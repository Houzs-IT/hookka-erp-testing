// ---------------------------------------------------------------------------
// po-editable.ts — can this purchase order still be edited? (BUG-2026-11-27-593)
//
// ONE rule for the PO detail page's Edit button and the PO list's right-click
// "Edit". Owner ruling 2026-08-07: a PO stays editable until goods land — a
// CONFIRMED (or SUBMITTED / DRAFT) PO that has received nothing yet can be
// edited; the PUT route permits supplier / line edits until a POSTED or
// CONFIRMED GRN exists (src/api/routes/purchase-orders.ts). It locks once
// anything is received (a posted / confirmed GRN, or any line receivedQty > 0)
// or the PO is terminal (CANCELLED / RECEIVED / CLOSED).
//
// The list used to allow DRAFT only, but manual POs are saved CONFIRMED, so
// its "Edit" was almost always greyed out while the detail page allowed it.
// ---------------------------------------------------------------------------

const LOCKED_STATUSES = new Set(["CANCELLED", "RECEIVED", "CLOSED"]);
const RECEIVING_GRN_STATUSES = new Set(["POSTED", "CONFIRMED"]);

export type PoEditableInput = {
  status: string;
  items: Array<{ receivedQty?: number | null }>;
};

/** True when any of these GRNs has received goods (POSTED or CONFIRMED). */
export function hasReceivingGrn(grns: Array<{ status?: string | null }> | null | undefined): boolean {
  return (grns ?? []).some((g) => RECEIVING_GRN_STATUSES.has(String(g.status ?? "").toUpperCase()));
}

export function isPoEditable(po: PoEditableInput, hasPostedGrn: boolean): boolean {
  if (LOCKED_STATUSES.has(po.status)) return false;
  if (hasPostedGrn) return false;
  const received = po.items.reduce((s, it) => s + (Number(it.receivedQty) || 0), 0);
  return received === 0;
}
