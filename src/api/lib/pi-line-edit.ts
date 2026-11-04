// ---------------------------------------------------------------------------
// pi-line-edit — which stored purchase-invoice line an edited line IS, decided by the line's own id.
//
// Why. PUT /api/purchase-invoices/:id with `items` deleted every line and inserted the new ones with freshly minted ids, and
// a line that did not name its own `poId` fell back to the HEADER PO. Because the GET did not return a line's PO, no client
// could name it, so editing a multi-PO invoice moved every line onto the header PO, and the ids changed on every save.
//
// Now (same method as the goods-receipt draft edit, src/api/lib/grn-line-edit.ts):
//   · an incoming line with an `id` IS that stored line: it keeps the id, inherits its stored `po_id` and `grn_item_id` when the
//     request omits them, and a request that names a DIFFERENT PO or GRN line is refused (409) — a link is never changed by an edit;
//   · a line the request no longer sends is removed; a line with no id and no candidate is NEW, and its links are validated
//     (a real PO of the invoice's supplier; a line of the invoice's own goods receipt);
//   · a client that sends no ids is matched on its goods-receipt line, else (material code, material name), ONLY when that is unique among the
//     stored lines AND among the id-less incoming lines (a goods-receipt line first, then code + name). When it is ambiguous the edit is REFUSED (409, "send line ids") — it is
//     never guessed, because a wrong guess silently moves a PO / GRN link.
// Pure — no database. The route supplies the stored rows and, for new lines, the PO / GRN rows to validate against.
// ---------------------------------------------------------------------------

export type StoredPiLine = {
  id: string;
  material_code?: string | null; materialCode?: string | null;
  material_name?: string | null; materialName?: string | null;
  po_id?: string | null; poId?: string | null;
  grn_item_id?: string | null; grnItemId?: string | null;
  created_at?: string | null; createdAt?: string | null;
};
export type IncomingPiLine = { id?: unknown; materialCode?: unknown; materialName?: unknown; poId?: unknown; grnItemId?: unknown };

export type PlannedPiLine = {
  /** The stored line this one is (its id and created_at are kept), or null for a new line. */
  id: string | null;
  createdAt: string | null;
  poId: string | null;
  grnItemId: string | null;
  /** A new line that named a PO and / or a GRN line: the route must validate them. */
  claimed: boolean;
};
export type PiLinePlan = { ok: true; lines: PlannedPiLine[]; removeIds: string[] } | { ok: false; status: 400 | 409; error: string };

const clean = (v: unknown): string => (v == null ? "" : String(v).trim());
const norm = (v: unknown): string => clean(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
const s = {
  code: (l: StoredPiLine) => clean(l.material_code ?? l.materialCode),
  name: (l: StoredPiLine) => clean(l.material_name ?? l.materialName),
  po: (l: StoredPiLine) => clean(l.po_id ?? l.poId) || null,
  grn: (l: StoredPiLine) => clean(l.grn_item_id ?? l.grnItemId) || null,
  at: (l: StoredPiLine) => clean(l.created_at ?? l.createdAt) || null,
};
const keyOfStored = (l: StoredPiLine) => `${norm(s.code(l))}|${norm(s.name(l))}`;
const keyOfIncoming = (l: IncomingPiLine) => `${norm(l.materialCode)}|${norm(l.materialName)}`;

export function planPiLines(stored: StoredPiLine[], incoming: IncomingPiLine[], headerPoId: string | null): PiLinePlan {
  const byId = new Map(stored.map((l) => [String(l.id), l]));
  const used = new Set<string>();
  const slot: (string | null)[] = incoming.map(() => null);

  for (let i = 0; i < incoming.length; i++) {
    const id = clean(incoming[i].id);
    if (!id) continue;
    if (!byId.has(id)) return { ok: false, status: 400, error: `Line ${i + 1}: id ${id} does not belong to this invoice.` };
    if (used.has(id)) return { ok: false, status: 400, error: `Line id ${id} appears twice.` };
    used.add(id);
    slot[i] = id;
  }

  // Lines without an id (a stale client): match only when it is UNIQUE, and refuse — never guess — when it is not.
  //   pass 1  by goods-receipt line: a line billed against a GRN line is that GRN line's line, whatever it is now called;
  //   pass 2  by material code + name, among what pass 1 left.
  // "Unique" means one candidate among the unclaimed stored lines AND one such request line. Nothing like it stored = a NEW line.
  const pass = (keyOfS: (l: StoredPiLine) => string | null, keyOfI: (l: IncomingPiLine) => string | null): PiLinePlan | null => {
    const freeByKey = new Map<string, StoredPiLine[]>();
    for (const l of stored) { if (used.has(String(l.id))) continue; const k = keyOfS(l); if (k) freeByKey.set(k, [...(freeByKey.get(k) ?? []), l]); }
    const incomingByKey = new Map<string, number[]>();
    incoming.forEach((l, i) => { if (slot[i]) return; const k = keyOfI(l); if (k) incomingByKey.set(k, [...(incomingByKey.get(k) ?? []), i]); });
    for (const [k, idxs] of incomingByKey) {
      const candidates = freeByKey.get(k) ?? [];
      if (candidates.length === 0) continue; // nothing like it is stored here
      if (candidates.length === 1 && idxs.length === 1) {
        slot[idxs[0]] = String(candidates[0].id);
        used.add(String(candidates[0].id));
        continue;
      }
      return {
        ok: false, status: 409,
        error: `Line ${idxs[0] + 1} could belong to ${candidates.length > 1 ? "several existing lines" : "an existing line"} and the request has ${idxs.length > 1 ? "several like it" : "no line id"} — reload the invoice and save again so each line is saved with its id.`,
      };
    }
    return null;
  };
  const refused =
    pass((l) => (s.grn(l) ? `g:${s.grn(l)}` : null), (l) => (clean(l.grnItemId) ? `g:${clean(l.grnItemId)}` : null)) ??
    pass(keyOfStored, keyOfIncoming);
  if (refused) return refused;

  const lines: PlannedPiLine[] = [];
  for (let i = 0; i < incoming.length; i++) {
    const inc = incoming[i];
    const id = slot[i];
    const askedPo = clean(inc.poId);
    const askedGrn = clean(inc.grnItemId);
    if (id) {
      const st = byId.get(id) as StoredPiLine;
      const poNow = s.po(st) ?? headerPoId ?? "";
      if (askedPo && askedPo !== poNow) {
        return { ok: false, status: 409, error: `Line ${i + 1}: the purchase order of an existing line can't be changed by editing the invoice. Remove the line and add it again against the right order.` };
      }
      if (askedGrn && askedGrn !== (s.grn(st) ?? "")) {
        return { ok: false, status: 409, error: `Line ${i + 1}: the goods-receipt line of an existing line can't be changed by editing the invoice.` };
      }
      lines.push({ id, createdAt: s.at(st), poId: s.po(st), grnItemId: s.grn(st), claimed: false });
    } else {
      lines.push({ id: null, createdAt: null, poId: askedPo || null, grnItemId: askedGrn || null, claimed: !!(askedPo || askedGrn) });
    }
  }
  const removeIds = stored.map((l) => String(l.id)).filter((id) => !used.has(id));
  return { ok: true, lines, removeIds };
}

export type PoRow = { id: string; supplierId?: string | null };
export type GrnItemRow = { id: string; grnId?: string | null };

/** A NEW line's links: its PO must be a real order of the invoice's supplier; its GRN line a line of the invoice's own goods receipt. */
export function validateNewPiLinks(
  line: { poId: string | null; grnItemId: string | null },
  invoice: { supplierId: string | null; grnId: string | null },
  pos: Map<string, PoRow>,
  grnItems: Map<string, GrnItemRow>,
  index: number,
): { ok: true } | { ok: false; status: 400 | 404; error: string } {
  if (line.poId) {
    const po = pos.get(line.poId);
    if (!po) return { ok: false, status: 404, error: `Line ${index + 1}: purchase order not found: ${line.poId}` };
    if (invoice.supplierId && po.supplierId && String(po.supplierId) !== String(invoice.supplierId)) {
      return { ok: false, status: 400, error: `Line ${index + 1}: that purchase order belongs to a different supplier than this invoice.` };
    }
  }
  if (line.grnItemId) {
    if (!invoice.grnId) return { ok: false, status: 400, error: `Line ${index + 1}: this invoice was not raised from a goods receipt, so a line can't be billed against one.` };
    const gi = grnItems.get(line.grnItemId);
    if (!gi) return { ok: false, status: 404, error: `Line ${index + 1}: goods-receipt line not found: ${line.grnItemId}` };
    if (String(gi.grnId ?? "") !== String(invoice.grnId)) return { ok: false, status: 400, error: `Line ${index + 1}: that goods-receipt line belongs to a different receipt than this invoice.` };
  }
  return { ok: true };
}
