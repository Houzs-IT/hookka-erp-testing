// ---------------------------------------------------------------------------
// The one way a currency code is read off input (owner 2026-10-20, Currency &
// FX: the yuan is CNY, the design's code). Trimmed, upper-case, MYR when
// blank; RMB — this repo's older spelling — reads as CNY, so a code typed or
// stored either way lands on one currency (measured on prod 2026-10-20: no
// document, party, price-list row or GRN held RMB, so nothing was rewritten).
// Pure, no imports: the API and the pages share it.
// ---------------------------------------------------------------------------

/** Older spellings of a currency code → the code this system keeps. */
export const CURRENCY_ALIASES: Readonly<Record<string, string>> = { RMB: "CNY" };

/** A currency code off a request body or a stored row. */
export function normaliseCurrencyCode(v: unknown, fallback = "MYR"): string {
  const c = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (!c) return fallback;
  return CURRENCY_ALIASES[c] ?? c;
}
