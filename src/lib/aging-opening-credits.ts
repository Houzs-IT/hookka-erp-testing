// ---------------------------------------------------------------------------
// aging-opening-credits.ts — opening-period receipts on the Debtor Aging
// (owner 2026-11-11, with a screenshot of the 3+ months column: 「可以帮我把
// houzs 和 conts 的还之前的的invoice的数额不要显示吗？」 → 「可以」).
//
// A customer receipt from the opening period (dated up to the month after the
// opening month, openingCreditCutoffYm in cashflow-forecast.ts) that is not
// knocked off yet pays invoices from before the opening, which the system
// does not hold. The Cash Flow forecast already leaves such receipts out
// (splitOpeningCredits); the Debtor Aging and the Daily Cash Position's TO
// RECEIVE now do too, and name the total under the table, because the ledger
// still counts them.
// ---------------------------------------------------------------------------

/** How the aging names a receipt still on account (an unapplied advance). */
export const ADVANCE_DOC_SUFFIX = " · Advance";

const AGING_BUCKETS = ["currentSen", "days30Sen", "days60Sen", "days90Sen", "over90Sen"] as const;

/** A receipt dated in the opening period: up to the end of `cutoffYm`. */
export function isOpeningCredit(date: string | null | undefined, cutoffYm: string | null): boolean {
  const d = String(date ?? "");
  return !!cutoffYm && /^\d{4}-\d{2}/.test(d) && d.slice(0, 7) <= cutoffYm;
}

export type ArAgingDoc = { no: string; date: string; mo: number; amountSen: number };
export type ArAgingRowLike = {
  customerName: string;
  currentSen: number; days30Sen: number; days60Sen: number; days90Sen: number; over90Sen: number;
  docs?: ArAgingDoc[];
};
/** What was left out: the receipts (amounts received, positive) and their total. */
export type OpeningCredits = { receivedSen: number; items: { customerName: string; no: string; date: string; sen: number }[] };

/** The Debtor Aging's rows without the opening-period receipts still on
 *  account: each such line leaves its row and its bucket goes back up by it.
 *  Credit notes and later receipts stay. A row left with nothing goes. The
 *  rows passed in are not changed. */
export function splitArOpeningCredits<R extends ArAgingRowLike>(rows: readonly R[], cutoffYm: string | null): { rows: R[]; openingCredits: OpeningCredits } {
  const items: OpeningCredits["items"] = [];
  const out: R[] = [];
  for (const r of rows) {
    const docs = r.docs ?? [];
    const leaving = docs.filter((d) => d.amountSen < 0 && d.no.endsWith(ADVANCE_DOC_SUFFIX) && isOpeningCredit(d.date, cutoffYm));
    if (!leaving.length) { out.push(r); continue; }
    const next: R = { ...r, docs: docs.filter((d) => !leaving.includes(d)) };
    const buckets = next as unknown as Record<(typeof AGING_BUCKETS)[number], number>;
    for (const d of leaving) {
      const k = AGING_BUCKETS[Math.min(Math.max(Math.round(d.mo), 0), AGING_BUCKETS.length - 1)];
      buckets[k] = (Number(buckets[k]) || 0) - d.amountSen;
      items.push({ customerName: r.customerName, no: d.no.slice(0, -ADVANCE_DOC_SUFFIX.length), date: d.date, sen: -d.amountSen });
    }
    const empty = !(next.docs ?? []).length && AGING_BUCKETS.every((k) => !buckets[k]);
    if (!empty) out.push(next);
  }
  return { rows: out, openingCredits: { receivedSen: items.reduce((t, i) => t + i.sen, 0), items } };
}
