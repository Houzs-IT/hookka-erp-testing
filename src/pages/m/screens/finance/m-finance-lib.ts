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
