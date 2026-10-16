// ---------------------------------------------------------------------------
// labour-to-date.ts (pure core) — the running month's labour cost TO DATE, for the P&L and
// the finance dashboard (owner 2026-10-12 「任何的 payroll 还没 confirm 都拿这个
// 新卡显示的数据可以吗？就算我的 pnl, dashboard 这些」→「做」).
//
// It is Employees › Labor Cost vs Revenue's "Labor Cost incl. EPF &
// Allowances" card for a month still running, split by each worker's HOME
// department (the payroll's own split, so the running month files labour the
// way a finished month does) and by EPF / SOCSO / EIS:
//   • the hours logged so far, valued at the production-cost rate (salary ÷ the
//     month's working days ÷ the worker's hours; OT day-typed);
//   • the month's payslips' allowances and employer EPF / SOCSO / EIS,
//     pro-rated to the working days logged; anyone whose department logs no
//     factory hours (office) pro-rated whole — gross and statutory;
//   • the absent-day / OT / docked-hours pay-vs-cost differences already in
//     those payslips.
// The payslips are the stored ones (drafts included), else the live estimate
// (labour-projection) — the card's own rule.
//
// The DB loader is src/api/lib/labour-to-date.ts. The card computes in the browser (src/pages/employees.tsx — left untouched:
// the Employees module isn't this work's). This file mirrors its rules line for
// line; the total goes through the same laborCostInclPayroll, and the split is
// trued up to that total, so the P&L carries the card's figure to the sen.
// ---------------------------------------------------------------------------
import {
  countElapsedWorkingDays,
  isDailyPaidWorker,
  dailyPaidEntryCostSen,
} from "./labor-engine";
import {
  resolvePayRulesAsOf,
  payrollDayRateSen,
  payrollHourRateSen,
  type PayRuleVersion,
} from "./pay-rules";
import { laborCostInclPayroll, loggedDayShare } from "./labor-cost-incl-payroll";

export type TdWorker = {
  id: string;
  departmentCode: string | null;
  basicSalarySen: number;
  /** The month's day-weighted effective salary (falls back to the scalar). */
  effectiveSalarySen: number;
  workingHoursPerDay: number;
  workingDaysPerMonth: number;
  otMultiplier: number | null;
  payMode: string | null;
  dailyRateSen: number | null;
};

export type TdEntry = { workerId: string; date: string; hours: number; departmentCode: string; category: string | null };

export type TdPayslip = {
  id: string;
  employeeId: string;
  departmentCode: string | null;
  basicSalarySen: number;
  absentDays: number;
  absenceDeductionSen: number;
  otWeekdayHours: number;
  otSundayHours: number;
  otPhHours: number;
  totalOtSen: number;
  allowancesSen: number;
  grossPaySen: number;
  epfEmployerSen: number;
  socsoEmployerSen: number;
  eisEmployerSen: number;
};

export type TdDeptCost = {
  departmentCode: string;
  workers: number;
  /** Everything but the employer statutory — the department's salary line. */
  nonStatutorySen: number;
  epfSen: number;
  socsoSen: number;
  eisSen: number;
};

export type LabourToDate = {
  /** The card's figure — Σ of every department below, to the sen. */
  totalSen: number;
  /** The latest day with logged hours (YYYY-MM-DD). */
  asOf: string;
  loggedDays: number;
  monthDays: number;
  byDept: TdDeptCost[];
  /** Each worker's cost to date (rounded), keyed by worker id. */
  byWorker: Map<string, number>;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

// The card's day classification (employees.tsx dayTypedOt): Sunday → every
// hour is OT at the Sunday multiplier; a public holiday → every hour at the
// holiday multiplier; a weekday → hours above the standard day at the worker's.
function dayTypedOt(
  date: string,
  holidays: readonly string[],
  totalH: number,
  stdHours: number,
  weekdayMult: number,
  payRuleVersions?: PayRuleVersion[],
): { otHours: number; mult: number } {
  const [yy, mm, dd] = date.split("-").map(Number);
  const dow = new Date(yy, (mm || 1) - 1, dd || 1).getDay();
  const cfg = resolvePayRulesAsOf(payRuleVersions, date);
  if (dow === 0) return { otHours: totalH, mult: cfg.sundayOtMultiplier };
  if (holidays.includes(date)) return { otHours: totalH, mult: cfg.holidayOtMultiplier };
  return { otHours: Math.max(0, totalH - stdHours), mult: weekdayMult };
}

// Pure — every input already loaded. null when the month has no logged hours
// yet (nothing has been worked to value).
export function computeLabourToDate(input: {
  ym: string;
  entries: TdEntry[];
  workers: Map<string, TdWorker>;
  payslips: TdPayslip[];
  deductions: { workerId: string; hours: number }[];
  holidays: string[];
  payRuleVersions: PayRuleVersion[];
  factoryDeptCodes: Set<string>;
}): LabourToDate | null {
  const { ym, entries, workers, payslips, deductions, holidays, payRuleVersions, factoryDeptCodes } = input;
  const [y, mo] = ym.split("-").map(Number);
  if (!y || !mo) return null;
  const calDays = new Date(y, mo, 0).getDate();
  const monthDays = countElapsedWorkingDays(y, mo, calDays, holidays);
  // Every per-day / per-hour rate divides by at least one working day.
  const rateDays = Math.max(1, monthDays);

  let lastLogged = "";
  for (const e of entries) {
    const d = String(e.date ?? "").slice(0, 10);
    if (d.startsWith(ym) && d > lastLogged) lastLogged = d;
  }
  if (!lastLogged) return null;
  const loggedDays = countElapsedWorkingDays(y, mo, Number(lastLogged.slice(8, 10)), holidays);
  const share = loggedDayShare(loggedDays, monthDays);

  // 1. Logged hours at the production-cost rate — per (department, category)
  //    bucket like the card's table (each bucket rounded), and per worker.
  const segs = new Map<string, TdEntry[]>();
  for (const e of entries) {
    const k = `${e.workerId}|${e.date}`;
    const arr = segs.get(k) ?? [];
    arr.push(e);
    segs.set(k, arr);
  }
  const buckets = new Map<string, number>();
  const loggedByWorker = new Map<string, number>();
  const book = (e: TdEntry, workerId: string, cost: number) => {
    const cat = typeof e.category === "string" ? e.category.trim().toUpperCase() : "";
    const key = `${e.departmentCode}|${cat}`;
    buckets.set(key, (buckets.get(key) ?? 0) + cost);
    loggedByWorker.set(workerId, (loggedByWorker.get(workerId) ?? 0) + cost);
  };
  for (const [k, list] of segs) {
    const [workerId, date] = k.split("|");
    const w = workers.get(workerId);
    if (!w) continue;
    if (isDailyPaidWorker(w)) {
      const dayHours = list.reduce((s, e) => s + (Number(e.hours) || 0), 0);
      for (const e of list) book(e, workerId, dailyPaidEntryCostSen(w, Number(e.hours) || 0, dayHours));
      continue;
    }
    if (!w.basicSalarySen) continue;
    const stdHours = w.workingHoursPerDay > 0 ? w.workingHoursPerDay : 9;
    const perMonth = w.workingDaysPerMonth > 0 ? w.workingDaysPerMonth : 26;
    const regularRateSen = w.effectiveSalarySen / rateDays / stdHours;
    const otBaseRateSen = w.effectiveSalarySen / perMonth / stdHours;
    const otMult = w.otMultiplier ?? 1.5;
    const totalH = list.reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const otDay = dayTypedOt(date, holidays, totalH, stdHours, otMult, payRuleVersions);
    const otShare = totalH > 0 ? otDay.otHours / totalH : 0;
    for (const e of list) {
      const hours = Number(e.hours) || 0;
      const otH = hours * otShare;
      book(e, workerId, (hours - otH) * regularRateSen + otH * otBaseRateSen * otDay.mult);
    }
  }
  // roundSen — Math.round, the app's one money-rounding rule.
  const loggedSen = [...buckets.values()].reduce((s, v) => s + Math.round(v), 0);

  // 2. The per-payslip pay-vs-cost bridges (the card's three maps).
  const endYmd = `${ym}-${pad2(calDays)}`;
  const cfgEnd = resolvePayRulesAsOf(payRuleVersions, endYmd);
  const dockHours = new Map<string, number>();
  for (const r of deductions) dockHours.set(r.workerId, (dockHours.get(r.workerId) ?? 0) + (Number(r.hours) || 0));
  const bridge = new Map<string, number>();
  const addBridge = (id: string, sen: number) => { if (sen !== 0) bridge.set(id, (bridge.get(id) ?? 0) + sen); };
  for (const p of payslips) {
    const w = workers.get(p.employeeId);
    // Absent days: payroll docks ÷26, costing loses ÷ the month's working days.
    const absent = Number(p.absentDays) || 0;
    if (absent > 0) addBridge(p.id, Math.round((absent * (Number(p.basicSalarySen) || 0)) / rateDays) - (Number(p.absenceDeductionSen) || 0));
    // OT: what payroll paid against the day-typed cost of the same hours.
    const wkH = Number(p.otWeekdayHours) || 0;
    const sunH = Number(p.otSundayHours) || 0;
    const phH = Number(p.otPhHours) || 0;
    if (wkH + sunH + phH > 0) {
      const mult = w && w.otMultiplier && w.otMultiplier > 0 ? w.otMultiplier : 1.5;
      const std = w && w.workingHoursPerDay > 0 ? w.workingHoursPerDay : 9;
      const perMonth = w && w.workingDaysPerMonth > 0 ? w.workingDaysPerMonth : 26;
      const otBaseSen = (Number(p.basicSalarySen) || 0) / perMonth / std;
      const costOtSen = Math.round((wkH * mult + sunH * cfgEnd.sundayOtMultiplier + phH * cfgEnd.holidayOtMultiplier) * otBaseSen);
      addBridge(p.id, (Number(p.totalOtSen) || 0) - costOtSen);
    }
    // Docked late / short hours: the costing rate above the dock rate only.
    const h = dockHours.get(p.employeeId) ?? 0;
    if (h > 0) {
      const std = w && w.workingHoursPerDay > 0 ? w.workingHoursPerDay : 9;
      const S = Number(p.basicSalarySen) || 0;
      const costEquivalentSen = Math.round((h * S) / rateDays / std);
      const wDays = w && w.workingDaysPerMonth > 0 ? w.workingDaysPerMonth : 26;
      const cfgDock = resolvePayRulesAsOf(payRuleVersions, endYmd);
      const dockDayRate = payrollDayRateSen(S, { workingDaysPerMonth: wDays, calendarDays: calDays, workingDaysInMonth: rateDays }, cfgDock);
      const dockSen = Math.round(h * payrollHourRateSen(dockDayRate, w?.workingHoursPerDay, cfgDock));
      addBridge(p.id, Math.max(0, costEquivalentSen - dockSen));
    }
  }

  // 3. The card's figure.
  const isFactoryDept = (code: string) => factoryDeptCodes.has(code);
  const statOf = (p: TdPayslip) =>
    (Number(p.epfEmployerSen) || 0) + (Number(p.socsoEmployerSen) || 0) + (Number(p.eisEmployerSen) || 0);
  const totalSen = laborCostInclPayroll({
    monthFinished: false,
    loggedSen,
    payslips: payslips.map((p) => ({
      id: p.id,
      departmentCode: p.departmentCode,
      grossSen: Number(p.grossPaySen) || 0,
      statutorySen: statOf(p),
      allowancesSen: Number(p.allowancesSen) || 0,
    })),
    isFactoryDept,
    bridgeSen: (id) => bridge.get(id) ?? 0,
    share,
  });

  // 4. The same money, per worker → home department.
  type Acc = { workers: Set<string>; nonStat: number; epf: number; socso: number; eis: number };
  const depts = new Map<string, Acc>();
  const perWorker = new Map<string, number>();
  const put = (deptRaw: string | null | undefined, workerId: string, nonStat: number, epf: number, socso: number, eis: number) => {
    const dept = String(deptRaw ?? "").trim() || "(unassigned)";
    const a = depts.get(dept) ?? { workers: new Set<string>(), nonStat: 0, epf: 0, socso: 0, eis: 0 };
    a.workers.add(workerId);
    a.nonStat += nonStat; a.epf += epf; a.socso += socso; a.eis += eis;
    depts.set(dept, a);
    perWorker.set(workerId, (perWorker.get(workerId) ?? 0) + nonStat + epf + socso + eis);
  };
  const covered = new Set<string>();
  for (const p of payslips) {
    const logged = covered.has(p.employeeId) ? 0 : (loggedByWorker.get(p.employeeId) ?? 0);
    covered.add(p.employeeId);
    const factory = isFactoryDept(p.departmentCode || "UNASSIGNED");
    const nonStat = factory
      ? logged + (Number(p.allowancesSen) || 0) * share + (bridge.get(p.id) ?? 0)
      : logged + (Number(p.grossPaySen) || 0) * share;
    put(p.departmentCode, p.employeeId, nonStat,
      (Number(p.epfEmployerSen) || 0) * share,
      (Number(p.socsoEmployerSen) || 0) * share,
      (Number(p.eisEmployerSen) || 0) * share);
  }
  // Hours logged by anyone with no payslip this month: their own department.
  for (const [workerId, logged] of loggedByWorker) {
    if (covered.has(workerId)) continue;
    put(workers.get(workerId)?.departmentCode, workerId, logged, 0, 0, 0);
  }

  const byDept: TdDeptCost[] = [...depts.entries()]
    .map(([departmentCode, a]) => ({
      departmentCode,
      workers: a.workers.size,
      nonStatutorySen: Math.round(a.nonStat),
      epfSen: Math.round(a.epf),
      socsoSen: Math.round(a.socso),
      eisSen: Math.round(a.eis),
    }))
    .sort((a, b) => a.departmentCode.localeCompare(b.departmentCode));
  // True the split up to the card's figure: per-department rounding must not
  // leave the P&L a few sen off the card. The residual sits on the biggest line.
  const splitSum = byDept.reduce((s, d) => s + d.nonStatutorySen + d.epfSen + d.socsoSen + d.eisSen, 0);
  if (byDept.length && splitSum !== totalSen) {
    const big = byDept.reduce((m, d) => (d.nonStatutorySen > m.nonStatutorySen ? d : m), byDept[0]);
    big.nonStatutorySen += totalSen - splitSum;
  }
  const byWorker = new Map<string, number>();
  for (const [id, v] of perWorker) byWorker.set(id, Math.round(v));
  return { totalSen, asOf: lastLogged, loggedDays, monthDays, byDept, byWorker };
}

// The month still running, in Malaysia time — the clock the Labor Cost page
// (and its card) decides "finished" by.
export function runningMonthYm(now: number = Date.now()): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
}
