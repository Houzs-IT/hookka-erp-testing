// ---------------------------------------------------------------------------
// grn-mobile — the Goods Receipt steps the phone adds to the existing GRN detail (desktop grn-detail.tsx, rule for rule):
//   · Mark In Transit / At Customs / Arrived — PUT /api/grn/:id/arrival, one step at a time (the server refuses a skip);
//     Post to Stock stays refused until the receipt is ARRIVED
//   · Edit Quantities — the accepted quantity per line, with the SHARED rules (lib/purchase-edit-rules): an invoiced line is
//     frozen, a blank is rejected, a POSTED receipt moves stock by the delta
// NOT here: Approve (BUG-2026-10-21-344: it posts stock without drawing the PO down).
//
// A DRAFT receipt's lines are edited by line id (src/api/lib/grn-line-edit.ts): the server updates each line in place and
// keeps its PO / PO-line link, so Edit Quantities is offered on a PO-linked draft too. (Until 2026-11-04 the server rebuilt
// a draft's lines without those links, and this action was withheld there.)
// Pure — no network.
// ---------------------------------------------------------------------------
import { checkGrnLineQtyEdit, describeGrnStockDelta, grnLineInvoicedQty, isGrnFullyLockedByDownstreamPi, isGrnLineEditable, isGrnLineLockedByPi } from "../../../lib/purchase-edit-rules";
import { n, rows, s, type RawRow } from "./procurement-mobile";

export type ArrivalStep = "NOT_ARRIVED" | "IN_TRANSIT" | "AT_CUSTOMS" | "ARRIVED";
const NEXT: Record<string, ArrivalStep | null> = { NOT_ARRIVED: "IN_TRANSIT", IN_TRANSIT: "AT_CUSTOMS", AT_CUSTOMS: "ARRIVED", ARRIVED: null };
const LABEL: Record<string, string> = { NOT_ARRIVED: "Mark In Transit", IN_TRANSIT: "Mark At Customs", AT_CUSTOMS: "Mark Arrived" };

const arrivalNow = (g: RawRow): string => s(g, "arrival_state", "arrivalState") || (s(g, "poId") ? "NOT_ARRIVED" : "ARRIVED");

/** The next arrival step, or null when ARRIVED or the receipt is cancelled. */
export function grnArrivalAdvance(g: RawRow): { target: ArrivalStep; label: string } | null {
  if (s(g, "status") === "CANCELLED") return null;
  const cur = arrivalNow(g);
  const target = NEXT[cur] ?? null;
  return target ? { target, label: LABEL[cur] } : null;
}

export const GRN_ARRIVAL_PERM: [string, string][] = [["grn", "update"]];
export const GRN_EDIT_QTY_PERM: [string, string][] = [["grn", "update"]];

export type QtyEditState = { ok: true; lockedKeys: number[] } | { ok: false; reason: string };

/** Whether Edit Quantities is offered, and which lines are frozen by a purchase invoice. */
export function grnQtyEditState(g: RawRow): QtyEditState {
  const status = s(g, "status");
  const items = rows(g.items);
  if (!isGrnLineEditable(status) || items.length === 0) return { ok: false, reason: "" };
  const inv = items.map((it) => ({ invoicedQty: n(it, "invoicedQty") }));
  if (isGrnFullyLockedByDownstreamPi(inv)) return { ok: false, reason: "Every line has been billed on a purchase invoice, so nothing is editable. Void or edit that invoice first." };
  return { ok: true, lockedKeys: items.map((it, i) => (isGrnLineLockedByPi(inv[i]) ? i : -1)).filter((i) => i >= 0) };
}

export type QtyLine = { ref: string; oldAccepted: number; invoiced: number; locked: boolean };
export const grnQtyLines = (g: RawRow): QtyLine[] =>
  rows(g.items).map((it, i) => ({
    ref: s(it, "materialName") || s(it, "materialCode") || `Line ${i + 1}`,
    oldAccepted: n(it, "acceptedQty"),
    invoiced: grnLineInvoicedQty({ invoicedQty: n(it, "invoicedQty") }),
    locked: isGrnLineLockedByPi({ invoicedQty: n(it, "invoicedQty") }),
  }));

/** Per-line check with the shared rule; `values` are what the operator typed (a locked line keeps its stored value). */
export function grnQtyCheck(g: RawRow, values: string[]): { ok: true; deltaText: string | null; changed: boolean } | { ok: false; error: string } {
  const lines = grnQtyLines(g);
  const deltas: { ref: string; delta: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = l.locked ? l.oldAccepted : parseFloat(values[i]);
    const r = checkGrnLineQtyEdit({ ref: l.ref, oldAcceptedQty: l.oldAccepted, newAcceptedQty: Number.isFinite(next) ? next : NaN, invoicedQty: l.invoiced });
    if (!r.ok) return { ok: false, error: r.error };
    deltas.push({ ref: l.ref, delta: r.delta });
  }
  const text = describeGrnStockDelta(deltas);
  return { ok: true, deltaText: text, changed: text != null };
}

/** PUT /api/grn/:id — the full items[] with the corrected accepted quantity, everything else carried verbatim (desktop). */
export function grnQtyBody(g: RawRow, values: string[]): { items: Record<string, unknown>[] } {
  const lines = grnQtyLines(g);
  return {
    items: rows(g.items).map((it, i) => ({
      // the line's own id: the server pairs by id and keeps its PO link
      id: it.id,
      poItemIndex: n(it, "poItemIndex"),
      materialCode: s(it, "materialCode"),
      materialName: s(it, "materialName"),
      orderedQty: n(it, "orderedQty"),
      receivedQty: n(it, "receivedQty"),
      acceptedQty: lines[i].locked ? lines[i].oldAccepted : parseFloat(values[i]) || 0,
      rejectedQty: n(it, "rejectedQty"),
      rejectionReason: it.rejectionReason ?? null,
      unitPrice: n(it, "unitPrice"),
    })),
  };
}
