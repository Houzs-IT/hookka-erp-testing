// ---------------------------------------------------------------------------
// cancelled-doc.ts — one "is this document cancelled?" test, shared by the
// PDFs (red CANCELLED stamp, src/lib/pdf-cancelled-stamp.ts) and the document
// lists (number struck through, row faded). Review D2 / G5; Houzs#4493,
// #5049; Conts#804. Display only.
// ---------------------------------------------------------------------------

const CANCELLED_STATUSES = new Set(["CANCELLED", "CANCELED", "VOID", "VOIDED"]);

/** True for a cancelled / voided document status, whatever the case. */
export function isCancelledStatus(status: unknown): boolean {
  if (status == null) return false;
  return CANCELLED_STATUSES.has(String(status).trim().toUpperCase());
}

/** DataGrid `cellClassName` for a document-number column: struck through. */
export const CANCELLED_DOC_NO_CLASS = "line-through decoration-[#B91C1C]";
/** DataGrid `rowClassName` for a cancelled row: faded text. */
export const CANCELLED_ROW_CLASS = "text-[#9CA3AF]";

export function cancelledDocNoClass(status: unknown): string {
  return isCancelledStatus(status) ? CANCELLED_DOC_NO_CLASS : "";
}

export function cancelledRowClass(status: unknown): string {
  return isCancelledStatus(status) ? CANCELLED_ROW_CLASS : "";
}
