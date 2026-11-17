// use-payroll — the data behind Employees → Payroll, the LIST (HK-0125 Phase 6a). Existing endpoints only; `payslips:read` is the gate the
// server enforces on both payslip requests (without it a lock card shows):
//   /api/payslips?period=YYYY-MM            the STORED payslips of the month (status DRAFT / APPROVED / PAID as the API returns it)
//   /api/payslips/projected?period=YYYY-MM  desktop's live estimate — requested ONLY for the current Malaysia month, and only after the
//                                           stored request succeeded with zero records (payroll-model.ts `wantEstimate`)
//   /api/departments                        (no gate) names for the card and the filter
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { payView, payslipRows, wantEstimate, type PayView, type Req } from "./payroll-model";

export type DeptRow = { code: string; name?: string; shortName?: string };

export function usePayroll(month: string, today: string): { permLoading: boolean; allowed: boolean; view: PayView; depts: DeptRow[] } {
  const { hasPermission, loading: permLoading } = usePermissions();
  const allowed = !permLoading && hasPermission("payslips", "read");
  const stored = useCachedJson<unknown>(allowed ? `/api/payslips?period=${month}` : null, 120);
  const storedReq: Req = { rows: payslipRows(stored.data), loading: stored.loading, error: !!stored.error || (stored.data !== null && payslipRows(stored.data) === null) };
  const projected = useCachedJson<unknown>(allowed && wantEstimate(month, today, storedReq) ? `/api/payslips/projected?period=${month}` : null, 120);
  const projReq: Req = { rows: payslipRows(projected.data), loading: projected.loading, error: !!projected.error || (projected.data !== null && payslipRows(projected.data) === null) };
  const depts = useCachedJson<unknown>(allowed ? "/api/departments" : null, 300);
  const deptRows = Array.isArray(depts.data) ? (depts.data as DeptRow[]) : Array.isArray((depts.data as { data?: unknown } | null)?.data) ? ((depts.data as { data: DeptRow[] }).data) : [];
  return { permLoading, allowed, view: allowed ? payView(month, today, storedReq, projReq) : { kind: "loading" }, depts: deptRows };
}
