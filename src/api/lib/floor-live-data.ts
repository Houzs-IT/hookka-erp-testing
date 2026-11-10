// ---------------------------------------------------------------------------
// floor-live-data.ts — the DB side of Floor Live (owner 2026-11-10).
//
// computeFloorLive  one day from the source tables (live for today).
// Snapshots         a CLOSED day is saved once (owner: "每天存一份") into
//                   floor_live_snapshots and never overwritten, so a later
//                   edit to punches or job cards does not move that day.
//                   Written nightly by POST /api/internal/floor-live-snapshot
//                   (.github/workflows/floor-live-snapshot.yml).
// ---------------------------------------------------------------------------
import { buildPerfDays, dayKey } from "./workforce-perf";
import { ensureDeptScanEvents, liveOpenPunchRows } from "./punch-autofill";
import { buildFloorLive, piecesDoneByWorker, type FloorLiveDept, type FloorLiveWorker } from "./floor-live";

const DAY = (col: string) => `SUBSTR(CAST(${col} AS TEXT), 1, 10)`;

export type FloorLiveDay = { date: string; departments: FloorLiveDept[]; workers: FloorLiveWorker[] };

/**
 * One day. `nowMin` = minutes since midnight for TODAY (live: open punches
 * get hours so far); null = a closed day (hours from punch-out entries only,
 * each worker's day ends at their punch-out).
 */
export async function computeFloorLive(db: D1Database, orgId: string, date: string, nowMin: number | null): Promise<FloorLiveDay> {
  const live = nowMin != null;
  await ensureDeptScanEvents(db);
  const [deptRes, workerRes, attRes, scanRes, wheRes, jcRes] = await Promise.all([
    db.prepare(`SELECT code, name, is_production, sequence FROM departments`).all<{
      code: string; name: string | null; isProduction: boolean | number | null; sequence: number | string | null;
    }>(),
    db.prepare(`SELECT id, name, department_code FROM workers`).all<{ id: string; name: string | null; departmentCode: string | null }>(),
    db.prepare(
      `SELECT employee_id, department_code, clock_in, clock_out
         FROM attendance_records
        WHERE org_id = ? AND ${DAY("date")} = ?
        ORDER BY clock_in ASC`,
    ).bind(orgId, date).all<{ employeeId: string | null; departmentCode: string | null; clockIn: string | null; clockOut: string | null }>(),
    db.prepare(`SELECT workerid, departmentcode, atmin FROM dept_scan_events WHERE date = ? ORDER BY atmin`)
      .bind(date).all<{ workerid: string; departmentcode: string; atmin: number }>(),
    db.prepare(
      `SELECT worker_id, date, department_code, hours, notes
         FROM working_hour_entries
        WHERE org_id = ? AND ${DAY("date")} = ?`,
    ).bind(orgId, date).all<{ workerId: string | null; date: string | null; departmentCode: string | null; hours: number | string | null; notes: string | null }>(),
    db.prepare(
      `SELECT id, department_code, pic1_id, pic2_id, completed_date, est_minutes, actual_minutes, wip_qty
         FROM job_cards
        WHERE org_id = ? AND status IN ('COMPLETED','TRANSFERRED') AND ${DAY("completed_date")} = ?`,
    ).bind(orgId, date).all<{
      id: string; departmentCode: string | null; pic1Id: string | null; pic2Id: string | null;
      completedDate: string | null; estMinutes: number | string | null; actualMinutes: number | string | null; wipQty: number | string | null;
    }>(),
  ]);
  const departments = deptRes.results ?? [];
  const workers = workerRes.results ?? [];
  const attendance = attRes.results ?? [];
  const whe = wheRes.results ?? [];
  const jobCards = jcRes.results ?? [];

  // Piece-level PICs for the day's cards, in parallel chunks of 200.
  const ids = jobCards.map((j) => j.id);
  const chunks = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
  const picRes = await Promise.all(
    chunks.map((chunk) =>
      db
        .prepare(`SELECT job_card_id, pic1_id, pic2_id FROM piece_pics WHERE org_id = ? AND job_card_id IN (${chunk.map(() => "?").join(",")})`)
        .bind(orgId, ...chunk)
        .all<{ jobCardId: string; pic1Id: string | null; pic2Id: string | null }>(),
    ),
  );
  const pics = picRes.flatMap((r) => r.results ?? []);

  // Live only: hours so far for punches still open (working_hour_entries land
  // at punch-out). Same as the dashboard feed. Steps every 5 minutes.
  let liveRows: Awaited<ReturnType<typeof liveOpenPunchRows>> = [];
  if (live) {
    const isNonProd = (n: string | null) => String(n ?? "").startsWith("Non-production (approved)");
    const keyed = new Set<string>();
    const nonProdByWorker = new Map<string, number>();
    for (const r of whe) {
      if (dayKey(r.date) !== date || !r.workerId) continue;
      if (isNonProd(r.notes)) nonProdByWorker.set(r.workerId, (nonProdByWorker.get(r.workerId) ?? 0) + (Number(r.hours) || 0));
      else keyed.add(r.workerId);
    }
    const homeDept = new Map(workers.map((w) => [w.id, w.departmentCode]));
    const punches = attendance
      .filter((a) => a.employeeId && a.clockIn && !a.clockOut && !keyed.has(a.employeeId))
      .map((a) => ({ workerId: a.employeeId!, clockIn: a.clockIn!, homeDeptCode: homeDept.get(a.employeeId!) ?? a.departmentCode }));
    liveRows = await liveOpenPunchRows(db, { date, nowMin: Math.floor(nowMin! / 5) * 5, punches, nonProdHoursByWorker: nonProdByWorker });
  }

  const productionDepts = new Set(departments.filter((d) => d.isProduction).map((d) => d.code));
  const { perfDays } = buildPerfDays({ whe: [...whe, ...liveRows], jobCards, pics, productionDepts });
  const dayPerf = perfDays.find((d) => d.date === date);
  const perf = new Map((dayPerf?.workers ?? []).map((w) => [w.workerId, w]));

  const built = buildFloorLive({
    nowMin: nowMin ?? 0,
    closedDay: !live,
    departments,
    workers,
    attendance,
    scans: (scanRes.results ?? []).map((s) => ({ workerId: String(s.workerid), departmentCode: String(s.departmentcode), atMin: Number(s.atmin) || 0 })),
    perf,
    done: piecesDoneByWorker(jobCards, pics),
  });
  return { date, ...built };
}

// ---- snapshots --------------------------------------------------------------
let snapshotTableReady = false;
export async function ensureFloorLiveSnapshots(db: D1Database): Promise<void> {
  if (snapshotTableReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS floor_live_snapshots (
         org_id TEXT NOT NULL,
         date TEXT NOT NULL,
         data TEXT NOT NULL,
         created_at TEXT NOT NULL,
         PRIMARY KEY (org_id, date)
       )`,
    )
    .run();
  snapshotTableReady = true;
}

export async function readFloorLiveSnapshot(db: D1Database, orgId: string, date: string): Promise<FloorLiveDay | null> {
  await ensureFloorLiveSnapshots(db);
  const row = await db
    .prepare(`SELECT data FROM floor_live_snapshots WHERE org_id = ? AND date = ?`)
    .bind(orgId, date)
    .first<{ data: string }>();
  if (!row?.data) return null;
  try {
    return JSON.parse(row.data) as FloorLiveDay;
  } catch {
    return null;
  }
}

export async function readFloorLiveSnapshots(db: D1Database, orgId: string, from: string, to: string): Promise<FloorLiveDay[]> {
  await ensureFloorLiveSnapshots(db);
  const res = await db
    .prepare(`SELECT data FROM floor_live_snapshots WHERE org_id = ? AND date >= ? AND date <= ? ORDER BY date`)
    .bind(orgId, from, to)
    .all<{ data: string }>();
  const out: FloorLiveDay[] = [];
  for (const r of res.results ?? []) {
    try {
      out.push(JSON.parse(r.data) as FloorLiveDay);
    } catch {
      // a corrupt row is skipped, never fatal
    }
  }
  return out;
}

/**
 * Save closed days once. An existing snapshot is NEVER overwritten (the owner
 * wants each day frozen). Returns how many were written / already there.
 */
export async function saveFloorLiveSnapshots(
  db: D1Database,
  dates: readonly string[],
): Promise<{ written: number; existing: number; orgs: number }> {
  await ensureFloorLiveSnapshots(db);
  let written = 0;
  let existing = 0;
  const orgSet = new Set<string>();
  for (const date of dates) {
    const orgs = await db
      .prepare(`SELECT DISTINCT org_id FROM attendance_records WHERE ${DAY("date")} = ?`)
      .bind(date)
      .all<{ orgId: string }>();
    for (const o of orgs.results ?? []) {
      const orgId = String(o.orgId ?? "");
      if (!orgId) continue;
      orgSet.add(orgId);
      if (await readFloorLiveSnapshot(db, orgId, date)) {
        existing++;
        continue;
      }
      const day = await computeFloorLive(db, orgId, date, null);
      const r = await db
        .prepare(`INSERT INTO floor_live_snapshots (org_id, date, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (org_id, date) DO NOTHING`)
        .bind(orgId, date, JSON.stringify(day), new Date().toISOString())
        .run();
      const changes = Number((r as { meta?: { changes?: number } })?.meta?.changes ?? 1);
      if (changes > 0) written++;
      else existing++;
    }
  }
  return { written, existing, orgs: orgSet.size };
}
