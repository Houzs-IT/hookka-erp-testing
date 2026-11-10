// ---------------------------------------------------------------------------
// floor-live.ts — Dashboard › Operations › Floor Live (owner 2026-11-10).
//
// "Who is where right now", from each worker's department QR scans, so a
// production worker who scans into a non-production department (Warehousing,
// Repair, Maintenance, R&D) and stays there is visible — time booked outside
// production while the work happens elsewhere inflates a department's
// efficiency. Pure (no DB): the route gathers rows and calls buildFloorLive.
//
// Rules (owner rulings 2026-11-10):
//   • where = the department of the worker's LAST scan today; no scan = home
//     department (same rule as the punch auto-fill split);
//   • production rows show pieces done today + efficiency (earned job-card
//     minutes ÷ production minutes worked so far — the SAME figure as the
//     Employees dashboard, from workforce-perf.ts);
//   • non-production rows show the time they scanned in; RED when that was
//     more than 60 minutes ago and they have not punched out;
//   • Production Shortfall is not shown (a worker last scanned there is shown
//     under their home department);
//   • names only (no EMP number on screen).
// ---------------------------------------------------------------------------

export const FLOOR_LIVE_HIDDEN_DEPTS = new Set(["PRODUCTION_SHORTFALL"]);
export const NON_PROD_RED_AFTER_MIN = 60;

export type FloorLiveDept = { code: string; name: string; isProduction: boolean; sequence: number };
export type FloorLiveWorker = {
  id: string;
  name: string;
  homeDept: string;
  dept: string;
  isProduction: boolean;
  clockIn: string | null;
  clockOut: string | null;
  /** HH:MM of the last department scan today; null = never scanned (home dept). */
  scannedAt: string | null;
  done: number;
  workingMinutes: number;
  earnedMinutes: number;
  effPct: number | null;
  /** Non-production and scanned in more than an hour ago while still punched in. */
  overHourNonProd: boolean;
};

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

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
  nowMin: number;
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

  const lastScan = new Map<string, { departmentCode: string; atMin: number }>();
  for (const s of input.scans) {
    const prev = lastScan.get(s.workerId);
    if (!prev || s.atMin >= prev.atMin) lastScan.set(s.workerId, s);
  }

  const seen = new Set<string>();
  const workers: FloorLiveWorker[] = [];
  for (const a of input.attendance) {
    const id = a.employeeId;
    if (!id || seen.has(id) || !a.clockIn) continue;
    seen.add(id);
    const w = workerById.get(id);
    const homeDept = w?.departmentCode ?? "";
    const scan = lastScan.get(id);
    // A scan into a hidden or unknown department falls back to home.
    const scannedDept = scan && deptByCode.has(scan.departmentCode) ? scan.departmentCode : null;
    const dept = scannedDept ?? homeDept;
    const d = deptByCode.get(dept);
    const isProduction = d ? d.isProduction : true;
    const p = input.perf.get(id);
    const workingMinutes = Math.round(p?.workingMinutes ?? 0);
    const earnedMinutes = Math.round(p?.productionMinutes ?? 0);
    const scannedAt = scannedDept && scan ? hhmm(scan.atMin) : null;
    const stillIn = !a.clockOut;
    workers.push({
      id,
      name: w?.name ?? id,
      homeDept,
      dept,
      isProduction,
      clockIn: a.clockIn,
      clockOut: a.clockOut,
      scannedAt,
      done: input.done.get(id) ?? 0,
      workingMinutes,
      earnedMinutes,
      effPct: workingMinutes > 0 ? Math.round((earnedMinutes / workingMinutes) * 100) : null,
      overHourNonProd:
        !isProduction && stillIn && !!scan && !!scannedDept && input.nowMin - scan.atMin > NON_PROD_RED_AFTER_MIN,
    });
  }
  workers.sort((x, y) => x.name.localeCompare(y.name));
  return { departments, workers };
}
