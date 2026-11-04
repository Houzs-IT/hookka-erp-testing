// ---------------------------------------------------------------------------
// grn-line-edit — which stored goods-receipt line an edited line IS, decided by the line's own id.
//
// Why this exists. PUT /api/grn/:id used to treat an edit of a DRAFT's items as "delete every line and insert what
// the client sent", writing only the columns the desktop form knew about. Two things followed:
//   · `po_id` / `po_item_id` (which PO line a line draws down — the multi-PO model, 2026-08-04) were not in the
//     INSERT, so editing a draft's quantities silently erased every line's purchase-order link; and the GET did not
//     return them, so no client could have sent them back;
//   · lines were paired with stored rows BY POSITION. The GET returns lines ordered by poItemIndex while the PUT
//     read the stored rows ordered by id, so on a receipt spanning several orders position i of one list was not
//     line i of the other.
// Both are fixed the same way: a line is identified by its row id, a kept line is UPDATED in place (its id, its PO
// links and what a purchase invoice has billed against it all survive), a line the client no longer sends is
// DELETED, and a line with no id is a NEW line. A client may not change a stored line's PO link through an edit.
//
// A client that sends no ids at all (a stale browser tab) is matched on the line's content instead of its position:
// (material code, poItemIndex) when that pair is unique on both sides. Anything it cannot place becomes a new line,
// which is what the old code did to every line.
//
// Pure — no database. The route supplies the stored rows and, for links on NEW lines, the purchase-order rows to
// validate against.
// ---------------------------------------------------------------------------

export type StoredGrnLine = {
  id: number | string;
  poItemIndex?: number | null;
  materialCode?: string | null;
  poId?: string | null;
  po_id?: string | null;
  poItemId?: string | null;
  po_item_id?: string | null;
};
export type IncomingGrnLine = Record<string, unknown>;

export type PlannedGrnLine = {
  /** The stored row this line updates, or null for a line to insert. */
  id: string | null;
  incoming: IncomingGrnLine;
  /** Links as they will be stored. For a kept line these are the STORED links; for a new line, what it claimed. */
  poId: string | null;
  poItemId: string | null;
  /** Set only for a new line that supplied links: the route must validate them. */
  claimed: boolean;
};

export type GrnLinePlan = { ok: true; lines: PlannedGrnLine[]; removeIds: string[] } | { ok: false; status: 400 | 409; error: string };

const clean = (v: unknown): string => (v == null ? "" : String(v).trim());
const linkOf = (s: StoredGrnLine, camel: "poId" | "poItemId", snake: "po_id" | "po_item_id"): string | null => clean(s[camel] ?? s[snake]) || null;
const keyOf = (code: unknown, idx: unknown): string => `${clean(code).toUpperCase()}|${idx == null || idx === "" ? "" : Number(idx)}`;
const idOf = (l: IncomingGrnLine): string => clean(l.id ?? l.lineId);

/**
 * Decide, for each incoming line, which stored line it is (or that it is new), and which stored lines are gone.
 * `kept` lines carry the STORED links; a supplied link that disagrees with the stored one is refused.
 */
export function planGrnDraftLines(stored: StoredGrnLine[], incoming: IncomingGrnLine[]): GrnLinePlan {
  const byId = new Map(stored.map((s) => [String(s.id), s]));
  const used = new Set<string>();
  const slot: (string | null)[] = incoming.map(() => null);

  // 1) by id
  for (let i = 0; i < incoming.length; i++) {
    const id = idOf(incoming[i]);
    if (!id) continue;
    if (!byId.has(id)) return { ok: false, status: 400, error: `Line id ${id} does not belong to this goods receipt.` };
    if (used.has(id)) return { ok: false, status: 400, error: `Line id ${id} appears twice.` };
    used.add(id);
    slot[i] = id;
  }

  // 2) a line with no id: match on (material code, poItemIndex) when that pair is unique among the stored lines still
  //    unclaimed AND among the id-less incoming lines. Never by position.
  const free = stored.filter((s) => !used.has(String(s.id)));
  const storedCount = new Map<string, number>();
  for (const s of free) storedCount.set(keyOf(s.materialCode, s.poItemIndex), (storedCount.get(keyOf(s.materialCode, s.poItemIndex)) ?? 0) + 1);
  const incomingCount = new Map<string, number>();
  for (let i = 0; i < incoming.length; i++) if (!slot[i]) incomingCount.set(keyOf(incoming[i].materialCode, incoming[i].poItemIndex), (incomingCount.get(keyOf(incoming[i].materialCode, incoming[i].poItemIndex)) ?? 0) + 1);
  for (let i = 0; i < incoming.length; i++) {
    if (slot[i]) continue;
    const k = keyOf(incoming[i].materialCode, incoming[i].poItemIndex);
    if (storedCount.get(k) === 1 && incomingCount.get(k) === 1) {
      const hit = free.find((s) => keyOf(s.materialCode, s.poItemIndex) === k && !used.has(String(s.id)));
      if (hit) { slot[i] = String(hit.id); used.add(String(hit.id)); }
    }
  }

  const lines: PlannedGrnLine[] = [];
  for (let i = 0; i < incoming.length; i++) {
    const inc = incoming[i];
    const id = slot[i];
    const suppliedPo = clean(inc.poId);
    const suppliedItem = clean(inc.poItemId);
    if (id) {
      const s = byId.get(id) as StoredGrnLine;
      const poId = linkOf(s, "poId", "po_id");
      const poItemId = linkOf(s, "poItemId", "po_item_id");
      if ((suppliedPo && suppliedPo !== (poId ?? "")) || (suppliedItem && suppliedItem !== (poItemId ?? ""))) {
        return { ok: false, status: 409, error: "A line's purchase-order link can't be changed by editing the receipt. Remove the line and add it again against the right order." };
      }
      lines.push({ id, incoming: inc, poId, poItemId, claimed: false });
    } else {
      lines.push({ id: null, incoming: inc, poId: suppliedPo || null, poItemId: suppliedItem || null, claimed: !!(suppliedPo || suppliedItem) });
    }
  }
  const removeIds = stored.map((s) => String(s.id)).filter((id) => !used.has(id));
  return { ok: true, lines, removeIds };
}

export type PoRow = { id: string; supplierId?: string | null };
export type PoItemRow = { id: string; purchaseOrderId: string };

/**
 * A NEW line's claimed links must name a real purchase order of THIS receipt's supplier, and a PO line that belongs to
 * that order. Returns the resolved (poId, poItemId) or an error. A line with no claim resolves to no links.
 */
export function validateClaimedLinks(
  line: { poId: string | null; poItemId: string | null },
  supplierId: string | null,
  pos: Map<string, PoRow>,
  items: Map<string, PoItemRow>,
): { ok: true; poId: string | null; poItemId: string | null } | { ok: false; status: 400 | 404; error: string } {
  let poId = line.poId;
  const poItemId = line.poItemId;
  if (poItemId) {
    const it = items.get(poItemId);
    if (!it) return { ok: false, status: 404, error: `Purchase order line not found: ${poItemId}` };
    if (poId && it.purchaseOrderId !== poId) return { ok: false, status: 400, error: "That purchase order line does not belong to the purchase order named on the line." };
    poId = it.purchaseOrderId;
  }
  if (poId) {
    const po = pos.get(poId);
    if (!po) return { ok: false, status: 404, error: `Purchase order not found: ${poId}` };
    if (supplierId && po.supplierId && String(po.supplierId) !== String(supplierId)) {
      return { ok: false, status: 400, error: "All purchase orders on one GRN must belong to the same supplier" };
    }
  }
  return { ok: true, poId: poId || null, poItemId: poItemId || null };
}

/**
 * A received (POSTED / CONFIRMED) receipt edits the quantity of existing lines only. Pair each stored line with its
 * incoming line by id when the client sent ids for all of them (so reordering is harmless); a client that sent none
 * falls back to the old positional pairing, which is all it ever had. Returns the incoming lines IN STORED ORDER.
 */
export function alignCommittedLines(
  stored: Pick<StoredGrnLine, "id">[],
  incoming: IncomingGrnLine[],
): { ok: true; items: IncomingGrnLine[] } | { ok: false; error: string } {
  if (incoming.length !== stored.length) return { ok: false, error: "length" };
  const withId = incoming.filter((l) => idOf(l)).length;
  if (withId === 0) return { ok: true, items: incoming };
  if (withId !== incoming.length) return { ok: false, error: "mixed" };
  const byId = new Map(incoming.map((l) => [idOf(l), l]));
  if (byId.size !== incoming.length) return { ok: false, error: "duplicate" };
  const items: IncomingGrnLine[] = [];
  for (const s of stored) {
    const hit = byId.get(String(s.id));
    if (!hit) return { ok: false, error: "unknown" };
    items.push(hit);
  }
  return { ok: true, items };
}
