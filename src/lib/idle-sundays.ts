// ---------------------------------------------------------------------------
// idle-sundays.ts — drop the Sundays the factory did not work from a per-day
// series (owner 2026-10-15: 「礼拜天 remove 掉，因为没开工，除非礼拜天开工才
// 拉进来」). A Sunday whose every value is zero is a closed day, not a bad
// day: plotting it draws a dive to 0 every week. A Sunday with ANY non-zero
// value was worked (or took orders) and stays. Other days are never touched,
// so a real zero on a weekday still shows.
//
// Only per-DAY keys (YYYY-MM-DD) are judged; anything else is kept as is, so
// the all-time weekly buckets pass through untouched.
// ---------------------------------------------------------------------------

/** True for a YYYY-MM-DD that falls on a Sunday. */
export function isSundayISO(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return new Date(`${day}T00:00:00Z`).getUTCDay() === 0;
}

/**
 * Remove rows that are a Sunday AND carry no non-zero value.
 * `dayOf` returns the row's YYYY-MM-DD; `values` the numbers to judge it by.
 */
export function dropIdleSundays<T>(rows: T[], dayOf: (row: T) => string, values: (row: T) => number[]): T[] {
  return rows.filter((r) => !isSundayISO(dayOf(r)) || values(r).some((v) => Number(v) !== 0));
}
