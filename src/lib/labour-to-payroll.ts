// ---------------------------------------------------------------------------
// labour-to-payroll.ts — makes the dashboard's per-day labour add up to payroll
// (owner 2026-11-06: 「上个月显示 68k，其实是 72k，我的 costing 哪里准呢？」).
//
// Logged hours at the Labor Cost rate leave out allowances, piece wages, employer
// EPF / SOCSO / EIS and anyone who logs no hours, so they sum to less than the
// month really cost. Per-day figures still have to come from the hours: nothing
// else says which day a cost belongs to. So each person's month is taken from
// LabourMonth (the one labour figure) and spread over their days in the shape of
// their logged hours. Someone paid with no hours at all (outsource on piece
// wages) is spread evenly over the month's working days, under their home
// department. Every total, month or department, then equals payroll.
// A month with no LabourMonth is left as logged.
// ---------------------------------------------------------------------------
import type { LabourMonth } from "./labour-to-date";

export function scaleLabourToPayroll(
  byWorkerDay: ReadonlyMap<string, number>,
  byWorkerDayDept: ReadonlyMap<string, number>,
  months: readonly LabourMonth[],
  homeDept: (workerId: string) => string | null | undefined,
): { byWorkerDay: Map<string, number>; byWorkerDayDept: Map<string, number> } {
  const target = new Map(months.map((m) => [m.ym, new Map(m.workers.map((w) => [w.id, w.costSen]))]));
  const logged = new Map<string, number>(); // ym|worker → logged sen
  const daysOf = new Map<string, Set<string>>(); // ym → dates with logged cost
  for (const [k, v] of byWorkerDay) {
    const [worker, date] = k.split("|");
    const ym = date.slice(0, 7);
    logged.set(`${ym}|${worker}`, (logged.get(`${ym}|${worker}`) ?? 0) + v);
    const set = daysOf.get(ym) ?? new Set<string>();
    set.add(date);
    daysOf.set(ym, set);
  }
  const factorOf = (worker: string, date: string): number => {
    const ym = date.slice(0, 7);
    const t = target.get(ym);
    if (!t) return 1;
    const l = logged.get(`${ym}|${worker}`) ?? 0;
    return l > 0 ? (t.get(worker) ?? 0) / l : 0;
  };
  const scale = (src: ReadonlyMap<string, number>) => {
    const out = new Map<string, number>();
    for (const [k, v] of src) {
      const [worker, date] = k.split("|");
      out.set(k, v * factorOf(worker, date));
    }
    return out;
  };
  const days = scale(byWorkerDay);
  const depts = scale(byWorkerDayDept);
  for (const m of months) {
    const dates = [...(daysOf.get(m.ym) ?? [])];
    if (!dates.length) continue;
    for (const w of m.workers) {
      if (w.costSen === 0 || (logged.get(`${m.ym}|${w.id}`) ?? 0) > 0) continue;
      const each = w.costSen / dates.length;
      const dept = homeDept(w.id) ?? "";
      for (const d of dates) {
        days.set(`${w.id}|${d}`, each);
        depts.set(`${w.id}|${d}|${dept}`, each);
      }
    }
  }
  return { byWorkerDay: days, byWorkerDayDept: depts };
}

export function wholeMonthsAround(from: string, to: string): { from: string; to: string } {
  const [year, month] = to.slice(0, 7).split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${from.slice(0, 7)}-01`, to: `${to.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

export function keepDaysWithin(costByKey: ReadonlyMap<string, number>, from: string, to: string): Map<string, number> {
  const kept = new Map<string, number>();
  for (const [key, sen] of costByKey) {
    const date = key.split("|")[1] ?? "";
    if (date >= from && date <= to) kept.set(key, sen);
  }
  return kept;
}

/** Months added up: what a card shows for a quarter or a year. */
export function sumLabourMonths(months: readonly LabourMonth[]) {
  const t = { totalSen: 0, directSen: 0, nonProductionSen: 0, outsourceSen: 0, warehousingSen: 0, shortfallSen: 0, overheadSen: 0, underRecordedSen: 0, draft: 0, approved: 0 };
  for (const m of months) {
    t.totalSen += m.totalSen;
    t.directSen += m.split.directSen;
    t.nonProductionSen += m.split.nonProductionSen;
    t.outsourceSen += m.split.outsourceSen;
    t.warehousingSen += m.split.warehousingSen;
    t.shortfallSen += m.split.shortfallSen;
    t.overheadSen += m.split.overheadSen;
    t.underRecordedSen += m.split.underRecordedSen;
    t.draft += m.payroll.draft;
    t.approved += m.payroll.approved;
  }
  return t;
}
