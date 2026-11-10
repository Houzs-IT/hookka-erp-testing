// ---------------------------------------------------------------------------
// pdf-cancelled-stamp.ts — the red CANCELLED stamp on a cancelled document's
// PDF, and the one "is this document cancelled?" test the PDFs and the lists
// share (review D2 / G5; Houzs#5049, #4493; Conts#804).
//
// A cancelled SO / PO / DO / GRN / invoice used to print exactly like a live
// one (the PO only showed "CANCELLED" as its Status value), so a printed or
// emailed copy could be mistaken for a valid document. Display only: nothing
// here reads or changes an amount or a quantity.
// ---------------------------------------------------------------------------
import type { jsPDF } from "jspdf";
import { isCancelledStatus } from "./cancelled-doc";

export { isCancelledStatus };

export const CANCELLED_STAMP_TEXT = "CANCELLED";
/** Stamp red, as RGB 0–255. */
export const CANCELLED_RED: [number, number, number] = [200, 30, 30];
/** Opacity of the stamp, so the document stays readable underneath. */
export const CANCELLED_OPACITY = 0.3;
/** Angle of the stamp, degrees counter-clockwise from the baseline. */
export const CANCELLED_ANGLE = 35;

/**
 * Where to put the start of the rotated stamp text so its middle lands on
 * (cx, cy). Rotation is about the text's start point, counter-clockwise.
 * `upIsPositive` is true for pdf-lib (y grows upward) and false for jsPDF
 * (y grows downward on the page).
 */
export function stampOrigin(
  cx: number,
  cy: number,
  textWidth: number,
  textHeight: number,
  angleDeg: number,
  upIsPositive: boolean,
): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Half the run along the baseline, plus half the cap height across it.
  const dx = (textWidth / 2) * cos - (textHeight / 2) * sin;
  const dy = (textWidth / 2) * sin + (textHeight / 2) * cos;
  return upIsPositive ? { x: cx - dx, y: cy - dy } : { x: cx - dx, y: cy + dy };
}

/**
 * Draw the CANCELLED stamp on every page of a finished jsPDF document. Call it
 * after the last page is added (footers included). Units follow the document
 * (the generators use mm).
 */
export function stampCancelledJsPdf(doc: jsPDF): void {
  const pages = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const fontSize = 72; // pt
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.saveGraphicsState();
    // jsPDF's typings declare GState as a method; at runtime it is the class.
    const GState = (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState;
    doc.setGState(new GState({ opacity: CANCELLED_OPACITY }));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fontSize);
    doc.setTextColor(...CANCELLED_RED);
    const w = doc.getTextWidth(CANCELLED_STAMP_TEXT);
    // Cap height ≈ 0.7 em; pt → document units via the scale factor.
    const h = (fontSize * 0.7) / doc.internal.scaleFactor;
    const o = stampOrigin(pageW / 2, pageH / 2, w, h, CANCELLED_ANGLE, false);
    doc.text(CANCELLED_STAMP_TEXT, o.x, o.y, { angle: CANCELLED_ANGLE });
    doc.restoreGraphicsState();
  }
  doc.setTextColor(0, 0, 0);
}
