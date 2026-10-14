// ---------------------------------------------------------------------------
// finance-money.ts — the one way the finance pages write an amount (owner
// 2026-10-14): 1,234.00 with no "RM" (the page says amounts are in RM),
// a negative in brackets (1,234.00), and nothing — "–" — for zero. A fractional
// sen keeps its third and fourth decimals, as formatCurrency does.
// ---------------------------------------------------------------------------

const FMT_2DP = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FMT_4DP = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const ZERO_AMOUNT = "–";

export function fmtAmount(sen: number, opts: { zero?: string } = {}): string {
  if (!Number.isFinite(sen)) return opts.zero ?? ZERO_AMOUNT;
  if (sen === 0 || Object.is(sen, -0)) return opts.zero ?? ZERO_AMOUNT;
  const fmt = Number.isInteger(sen) ? FMT_2DP : FMT_4DP;
  const text = fmt.format(Math.abs(sen) / 100);
  return sen < 0 ? `(${text})` : text;
}

/** A negative amount reads red on the finance pages. */
export function isNegativeAmount(sen: number): boolean {
  return Number.isFinite(sen) && sen < 0;
}
