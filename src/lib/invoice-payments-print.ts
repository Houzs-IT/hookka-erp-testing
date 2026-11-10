// ---------------------------------------------------------------------------
// invoice-payments-print.ts — the "Payments received" block on a printed or
// reprinted sales invoice (review H1-6, Houzs#4486). DISPLAY ONLY: it lists
// what is already stored and never posts, allocates or recomputes anything.
//
// Sources, in this order:
//   1. Official receipts (`payment_records`, not BOUNCED / CANCELLED) whose
//      allocations name this invoice — each prints its receipt number and the
//      amount allocated to THIS invoice (never just "Deposit").
//   2. Payments recorded straight on the invoice (`invoice_payments`) that no
//      receipt accounts for. A receipt also writes one invoice_payments row
//      per allocation (same date + amount), so those are matched off first.
//   3. The stored `invoices.paidAmount` is the authority for "paid": when the
//      rows above do not add up to it (a contra, an edited receipt), one
//      "Other settlement" row carries the difference, so the printed sum
//      always equals the stored figure and Balance due = total − paidAmount.
//
// Importable by both sides (src/api/lib is backend-only).
// ---------------------------------------------------------------------------

export interface InvoicePrintPayment {
  /** ISO date or YYYY-MM-DD, as stored. */
  date: string;
  /** Receipt number, or the payment's reference / method when it has none. */
  ref: string;
  amountSen: number;
}

export interface ReceiptAllocationRow {
  receiptNumber: string;
  date: string;
  status?: string | null;
  /** Amount of this receipt allocated to the invoice, in sen. */
  amountSen: number;
}

export interface DirectPaymentRow {
  date: string;
  amountSen: number;
  method?: string | null;
  reference?: string | null;
}

const DEAD_RECEIPT = new Set(["BOUNCED", "CANCELLED", "VOID", "VOIDED", "DELETED"]);

const day = (d: string) => String(d || "").slice(0, 10);

/** The rows to print, oldest first, summing to `paidSen` exactly. */
export function invoicePaymentLines(
  receipts: ReceiptAllocationRow[],
  direct: DirectPaymentRow[],
  paidSen: number,
): InvoicePrintPayment[] {
  const lines: InvoicePrintPayment[] = [];
  const live = receipts.filter(
    (r) => !DEAD_RECEIPT.has(String(r.status || "").toUpperCase()) && Math.round(Number(r.amountSen) || 0) !== 0,
  );
  const unmatched = direct.map((d) => ({ ...d, used: false }));
  for (const r of live) {
    const amt = Math.round(Number(r.amountSen) || 0);
    lines.push({ date: r.date, ref: r.receiptNumber || "Receipt", amountSen: amt });
    // Match off the invoice_payments row this receipt wrote (same day + amount).
    const twin = unmatched.find((d) => !d.used && day(d.date) === day(r.date) && Math.round(Number(d.amountSen) || 0) === amt);
    if (twin) twin.used = true;
  }
  for (const d of unmatched) {
    if (d.used) continue;
    const amt = Math.round(Number(d.amountSen) || 0);
    if (amt === 0) continue;
    const ref = String(d.reference || "").trim() || String(d.method || "").replace(/_/g, " ").trim() || "Payment";
    lines.push({ date: d.date, ref, amountSen: amt });
  }
  lines.sort((a, b) => day(a.date).localeCompare(day(b.date)));
  const listed = lines.reduce((s, l) => s + l.amountSen, 0);
  const paid = Math.round(Number(paidSen) || 0);
  if (paid !== listed) {
    lines.push({ date: "", ref: paid > listed ? "Other settlement" : "Adjustment", amountSen: paid - listed });
  }
  return lines;
}

/** Balance still due on the invoice: stored total − stored paid, never below 0. */
export function invoiceBalanceDueSen(totalSen: number, paidSen: number): number {
  return Math.max(0, Math.round(Number(totalSen) || 0) - Math.round(Number(paidSen) || 0));
}
