// employees-dates.ts — pure date helpers for the mobile Employees shared period (HK-0125).
//
// Every function takes `today` (a Malaysia YYYY-MM-DD) as an argument instead of reading the clock, so the rules are
// testable and never hard-code a date. The caller supplies `todayYmdMYForReads()`.
//
// Rules (desktop employees.tsx wins): a tab opens on the whole CURRENT calendar month (1st..last day), the same as
// `readPersistedDateRangeThisMonth`. Future months are disabled; a custom From/To cannot end after today.

export type YmdRange = { from: string; to: string };

/** Earliest selectable date (the prototype's `min`). */
export const MIN_DATE = "2020-01-01";

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** True for a real calendar date written YYYY-MM-DD (rejects 2026-02-30). */
export function isYmd(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** YYYY-MM-DD shifted by whole days (calendar arithmetic, no time zone). */
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)) + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** First..last day of a calendar month. `month` is 1-12. */
export function monthRange(year: number, month: number): YmdRange {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad2(month)}-01`, to: `${year}-${pad2(month)}-${pad2(last)}` };
}

/** The whole current calendar month (NOT month-to-date). */
export function thisMonthRange(today: string): YmdRange {
  return monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
}

/** { year, month } when the range is exactly one whole calendar month, else null. */
export function wholeMonthOf(r: YmdRange): { year: number; month: number } | null {
  if (!isYmd(r.from) || !isYmd(r.to)) return null;
  const year = Number(r.from.slice(0, 4));
  const month = Number(r.from.slice(5, 7));
  const full = monthRange(year, month);
  return full.from === r.from && full.to === r.to ? { year, month } : null;
}

/** A month is "future" once its first day is after today. The current month is NOT future. */
export function isFutureMonth(year: number, month: number, today: string): boolean {
  return `${year}-${pad2(month)}-01` > today;
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

export function monthShort(month: number): string {
  return MONTHS_SHORT[month - 1];
}

function dayLabel(ymd: string, withYear: boolean): string {
  const d = Number(ymd.slice(8, 10));
  const m = MONTHS_SHORT[Number(ymd.slice(5, 7)) - 1];
  return withYear ? `${d} ${m} ${ymd.slice(0, 4)}` : `${d} ${m}`;
}

/** "November 2026" for a whole month, otherwise "1 Nov – 13 Nov 2026" (year shown on both ends if they differ). */
export function rangeLabel(r: YmdRange): string {
  const whole = wholeMonthOf(r);
  if (whole) return monthLabel(whole.year, whole.month);
  if (r.from === r.to) return dayLabel(r.from, true);
  if (r.from.slice(0, 4) === r.to.slice(0, 4)) return `${dayLabel(r.from, false)} – ${dayLabel(r.to, true)}`;
  return `${dayLabel(r.from, true)} – ${dayLabel(r.to, true)}`;
}

export const ERR_FROM_AFTER_TO = "Choose a From date on or before the To date.";
export const ERR_FUTURE = "Dates can't be in the future.";
export const ERR_INVALID = "Choose a valid From and To date.";

/**
 * null when the range may be applied. A whole month that has started is always allowed (the current month runs past
 * today, as on desktop). Any other range must end on or before today.
 */
export function validateRange(r: YmdRange, today: string): string | null {
  if (!isYmd(r.from) || !isYmd(r.to) || r.from < MIN_DATE || r.to < MIN_DATE) return ERR_INVALID;
  if (r.from > r.to) return ERR_FROM_AFTER_TO;
  const whole = wholeMonthOf(r);
  if (whole) return isFutureMonth(whole.year, whole.month, today) ? ERR_FUTURE : null;
  if (r.to > today) return ERR_FUTURE;
  return null;
}

/** Range from URL params; anything missing, malformed or not allowed falls back to the current month. */
export function parseRange(from: string | null, to: string | null, today: string): YmdRange {
  const candidate = { from: from ?? "", to: to ?? "" };
  return validateRange(candidate, today) === null ? candidate : thisMonthRange(today);
}
