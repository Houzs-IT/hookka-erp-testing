// ---------------------------------------------------------------------------
// working-days.ts — which days count as working days for the dashboard's
// per-day averages (Daily Capacity, Backlog days of queue).
//
// Owner 2026-10-15: 「礼拜天 remove 掉，因为没开工，除非礼拜天开工才拉进来 …
// 全部的 chart 和数据都是，不要被这个影响了我们的数据」. A Sunday — or a public
// holiday, the same "factory closed" case — is a working day ONLY when
// production actually happened on it. Before this, every Sunday and holiday
// was dropped unconditionally, so a Sunday the factory DID work vanished from
// Daily Capacity; and counting an idle one would drag the average down.
//
// `worked` = the dates with production (completed job-card minutes > 0).
// Dates are YYYY-MM-DD; weekday is read in UTC from the date itself.
// ---------------------------------------------------------------------------

const dow = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

const shift = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Mon–Sat and not a holiday — or any day production happened on. */
export function isWorkingDay(iso: string, holidays: Set<string>, worked: Set<string>): boolean {
  if (worked.has(iso)) return true;
  return dow(iso) !== 0 && !holidays.has(iso);
}

/** The `count` most recent working days ending on `endISO` (inclusive), oldest first. */
export function workingDaysBack(
  endISO: string,
  count: number,
  holidays: Set<string>,
  worked: Set<string>,
): string[] {
  const out: string[] = [];
  let cur = endISO;
  // The guard caps the walk-back so a malformed holiday list can never spin.
  for (let g = 0; out.length < count && g < 130; g++) {
    if (isWorkingDay(cur, holidays, worked)) out.push(cur);
    cur = shift(cur, -1);
  }
  return out.reverse();
}

/** Every working day in [startISO, endISO], oldest first. */
export function workingDaysInRange(
  startISO: string,
  endISO: string,
  holidays: Set<string>,
  worked: Set<string>,
): string[] {
  const out: string[] = [];
  let cur = startISO;
  for (let g = 0; cur <= endISO && g < 400; g++) {
    if (isWorkingDay(cur, holidays, worked)) out.push(cur);
    cur = shift(cur, 1);
  }
  return out;
}
