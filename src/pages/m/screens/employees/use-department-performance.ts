// use-department-performance — the data behind Employees → Department Performance (HK-0125 Phase 5a). One existing endpoint, gated
// by the permission the server already enforces (`workers:read`), used two ways with the SAME department and category filters:
//   the LIST     /api/department-performance?view=summary&from&to&departmentCode&category   totals + one row per day (small)
//   one DAY      /api/department-performance?from=D&to=D&departmentCode&category           that date's workers and their job cards
// plus /api/departments (no gate) for the filter's department names.
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { dayUrl, listUrl, type DpCategory, type DpData } from "./department-performance-model";
import type { YmdRange } from "./employees-dates";

type Resp = { success?: boolean; data?: DpData };
const dataOf = (r: Resp | null): DpData | null => (r && r.success !== false && r.data && r.data.totals && Array.isArray(r.data.daily) ? r.data : null);

export type DpDept = { code: string; name?: string; shortName?: string; isProduction?: boolean; sequence?: number };

export function useDepartmentPerformance(range: YmdRange, dept: string, cat: DpCategory, day: string | null) {
  const { hasPermission, loading: permLoading } = usePermissions();
  const allowed = !permLoading && hasPermission("workers", "read");
  const list = useCachedJson<Resp>(allowed ? listUrl(range, dept, cat) : null, 120);
  const detail = useCachedJson<Resp>(allowed && day ? dayUrl(day, dept, cat) : null, 120);
  const depts = useCachedJson<unknown>(allowed ? "/api/departments" : null, 300);
  const deptRows = Array.isArray(depts.data) ? (depts.data as DpDept[]) : Array.isArray((depts.data as { data?: unknown } | null)?.data) ? ((depts.data as { data: DpDept[] }).data) : null;
  return {
    permLoading,
    allowed,
    list: { data: dataOf(list.data), loading: list.loading, error: !!list.error || (list.data !== null && dataOf(list.data) === null) },
    detail: { data: dataOf(detail.data), loading: detail.loading, error: !!detail.error || (detail.data !== null && dataOf(detail.data) === null) },
    depts: deptRows,
  };
}
