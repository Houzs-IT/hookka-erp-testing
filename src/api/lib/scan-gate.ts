// ---------------------------------------------------------------------------
// scan-gate.ts — who may complete a job card by scanning it on the worker
// phone (owner 2026-11-17): "they need to scan department and punch card only
// able to scan my jobcard to mark as complete; for outsource dont need".
//
// A worker (x-worker-token caller) must, TODAY (Malaysia day):
//   1. be punched in and not yet punched out          → else PUNCH_IN_FIRST
//   2. have scanned a department QR                    → else DEPT_SCAN_FIRST
//   3. be completing a card of the department they last scanned
//                                                      → else WRONG_DEPT
// Outsource workers (worker flag, OSC… employee number, OUTSOURCE… name — the
// payroll rule) skip all three. The office scanner (a signed-in dashboard
// user) is not gated here.
//
// Before this the server checked none of it; the phone checked only the
// department, fell back to the punch / home department when no QR was
// scanned, and let the scan through when its check failed.
// ---------------------------------------------------------------------------
import { isOutsourceWorker } from "../../lib/labour-to-date";
import { todayYmdMalaysia } from "./worker-penalties";

type Db = {
  prepare: (sql: string) => {
    bind: (...v: unknown[]) => { first: <T>() => Promise<T | null> };
  };
};

export type ScanGateCode = "PUNCH_IN_FIRST" | "DEPT_SCAN_FIRST" | "WRONG_DEPT";
export type ScanGateFail = { code: ScanGateCode; error: string; currentDept?: string };

export interface ScanGateFacts {
  isOutsource: boolean;
  clockIn: string | null | undefined;
  clockOut: string | null | undefined;
  /** Department code of the worker's latest department-QR scan today, if any. */
  lastDeptScan: string | null | undefined;
  /** The department of the card being completed; null = check punch + scan only. */
  cardDept: string | null | undefined;
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase();

/** The rule, on plain facts (tested on its own). */
export function decideScanGate(f: ScanGateFacts): ScanGateFail | null {
  if (f.isOutsource) return null;
  if (!String(f.clockIn ?? "").trim() || String(f.clockOut ?? "").trim()) {
    return { code: "PUNCH_IN_FIRST", error: "Punch in first, then scan your department QR before completing a card." };
  }
  const last = norm(f.lastDeptScan);
  if (!last) {
    return { code: "DEPT_SCAN_FIRST", error: "Scan your department QR first, then scan the card." };
  }
  const card = norm(f.cardDept);
  if (card && card !== last) {
    return {
      code: "WRONG_DEPT",
      error: `This card belongs to ${card}, but your last department scan is ${last}. Scan the ${card} QR first.`,
      currentDept: last,
    };
  }
  return null;
}

const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "t" || v === "true";

/** Load today's facts for a worker and apply the rule. */
export async function checkWorkerScanGate(
  db: Db,
  workerId: string,
  cardDept: string | null | undefined,
  now: Date = new Date(),
): Promise<ScanGateFail | null> {
  const date = todayYmdMalaysia(now);
  const w = await db
    .prepare("SELECT empNo, name, isOutsource FROM workers WHERE id = ?")
    .bind(workerId)
    .first<Record<string, unknown>>();
  const isOutsource =
    truthy(w?.isOutsource ?? w?.is_outsource) ||
    isOutsourceWorker({ empNo: (w?.empNo ?? w?.emp_no) as string | null, name: w?.name as string | null });
  if (isOutsource) return null;
  const att = await db
    .prepare("SELECT clockIn, clockOut FROM attendance_records WHERE employeeId = ? AND date = ? ORDER BY clockIn DESC LIMIT 1")
    .bind(workerId, date)
    .first<Record<string, unknown>>();
  let lastDeptScan: string | null = null;
  try {
    const ds = await db
      .prepare("SELECT departmentcode FROM dept_scan_events WHERE workerid = ? AND date = ? ORDER BY atmin DESC, createdat DESC LIMIT 1")
      .bind(workerId, date)
      .first<Record<string, unknown>>();
    lastDeptScan = (ds?.departmentcode ?? ds?.departmentCode ?? null) as string | null;
  } catch {
    lastDeptScan = null; // no table yet = no scan
  }
  return decideScanGate({
    isOutsource,
    clockIn: (att?.clockIn ?? att?.clock_in) as string | null,
    clockOut: (att?.clockOut ?? att?.clock_out) as string | null,
    lastDeptScan,
    cardDept,
  });
}
