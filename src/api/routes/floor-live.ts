// ---------------------------------------------------------------------------
// GET /api/dashboard/floor-live — Dashboard › Operations › Floor Live
// (owner 2026-11-10). Read-only. Today (Malaysia), every worker who punched
// in: where they are (last department scan, else home), pieces done today,
// live efficiency (the Employees dashboard's own figure), and — for
// non-production — when they scanned in, flagged after an hour.
// Shaping rules live in src/api/lib/floor-live.ts.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { requireReadOrDashboardTab } from "../lib/rbac";
import { getOrgId } from "../lib/tenant";
import { buildPerfDays, dayKey } from "../lib/workforce-perf";
import { ensureDeptScanEvents, liveOpenPunchRows } from "../lib/punch-autofill";
import { buildFloorLive, piecesDoneByWorker } from "../lib/floor-live";

const app = new Hono<Env>();

const DAY = (col: string) => `SUBSTR(CAST(${col} AS TEXT), 1, 10)`;

app.get("/", async (c) => {
  const denied = await requireReadOrDashboardTab(c, "production-orders", "operations");
  if (denied) return denied;
  const db = c.var.DB;
  const orgId = getOrgId(c);

  const myNow = new Date(Date.now() + 8 * 3600_000);
  const today = myNow.toISOString().slice(0, 10);
  const nowMin = myNow.getUTCHours() * 60 + myNow.getUTCMinutes();
  // Efficiency's "worked so far" steps every 5 minutes, matching the refresh.
  const nowSlotMin = Math.floor(nowMin / 5) * 5;

  try {
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
      ).bind(orgId, today).all<{ employeeId: string | null; departmentCode: string | null; clockIn: string | null; clockOut: string | null }>(),
      db.prepare(
        `SELECT workerid, departmentcode, atmin FROM dept_scan_events WHERE date = ? ORDER BY atmin`,
      ).bind(today).all<{ workerid: string; departmentcode: string; atmin: number }>(),
      db.prepare(
        `SELECT worker_id, date, department_code, hours, notes
           FROM working_hour_entries
          WHERE org_id = ? AND ${DAY("date")} = ?`,
      ).bind(orgId, today).all<{ workerId: string | null; date: string | null; departmentCode: string | null; hours: number | string | null; notes: string | null }>(),
      db.prepare(
        `SELECT id, department_code, pic1_id, pic2_id, completed_date, est_minutes, actual_minutes, wip_qty
           FROM job_cards
          WHERE org_id = ? AND status IN ('COMPLETED','TRANSFERRED') AND ${DAY("completed_date")} = ?`,
      ).bind(orgId, today).all<{
        id: string; departmentCode: string | null; pic1Id: string | null; pic2Id: string | null;
        completedDate: string | null; estMinutes: number | string | null; actualMinutes: number | string | null; wipQty: number | string | null;
      }>(),
    ]);
    const departments = deptRes.results ?? [];
    const workers = workerRes.results ?? [];
    const attendance = attRes.results ?? [];
    const whe = wheRes.results ?? [];
    const jobCards = jcRes.results ?? [];

    // Piece-level PICs for today's cards only.
    // Chunks of 200 ids, fetched in parallel (no query inside a loop).
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

    // Hours so far for punches still open (same as the dashboard feed):
    // working_hour_entries land only at punch-out.
    const isNonProd = (n: string | null) => String(n ?? "").startsWith("Non-production (approved)");
    const keyed = new Set<string>();
    const nonProdByWorker = new Map<string, number>();
    for (const r of whe) {
      if (dayKey(r.date) !== today || !r.workerId) continue;
      if (isNonProd(r.notes)) nonProdByWorker.set(r.workerId, (nonProdByWorker.get(r.workerId) ?? 0) + (Number(r.hours) || 0));
      else keyed.add(r.workerId);
    }
    const homeDept = new Map(workers.map((w) => [w.id, w.departmentCode]));
    const punches = attendance
      .filter((a) => a.employeeId && a.clockIn && !a.clockOut && !keyed.has(a.employeeId))
      .map((a) => ({ workerId: a.employeeId!, clockIn: a.clockIn!, homeDeptCode: homeDept.get(a.employeeId!) ?? a.departmentCode }));
    const live = await liveOpenPunchRows(db, { date: today, nowMin: nowSlotMin, punches, nonProdHoursByWorker: nonProdByWorker });

    const productionDepts = new Set(departments.filter((d) => d.isProduction).map((d) => d.code));
    const { perfDays } = buildPerfDays({ whe: [...whe, ...live], jobCards, pics, productionDepts });
    const todayPerf = perfDays.find((d) => d.date === today);
    const perf = new Map((todayPerf?.workers ?? []).map((w) => [w.workerId, w]));

    const data = buildFloorLive({
      nowMin,
      departments,
      workers,
      attendance,
      scans: (scanRes.results ?? []).map((s) => ({ workerId: String(s.workerid), departmentCode: String(s.departmentcode), atMin: Number(s.atmin) || 0 })),
      perf,
      done: piecesDoneByWorker(jobCards, pics),
    });
    c.header("Cache-Control", "no-store");
    return c.json({
      success: true,
      date: today,
      asOf: `${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`,
      ...data,
    });
  } catch (e) {
    console.error("[floor-live]", e);
    return c.json({ success: false, error: e instanceof Error ? e.message : "Could not load the floor" }, 500);
  }
});

export default app;
