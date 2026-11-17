// department-labor-model.ts — the costing behind Employees → Department Labor (HK-0125 Phase 4, step 3). Pure: no React, no clock.
//
// COSTING = DESKTOP'S DEPARTMENT LABOR TAB, line for line (src/pages/employees.tsx `DepartmentLaborTab`, identical on staging and
// main), so mobile and desktop can be compared for the same period. It deliberately keeps that tab's own loop — NOT the shared
// `workerDayEntryCostsSen` that the Labor Cost tab uses — which means it keeps desktop's two differences from Labor Cost: hours
// after a worker's resignation date are still costed, and the whole range is costed with the working days of the range's first
// month. The shared helpers desktop imports are imported here too (dayTypedOt, labor-engine, pay-rules, distributeRoundSen).
//
// Per worker × date: regular hours cost effective salary ÷ the month's working days ÷ hours per day; overtime is split pro rata
// across the day's entries (Sunday every hour at the Sunday multiplier, public holiday every hour at the holiday multiplier,
// weekday only the hours above the standard day at the worker's multiplier, at salary ÷ days per month ÷ hours per day);
// a daily-paid (outsourced) worker costs the agreed day rate split by hours; a monthly worker with no salary costs nothing.
//
// Fully loaded ("Total", ties to Payroll): only for ONE whole calendar month that is already over, with no category filter, and
// only when the payslips, deductions and pay rules all loaded. Each payslip worker's (gross + employer EPF / SOCSO / EIS − logged
// cost) is added to their department, the leftover sen are spread over the departments by `distributeRoundSen`, and each
// department's UNDER-RECORDED part is the same per-worker gap the Labor Cost tab itemises. Otherwise the cost is the logged-hours
// ESTIMATE. If the data the estimate needs did not load, the cost is UNAVAILABLE — never a guessed number.
import { distributeRoundSen, roundSen } from "../../../../lib/utils";
import { dayTypedOt } from "../../../../lib/labor-day-cost";
import { countElapsedWorkingDays, dailyPaidEntryCostSen, isDailyPaidWorker } from "../../../../lib/labor-engine";
import { payrollDayRateSen, payrollHourRateSen, resolvePayRulesAsOf, type PayRuleVersion } from "../../../../lib/pay-rules";

export type DlCategory = "" | "SOFA" | "BEDFRAME" | "ACCESSORY";
export type DlWorker = {
  id: string;
  status?: string;
  departmentCode?: string;
  basicSalarySen?: number;
  workingHoursPerDay?: number;
  workingDaysPerMonth?: number;
  otMultiplier?: number | null;
  payMode?: string | null;
  dailyRateSen?: number | null;
};
export type DlEntry = { workerId: string; date: string; departmentCode: string; category?: string | null; hours: number | string };
export type DlDept = { code: string; name?: string; shortName?: string; isProduction?: boolean; sequence?: number };
export type DlPayslip = {
  employeeId?: string;
  departmentCode?: string;
  period?: string;
  basicSalary?: number;
  absentDays?: number;
  absenceDeductionSen?: number;
  otWeekdayHours?: number;
  otSundayHours?: number;
  otPHHours?: number;
  totalOT?: number;
  allowances?: number;
  grossPay?: number;
  epfEmployer?: number;
  socsoEmployer?: number;
  eisEmployer?: number;
};
export type DlDock = { workerId: string; hours: number | string };

// ---- the period rules (desktop's helpers, with Malaysia "today" passed in) --------------------------------------------------

/** From the 1st to the last day of ONE calendar month (desktop `isFullSingleMonth`). */
export function isFullSingleMonth(from: string, to: string): boolean {
  if (!from || !to) return false;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return false;
  if (fd !== 1 || fy !== ty || fm !== tm) return false;
  return td === new Date(Date.UTC(ty, tm, 0)).getUTCDate();
}

/** True only once the month is over: a LATER month has started (desktop `monthIsFinished`, but on the Malaysia date). */
export function monthIsFinished(ym: string, today: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(ym)) return false;
  return ym < today.slice(0, 7);
}

/** Does this period qualify for the fully-loaded "Total" (before checking that the payroll data loaded)? */
export function payrollEligible(range: { from: string; to: string }, category: DlCategory, today: string): boolean {
  return isFullSingleMonth(range.from, range.to) && !category && monthIsFinished(range.from.slice(0, 7), today);
}

// ---- compute --------------------------------------------------------------------------------------------------------------

export type CostMode = "payroll" | "estimate" | "unavailable";

export type DlRow = {
  deptCode: string;
  deptName: string;
  isProduction: boolean;
  totalHours: number;
  workerIds: string[];
  /** Whole sen. In "unavailable" mode every money field is 0 and must not be shown. */
  costSen: number;
  laborSen: number;
  underSen: number;
  sofaSen: number;
  bedframeSen: number;
  accessorySen: number;
  catTotalSen: number;
};

export type DlResult = { mode: CostMode; rows: DlRow[]; payrollMissing: boolean };

type Cell = { totalHours: number; workerIds: Set<string>; costSen: number; catSen: { SOFA: number; BEDFRAME: number; ACCESSORY: number } };
const newCell = (): Cell => ({ totalHours: 0, workerIds: new Set(), costSen: 0, catSen: { SOFA: 0, BEDFRAME: 0, ACCESSORY: 0 } });

export function computeDepartmentLabor(input: {
  entries: readonly DlEntry[];
  workers: readonly DlWorker[];
  depts: readonly DlDept[];
  holidays: readonly string[];
  versions: readonly PayRuleVersion[];
  /** worker id → effective salary (sen) for the period's month; a worker missing from it falls back to basic salary. */
  effSalary: Readonly<Record<string, number>>;
  /** Payslips of the period's month and the late / short docks, or null when they did not load (or were not requested). */
  payslips: readonly DlPayslip[] | null;
  docks: readonly DlDock[] | null;
  range: { from: string; to: string };
  category: DlCategory;
  today: string;
  /** false = the data the estimate needs did not load: hours and workers only, no money. */
  costDataOk: boolean;
}): DlResult {
  const { entries, workers, depts, holidays, effSalary, range, category, today } = input;
  const versions = input.versions as PayRuleVersion[];
  const workerById = new Map(workers.map((w) => [w.id, w]));
  const eligible = payrollEligible(range, category, today);
  const payrollLoaded = input.payslips !== null && input.docks !== null;
  const fullyLoaded = input.costDataOk && eligible && payrollLoaded;
  const mode: CostMode = !input.costDataOk ? "unavailable" : fullyLoaded ? "payroll" : "estimate";
  const payrollMissing = input.costDataOk && eligible && !payrollLoaded;

  // Desktop's department list, production first (by sequence), then non-production.
  const orderedDepts = [...depts].sort((a, b) => {
    if (!!a.isProduction !== !!b.isProduction) return a.isProduction ? -1 : 1;
    const sa = a.sequence ?? 999;
    const sb = b.sequence ?? 999;
    if (sa !== sb) return sa - sb;
    return a.code.localeCompare(b.code);
  });

  const acc = new Map<string, Cell>();
  const cellOf = (code: string) => {
    let c = acc.get(code);
    if (!c) {
      c = newCell();
      acc.set(code, c);
    }
    return c;
  };
  const loggedByWorker = new Map<string, number>();
  const underByDept = new Map<string, number>();

  const [hYear, hMonth] = range.from.slice(0, 7).split("-").map(Number);
  const actualWorkingDays =
    hYear && hMonth ? Math.max(1, countElapsedWorkingDays(hYear, hMonth, new Date(hYear, hMonth, 0).getDate(), holidays as string[])) : 26;

  const segsByWorkerDate = new Map<string, DlEntry[]>();
  for (const e of entries) {
    const k = `${e.workerId}|${e.date}`;
    const arr = segsByWorkerDate.get(k) ?? [];
    arr.push(e);
    segsByWorkerDate.set(k, arr);
  }
  const catOf = (e: DlEntry) => (typeof e.category === "string" ? e.category.trim().toUpperCase() : "") as "" | "SOFA" | "BEDFRAME" | "ACCESSORY";

  if (!input.costDataOk) {
    // Hours and workers only (the category filter still applies): money is not computable.
    for (const [k, segs] of segsByWorkerDate) {
      const workerId = k.split("|")[0];
      if (!workerById.get(workerId)) continue;
      for (const e of segs) {
        const cat = catOf(e);
        if (category && cat !== category && cat !== "") continue;
        const cell = cellOf(e.departmentCode);
        cell.totalHours += Number(e.hours) || 0;
        cell.workerIds.add(workerId);
      }
    }
  } else {
    for (const [k, segs] of segsByWorkerDate.entries()) {
      const [workerId] = k.split("|");
      const w = workerById.get(workerId);
      if (!w) continue;
      // Outsourced / per-day people: the agreed day rate × days logged (desktop's own branch).
      if (isDailyPaidWorker(w)) {
        const dayHours = segs.reduce((s, e) => s + (Number(e.hours) || 0), 0);
        for (const e of segs) {
          const hours = Number(e.hours) || 0;
          const cost = dailyPaidEntryCostSen(w as Parameters<typeof dailyPaidEntryCostSen>[0], hours, dayHours);
          const cat = catOf(e);
          if (category && cat !== category && cat !== "") continue;
          const cell = cellOf(e.departmentCode);
          cell.totalHours += hours;
          cell.workerIds.add(workerId);
          cell.costSen += cost;
          if (cat === "SOFA" || cat === "BEDFRAME" || cat === "ACCESSORY") cell.catSen[cat] += cost;
          loggedByWorker.set(workerId, (loggedByWorker.get(workerId) ?? 0) + cost);
        }
        continue;
      }
      // A monthly worker with no salary on record has no rate to cost with.
      if (!w.basicSalarySen) continue;
      const stdHours = (w.workingHoursPerDay ?? 0) > 0 ? (w.workingHoursPerDay as number) : 9;
      const monthDays = (w.workingDaysPerMonth ?? 0) > 0 ? (w.workingDaysPerMonth as number) : 26;
      const effSalarySen = typeof effSalary[w.id] === "number" ? effSalary[w.id] : w.basicSalarySen;
      const regularRateSen = effSalarySen / actualWorkingDays / stdHours;
      const otBaseRateSen = effSalarySen / monthDays / stdHours;
      const otMult = w.otMultiplier ?? 1.5;
      const totalH = segs.reduce((s, e) => s + (Number(e.hours) || 0), 0);
      const otDay = dayTypedOt(k.split("|")[1], holidays, totalH, stdHours, otMult, versions);
      const otShare = totalH > 0 ? otDay.otHours / totalH : 0;
      for (const e of segs) {
        const hours = Number(e.hours) || 0;
        const otH = hours * otShare;
        const regularH = hours - otH;
        const cost = regularH * regularRateSen + otH * otBaseRateSen * otDay.mult;
        const cat = catOf(e);
        if (category && cat !== category && cat !== "") continue;
        const cell = cellOf(e.departmentCode);
        cell.totalHours += hours;
        cell.workerIds.add(workerId);
        cell.costSen += cost;
        if (cat === "SOFA" || cat === "BEDFRAME" || cat === "ACCESSORY") cell.catSen[cat] += cost;
        loggedByWorker.set(workerId, (loggedByWorker.get(workerId) ?? 0) + cost);
      }
    }

    if (fullyLoaded) {
      const docksByWorker = new Map<string, number>();
      for (const r of input.docks ?? []) docksByWorker.set(r.workerId, (docksByWorker.get(r.workerId) ?? 0) + (Number(r.hours) || 0));
      const factoryCodes = new Set(depts.map((d) => d.code));
      for (const p of input.payslips ?? []) {
        const wid = p.employeeId;
        if (!wid) continue;
        const gross = Number(p.grossPay) || 0;
        const statutory = (Number(p.epfEmployer) || 0) + (Number(p.socsoEmployer) || 0) + (Number(p.eisEmployer) || 0);
        const extra = gross + statutory - (loggedByWorker.get(wid) ?? 0);
        const deptCode = p.departmentCode || workerById.get(wid)?.departmentCode || "UNASSIGNED";
        if (extra !== 0) {
          const cell = cellOf(deptCode);
          // Not category-specific: lifts the cost only, never a category column.
          cell.costSen += extra;
          cell.workerIds.add(wid);
        }
        // Under-recorded gap — factory departments only, the payslip's OWN department code (as the Labor Cost tab).
        const reconCode = p.departmentCode || "UNASSIGNED";
        if (gross > 0 && factoryCodes.has(reconCode)) {
          const absent = Number(p.absentDays) || 0;
          const costEquivalent = absent > 0 ? Math.round((absent * (Number(p.basicSalary) || 0)) / actualWorkingDays) : 0;
          const leniency = costEquivalent - (Number(p.absenceDeductionSen) || 0);
          const ow = workerById.get(wid);
          const owMult = ow && ow.otMultiplier && ow.otMultiplier > 0 ? ow.otMultiplier : 1.5;
          const owStd = ow && (ow.workingHoursPerDay ?? 0) > 0 ? (ow.workingHoursPerDay as number) : 9;
          const owDays = ow && (ow.workingDaysPerMonth ?? 0) > 0 ? (ow.workingDaysPerMonth as number) : 26;
          const [bdY, bdM] = (p.period || "").split("-").map(Number);
          const cfgDeptEnd = resolvePayRulesAsOf(
            versions,
            bdY && bdM ? `${p.period}-${String(new Date(bdY, bdM, 0).getDate()).padStart(2, "0")}` : "9999-12-31",
          );
          const otCostSen = Math.round(
            ((Number(p.otWeekdayHours) || 0) * owMult +
              (Number(p.otSundayHours) || 0) * cfgDeptEnd.sundayOtMultiplier +
              (Number(p.otPHHours) || 0) * cfgDeptEnd.holidayOtMultiplier) *
              ((Number(p.basicSalary) || 0) / owDays / owStd),
          );
          const otAdj = (Number(p.totalOT) || 0) - otCostSen;
          const dockH = docksByWorker.get(wid) ?? 0;
          let lateAdj = 0;
          if (dockH > 0) {
            const S = Number(p.basicSalary) || 0;
            const dockDayRate = payrollDayRateSen(
              S,
              { workingDaysPerMonth: owDays, calendarDays: bdY && bdM ? new Date(bdY, bdM, 0).getDate() : 30, workingDaysInMonth: actualWorkingDays },
              cfgDeptEnd,
            );
            lateAdj = Math.max(
              0,
              Math.round((dockH * S) / actualWorkingDays / owStd) - Math.round(dockH * payrollHourRateSen(dockDayRate, ow?.workingHoursPerDay, cfgDeptEnd)),
            );
          }
          const gap = Math.round(gross - (loggedByWorker.get(wid) ?? 0) - leniency - otAdj - lateAdj - (Number(p.allowances) || 0));
          if (gap > 50) underByDept.set(reconCode, (underByDept.get(reconCode) ?? 0) + gap);
        }
      }
    }
  }

  const build = (code: string, name: string, isProduction: boolean): DlRow => {
    const cell = acc.get(code);
    const costSen = input.costDataOk ? roundSen(cell?.costSen ?? 0) : 0;
    const underSen = input.costDataOk ? roundSen(underByDept.get(code) ?? 0) : 0;
    const sofaSen = input.costDataOk ? roundSen(cell?.catSen.SOFA ?? 0) : 0;
    const bedframeSen = input.costDataOk ? roundSen(cell?.catSen.BEDFRAME ?? 0) : 0;
    const accessorySen = input.costDataOk ? roundSen(cell?.catSen.ACCESSORY ?? 0) : 0;
    return {
      deptCode: code,
      deptName: name,
      isProduction,
      totalHours: cell?.totalHours ?? 0,
      workerIds: cell ? [...cell.workerIds] : [],
      costSen,
      underSen,
      laborSen: costSen - underSen,
      sofaSen,
      bedframeSen,
      accessorySen,
      catTotalSen: sofaSen + bedframeSen + accessorySen,
    };
  };

  const shownCodes = new Set(orderedDepts.map((d) => d.code));
  const orderedRows = orderedDepts.map((d) => build(d.code, d.shortName || d.name || d.code, !!d.isProduction));
  // Cost parked on a department not in the list (e.g. an unassigned worker's loaded extra) — kept so the total still ties.
  const extraRows = [...acc.entries()]
    .filter(([code, cell]) => !shownCodes.has(code) && (input.costDataOk ? roundSen(cell.costSen) !== 0 : cell.totalHours > 0))
    .map(([code]) => build(code, code || "Unassigned", false));
  const allRows = [...orderedRows, ...extraRows];

  if (fullyLoaded && allRows.length) {
    let payrollTotalSen = 0;
    for (const p of input.payslips ?? []) {
      payrollTotalSen += roundSen(Number(p.grossPay) || 0) + roundSen(Number(p.epfEmployer) || 0) + roundSen(Number(p.socsoEmployer) || 0) + roundSen(Number(p.eisEmployer) || 0);
    }
    const tied = distributeRoundSen(allRows.map((r) => acc.get(r.deptCode)?.costSen ?? 0), payrollTotalSen);
    allRows.forEach((r, i) => {
      r.costSen = tied[i];
      r.laborSen = r.costSen - r.underSen;
    });
  }
  return { mode, rows: allRows, payrollMissing };
}

// ---- the screen's view of the rows ---------------------------------------------------------------------------------------------

export type DlType = "all" | "prod" | "non";
export type DlFilters = { category: DlCategory; type: DlType; depts: readonly string[]; q: string };
export const NO_FILTERS: DlFilters = { category: "", type: "all", depts: [], q: "" };

/** Active filter count for the badge (search is not a filter chip). */
export function filterCount(f: DlFilters): number {
  return (f.category ? 1 : 0) + (f.type !== "all" ? 1 : 0) + (f.depts.length ? 1 : 0);
}

/** True when nothing narrows the list: no category, type, department or search. */
export function isUnfiltered(f: DlFilters): boolean {
  return filterCount(f) === 0 && f.q.trim() === "";
}

/**
 * The departments the screen lists: those with hours in the selected scope (so a category filter drops production departments
 * with nothing in it, and non-production departments with hours always stay), plus any department that carries a loaded cost
 * even with no hours (so a payroll-tied total never loses a department). Highest cost first.
 */
export function visibleRows(result: DlResult, f: DlFilters): DlRow[] {
  const q = f.q.trim().toLowerCase();
  return result.rows
    .filter((r) => r.totalHours > 0 || (result.mode !== "unavailable" && r.costSen !== 0))
    .filter((r) => f.type === "all" || (f.type === "prod") === r.isProduction)
    .filter((r) => f.depts.length === 0 || f.depts.includes(r.deptCode))
    .filter((r) => !q || r.deptName.toLowerCase().includes(q))
    .sort((a, b) => b.costSen - a.costSen || a.deptName.localeCompare(b.deptName));
}

export type DlTotals = { departments: number; hours: number; workers: number; costSen: number; laborSen: number; underSen: number; catTotalSen: number };

/** The total strip over the MATCHING rows (all of them, not just the first five); each worker is counted once across them. */
export function totalsOf(rows: readonly DlRow[]): DlTotals {
  const workers = new Set<string>();
  let hours = 0, costSen = 0, laborSen = 0, underSen = 0, catTotalSen = 0;
  for (const r of rows) {
    hours += r.totalHours;
    costSen += r.costSen;
    laborSen += r.laborSen;
    underSen += r.underSen;
    catTotalSen += r.catTotalSen;
    for (const w of r.workerIds) workers.add(w);
  }
  return { departments: rows.length, hours, workers: workers.size, costSen, laborSen, underSen, catTotalSen };
}

/** The cost label: "Total" only when fully loaded; otherwise "Estimated Labor Cost" (or Unavailable when the estimate cannot be made). */
export function costLabel(mode: CostMode): string {
  return mode === "payroll" ? "Total" : "Estimated Labor Cost";
}

export type Footnote = "matches-payroll" | "filtered-payroll" | "payroll-missing" | null;
/** "Matches Payroll" only for the UNFILTERED, completed month whose payroll data all loaded; a filtered fully-loaded view says so instead. */
export function footnote(result: DlResult, f: DlFilters): Footnote {
  if (result.mode === "payroll") return isUnfiltered(f) ? "matches-payroll" : "filtered-payroll";
  if (result.payrollMissing) return "payroll-missing";
  return null;
}
