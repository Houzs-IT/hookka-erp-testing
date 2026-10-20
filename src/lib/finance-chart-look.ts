// ---------------------------------------------------------------------------
// finance-chart-look.ts — the Financial Dashboard's look, as the owner's design
// draws it (Claude Design handoff "Hookka Finance v2", PALETTES["Categorical"]
// and its Chart; owner 2026-10-20 「先把dashboard 那边做好，就是我设计稿那边的
// 动画，颜色，曲线等等，电脑版和手机版的」). One place for the desktop page and
// the phone screen, so the two cannot drift apart again.
// ---------------------------------------------------------------------------

/** Series colours. Multi-series charts use the categorical palette; a single
 *  series is teal; the forecast line stays red. */
export const CH = {
  actual: "#5FA8A0",
  fc: "#D9534F",
  teal: "#2F6E7C",
  green: "#2F7A3B",
  out: "#E07A5F",
  in: "#7FB7BE",
  liab: "#BDB6AA",
  net: "#1F2A44",
  single: "#5FA8A0",
  assets: "#5FA8A0",
} as const;

/** Stacked bands (departments, materials), by position. */
export const CS_COLOURS = [
  "#5B7BA6", "#8E7DBE", "#7FB7BE", "#F2B880", "#81B29A", "#B5838D",
  "#98C1D9", "#F4D35E", "#9A8C98", "#D4A373", "#C9ADA7", "#5FA8D3",
] as const;

/** Axis, grid and tick colours. */
export const AXIS = { line: "#CFC8BF", grid: "#EEF1F5", tick: "#374151", label: "#1F1D1B" } as const;

/** A chart change (a tab, the period, a series shown or hidden) eases over
 *  half a second; hover effects take a fifth. */
export const CHART_MS = 500;
export const HOVER_MS = 200;

/** Forecast lines are dashed 6 / 4. */
export const FORECAST_DASH = "6 4";

/** The first month the 6-month view may show (the owner's design: the rolling
 *  six start in July; when a new month arrives the oldest drops off). */
export const DASH_FIRST_MONTH = "2026-07";

export type DashSpan = 6 | 12;

/** The first month of a period key — a month "2026-07" is itself; a quarter
 *  "2026-Q3" starts in "2026-07". */
export function periodStartYm(key: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(key);
  if (q) return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}`;
  return key.slice(0, 7);
}

/** The periods the dashboard draws: only those that have happened (they carry
 *  actual figures — the months ahead with only a forecast are left out). An
 *  explicit From / To shows all of its own; otherwise the last 6 or 12 months
 *  (2 or 4 quarters), the 6-month view never starting before DASH_FIRST_MONTH. */
export function dashPeriods<T extends { key: string; actual: unknown }>(
  rows: T[],
  opts: { span: DashSpan; granularity: "month" | "quarter"; explicit: boolean },
): T[] {
  const happened = rows.filter((r) => r.actual !== null && r.actual !== undefined);
  if (opts.explicit) return happened;
  const n = opts.granularity === "quarter" ? opts.span / 3 : opts.span;
  const pool = opts.span === 6 ? happened.filter((r) => periodStartYm(r.key) >= DASH_FIRST_MONTH) : happened;
  return (pool.length ? pool : happened).slice(-n);
}
