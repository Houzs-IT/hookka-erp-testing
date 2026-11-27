// ---------------------------------------------------------------------------
// invoiceable-do.ts — which delivery orders can be invoiced (BUG-2026-11-27-591).
//
// ONE rule, shared by the server (POST /api/invoices refuses anything else)
// and the invoice page's "New Invoice" dialog (which lists only these).
//
// The rule is DELIVERED, not LOADED, on purpose:
//  * src/api/routes/invoices.ts header: "Invoice creation still requires a
//    DELIVERED deliveryOrderId".
//  * Revenue and COGS are booked on delivery: the DELIVERED cascade
//    (buildDoDeliveredSoAndInvoice in delivery-orders/_helpers.ts) runs FIFO
//    COGS and auto-creates the invoice. A LOADED DO is still on the lorry; it
//    counts as UNDELIVERED exposure in the credit check (customer-credit.ts).
//  * The DO list's "Transfer to Invoice" is disabled unless DELIVERED.
// The dialog used to list LOADED too, so picking one always answered 400.
//
// A DO delivered WITH ISSUES is held until its paperwork is resolved (the
// server refuses it too), so it is not offered either.
// ---------------------------------------------------------------------------

export const INVOICEABLE_DO_STATUS = "DELIVERED";

export type InvoiceableDoCandidate = {
  status?: string | null;
  deliveryIncomplete?: boolean | number | null;
};

/** True when POST /api/invoices would accept this DO's status. */
export function isInvoiceableDo(d: InvoiceableDoCandidate): boolean {
  return d.status === INVOICEABLE_DO_STATUS && !Number(d.deliveryIncomplete ?? 0);
}

/**
 * Where "Convert to Invoice" on a DO's page goes: the invoice page's New
 * Invoice dialog, opened with this DO picked (BUG-2026-11-27-595). The DO page
 * must never create the invoice by flipping the DO status to INVOICED.
 */
export function invoiceFromDoPath(doId: string): string {
  return `/invoices?createFromDo=${encodeURIComponent(doId)}`;
}
