// ---------------------------------------------------------------------------
// expense-estimates.ts (pure) — the running month's recurring costs that
// nothing has been recorded for yet, shown at last month's amount (owner
// 2026-10-13: 「这个月的 amount 还没有但每个月都有的，可以根据上个月的 amount
// 出现吗」→ last month's amount, three months in a row, factory overhead too,
// coloured rows →「做」).
//
// An account qualifies when it is an operating expense, a salaries &
// contribution line or factory overhead; it had a positive amount in each of
// the three months before the running month; and it nets to nothing so far
// this month. Its estimate is last month's amount. As soon as anything is
// recorded on it this month, the real figure replaces the estimate. Months
// that have ended are never estimated. Display only — nothing is posted, so
// the trial balance and balance sheet never carry it.
// ---------------------------------------------------------------------------

export const ESTIMATE_BUCKETS: ReadonlySet<string> = new Set(["OPERATING_EXPENSE", "OPEX_SALARIES", "FACTORY_OVERHEAD"]);
export const ESTIMATE_LOOKBACK = 3;

/** The `n` months before `ym`, most recent first. */
export function previousMonths(ym: string, n: number): string[] {
  const out: string[] = [];
  let [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  for (let i = 0; i < n; i++) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/** Does the window [startYm, endYm] (null = open) cover month `ym`? */
export function windowCoversYm(startYm: string | null, endYm: string | null, ym: string): boolean {
  return (!startYm || startYm <= ym) && (!endYm || ym <= endYm);
}

/**
 * The estimates for the running month. `current` is the running month's own
 * figure per account (DR − CR, before any estimate); `previous` the months
 * before it, most recent first (at least ESTIMATE_LOOKBACK of them);
 * `bucketOf` an account's P&L section (null = not a P&L account).
 */
export function recurringEstimates(input: {
  current: ReadonlyMap<string, number>;
  previous: ReadonlyMap<string, number>[];
  bucketOf: (code: string) => string | null;
}): Map<string, number> {
  const out = new Map<string, number>();
  const months = input.previous.slice(0, ESTIMATE_LOOKBACK);
  if (months.length < ESTIMATE_LOOKBACK) return out;
  const [last] = months;
  for (const [code, sen] of last) {
    const bucket = input.bucketOf(code);
    if (!bucket || !ESTIMATE_BUCKETS.has(bucket)) continue;
    if (!months.every((m) => Math.round(m.get(code) ?? 0) > 0)) continue;
    if (Math.round(input.current.get(code) ?? 0) !== 0) continue;
    out.set(code, Math.round(sen));
  }
  return out;
}
