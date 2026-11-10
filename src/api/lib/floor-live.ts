// ---------------------------------------------------------------------------
// floor-live.ts — Dashboard › Operations › Floor Live (owner 2026-11-10).
//
// "Who is where right now", from each worker's department QR scans, so a
// production worker who scans into a non-production department (Warehousing,
// Repair, Maintenance, R&D) and stays there is visible — time booked outside
// production while the work happens elsewhere inflates a department's
// efficiency. Pure (no DB): floor-live-data.ts gathers rows and calls these.
//
// Rules (owner rulings 2026-11-10):
//   • where = the department of the worker's LAST scan of the day; no scan =
//     home department (same rule as the punch auto-fill split);
//   • production rows show pieces done + efficiency (earned job-card minutes ÷
//     production minutes worked — the SAME figure as the Employees dashboard,
//     from workforce-perf.ts);
//   • non-production rows show the time they scanned in; RED when they stayed
//     more than 60 minutes (live: still punched in and scanned in over an hour
//     ago; a closed day: until their punch-out);
//   • Production Shortfall is not shown (a worker last scanned there is shown
//     under their home department);
//   • names only (no EMP number on screen);
//   • a closed day is saved once as a snapshot and never recomputed; Month /
//     Quarter / Year read those snapshots (summarizeFloorLive).
// ---------------------------------------------------------------------------

export const FLOOR_LIVE_HIDDEN_DEPTS = new Set(["PRODUCTION_SHORTFALL"]);
export const NON_PROD_RED_AFTER_MIN = 60;
const DAY_END_MIN = 24 * 60;

export type FloorLiveDept = { code: string; name: string; isProduction: boolean; sequence: number };
export type FloorLiveWorker = {
  id: string;
  name: string;
  homeDept: string;
  dept: string;
  isProduction: boolean;
  clockIn: string | null;
  clockOut: string | null;
  /** HH:MM of the last department scan; null = never scanned (home dept). */
  scannedAt: string | null;
  done: number;
  workingMinutes: number;
  earnedMinutes: number;
  effPct: number | null;
  /** Minutes spent in non-production departments, from the scan segments. */
  nonProdMinutes: number;
  /** In a non-production department for more than an hour (see rules). */
  overHourNonProd: boolean;
};

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMin = (t: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Pieces each worker completed: one per piece-PIC row, else the card's qty to each PIC. */
export function piecesDoneByWorker(
  jobCards: readonly { id: string; pic1Id: string | null; pic2Id: string | null; wipQty: number | string | null }[],
  pics: readonly { jobCardId: string; pic1Id: string | null; pic2Id: string | null }[],
): Map<string, number> {
  const byJc = new Map<string, { pic1Id: string | null; pic2Id: string | null }[]>();
  for (const p of pics) {
    const a = byJc.get(p.jobCardId) ?? [];
    a.push(p);
    byJc.set(p.jobCardId, a);
  }
  const out = new Map<string, number>();
  const add = (w: string | null, n: number) => {
    if (w) out.set(w, (out.get(w) ?? 0) + n);
  };
  for (const jc of jobCards) {
    const pieces = byJc.get(jc.id);
    if (pieces && pieces.length) {
      for (const p of pieces) {
        add(p.pic1Id, 1);
        add(p.pic2Id, 1);
      }
    } else {
      const q = Math.max(1, Math.round(Number(jc.wipQty) || 1));
      add(jc.pic1Id, q);
      add(jc.pic2Id, q);
    }
  }
  return out;
}

export function buildFloorLive(input: {
  /** Minutes since midnight now (live) — ignored when `closedDay`. */
  nowMin: number;
  /** A finished day: each worker's day ends at their punch-out (else midnight). */
  closedDay?: boolean;
  departments: readonly { code: string; name: string | null; isProduction: boolean | number | null; sequence: number | string | null }[];
  workers: readonly { id: string; name: string | null; departmentCode: string | null }[];
  attendance: readonly { employeeId: string | null; clockIn: string | null; clockOut: string | null }[];
  scans: readonly { workerId: string; departmentCode: string; atMin: number }[];
  perf: ReadonlyMap<string, { workingMinutes: number; productionMinutes: number }>;
  done: ReadonlyMap<string, number>;
}): { departments: FloorLiveDept[]; workers: FloorLiveWorker[] } {
  const departments: FloorLiveDept[] = input.departments
    .filter((d) => d.code && !FLOOR_LIVE_HIDDEN_DEPTS.has(d.code))
    .map((d) => ({ code: d.code, name: d.name || d.code, isProduction: !!d.isProduction, sequence: Number(d.sequence) || 0 }))
    .sort((a, b) => a.sequence - b.sequence);
  const deptByCode = new Map(departments.map((d) => [d.code, d]));
  const workerById = new Map(input.workers.map((w) => [w.id, w]));

  const scansByWorker = new Map<string, { departmentCode: string; atMin: number }[]>();
  for (const s of input.scans) {
    const a = scansByWorker.get(s.workerId) ?? [];
    a.push(s);
    scansByWorker.set(s.workerId, a);
  }
  for (const a of scansByWorker.values()) a.sort((x, y) => x.atMin - y.atMin);

  const seen = new Set<string>();
  const workers: FloorLiveWorker[] = [];
  for (const a of input.attendance) {
    const id = a.employeeId;
    if (!id || seen.has(id) || !a.clockIn) continue;
    seen.add(id);
    const w = workerById.get(id);
    const homeDept = w?.departmentCode ?? "";
    const scans = scansByWorker.get(id) ?? [];
    const scan = scans.length ? scans[scans.length - 1] : undefined;
    // A scan into a hidden or unknown department falls back to home.
    const scannedDept = scan && deptByCode.has(scan.departmentCode) ? scan.departmentCode : null;
    const dept = scannedDept ?? homeDept;
    const d = deptByCode.get(dept);
    const isProduction = d ? d.isProduction : true;
    const p = input.perf.get(id);
    const workingMinutes = Math.round(p?.workingMinutes ?? 0);
    const earnedMinutes = Math.round(p?.productionMinutes ?? 0);
    const outMin = toMin(a.clockOut);
    // Where the day ends for this worker: live = now (or punch-out if out);
    // a closed day = punch-out, else midnight.
    const endMin = input.closedDay ? (outMin ?? DAY_END_MIN) : (outMin ?? input.nowMin);

    // Time in non-production departments: each scan opens a segment that
    // runs to the next scan or the end of the day.
    let nonProdMinutes = 0;
    scans.forEach((s, i) => {
      const next = i + 1 < scans.length ? scans[i + 1].atMin : endMin;
      const seg = Math.max(0, Math.min(next, endMin) - s.atMin);
      const sd = deptByCode.get(s.departmentCode);
      if (sd && !sd.isProduction) nonProdMinutes += seg;
    });

    const lastStay = scan && scannedDept ? endMin - scan.atMin : 0;
    const overHourNonProd = input.closedDay
      ? !isProduction && lastStay > NON_PROD_RED_AFTER_MIN
      : !isProduction && !a.clockOut && lastStay > NON_PROD_RED_AFTER_MIN;

    workers.push({
      id,
      name: w?.name ?? id,
      homeDept,
      dept,
      isProduction,
      clockIn: a.clockIn,
      clockOut: a.clockOut,
      scannedAt: scannedDept && scan ? hhmm(scan.atMin) : null,
      done: input.done.get(id) ?? 0,
      workingMinutes,
      earnedMinutes,
      effPct: workingMinutes > 0 ? Math.round((earnedMinutes / workingMinutes) * 100) : null,
      nonProdMinutes,
      overHourNonProd,
    });
  }
  workers.sort((x, y) => x.name.localeCompare(y.name));
  return { departments, workers };
}

// ---- Month / Quarter / Year (owner 2026-11-10) ----------------------------
export type FloorLiveSummaryRow = {
  id: string;
  name: string;
  homeDept: string;
  days: number;
  done: number;
  workingMinutes: number;
  earnedMinutes: number;
  effPct: number | null;
  nonProdMinutes: number;
  /** Days on which they stayed in a non-production department over an hour. */
  overHourDays: number;
};

/** Sum saved day snapshots per worker; grouped by their latest home department. */
export function summarizeFloorLive(
  days: readonly { date: string; workers: readonly FloorLiveWorker[] }[],
): FloorLiveSummaryRow[] {
  const by = new Map<string, FloorLiveSummaryRow & { lastDate: string }>();
  for (const day of [...days].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const w of day.workers) {
      const r = by.get(w.id) ?? {
        id: w.id, name: w.name, homeDept: w.homeDept, days: 0, done: 0, workingMinutes: 0,
        earnedMinutes: 0, effPct: null, nonProdMinutes: 0, overHourDays: 0, lastDate: "",
      };
      r.days += 1;
      r.done += w.done || 0;
      r.workingMinutes += w.workingMinutes || 0;
      r.earnedMinutes += w.earnedMinutes || 0;
      r.nonProdMinutes += w.nonProdMinutes || 0;
      if (w.overHourNonProd) r.overHourDays += 1;
      r.name = w.name;
      r.homeDept = w.homeDept || r.homeDept;
      r.lastDate = day.date;
      by.set(w.id, r);
    }
  }
  return [...by.values()]
    .map(({ lastDate: _lastDate, ...r }) => ({
      ...r,
      effPct: r.workingMinutes > 0 ? Math.round((r.earnedMinutes / r.workingMinutes) * 100) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
