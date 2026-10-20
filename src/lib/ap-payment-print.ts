// The bills block of a printed AP payment (owner 2026-10-17, print design 1a):
// one row per bill the payment settles — bill no., the supplier's own invoice
// no., bill date, due date, what was outstanding just before this payment and
// what this payment put on it — plus rows for an advance or a trade-finance
// repayment, and a strip with the party's balance before / this payment /
// after. The detail comes from GET /api/accounting/ap-payment-print; the maths
// it needs lives here too, pure, so the server and the tests share it. Money is
// integer sen; the caller formats it.
import type { VoucherColumn, VoucherFact, VoucherLine } from "./print-voucher";
import { fmtFxRate } from "./fx";

export type ApPrintBill = {
  docNo: string;
  /** The supplier's own invoice / bill reference; "" when none is on file. */
  supplierInvNo: string;
  /** YYYY-MM-DD, or "" when unknown. */
  billDate: string;
  dueDate: string;
  /** The bill's balance just before this payment; null when it cannot be worked out. */
  outstandingBeforeSen: number | null;
  /** What this payment put on the bill. */
  paidSen: number;
  /** A foreign-currency bill (Currency & FX step 3): what this payment paid in its currency. */
  foreignPaidSen?: number;
};

export type ApPrintDetail = {
  bills: ApPrintBill[];
  /** The part of the payment not put on any bill. */
  advanceSen: number;
  /** A supplier payment that repays a trade-finance lender. */
  tfRepaySen?: number;
  /** The party's balance just before this payment; null hides the strip. */
  balanceBeforeSen: number | null;
  /** The payee's bank & account no. from its master (Finance v2 party fields); "" when none is on file. */
  payeeBank?: string;
  /** An AP Payment of foreign-currency bills: their currency and the payment's rate (RM per 1 unit). */
  fx?: { currency: string; rate: number } | null;
};

/** One payment's amount on one bill. */
export type BillSettlement = { paymentNo: string; date: string; sen: number };

/**
 * A bill's balance just before payment `paymentNo` (dated `payDate`), anchored
 * on today's paid amount: what it owes now, plus what this payment put on it,
 * plus what payments dated after this one put on it. Same-day payments count
 * as before. `settlements` must already leave out void / deleted payments
 * (their amounts were given back to the bill when they were voided).
 */
export function billOutstandingBefore(
  bill: { totalSen: number; paidSen: number },
  settlements: BillSettlement[],
  paymentNo: string,
  payDate: string,
): number {
  let sen = bill.totalSen - bill.paidSen;
  for (const s of settlements) if (s.paymentNo === paymentNo || s.date > payDate) sen += s.sen;
  return sen;
}

/**
 * A party's balance just before payment `paymentNo` from its statement lines
 * (credit-normal: owed = credits − debits; lines already past the opening
 * floor): every line dated on or before the payment date, with this payment's
 * own lines added back. A draft payment has no lines yet — the balance is
 * simply the balance at that date.
 */
export function statementBalanceBefore(
  lines: { date: string; ref: string; type: string; debitSen: number; creditSen: number }[],
  paymentNo: string,
  payDate: string,
): number {
  let sen = 0;
  for (const l of lines) {
    if (l.date > payDate) continue;
    if (l.type === "PAYMENT" && l.ref === paymentNo) continue;
    sen += l.creditSen - l.debitSen;
  }
  return sen;
}

export type ApBillsBlock = {
  columns: VoucherColumn[];
  lines: VoucherLine[];
  totalCells: string[];
  balanceStrip?: VoucherFact[];
};

const dmy = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

export function apBillsBlock(
  d: ApPrintDetail,
  opts: { totalSen: number; money: (sen: number) => string; docLabel: string; refLabel: string; partyWord: string; fxMoney?: (sen: number, currency: string) => string },
): ApBillsBlock {
  const { money } = opts;
  // A foreign-currency payment (Currency & FX step 3): each bill's payment in
  // its currency and in RM at the payment's rate — the RM column adds up to
  // the amount paid; the bill was cleared at its booked RM, so the balance
  // strip moves by that and names the realised FX gain or loss.
  if (d.fx && d.fx.rate > 0) {
    const fx = d.fx;
    const fm = opts.fxMoney ?? ((sen: number, ccy: string) => `${ccy} ${(sen / 100).toFixed(2)}`);
    const foreignTotal = d.bills.reduce((s, b) => s + (b.foreignPaidSen ?? 0), 0);
    const bookedTotal = d.bills.reduce((s, b) => s + b.paidSen, 0);
    const fxSen = bookedTotal - opts.totalSen;
    return {
      columns: [
        { label: opts.docLabel },
        { label: opts.refLabel },
        { label: "Bill date" },
        { label: "Due" },
        { label: "Outstanding (RM)", align: "right" },
        { label: `Paid (${fx.currency})`, align: "right" },
        { label: `Paid (RM @ ${fmtFxRate(fx.rate)})`, align: "right" },
      ],
      lines: d.bills.map((b) => ({
        cells: [
          b.docNo || "—",
          b.supplierInvNo || "—",
          dmy(b.billDate),
          dmy(b.dueDate),
          b.outstandingBeforeSen == null ? "—" : money(b.outstandingBeforeSen),
          fm(b.foreignPaidSen ?? 0, fx.currency),
          money(Math.round((b.foreignPaidSen ?? 0) * fx.rate)),
        ],
      })),
      totalCells: ["", "", "", "", "Total", fm(foreignTotal, fx.currency), money(opts.totalSen)],
      balanceStrip: d.balanceBeforeSen == null
        ? (fxSen !== 0 ? [{ label: fxSen > 0 ? "Realised FX gain" : "Realised FX loss", value: money(Math.abs(fxSen)) }] : undefined)
        : [
            { label: `${opts.partyWord} balance before`, value: money(d.balanceBeforeSen) },
            { label: "Cleared (booked RM)", value: `− ${money(bookedTotal)}` },
            { label: "Balance after", value: money(d.balanceBeforeSen - bookedTotal) },
            ...(fxSen !== 0 ? [{ label: fxSen > 0 ? "Realised FX gain" : "Realised FX loss", value: money(Math.abs(fxSen)) }] : []),
          ],
    };
  }
  const lines: VoucherLine[] = d.bills.map((b) => ({
    cells: [
      b.docNo || "—",
      b.supplierInvNo || "—",
      dmy(b.billDate),
      dmy(b.dueDate),
      b.outstandingBeforeSen == null ? "—" : money(b.outstandingBeforeSen),
      money(b.paidSen),
    ],
  }));
  if ((d.tfRepaySen ?? 0) > 0) lines.push({ cells: ["Trade finance repayment", "—", "—", "—", "—", money(d.tfRepaySen ?? 0)] });
  if (d.advanceSen > 0) lines.push({ cells: ["Advance / unallocated", "—", "—", "—", "—", money(d.advanceSen)] });
  const balanceStrip = d.balanceBeforeSen == null
    ? undefined
    : [
        { label: `${opts.partyWord} balance before`, value: money(d.balanceBeforeSen) },
        { label: "This payment", value: `− ${money(opts.totalSen)}` },
        { label: "Balance after", value: money(d.balanceBeforeSen - opts.totalSen) },
      ];
  return {
    columns: [
      { label: opts.docLabel },
      { label: opts.refLabel },
      { label: "Bill date" },
      { label: "Due" },
      { label: "Outstanding", align: "right" },
      { label: "Paid", align: "right" },
    ],
    lines,
    totalCells: ["", "", "", "", "Total", money(opts.totalSen)],
    balanceStrip,
  };
}
