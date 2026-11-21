// ---------------------------------------------------------------------------
// delivery-bucket.ts — which customer-delivery bucket an open order falls in
// (owner 2026-11-22: "17.4 天 … 11 月份的 order 可能 4 天而已，12 月份的 10 天，
// 剩下的 3 天其实是 1 月份的"). Used by the dashboard's Department Backlog,
// Plant Load, Total Backlog and Active Jobs so every one of them splits the
// same way.
//
//   "overdue"  — delivery date before today (still open = late)
//   "YYYY-MM"  — the delivery month, today or later
//   "none"     — no delivery date on the order (stock build, missing data)
//
// Order: overdue first, then months oldest → newest, "none" last.
// ---------------------------------------------------------------------------

export const OVERDUE = "overdue";
export const NO_DATE = "none";

const ymd = (v: unknown): string => {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
};

/** Bucket key for one order's customer delivery date, as of `today` (YYYY-MM-DD). */
export function deliveryBucket(date: unknown, today: string): string {
  const d = ymd(date);
  if (!d) return NO_DATE;
  if (d < today) return OVERDUE;
  return d.slice(0, 7);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Overdue", "Nov 2026", "No delivery date". */
export function bucketLabel(key: string): string {
  if (key === OVERDUE) return "Overdue";
  if (key === NO_DATE) return "No delivery date";
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Distinct keys in display order: overdue, months ascending, none. */
export function sortBuckets(keys: Iterable<string>): string[] {
  const set = new Set(keys);
  const months = [...set].filter((k) => k !== OVERDUE && k !== NO_DATE).sort();
  return [...(set.has(OVERDUE) ? [OVERDUE] : []), ...months, ...(set.has(NO_DATE) ? [NO_DATE] : [])];
}
