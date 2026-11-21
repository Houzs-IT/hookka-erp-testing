// ---------------------------------------------------------------------------
// backlog-months.ts — the customer-delivery-month toggles on Department
// Backlog / Plant Load / Total Backlog / Active Jobs (owner 2026-11-22: "17.4
// 天 … 11 月份的 order 可能 4 天而已，12 月份的 10 天"; "就像 bedframe sofa 那样
// 点了就可以了"; "12 月份的 sofa 可以？").
//
// The API gives each department's open minutes per bucket (`byMonth`, buckets
// from lib/delivery-bucket) and Active Jobs per customer per bucket. These pure
// helpers apply the month + Sofa/Bedframe toggles the same way everywhere.
// A feed without the split (an older cached payload, a stored past-month
// snapshot) has no `byMonth`: the month toggles are hidden and every number
// stays as the API sent it.
// ---------------------------------------------------------------------------
import { NO_DATE, OVERDUE, sortBuckets } from "../../lib/delivery-bucket";

export type MonthMin = { month: string; sofaMin: number; bedframeMin: number };
export type JobsMonth = { customer: string; month: string; bedframeUnits: number; sofaSets: number };

export type DeptLike = {
  dept: string;
  sofaMin: number;
  bedframeMin: number;
  totalMin: number;
  dailyCapMin: number;
  sofaCapMin?: number;
  bedframeCapMin?: number;
  sofaDays?: number | null;
  bedframeDays?: number | null;
  backlogDays: number | null;
  byMonth?: MonthMin[];
};

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Every bucket any department or Active Jobs row has, in display order. */
export function backlogMonthKeys(depts: readonly DeptLike[], jobs?: readonly JobsMonth[] | null): string[] {
  const keys = new Set<string>();
  for (const d of depts) for (const m of d.byMonth ?? []) keys.add(m.month);
  for (const j of jobs ?? []) keys.add(j.month);
  return sortBuckets(keys);
}

const MONTH_SHADES = ["#1f3d7a", "#4f7fd1", "#a9c3ee", "#6d8fc4", "#2f5f9e", "#c3d4ee"];
/** Overdue red, no-date grey, months in navy → light blue (distinct lightness). */
export function monthColor(key: string, monthIndex: number): string {
  if (key === OVERDUE) return "#b42318";
  if (key === NO_DATE) return "#c9c3b8";
  return MONTH_SHADES[monthIndex % MONTH_SHADES.length];
}

/**
 * The department as if only the visible months existed: minutes summed over
 * them, days re-derived with the API's own rules (both categories = total ÷
 * total capacity; one category = its minutes ÷ its own capacity; no capacity =
 * null "stalled"; nothing queued = 0). No split or nothing hidden = unchanged.
 */
export function filterDeptByMonths<T extends DeptLike>(d: T, hidden: ReadonlySet<string>): T {
  if (!d.byMonth || hidden.size === 0) return d;
  let sofa = 0;
  let bed = 0;
  for (const m of d.byMonth) {
    if (hidden.has(m.month)) continue;
    sofa += m.sofaMin;
    bed += m.bedframeMin;
  }
  const total = sofa + bed;
  const catDays = (q: number, cap: number | undefined): number | null | undefined =>
    cap === undefined ? undefined : q <= 0 ? 0 : cap > 0 ? r1(q / cap) : null;
  return {
    ...d,
    sofaMin: sofa,
    bedframeMin: bed,
    totalMin: total,
    sofaDays: catDays(sofa, d.sofaCapMin),
    bedframeDays: catDays(bed, d.bedframeCapMin),
    backlogDays: d.dailyCapMin > 0 ? r1(total / d.dailyCapMin) : null,
  };
}

/** Days per visible month for one department's bar, on the capacity the row uses. */
export function deptMonthSegments(
  d: DeptLike,
  hidden: ReadonlySet<string>,
  sofaOn: boolean,
  bedOn: boolean,
): { month: string; days: number }[] {
  if (!d.byMonth) return [];
  const cap =
    sofaOn !== bedOn
      ? (sofaOn ? d.sofaCapMin : d.bedframeCapMin) ?? d.dailyCapMin
      : d.dailyCapMin;
  if (!(cap > 0)) return [];
  return d.byMonth
    .filter((m) => !hidden.has(m.month))
    .map((m) => ({ month: m.month, days: ((sofaOn ? m.sofaMin : 0) + (bedOn ? m.bedframeMin : 0)) / cap }))
    .filter((s) => s.days > 0);
}

/** Open minutes across all departments under the current toggles. */
export function shownBacklogMin(
  depts: readonly DeptLike[],
  hidden: ReadonlySet<string>,
  sofaOn: boolean,
  bedOn: boolean,
): number {
  let s = 0;
  for (const raw of depts) {
    const d = filterDeptByMonths(raw, hidden);
    s += (sofaOn ? d.sofaMin : 0) + (bedOn ? d.bedframeMin : 0);
  }
  return s;
}

/** Active Jobs under the toggles, one row per customer (no month column). */
export function filterJobs(
  rows: readonly JobsMonth[],
  hidden: ReadonlySet<string>,
  sofaOn: boolean,
  bedOn: boolean,
): { bedframeUnits: number; sofaSets: number; byCustomer: { customer: string; bedframeUnits: number; sofaSets: number }[] } {
  const byC = new Map<string, { customer: string; bedframeUnits: number; sofaSets: number }>();
  let bf = 0;
  let sf = 0;
  for (const r of rows) {
    if (hidden.has(r.month)) continue;
    const b = bedOn ? r.bedframeUnits : 0;
    const s = sofaOn ? r.sofaSets : 0;
    if (!b && !s) continue;
    const e = byC.get(r.customer) ?? { customer: r.customer, bedframeUnits: 0, sofaSets: 0 };
    e.bedframeUnits += b;
    e.sofaSets += s;
    byC.set(r.customer, e);
    bf += b;
    sf += s;
  }
  const byCustomer = [...byC.values()].sort((a, b) => b.bedframeUnits + b.sofaSets - (a.bedframeUnits + a.sofaSets));
  return { bedframeUnits: bf, sofaSets: sf, byCustomer };
}
