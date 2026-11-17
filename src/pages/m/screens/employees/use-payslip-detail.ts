// use-payslip-detail — the EXTRA data a payslip detail page may show, each requested only where the existing permission allows it and
// only when the open payslip has something to explain (HK-0125 Phase 6b). The payslip itself is the row the list already loaded.
//   /api/employee-advances?period=      payslips:read          the advance dates (chips), only when the payslip has an advance deduction
//   /api/worker-penalties?period=       worker-penalties:read  the penalty references (chips), only when it has a penalty deduction
//   /api/pay-rules                      payslips:read          \  only to VERIFY the hourly-rate formula (payroll-model: shown only when it
//   /api/workers                        workers:read           /  reproduces the server's rate); without either the formula is simply left out
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import type { PayRuleVersion } from "../../../../lib/pay-rules";
import { advanceChips, penaltyChips, type Advance, type DetailRow, type Penalty } from "./payslip-detail-model";

const listOf = <T,>(r: unknown): T[] | null => (Array.isArray((r as { data?: unknown } | null)?.data) ? ((r as { data: T[] }).data) : Array.isArray(r) ? (r as T[]) : null);

type WorkerLite = { id: string; workingHoursPerDay?: number; payMode?: string | null; dailyRateSen?: number | null };

export function usePayslipDetail(row: DetailRow | null) {
  const { hasPermission } = usePermissions();
  const period = row?.period ?? "";
  const wantAdv = !!row && Number(row.advanceDeductionSen) > 0 && hasPermission("payslips", "read");
  const wantPen = !!row && Number(row.penaltyDeductionSen) > 0 && hasPermission("worker-penalties", "read");
  const canRules = !!row && hasPermission("payslips", "read");
  const canWorkers = !!row && hasPermission("workers", "read");

  const adv = useCachedJson<unknown>(wantAdv ? `/api/employee-advances?period=${period}` : null, 120);
  const pen = useCachedJson<unknown>(wantPen ? `/api/worker-penalties?period=${period}` : null, 120);
  const rules = useCachedJson<{ data?: { versions?: unknown } }>(canRules ? "/api/pay-rules" : null, 300);
  const workers = useCachedJson<unknown>(canWorkers ? "/api/workers" : null, 300);

  const advances = listOf<Advance>(adv.data);
  const penalties = listOf<Penalty>(pen.data);
  const versions = Array.isArray(rules.data?.data?.versions) ? (rules.data?.data?.versions as PayRuleVersion[]) : null;
  const w = listOf<WorkerLite>(workers.data)?.find((x) => x.id === row?.employeeId) ?? null;
  return {
    advanceChips: row && advances ? advanceChips(advances, row.employeeId ?? "") : [],
    penaltyChips: row && penalties ? penaltyChips(penalties, row.employeeId ?? "", period) : [],
    formulaCtx: { versions: w ? versions : null, hoursPerDay: w?.workingHoursPerDay ?? null, dailyPaid: !!w && w.payMode === "DAILY" && Number(w.dailyRateSen) > 0 },
  };
}
