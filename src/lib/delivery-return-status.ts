// ---------------------------------------------------------------------------
// delivery-return-status.ts — what a delivery return's status chip says.
//
// "Return to stock" on an invoiced delivery order moves the return to
// CN_ISSUED the moment it is pressed — before any credit note exists; the
// note is raised on the next screen, and that screen can be left without
// saving. DR-2608-001 sat at "CN issued" with no note behind it (owner
// 2026-10-17 「这个要修」, BUG-2026-10-17-318). So the label is worked from
// the credit note actually linked to the return, never from the stored
// status alone. Pure; shared by the list and the detail page.
// ---------------------------------------------------------------------------

export const DELIVERY_RETURN_STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  RETURNED_TO_STOCK: "Returned to stock",
  SERVICE_SPAWNED: "Service in progress",
  CN_ISSUED: "CN issued",
  REDELIVERED: "Re-delivered",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export type DeliveryReturnStatusView = {
  /** What the chip says. */
  label: string;
  /** The status the chip is coloured by. */
  chip: string;
  /** Returned to stock on an invoiced order, and no credit note raised yet. */
  awaitingCreditNote: boolean;
};

export function deliveryReturnStatus(r: {
  status: string;
  creditNoteId?: string | null;
  creditNoteStatus?: string | null;
}): DeliveryReturnStatusView {
  if (r.status === "CN_ISSUED") {
    if (!r.creditNoteId) return { label: "Awaiting credit note", chip: "PENDING", awaitingCreditNote: true };
    if (r.creditNoteStatus === "DRAFT") return { label: "Credit note drafted", chip: "DRAFT", awaitingCreditNote: false };
  }
  return {
    label: DELIVERY_RETURN_STATUS_LABEL[r.status] ?? r.status,
    chip: r.status,
    awaitingCreditNote: false,
  };
}
