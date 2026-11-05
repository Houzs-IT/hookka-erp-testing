// ---------------------------------------------------------------------------
// scan-grn — the pure logic of "scan a supplier delivery document → draft Goods Receipt" on mobile.
//
// The desktop's CreateGRNWizard (src/components/scan-supplier-modal.tsx ~3896-4870) on the phone. It REUSES the
// Purchase Invoice scanner (scan-pi.ts): the same supplier / alias / binding / candidate-tier matching builds the
// card, and the same PO linking decides which order each line belongs to. What differs, as on the desktop:
//   · lines carry Received / Accepted / Rejected quantity, no price or tax (GRNs record quantity; the server fills
//     a PO-linked line's price from the PO line)
//   · each line also carries the PO LINE it draws down (poId + poItemId + poItemIndex): ownership lives on the line
//   · the body is POST /api/grn with `ocrUsed: true`, which the server lands as DRAFT — never posted to stock
// A PO-linked receipt starts NOT_ARRIVED (Post to Stock is refused until it is marked arrived); a receipt with no PO
// is born ARRIVED. Both stay DRAFT here.
// Nothing here talks to the network.
// ---------------------------------------------------------------------------
import { allocateLinesToPos, allocatedPoIds, headerPoId } from "../../../lib/po-line-allocate";
import {
  blankLine, buildPiCard, changeSupplier, correctedExtraction, pickMaterial, relinkToPos,
  type PiCard, type PiCardLine, type PiContext, type PiPo, type PiPoItem, type SupplierDoc,
} from "./scan-pi";

export type GrnLine = PiCardLine & {
  /** `qty` (on PiCardLine) is the RECEIVED quantity; these two split it. */
  acceptedQty: string;
  rejectedQty: string;
  poItemId: string | null;
  poItemIndex: number | null;
};
export type GrnCard = Omit<PiCard, "lines"> & { lines: GrnLine[] };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const q = (n: number): string => String(Math.round(n * 1e6) / 1e6);

const posOf = (card: Pick<PiCard, "purchaseOrderIds">, ctx: PiContext): PiPo[] => ctx.purchaseOrders.filter((p) => card.purchaseOrderIds.includes(p.id));

/** (Re)decide which PO line each line draws down, from the orders the card links. A line it cannot place stays null. */
export function allocateGrn(card: GrnCard, ctx: PiContext): GrnCard {
  const allocations = allocateLinesToPos(card.lines, posOf(card, ctx));
  return { ...card, lines: card.lines.map((l, i) => ({ ...l, poId: allocations[i]?.poId ?? null, poItemId: allocations[i]?.poItemId ?? null, poItemIndex: allocations[i]?.poItemIndex ?? null })) };
}

/** A scan-pi result (which knows nothing of quantities) back onto a GRN card, keeping each line's own quantities. */
function carry(prev: GrnCard, next: PiCard, ctx: PiContext): GrnCard {
  const byKey = new Map(prev.lines.map((l) => [l.key, l]));
  return allocateGrn({
    ...next,
    lines: next.lines.map((l) => {
      const p = byKey.get(l.key);
      return { ...l, acceptedQty: p?.acceptedQty ?? l.qty, rejectedQty: p?.rejectedQty ?? "0", poItemId: null, poItemIndex: null };
    }),
  }, ctx);
}

export function buildGrnCard(ex: SupplierDoc, ctx: PiContext, opts: { defaultSupplierId?: string | null; today?: string } = {}): GrnCard {
  const base = buildPiCard(ex, ctx, opts);
  return allocateGrn({
    ...base,
    // a delivery note's number is the DO number even when the OCR filed it as an invoice number
    supplierDoNo: base.supplierDoNo || base.supplierInvoiceNo,
    lines: base.lines.map((l) => ({ ...l, acceptedQty: l.qty, rejectedQty: "0", poItemId: null, poItemIndex: null })),
  }, ctx);
}

export const grnChangeSupplier = (card: GrnCard, supplierId: string, ctx: PiContext): GrnCard => carry(card, changeSupplier({ ...card, purchaseOrderIds: [] }, supplierId, ctx), ctx);
export const grnPickMaterial = (card: GrnCard, lineKey: string, code: string, ctx: PiContext): GrnCard => carry(card, pickMaterial(card, lineKey, code, ctx), ctx);
export const grnRelink = (card: GrnCard, poIds: string[], ctx: PiContext): GrnCard => carry(card, relinkToPos(card, poIds, ctx), ctx);

export function newGrnLine(key: string): GrnLine {
  return { ...blankLine(key), acceptedQty: "1", rejectedQty: "0", poItemId: null, poItemIndex: null };
}

/** Received changed: accepted follows (received − rejected), as the desktop's default of accepted = received. */
export function setReceived(line: GrnLine, received: string): GrnLine {
  return { ...line, qty: received, acceptedQty: q(Math.max(0, num(received) - num(line.rejectedQty))) };
}
export function setRejected(line: GrnLine, rejected: string): GrnLine {
  return { ...line, rejectedQty: rejected, acceptedQty: q(Math.max(0, num(line.qty) - num(rejected))) };
}

const kept = (card: GrnCard): GrnLine[] => card.lines.filter((l) => (l.materialName || l.description).trim() !== "" && num(l.qty) > 0);

/** What stops the receipt being created (the desktop's three, plus quantities that do not add up). */
export function grnBlockers(card: GrnCard, ctx: PiContext): string[] {
  const out: string[] = [];
  if (!card.supplierId || !ctx.suppliers.some((s) => s.id === card.supplierId)) out.push("Choose the supplier.");
  const lines = kept(card);
  if (lines.length === 0) out.push("Add at least one line with a received quantity.");
  const unbound = lines.filter((l) => !l.materialCode.trim());
  if (unbound.length) out.push(`${unbound.length} line${unbound.length === 1 ? "" : "s"} not matched to a catalogue item — pick the internal code.`);
  const bad = lines.find((l) => num(l.acceptedQty) < 0 || num(l.rejectedQty) < 0 || num(l.acceptedQty) + num(l.rejectedQty) > num(l.qty) + 1e-9);
  if (bad) out.push(`"${bad.materialName || bad.description}": accepted + rejected is more than received.`);
  return out;
}

/** Non-blocking: the server refuses a receipt past 110% of the order line (cumulative), so say so before the round trip. */
export function overReceiptNotes(card: GrnCard, ctx: PiContext): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  for (const l of card.lines) {
    if (!l.poId || !l.poItemId) continue;
    const po = ctx.purchaseOrders.find((p) => p.id === l.poId);
    const it = (po?.items as PiPoItem[] | null | undefined)?.find((i) => String(i.id) === l.poItemId);
    if (!po || !it) continue;
    const ordered = num(it.quantity);
    const already = num(it.receivedQty);
    const cumulative = already + num(l.qty);
    if (ordered > 0 && cumulative > ordered * 1.1) out.push({ key: l.key, text: `${po.poNo || "Order"}: ordered ${ordered}, already received ${already} — receiving ${num(l.qty)} goes past 110% and the server will refuse it.` });
  }
  return out;
}

/** The header PO shown on the document; ownership is on the lines. */
export function grnHeaderPo(card: GrnCard, ctx: PiContext): string | null {
  const allocations = allocateLinesToPos(card.lines, posOf(card, ctx));
  return headerPoId(allocations, card.purchaseOrderIds);
}
export const grnTouchedPos = (card: GrnCard, ctx: PiContext): string[] => allocatedPoIds(allocateLinesToPos(card.lines, posOf(card, ctx)));

/** POST /api/grn — `ocrUsed: true` makes the server create a DRAFT. */
export function grnDraftBody(card: GrnCard, ctx: PiContext, fileName: string): Record<string, unknown> {
  const sup = ctx.suppliers.find((s) => s.id === card.supplierId);
  const body: Record<string, unknown> = {
    supplierId: card.supplierId,
    supplierName: sup?.name ?? "",
    purchaseOrgCode: card.purchaseOrgCode,
    receivedBy: "Scanned",
    notes: `Scanned: ${fileName}`,
    supplier_do_no: card.supplierDoNo.trim() || null,
    ocrUsed: true,
    items: kept(card).map((l) => ({
      materialName: (l.materialName || l.description).trim(),
      materialCode: l.materialCode.trim(),
      supplierSku: l.supplierSku.trim() || null,
      receivedQty: num(l.qty),
      acceptedQty: num(l.acceptedQty),
      rejectedQty: num(l.rejectedQty),
      rejectionReason: null,
      unitPriceSen: 0,
      poId: l.poId ?? null,
      poItemId: l.poItemId ?? null,
      poItemIndex: l.poItemIndex ?? null,
      // a text-vs-whole-catalogue guess may fill the field but must not teach a permanent binding
      unverifiedMatch: l.autoMatched === true && l.matchTier === "catalog",
    })),
  };
  const po = grnHeaderPo(card, ctx);
  if (po) body.poId = po;
  return body;
}

/** The imported values, for the accuracy report. */
export function grnCorrected(card: GrnCard, original: SupplierDoc): SupplierDoc {
  const base = correctedExtraction({ ...card, lines: card.lines }, original);
  return { ...base, docNo: card.supplierDoNo.trim() || original.docNo || null, lines: card.lines.map((l, i) => ({ ...base.lines![i], qty: num(l.qty) || null })) };
}
