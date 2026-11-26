// ---------------------------------------------------------------------------
// Removing a worker-day from Working Hours (HK-0178, BUG-2026-11-26-001).
//
// The grid builds a row for every PUNCH that has no working-hour entry
// (employees.tsx refresh). So deleting only the entry left the punch behind,
// and the row came back on the next refresh. When the LAST entry of a
// worker-day goes, the punch goes too, and so does the AUTO short-hour dock it
// produced (a MANUAL dock is the owner's call and stays).
//
// Every statement is guarded by "no entry left for this worker-day", so a
// split day (several entries sharing one punch) keeps its punch until its last
// entry is removed. Run them in ONE batch after the entry delete, so the punch
// and dock can never outlive a failed half.
// ---------------------------------------------------------------------------
import { AUTO_DOCK_SOURCE } from "./attendance-deduct";

type RemoveDayDb = D1Database;

const NO_ENTRY_LEFT =
  "NOT EXISTS (SELECT 1 FROM working_hour_entries WHERE workerId = ? AND date = ?)";

/** Statements that drop the day's punch + AUTO dock once no entry is left. */
export function punchCleanupStatements(
  db: RemoveDayDb,
  orgId: string,
  workerId: string,
  date: string,
) {
  return [
    db
      .prepare(
        `DELETE FROM attendance_records WHERE employeeId = ? AND date = ? AND orgId = ?
           AND (clockIn IS NOT NULL OR clockOut IS NOT NULL) AND ${NO_ENTRY_LEFT}`,
      )
      .bind(workerId, date, orgId, workerId, date),
    db
      .prepare(
        `DELETE FROM payroll_hour_deductions WHERE workerId = ? AND date = ? AND source = ?
           AND ${NO_ENTRY_LEFT}`,
      )
      .bind(workerId, date, AUTO_DOCK_SOURCE, workerId, date),
  ];
}

/** Approved / paid payslips for the month → the day is frozen (same rule as the auto dock). */
export async function isPayrollLocked(db: RemoveDayDb, date: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM payslips WHERE period = ? AND status != 'DRAFT'")
    .bind(date.slice(0, 7))
    .first<{ c: number | string }>();
  return Number(row?.c ?? 0) > 0;
}

export const PAYROLL_LOCKED_ERROR =
  "Payroll for this month is approved. Withdraw approval before removing this day.";
