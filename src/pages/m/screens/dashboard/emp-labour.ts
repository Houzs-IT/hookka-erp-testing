// Labour cost card of the /m Home Employees view: the desktop LabourSplitCard's grouping (dashboards/LabourSplitCard.tsx),
// copied line for line because it lives inside that component. Input = the payroll months the desktop passes it
// (useLabourCost → labourMonthsWithin, cut to the period). No React here, so node --test imports it.
// Labour = payroll: gross pay plus employer EPF, SOCSO and EIS, outsource included; a running month is labour to date.
import type { LabourMonth } from "../../../../lib/labour-to-date";
import { sumLabourMonths } from "../../../../lib/labour-to-payroll";
import { deptName } from "../../../dashboards/ops-floor-lib";

const COST_CENTRE: Record<string, string> = { WAREHOUSING: "Warehousing", REPAIR: "Repair", MAINTENANCE: "Maintenance", R_AND_D: "R&D", PRODUCTION_SHORTFALL: "Shortfall", OTHER: "Other" };
/** A department or cost-centre code in words (desktop labelOf). */
export const labourLabel = (code: string) => COST_CENTRE[code] ?? deptName(code);
export const share = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—");

export type LabourStatus = { text: string; tone: "running" | "draft" | "approved" };

export function labourSplitOf(months: readonly LabourMonth[]) {
  const t = sumLabourMonths(months);
  const deptMap = new Map<string, { workers: number; costSen: number; outsourceSen: number }>();
  for (const mo of months) for (const d of mo.byDept) {
    const r = deptMap.get(d.departmentCode) ?? { workers: 0, costSen: 0, outsourceSen: 0 };
    r.workers = Math.max(r.workers, d.workers);
    r.costSen += d.costSen;
    r.outsourceSen += d.outsourceSen ?? 0;
    deptMap.set(d.departmentCode, r);
  }
  const depts = [...deptMap.entries()].sort((a, b) => b[1].costSen - a[1].costSen);
  const outsourceDepts = depts.filter(([, d]) => d.outsourceSen !== 0).map(([code, d]) => [code, d.outsourceSen] as const);
  const npMap = new Map<string, number>();
  for (const mo of months) for (const l of mo.split.nonProductionLines ?? []) npMap.set(l.departmentCode, (npMap.get(l.departmentCode) ?? 0) + l.sen);
  const nonProd = [...npMap.entries()].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
  const staffMap = new Map<string, { costSen: number; directSen: number; nonProductionSen: number }>();
  for (const mo of months) for (const w of mo.workers) {
    const r = staffMap.get(w.id) ?? { costSen: 0, directSen: 0, nonProductionSen: 0 };
    r.costSen += w.costSen; r.directSen += w.directSen; r.nonProductionSen += w.nonProductionSen;
    staffMap.set(w.id, r);
  }
  const staff = [...staffMap.entries()].filter(([, r]) => r.costSen !== 0).sort((a, b) => b[1].costSen - a[1].costSen);
  const running = months.some((m) => !m.finished);
  const status: LabourStatus = running
    ? { text: "Labour to date · payroll not finished", tone: "running" }
    : t.draft > 0
      ? { text: `${t.draft.toLocaleString("en-MY")} payslips still draft`, tone: "draft" }
      : { text: "From approved payroll", tone: "approved" };
  const directPct = t.totalSen > 0 ? (t.directSen / t.totalSen) * 100 : 0;
  /** The card is not drawn without payroll months or with a zero total (desktop returns null). */
  const show = months.length > 0 && t.totalSen !== 0;
  return { t, depts, outsourceDepts, nonProd, staff, status, directPct, show };
}
export type LabourSplitView = ReturnType<typeof labourSplitOf>;
