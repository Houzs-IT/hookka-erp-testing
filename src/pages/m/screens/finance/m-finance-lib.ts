// ---------------------------------------------------------------------------
// Pure helpers for the phone's Finance screens (finance v2 mobile). The
// screens show the server's figures; where a total is shown that the server
// does not send, it is the sum of the rows on the screen — computed here, once,
// and tested.
// ---------------------------------------------------------------------------
// Relative, so the node tests can load this file without the app's @/ alias.
import { dashPeriods } from "../../../../lib/finance-chart-look";
import { fmtPct } from "../../../../lib/finance-money";

/** A percentage chart's point label on the phone ("46.8%"; owner 2026-10-20
 *  「手机版的overview 每个月份的点没有percentage」 — a phone has no hover). A
 *  month without sales has no point, so no label. */
export const pctPointLabel = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? fmtPct(v) : "");

/** The five aging buckets, in order, as /api/accounting/aging names them. */
export const AGING_BUCKETS = [
  { key: "currentSen", label: "Current" },
  { key: "days30Sen", label: "1 month" },
  { key: "days60Sen", label: "2 months" },
  { key: "days90Sen", label: "3 months" },
  { key: "over90Sen", label: "3+ months" },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]["key"];
export type AgingRowLike = Partial<Record<AgingBucketKey, number>>;

/** One party's outstanding: the sum of its five buckets (the desktop Total). */
export function agingRowTotal(r: AgingRowLike): number {
  return AGING_BUCKETS.reduce((s, b) => s + (Number(r[b.key]) || 0), 0);
}

/** Per-bucket sums and the grand total over the rows shown. */
export function agingTotals(rows: AgingRowLike[]): { buckets: Record<AgingBucketKey, number>; total: number } {
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0])) as Record<AgingBucketKey, number>;
  for (const r of rows) for (const b of AGING_BUCKETS) buckets[b.key] += Number(r[b.key]) || 0;
  return { buckets, total: AGING_BUCKETS.reduce((s, b) => s + buckets[b.key], 0) };
}

/** Widths for the stacked bucket bar, in %: negative buckets (money held
 *  ahead of a bill) take no width; nothing to draw gives all zeros. */
export function agingBarWidths(buckets: Record<AgingBucketKey, number>): number[] {
  const pos = AGING_BUCKETS.map((b) => Math.max(0, buckets[b.key]));
  const sum = pos.reduce((s, v) => s + v, 0);
  return sum > 0 ? pos.map((v) => (v / sum) * 100) : pos.map(() => 0);
}

/** Money as the reports print it: 1,234.56, a negative in brackets. */
export function fmtMoney(sen: number): string {
  const s = (Math.abs(sen) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sen < 0 ? `(${s})` : s;
}

/** The P&L statement's two headline figures and their % of sales, read off
 *  the statement's own result rows (nothing recomputed). */
export function plHeadline<R extends { kind: string; label: string; periodSen?: number }>(
  rows: R[],
  netSalesSen: number,
): { gross: { sen: number; pct: number | null } | null; net: { sen: number; pct: number | null } | null } {
  const pick = (re: RegExp) => {
    const r = rows.find((x) => x.kind === "grandtotal" && re.test(x.label));
    if (!r || r.periodSen === undefined) return null;
    return { sen: r.periodSen, pct: netSalesSen > 0 ? (r.periodSen / netSalesSen) * 100 : null };
  };
  return { gross: pick(/GROSS PROFIT/i), net: pick(/NET PROFIT/i) };
}

/** The Balance Sheet's two sides in the desktop arrangement (owner
 *  2026-10-17): Fixed Assets + Current Assets − Current Liabilities against
 *  Equity + Non-Current Liabilities. */
export function bsSides(entries: { category: string; balance: number }[]) {
  const sum = (c: string) => entries.filter((e) => e.category === c).reduce((s, e) => s + e.balance, 0);
  const fixed = sum("FIXED_ASSET");
  const current = sum("CURRENT_ASSET");
  const currentLiab = sum("CURRENT_LIABILITY");
  const longLiab = sum("LONG_TERM_LIABILITY");
  const equity = sum("EQUITY");
  const netCurrent = current - currentLiab;
  const left = fixed + netCurrent;
  const right = equity + longLiab;
  return { fixed, current, currentLiab, longLiab, equity, netCurrent, left, right, diff: left - right };
}

/** Which Cash Flow column is the month asked for (the engine keys month
 *  columns "YYYY-MM" and also sends an Accumulated column); -1 when the month
 *  is not there — the screen then says so rather than show another month. */
export function cfColumnIndex(columns: { key: string; accum?: boolean }[], period: string): number {
  return columns.findIndex((c) => c.key === period && !c.accum);
}

/** The desktop Financial Dashboard's Income Statement lines, in its order
 *  (PL_TABS in src/pages/finance-dashboard.tsx — a test keeps the two equal). */
export const FIN_DASH_LINES = [
  { key: "sales", label: "Revenue" },
  { key: "cogs", label: "COGS" },
  { key: "materials", label: "Raw Material" },
  { key: "labour", label: "Production Salary" },
  { key: "overhead", label: "Factory Overhead" },
  { key: "stockMovement", label: "Stock Movement" },
  { key: "gross", label: "Gross Profit" },
  { key: "staffCost", label: "Staff Cost" },
  { key: "otherOpex", label: "Other Expenses" },
  { key: "net", label: "Net Profit" },
] as const;
export type DashLine = (typeof FIN_DASH_LINES)[number]["key"];

const DASH_INCOME: ReadonlySet<DashLine> = new Set<DashLine>(["sales", "gross", "net"]);

/** A line's gap to its forecast; "bad" = income under plan or a cost over it. */
export function dashGap(line: DashLine, actual: number | null, forecast: number | null): { sen: number; bad: boolean } | null {
  if (actual === null || forecast === null) return null;
  const sen = actual - forecast;
  return { sen, bad: DASH_INCOME.has(line) ? sen < 0 : sen > 0 };
}

/** The dashboard's month to show: the latest row with actual figures. The
 *  endpoint also sends the months ahead that carry only a forecast
 *  (BUG-2026-10-17-308); -1 when no month has actuals. */
export function dashAnchorIndex(rows: { actual: unknown }[]): number {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].actual) return i;
  return -1;
}

/** A dashboard month key in words: "2026-10" → "Oct" / "Oct 2026" (en-US, so
 *  September reads "Sep" as the design does — en-GB says "Sept"); any other
 *  key (a quarter) is returned as it is. */
export function dashMonthLabel(key: string, long: boolean): string {
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  return new Date(`${key}-01T00:00:00Z`).toLocaleString("en-US", long ? { month: "short", year: "numeric", timeZone: "UTC" } : { month: "short", timeZone: "UTC" });
}

// ---- The Finance Dashboard on the phone, as the owner's phone design draws it
// (2026-10-20 「手机版的和我之前设计的也有不一样」) ---------------------------

/** The phone Income Statement's lines: the desktop's, without Stock Movement
 *  (the phone design leaves it out). */
export const MOBILE_DASH_LINES = FIN_DASH_LINES.filter((l) => l.key !== "stockMovement");

/** Whole ringgit, as the phone dashboard prints its figures: 612,400 / -887,600. */
export function rmWhole(sen: number | null | undefined): string {
  if (sen === null || sen === undefined || !Number.isFinite(sen)) return "-";
  return Math.round(sen / 100).toLocaleString("en-MY");
}

/** The pill against the forecast: "+12,000 vs fcst" / "-8,000 vs fcst";
 *  good = income at or over plan, a cost at or under it. */
export function vsForecast(
  actual: number | null,
  forecast: number | null,
  lowerBetter: boolean,
): { text: string; good: boolean; forecast: string } | null {
  if (actual === null || forecast === null) return null;
  const gap = actual - forecast;
  return { text: `${gap > 0 ? "+" : ""}${rmWhole(gap)} vs fcst`, good: lowerBetter ? gap <= 0 : gap >= 0, forecast: rmWhole(forecast) };
}

/** The months the phone dashboard shows: the last four that have happened,
 *  from July (the desktop's 6-month rule, the phone design's four). */
export function phoneDashMonths<T extends { key: string; actual: unknown }>(rows: T[]): T[] {
  return dashPeriods(rows, { span: 6, granularity: "month", explicit: false }).slice(-4);
}

/** The phone design's smooth line through points: each gap a cubic whose
 *  handles reach a 2.5th of the way across. */
export function smoothPath(pts: readonly (readonly [number, number])[]): string {
  if (!pts.length) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1];
    const [x1, y1] = pts[k];
    const dx = (x1 - x0) / 2.5;
    d += ` C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`;
  }
  return d;
}

// The cash-flow sections in the statement's order, as the phone design lists
// them (money in first); any other section follows in the order it came.
const CF_SECTION_ORDER = [
  "REVENUE COLLECTION", "RAW MATERIALS", "TRADE FINANCE", "DIRECT LABOUR", "FACTORY OVERHEAD",
  "GENERAL EXPENSE", "FINANCE COST", "CAPEX", "LOAN & DEPOSIT",
];
const sentenceCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

/** A month's cash flow by section, the way the desktop's Detail groups it, in
 *  the statement's order and in words ("Revenue collection"); a section that
 *  nets to nothing is left out. */
export function cfSectionTotals(lines: readonly { section: string; value: number }[] | undefined): { name: string; value: number }[] {
  const by = new Map<string, number>();
  for (const l of lines ?? []) {
    const key = l.section.replace(/_/g, " ").trim().toUpperCase();
    by.set(key, (by.get(key) ?? 0) + l.value);
  }
  const rank = (k: string) => {
    const i = CF_SECTION_ORDER.indexOf(k);
    return i < 0 ? CF_SECTION_ORDER.length : i;
  };
  return [...by.entries()]
    .filter(([, v]) => Math.round(v) !== 0)
    .map(([k, value], seen) => ({ k, value, seen }))
    .sort((a, b) => rank(a.k) - rank(b.k) || a.seen - b.seen)
    .map(({ k, value }) => ({ name: sentenceCase(k), value }));
}

/** "Oct 2026 *" — a dashboard month in words, starred while it is still running. */
export const monthName = (r: { key: string; partial: boolean }) => `${dashMonthLabel(r.key, true)}${r.partial ? " *" : ""}`;
/** "Oct*" — the same, short, for the chart. */
export const shortName = (r: { key: string; partial: boolean }) => `${dashMonthLabel(r.key, false)}${r.partial ? "*" : ""}`;

/** The swipe back on the phone's Finance screens: it starts within 28px of
 *  the left edge and goes back once dragged past 30% of the width. */
export const SWIPE_EDGE_PX = 28;
export const swipeGoesBack = (dx: number, width: number) => dx > width * 0.3;

/** A share-of-the-whole bar's parts: each positive part's width in %, in order. */
export function shareWidths(values: readonly (number | null)[]): number[] {
  const pos = values.map((v) => Math.max(0, v ?? 0));
  const sum = pos.reduce((s, v) => s + v, 0);
  return sum > 0 ? pos.map((v) => (v / sum) * 100) : pos.map(() => 0);
}
