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

// ---------------------------------------------------------------------------
// Compare-and-set on status changes (review O1, owner-approved 2026-11-10;
// sister of Houzs#5466). Every status-changing endpoint takes the status the
// page showed (`expectedStatus`) and refuses with 409 when the return has
// moved since — so a late click cannot act on a state nobody looked at, and a
// late write cannot re-open a cancelled return. Pure; shared by the route and
// the tests.
// ---------------------------------------------------------------------------

/** The status the client says it saw, or null when it sent none. */
export function readExpectedStatus(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const v = (body as { expectedStatus?: unknown }).expectedStatus;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** True when the client named a status and the return is no longer in it. */
export function isStaleStatus(expected: string | null, current: string | null | undefined): boolean {
  return expected != null && expected !== (current ?? "");
}

function statusWords(s: string | null | undefined): string {
  if (!s) return "gone";
  return DELIVERY_RETURN_STATUS_LABEL[s] ?? s;
}

/** The 409 sentence when the return moved between the page and the save. */
export function staleReturnStatusMessage(
  current: string | null | undefined,
  saw: string | null | undefined,
): string {
  const was = saw ? `, it was ${statusWords(saw)} when you started` : "";
  return `This return was changed by someone else just now (it is now ${statusWords(current)}${was}). Nothing was saved. Refresh and check before trying again.`;
}
