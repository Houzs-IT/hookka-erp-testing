// HK-0114 — "has this PO's goods all arrived?" for the Overdue POs widget.
//
// The office bills most POs straight from the PO (Purchase Invoice → From PO)
// without posting a GRN, so receivedQty stays 0 and status stays CONFIRMED
// forever. Prod 2026-10-26: 0 live GRNs, 108 "overdue" POs of which 101 already
// carried a PI. A billed quantity is the office's own proof the goods came in,
// so a line counts as delivered by max(received, invoiced).
//
// Buckets follow checkPoRemaining in purchase-invoices.ts: the material code
// when the PO line has one (two lines of one material share a bucket), else
// the PO line's own id; an invoiced row matches by code first, PO line second.

export interface PoDeliveredItemRow {
  id: string | number;
  purchaseOrderId: string;
  materialCode: string | null;
  quantity: number;
  receivedQty: number;
}

export interface PoInvoicedRow {
  poId: string;
  poItemId: string | null;
  materialCode: string | null;
  qty: number;
}

export function poIdsDeliveredInFull(
  items: PoDeliveredItemRow[],
  invoiced: PoInvoicedRow[],
): Set<string> {
  type Bucket = { ordered: number; received: number; invoiced: number };
  const perPo = new Map<
    string,
    { buckets: Map<string, Bucket>; byItemId: Map<string, string>; byCode: Map<string, string> }
  >();
  for (const it of items) {
    let po = perPo.get(it.purchaseOrderId);
    if (!po) {
      po = { buckets: new Map(), byItemId: new Map(), byCode: new Map() };
      perPo.set(it.purchaseOrderId, po);
    }
    const itemId = String(it.id);
    const code = it.materialCode ? String(it.materialCode) : "";
    const key = code ? `code:${code}` : `item:${itemId}`;
    po.byItemId.set(itemId, key);
    if (code) po.byCode.set(code, key);
    const b = po.buckets.get(key) ?? { ordered: 0, received: 0, invoiced: 0 };
    b.ordered += Number(it.quantity) || 0;
    b.received += Number(it.receivedQty) || 0;
    po.buckets.set(key, b);
  }
  for (const row of invoiced) {
    const po = perPo.get(row.poId);
    if (!po) continue;
    const key =
      (row.materialCode ? po.byCode.get(String(row.materialCode)) : undefined) ??
      (row.poItemId ? po.byItemId.get(String(row.poItemId)) : undefined);
    if (!key) continue;
    po.buckets.get(key)!.invoiced += Number(row.qty) || 0;
  }
  const done = new Set<string>();
  for (const [poId, po] of perPo) {
    let all = po.buckets.size > 0;
    for (const b of po.buckets.values()) {
      if (Math.max(b.received, b.invoiced) < b.ordered) {
        all = false;
        break;
      }
    }
    if (all) done.add(poId);
  }
  return done;
}
