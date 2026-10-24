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

/** The width a value axis needs for its widest label (BUG-2026-10-24-391: at
 *  recharts' fixed 60 a seven-digit label such as 1,400,000 lost its first
 *  digit). At 12px a tabular figure runs about 7.2, a comma or point 3.2, a
 *  per cent sign 10; plus 13 for the tick and a gap. The axis rounds its top up to a
 *  round step, so the widest label is taken a quarter above the largest value
 *  (850,000 draws a 1,000,000 tick); never narrower than the old 60, so a
 *  six-digit axis keeps its width. */
export function yAxisWidthFor(values: readonly (number | null | undefined)[], fmt: (v: number) => string): number {
  let hi = 0;
  let lo = 0;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v > hi) hi = v;
    if (v < lo) lo = v;
  }
  const labelWidth = (s: string) => [...s].reduce((w, ch) => w + (ch === "," || ch === "." ? 3.2 : ch === "%" ? 10 : 7.2), 0);
  const labels = [hi, hi * 1.25, ...(lo < 0 ? [lo, lo * 1.25] : [])].map(fmt);
  return Math.max(60, Math.ceil(Math.max(...labels.map(labelWidth))) + 13);
}

/** A ratio axis's label: a percentage or a multiple as the value reads, never
 *  the money format (BUG-2026-10-24-391: 39.05 % through the money format
 *  printed 0). Up to two decimals, trailing zeros dropped. */
export function ratioTick(v: number, pct: boolean): string {
  const n = String(Math.round(v * 100) / 100);
  return pct ? `${n}%` : n;
}

/** The first month the 6-month view may show (the owner's design: the rolling
 *  six start in July; when a new month arrives the oldest drops off). */
export const DASH_FIRST_MONTH = "2026-07";

export type DashSpan = 6 | 12;

/** A period as the design labels it: "Jul 2026" (a quarter key such as
 *  "2026/Q3" stays as it is), starred while it is still running. */
export function dashPeriodLabel(label: string, partial: boolean): string {
  const words = /^\d{4}-\d{2}$/.test(label)
    ? new Date(`${label}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : label;
  return `${words}${partial ? " *" : ""}`;
}

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
