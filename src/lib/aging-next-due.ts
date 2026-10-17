// Creditor Aging's Next Due column (owner 2026-10-17, Finance v2: "A Next Due
// column: amber within 7 days, red when overdue") and Overdue card, plus the
// month bucket for a trade-finance draw. Pure; dates are "YYYY-MM-DD", today
// is the caller's Malaysia date.

type DueDoc = { due?: string; amountSen: number };

const isYmd = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The earliest due date among the documents still owed; "" when none has one. */
export function nextDueOf(docs: DueDoc[]): string {
  let best = "";
  for (const d of docs) {
    if (d.amountSen <= 0 || !isYmd(d.due)) continue;
    if (!best || d.due < best) best = d.due;
  }
  return best;
}

/** Whole days from today to the due date (negative = past due). */
export function daysUntil(dueYmd: string, todayYmd: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(dueYmd) - t(todayYmd)) / 86_400_000);
}

export type DueTone = "overdue" | "soon" | "later";

/** Red when overdue, amber within 7 days, plain after. */
export function dueTone(days: number): DueTone {
  return days < 0 ? "overdue" : days <= 7 ? "soon" : "later";
}

export function dueText(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** What is owed past its due date. */
export function overdueSen(docs: DueDoc[], todayYmd: string): number {
  return docs.reduce((s, d) => s + (d.amountSen > 0 && isYmd(d.due) && d.due < todayYmd ? d.amountSen : 0), 0);
}

/** Calendar months from a date to today, as the aging buckets count them (0..4). */
export function monthBucket(dateYmd: string, todayYmd: string): number {
  if (!isYmd(dateYmd)) return 0;
  const m = (+todayYmd.slice(0, 4) - +dateYmd.slice(0, 4)) * 12 + (+todayYmd.slice(5, 7) - +dateYmd.slice(5, 7));
  return m <= 0 ? 0 : m >= 4 ? 4 : m;
}
