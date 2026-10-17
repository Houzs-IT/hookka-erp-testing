// ---------------------------------------------------------------------------
// Pure helpers for the phone's Finance screens (finance v2 mobile). The
// screens show the server's figures; where a total is shown that the server
// does not send, it is the sum of the rows on the screen — computed here, once,
// and tested.
// ---------------------------------------------------------------------------

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
