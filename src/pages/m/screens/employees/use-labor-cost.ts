// use-labor-cost — the data behind Employees → Labor Cost (HK-0125 Phase 5b). Existing endpoints only, each gated by the permission
// the server already enforces, all on the shared period. The screen needs `workers:read` AND `payslips:read` (the HANDOFF lists Labor
// Cost as "workers + payslips read"); revenue additionally needs `revenue-figures:read` and is simply not requested without it:
//   /api/working-hour-entries?from&to                          (no gate)               the raw entries
//   /api/workers                                               workers:read            salary, hours per day, days per month, pay mode
//   /api/workers/salary/effective?period=YYYY-MM               workers:read            day-weighted effective salary
//   /api/kv-config/public_holidays                             (no gate)
//   /api/pay-rules                                             payslips:read           effective-dated overtime multipliers
//   /api/departments                                           (no gate)
//   /api/working-hour-entries/production-revenue?from&to       revenue-figures:read    category totals, per (department|category)
//                                                                                      revenue and the recognised unit rows
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import type { PayRuleVersion } from "../../../../lib/pay-rules";
import type { DlDept, DlEntry, DlWorker } from "./department-labor-model";
import type { RevenueUnit } from "./labor-cost-model";
import type { YmdRange } from "./employees-dates";

function listOrNull<T>(resp: unknown): T[] | null {
  if (Array.isArray(resp)) return resp as T[];
  const d = (resp as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as T[]) : null;
}

export type Source<T> = { value: T | null; loading: boolean; error: boolean };
export type RevenueData = { byDeptCategory: Record<string, number>; rows: RevenueUnit[] };

export type LaborCostData = {
  permLoading: boolean;
  allowed: boolean;
  canRevenue: boolean;
  workers: Source<DlWorker[]>;
  entries: Source<DlEntry[]>;
  depts: Source<DlDept[]>;
  holidays: Source<string[]>;
  effSalary: Source<Record<string, number>>;
  versions: Source<PayRuleVersion[]>;
  revenue: Source<RevenueData>;
};

export function useLaborCost(range: YmdRange): LaborCostData {
  const { hasPermission, loading: permLoading } = usePermissions();
  const allowed = !permLoading && hasPermission("workers", "read") && hasPermission("payslips", "read");
  const canRevenue = allowed && hasPermission("revenue-figures", "read");
  const { from, to } = range;
  const ym = from.slice(0, 7);

  const workersRes = useCachedJson<unknown>(allowed ? "/api/workers" : null, 300);
  const entriesRes = useCachedJson<unknown>(allowed ? `/api/working-hour-entries?from=${from}&to=${to}` : null, 120);
  const deptsRes = useCachedJson<unknown>(allowed ? "/api/departments" : null, 300);
  const holidaysRes = useCachedJson<{ data?: unknown }>(allowed ? "/api/kv-config/public_holidays" : null, 300);
  const effRes = useCachedJson<{ data?: unknown }>(allowed ? `/api/workers/salary/effective?period=${ym}` : null, 300);
  const rulesRes = useCachedJson<{ data?: { versions?: unknown } }>(allowed ? "/api/pay-rules" : null, 300);
  const revRes = useCachedJson<{ success?: boolean; data?: { byDeptCategory?: unknown; rows?: unknown } }>(canRevenue ? `/api/working-hour-entries/production-revenue?from=${from}&to=${to}` : null, 120);

  const src = <T,>(res: { loading: boolean; error?: unknown }, value: T | null): Source<T> => ({ value, loading: res.loading, error: !!res.error });
  const hol = holidaysRes.data === null ? null : holidaysRes.data.data === null ? [] : Array.isArray(holidaysRes.data.data) ? (holidaysRes.data.data as string[]) : null;
  const eff = effRes.data === null ? null : effRes.data.data && typeof effRes.data.data === "object" && !Array.isArray(effRes.data.data) ? (effRes.data.data as Record<string, number>) : null;
  const ver = rulesRes.data === null ? null : Array.isArray(rulesRes.data.data?.versions) ? (rulesRes.data.data?.versions as PayRuleVersion[]) : null;
  const rev: RevenueData | null =
    revRes.data && revRes.data.success !== false && revRes.data.data
      ? {
          byDeptCategory: revRes.data.data.byDeptCategory && typeof revRes.data.data.byDeptCategory === "object" ? (revRes.data.data.byDeptCategory as Record<string, number>) : {},
          rows: Array.isArray(revRes.data.data.rows) ? (revRes.data.data.rows as RevenueUnit[]) : [],
        }
      : null;

  return {
    permLoading,
    allowed,
    canRevenue,
    workers: src(workersRes, listOrNull<DlWorker>(workersRes.data)),
    entries: src(entriesRes, listOrNull<DlEntry>(entriesRes.data)),
    depts: src(deptsRes, listOrNull<DlDept>(deptsRes.data)),
    holidays: src(holidaysRes, hol),
    effSalary: src(effRes, eff),
    versions: src(rulesRes, ver),
    revenue: src(revRes, rev),
  };
}

export type RevenueState = "locked" | "loading" | "failed" | "ok";

/**
 * What the screen can draw yet. Hours data failing blocks the screen; cost data failing (workers, effective salary, holidays, pay
 * rules) leaves hours with "Unavailable" money; revenue is "locked" without the permission, "failed" when its request failed.
 */
export function laborCostState(d: LaborCostData): { loading: boolean; failed: boolean; costDataOk: boolean; revenue: RevenueState; ready: boolean } {
  const need = [d.workers, d.entries, d.depts, d.holidays, d.effSalary, d.versions, ...(d.canRevenue ? [d.revenue] : [])];
  const loading = d.permLoading || (d.allowed && need.some((s) => s.value === null && s.loading));
  const failed = d.allowed && !loading && (d.entries.value === null || d.depts.value === null || d.workers.value === null);
  const costDataOk = d.workers.value !== null && d.holidays.value !== null && d.effSalary.value !== null && d.versions.value !== null;
  const revenue: RevenueState = !d.canRevenue ? "locked" : d.revenue.value ? "ok" : loading ? "loading" : "failed";
  return { loading, failed, costDataOk, revenue, ready: d.allowed && !loading && !failed };
}
