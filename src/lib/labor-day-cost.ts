// ---------------------------------------------------------------------------
// labor-day-cost.ts — what one worker's logged day costs, by the Labor Cost
// rule (Employees › Labor Cost vs Revenue). Moved out of employees.tsx so the
// merged dashboard's Employees tab prices a worker-day exactly like the Labor
// Cost tab does (owner 2026-10-17: 「看我们的 labor cost 计算方式」).
//
//   monthly worker: regular hours × (effective salary ÷ the month's actual
//     working days ÷ the worker's hours/day) + OT hours × (salary ÷ the
//     worker's days/month ÷ hours/day) × the day's OT multiplier.
//   OT by day type: Sunday → every hour at the Sunday multiplier, public
//     holiday → every hour at the holiday multiplier, weekday → hours above
//     the standard day at the worker's own multiplier. A day's OT is split
//     across its entries pro rata, never by entry order.
//   per-day (outsourced) worker: dailyPaidEntryCostSen — day rate × days.
//   a monthly worker with no salary on record has no rate → 0.
// ---------------------------------------------------------------------------
import { isDailyPaidWorker, dailyPaidEntryCostSen } from "./labor-engine";
import { resolvePayRulesAsOf, type PayRuleVersion } from "./pay-rules";

/**
 * Day-typed OT for the COST side — mirrors the engine so logged labor cost
 * values Sunday / public-holiday OT the SAME way payroll pays it. Multipliers
 * come from the effective-dated pay rules in force ON the logged date; no
 * versions → defaults. A holiday on a Sunday is treated as a Sunday.
 */
export function dayTypedOt(
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

export type CostWorker = Parameters<typeof isDailyPaidWorker>[0] & {
  basicSalarySen: number;
  workingHoursPerDay: number;
  workingDaysPerMonth: number;
  otMultiplier?: number | null;
};

/**
 * Cost (fractional sen) of each of one worker's entries on one date, in the
 * order given. `actualWorkingDays` = the month's Mon–Sat days minus public
 * holidays (the production-cost divisor); `effSalarySen` = the worker's
 * day-weighted effective salary for that month.
 */
export function workerDayEntryCostsSen(args: {
  worker: CostWorker;
  effSalarySen: number;
  date: string;
  entryHours: number[];
  actualWorkingDays: number;
  holidays: readonly string[];
  payRuleVersions?: PayRuleVersion[];
}): number[] {
  const { worker: w, effSalarySen, date, entryHours, actualWorkingDays, holidays, payRuleVersions } = args;
  const dayHours = entryHours.reduce((s, h) => s + (Number(h) || 0), 0);
  if (isDailyPaidWorker(w)) {
    return entryHours.map((h) => dailyPaidEntryCostSen(w, Number(h) || 0, dayHours));
  }
  if (!w.basicSalarySen) return entryHours.map(() => 0);
  const stdHours = w.workingHoursPerDay > 0 ? w.workingHoursPerDay : 9;
  const monthDays = w.workingDaysPerMonth > 0 ? w.workingDaysPerMonth : 26;
  const regularRateSen = effSalarySen / actualWorkingDays / stdHours;
  const otBaseRateSen = effSalarySen / monthDays / stdHours;
  const otDay = dayTypedOt(date, holidays, dayHours, stdHours, w.otMultiplier ?? 1.5, payRuleVersions);
  const otShare = dayHours > 0 ? otDay.otHours / dayHours : 0;
  return entryHours.map((h) => {
    const hours = Number(h) || 0;
    const otH = hours * otShare;
    return (hours - otH) * regularRateSen + otH * otBaseRateSen * otDay.mult;
  });
}
