// use-department-labor — the data behind Employees → Department Labor (HK-0125 Phase 4, step 3). Existing endpoints only, each
// gated by the permission the server already enforces, all on the shared period (from / to). The screen needs `workers:read`
// AND `payslips:read` (the HANDOFF lists Department Labor as payslips:read; salaries and pay rules need both):
//   /api/working-hour-entries?from&to                    (no gate)       the raw entries, one row per worker × date × department
//   /api/workers                                         workers:read    salary, hours per day, days per month, OT multiplier, pay mode
//   /api/workers/salary/effective?period=YYYY-MM         workers:read    each worker's day-weighted effective salary for the month
//   /api/kv-config/public_holidays                       (no gate)       holidays (working days and OT multipliers)
//   /api/pay-rules                                       payslips:read   effective-dated Sunday / holiday multipliers
//   /api/departments                                     (no gate)       names, production flag, order
//   /api/payslips?period=YYYY-MM                         payslips:read   ONLY for a completed whole month with no category filter
//   /api/payroll-hour-deductions?period=YYYY-MM          payslips:read   (same condition) late / short docks for the under-recorded bridge
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import type { PayRuleVersion } from "../../../../lib/pay-rules";
import { payrollEligible, type DlCategory, type DlDept, type DlDock, type DlEntry, type DlPayslip, type DlWorker } from "./department-labor-model";
import type { YmdRange } from "./employees-dates";

function listOrNull<T>(resp: unknown): T[] | null {
  if (Array.isArray(resp)) return resp as T[];
  const d = (resp as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as T[]) : null;
}

export type Source<T> = { value: T | null; loading: boolean; error: boolean };

export type DepartmentLaborData = {
  permLoading: boolean;
  allowed: boolean;
  wantPayroll: boolean;
  workers: Source<DlWorker[]>;
  entries: Source<DlEntry[]>;
  depts: Source<DlDept[]>;
  holidays: Source<string[]>;
  effSalary: Source<Record<string, number>>;
  versions: Source<PayRuleVersion[]>;
  payslips: Source<DlPayslip[]>;
  docks: Source<DlDock[]>;
};

export function useDepartmentLabor(range: YmdRange, category: DlCategory, today: string): DepartmentLaborData {
  const { hasPermission, loading: permLoading } = usePermissions();
  const canWorkers = !permLoading && hasPermission("workers", "read");
  const canPayslips = !permLoading && hasPermission("payslips", "read");
  const allowed = canWorkers && canPayslips;
  const { from, to } = range;
  const ym = from.slice(0, 7);
  const wantPayroll = allowed && payrollEligible(range, category, today);

  const workersRes = useCachedJson<unknown>(allowed ? "/api/workers" : null, 300);
  const entriesRes = useCachedJson<unknown>(allowed ? `/api/working-hour-entries?from=${from}&to=${to}` : null, 120);
  const deptsRes = useCachedJson<unknown>(allowed ? "/api/departments" : null, 300);
  const holidaysRes = useCachedJson<{ data?: unknown }>(allowed ? "/api/kv-config/public_holidays" : null, 300);
  const effRes = useCachedJson<{ data?: unknown }>(allowed ? `/api/workers/salary/effective?period=${ym}` : null, 300);
  const rulesRes = useCachedJson<{ data?: { versions?: unknown } }>(allowed ? "/api/pay-rules" : null, 300);
  const slipsRes = useCachedJson<unknown>(wantPayroll ? `/api/payslips?period=${ym}` : null, 300);
  const docksRes = useCachedJson<unknown>(wantPayroll ? `/api/payroll-hour-deductions?period=${ym}` : null, 300);

  const src = <T,>(res: { loading: boolean; error?: unknown }, value: T | null): Source<T> => ({ value, loading: res.loading, error: !!res.error });

  // `data: null` is a legitimate "no holidays saved"; a missing body is a failure.
  const hol = holidaysRes.data === null ? null : holidaysRes.data.data === null ? [] : Array.isArray(holidaysRes.data.data) ? (holidaysRes.data.data as string[]) : null;
  const eff = effRes.data === null ? null : effRes.data.data && typeof effRes.data.data === "object" && !Array.isArray(effRes.data.data) ? (effRes.data.data as Record<string, number>) : null;
  const ver = rulesRes.data === null ? null : Array.isArray(rulesRes.data.data?.versions) ? (rulesRes.data.data?.versions as PayRuleVersion[]) : null;

  return {
    permLoading,
    allowed,
    wantPayroll,
    workers: src(workersRes, listOrNull<DlWorker>(workersRes.data)),
    entries: src(entriesRes, listOrNull<DlEntry>(entriesRes.data)),
    depts: src(deptsRes, listOrNull<DlDept>(deptsRes.data)),
    holidays: src(holidaysRes, hol),
    effSalary: src(effRes, eff),
    versions: src(rulesRes, ver),
    payslips: src(slipsRes, listOrNull<DlPayslip>(slipsRes.data)),
    docks: src(docksRes, listOrNull<DlDock>(docksRes.data)),
  };
}

/**
 * What the screen can draw yet: still loading, the hours data failed (no screen), the cost data failed (hours and workers only,
 * cost "Unavailable"), or ready. Payroll data failing never blocks the estimate; it only withholds "Total / matches Payroll".
 */
export function laborState(d: DepartmentLaborData): { loading: boolean; failed: boolean; costDataOk: boolean; ready: boolean } {
  const need = [d.workers, d.entries, d.depts, d.holidays, d.effSalary, d.versions, ...(d.wantPayroll ? [d.payslips, d.docks] : [])];
  const loading = d.permLoading || (d.allowed && need.some((s) => s.value === null && s.loading));
  const failed = d.allowed && !loading && (d.entries.value === null || d.depts.value === null || d.workers.value === null);
  const costDataOk = d.workers.value !== null && d.holidays.value !== null && d.effSalary.value !== null && d.versions.value !== null;
  return { loading, failed, costDataOk, ready: d.allowed && !loading && !failed };
}
