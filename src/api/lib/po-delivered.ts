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
//
// HK-0119 — legacy PO-0001xx lines carry no material code and their PI lines
// carry neither a code nor a PO line, so neither key could match. A code-less
// PO line now buckets by its material name instead, and a code-less invoiced
// row that matched nothing else falls back to that name.

export interface PoDeliveredItemRow {
  id: string | number;
  purchaseOrderId: string;
  materialCode: string | null;
  materialName?: string | null;
  quantity: number;
  receivedQty: number;
}

export interface PoInvoicedRow {
  poId: string;
  poItemId: string | null;
  materialCode: string | null;
  materialName?: string | null;
  qty: number;
}

const nameKey = (n: string | null | undefined) => String(n ?? "").trim().toUpperCase();

export function poIdsDeliveredInFull(
  items: PoDeliveredItemRow[],
  invoiced: PoInvoicedRow[],
): Set<string> {
  type Bucket = { ordered: number; received: number; invoiced: number };
  const perPo = new Map<
    string,
    {
      buckets: Map<string, Bucket>;
      byItemId: Map<string, string>;
      byCode: Map<string, string>;
      byName: Map<string, string>;
    }
  >();
  for (const it of items) {
    let po = perPo.get(it.purchaseOrderId);
    if (!po) {
      po = { buckets: new Map(), byItemId: new Map(), byCode: new Map(), byName: new Map() };
      perPo.set(it.purchaseOrderId, po);
    }
    const itemId = String(it.id);
    const code = it.materialCode ? String(it.materialCode) : "";
    const name = code ? "" : nameKey(it.materialName);
    const key = code ? `code:${code}` : name ? `name:${name}` : `item:${itemId}`;
    po.byItemId.set(itemId, key);
    if (code) po.byCode.set(code, key);
    if (name) po.byName.set(name, key);
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
      (row.poItemId ? po.byItemId.get(String(row.poItemId)) : undefined) ??
      (!row.materialCode && row.materialName ? po.byName.get(nameKey(row.materialName)) : undefined);
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

// HK-0114 — open POs whose every line is covered by received OR invoiced qty
// (the rule above). Only open POs are measured; the widget ignores the
// terminal ones anyway. A failed invoiced read (column not self-applied yet on
// a fresh database) degrades to the old receivedQty-only answer, not a 500.
export async function openPoIdsDeliveredInFull(db: D1Database, orgId: string): Promise<Set<string>> {
  const itemsRes = await db
    .prepare(
      `SELECT poi.id, poi.purchaseOrderId AS "poId", poi.material_code AS "mc",
              poi.materialName AS "mn", poi.quantity AS "qty", poi.receivedQty AS "recv"
         FROM purchase_order_items poi
         JOIN purchase_orders p ON p.id = poi.purchaseOrderId
        WHERE p.orgId = ? AND p.status NOT IN ('RECEIVED','CLOSED','CANCELLED')`,
    )
    .bind(orgId)
    .all<{ id: string | number; poId: string; mc: string | null; mn: string | null; qty: number; recv: number | null }>();
  let invoiced: PoInvoicedRow[] = [];
  try {
    // Same already-invoiced read as checkPoRemaining (purchase-invoices.ts),
    // org-wide. DRAFT is left out: an unconfirmed bill is no proof of arrival.
    const invRes = await db
      .prepare(
        `SELECT COALESCE(pii.po_id, pi.purchaseOrderId) AS "poId",
                COALESCE(pii.po_item_id, gi.po_item_id) AS "poItemId",
                pii.material_code AS "mc", pii.materialName AS "mn", COALESCE(SUM(pii.qty), 0) AS "qty"
           FROM purchase_invoice_items pii
           JOIN purchase_invoices pi ON pi.id = pii.pi_id
           LEFT JOIN grn_items gi ON gi.id::text = pii.grn_item_id
          WHERE pi.orgId = ? AND pi.status NOT IN ('CANCELLED','DRAFT')
          GROUP BY COALESCE(pii.po_id, pi.purchaseOrderId), COALESCE(pii.po_item_id, gi.po_item_id), pii.material_code, pii.materialName`,
      )
      .bind(orgId)
      .all<{ poId: string | null; poItemId: string | null; mc: string | null; mn: string | null; qty: number }>();
    invoiced = (invRes.results ?? [])
      .filter((r) => r.poId)
      .map((r) => ({
        poId: String(r.poId),
        poItemId: r.poItemId,
        materialCode: r.mc,
        materialName: r.mn,
        qty: Number(r.qty) || 0,
      }));
  } catch (err) {
    console.warn("[purchase-orders/stats] invoiced-qty read failed; overdue uses receivedQty only", err);
  }
  return poIdsDeliveredInFull(
    (itemsRes.results ?? []).map((r) => ({
      id: r.id,
      purchaseOrderId: String(r.poId),
      materialCode: r.mc,
      materialName: r.mn,
      quantity: Number(r.qty) || 0,
      receivedQty: Number(r.recv) || 0,
    })),
    invoiced,
  );
}
