// Payroll rows for the phone's Employees > Payroll tab. All periods are fetched
// and the newest one that has payslips is shown: the current month's payroll
// does not exist until it is run, so asking for "this month" was usually empty.
import { str } from "./helpers";

type RawRow = Record<string, unknown>;

export const PAYSLIPS_URL = "/api/payslips";

export function latestPayslips(rows: RawRow[]): { period: string; rows: RawRow[] } {
  const live = rows.filter((r) => str(r, "status") !== "CANCELLED");
  const period = live.reduce((m, r) => (str(r, "period") > m ? str(r, "period") : m), "");
  return { period, rows: period ? live.filter((r) => str(r, "period") === period) : [] };
}
