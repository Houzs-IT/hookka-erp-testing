// ---------------------------------------------------------------------------
// flow-line-files.ts — the line files of one flow document, with the files
// carried down from the lines it was made from (review pass 2 C1-5).
//
// Served by GET /api/files/flow-lines?doc=GRN&id=<grnId>. ONE request per
// document page instead of one per line. For each line of the document it
// returns the files on that line ("own", type e.g. GRN_LINE) and the files on
// its upstream lines ("inherited", read-only):
//
//   GRN line     ← PO line        (grn_items.po_item_id, else the position on
//                                  the owning PO — grn-po-line-link.ts, which
//                                  REFUSES a contested line instead of guessing)
//   PI line      ← GRN line (grn_item_id) and PO line (po_item_id, else the
//                                  GRN line's PO line)
//   DO line      ← SO line        (production order → sales order + line no)
//   invoice line ← DO line (delivery_order_item_id, else the ONE line on the
//                  invoice's DO with the same production order) and SO line
//                  (so_item_id, else via the production order)
//   return line  ← DO line and SO line, the same way as the invoice
//
// READ-ONLY: SELECTs only, no self-apply, no write. Columns that are added at
// runtime by other routes (invoice_items.delivery_order_item_id / so_item_id)
// are read through SELECT * so a database that has not grown them yet just
// falls back to the production-order match.
// ---------------------------------------------------------------------------
import type { D1Database } from "@cloudflare/workers-types";
import {
  FLOW_LINE_TYPE,
  mapProdOrdersToSoItems,
  uniqueDoLineByProdOrder,
  type FlowDoc,
  type LineRef,
} from "../../lib/flow-files";
import { buildPoLineIndex, resolveGrnPoLine, type PoLineRef } from "./grn-po-line-link";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ph = (n: number) => Array.from({ length: n }, () => "?").join(", ");

async function all(db: D1Database, sql: string, binds: unknown[]): Promise<Row[]> {
  const res = await db.prepare(sql).bind(...binds).all<Row>();
  return (res.results ?? []) as Row[];
}

export type FlowLineScope = {
  /** Every line id of the document, in document order. */
  lineIds: string[];
  /** The file_assets type of those lines. */
  ownType: string;
  /** line id → the upstream lines it was made from. */
  upstream: Map<string, LineRef[]>;
};

function push(map: Map<string, LineRef[]>, lineId: string, ref: LineRef) {
  if (!ref.id) return;
  const arr = map.get(lineId);
  if (arr) {
    if (!arr.some((r) => r.type === ref.type && r.id === ref.id)) arr.push(ref);
  } else map.set(lineId, [ref]);
}

/** GRN line ids → the PO line each receives (unresolvable lines are left out). */
async function grnLinesToPoLines(db: D1Database, grnLineIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = grnLineIds.filter((id) => /^\d+$/.test(id));
  if (ids.length === 0) return out;
  const lines = await all(
    db,
    `SELECT id, grn_id, po_item_index, po_id, po_item_id FROM grn_items WHERE id IN (${ph(ids.length)})`,
    ids,
  );
  const grnIds = [...new Set(lines.map((l) => str(l.grn_id ?? l.grnId)).filter(Boolean))];
  const headers = grnIds.length
    ? await all(db, `SELECT id, po_id FROM grns WHERE id IN (${ph(grnIds.length)})`, grnIds)
    : [];
  const headerPo = new Map(headers.map((h) => [str(h.id), str(h.po_id ?? h.poId)]));
  // Every order a receipt could draw on: its header PO plus every line's own PO.
  const posByGrn = new Map<string, Set<string>>();
  for (const g of grnIds) posByGrn.set(g, new Set([headerPo.get(g) ?? ""].filter(Boolean)));
  for (const l of lines) {
    const p = str(l.po_id ?? l.poId);
    if (p) posByGrn.get(str(l.grn_id ?? l.grnId))?.add(p);
  }
  const allPoIds = [...new Set([...posByGrn.values()].flatMap((s) => [...s]))];
  // PO_ITEMS_ORDER (purchase-orders.ts) — a position only means something against it.
  const poItems: PoLineRef[] = allPoIds.length
    ? (
        await all(
          db,
          `SELECT id, purchase_order_id FROM purchase_order_items WHERE purchase_order_id IN (${ph(allPoIds.length)}) ORDER BY line_no NULLS LAST, id`,
          allPoIds,
        )
      ).map((r) => ({ id: str(r.id), purchaseOrderId: str(r.purchase_order_id ?? r.purchaseOrderId) }))
    : [];
  for (const l of lines) {
    const grnId = str(l.grn_id ?? l.grnId);
    const poIds = [...(posByGrn.get(grnId) ?? [])];
    const scope = new Set(poIds);
    const idx = buildPoLineIndex(poItems.filter((p) => scope.has(p.purchaseOrderId)), poIds);
    const res = resolveGrnPoLine(idx, {
      poItemIndex: num(l.po_item_index ?? l.poItemIndex),
      po_id: str(l.po_id ?? l.poId) || null,
      po_item_id: str(l.po_item_id ?? l.poItemId) || null,
    });
    if (res.poItemId) out.set(str(l.id), res.poItemId);
  }
  return out;
}

/** Production order ids → their sales order line id. */
async function prodOrdersToSoLines(db: D1Database, prodOrderIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(prodOrderIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const pos = (
    await all(db, `SELECT id, sales_order_id, line_no FROM production_orders WHERE id IN (${ph(ids.length)})`, ids)
  ).map((r) => ({
    id: str(r.id),
    salesOrderId: str(r.sales_order_id ?? r.salesOrderId),
    lineNo: num(r.line_no ?? r.lineNo),
  }));
  const soIds = [...new Set(pos.map((p) => p.salesOrderId).filter(Boolean))];
  if (soIds.length === 0) return new Map();
  const soItems = (
    await all(db, `SELECT id, sales_order_id, line_no FROM sales_order_items WHERE sales_order_id IN (${ph(soIds.length)})`, soIds)
  ).map((r) => ({
    id: str(r.id),
    salesOrderId: str(r.sales_order_id ?? r.salesOrderId),
    lineNo: num(r.line_no ?? r.lineNo),
  }));
  return mapProdOrdersToSoItems(pos, soItems);
}

/** The lines of a delivery order, as (id, production order) — for the DO-line fallback. */
async function doLinesByProdOrder(db: D1Database, doId: string): Promise<Map<string, string>> {
  if (!doId) return new Map();
  const rows = await all(db, "SELECT id, production_order_id FROM delivery_order_items WHERE delivery_order_id = ?", [doId]);
  return uniqueDoLineByProdOrder(
    rows.map((r) => ({ id: str(r.id), productionOrderId: str(r.production_order_id ?? r.productionOrderId) })),
  );
}

/**
 * Resolve the lines of one flow document and their upstream lines. Returns
 * null when the document is not in this org (the caller answers 404).
 */
export async function resolveFlowLineScope(
  db: D1Database,
  orgId: string,
  doc: FlowDoc,
  docId: string,
): Promise<FlowLineScope | null> {
  const ownType = FLOW_LINE_TYPE[doc];
  const upstream = new Map<string, LineRef[]>();

  if (doc === "PO") {
    const h = await all(db, "SELECT id FROM purchase_orders WHERE id = ? AND org_id = ?", [docId, orgId]);
    if (!h.length) return null;
    const rows = await all(
      db,
      "SELECT id FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY line_no NULLS LAST, id",
      [docId],
    );
    return { lineIds: rows.map((r) => str(r.id)), ownType, upstream };
  }

  if (doc === "GRN") {
    const h = await all(db, "SELECT id FROM grns WHERE id = ? AND org_id = ?", [docId, orgId]);
    if (!h.length) return null;
    const rows = await all(db, "SELECT id FROM grn_items WHERE grn_id = ? ORDER BY id", [docId]);
    const lineIds = rows.map((r) => str(r.id));
    const toPo = await grnLinesToPoLines(db, lineIds);
    for (const id of lineIds) push(upstream, id, { type: "PO_LINE", id: toPo.get(id) ?? "" });
    return { lineIds, ownType, upstream };
  }

  if (doc === "PI") {
    const h = await all(db, "SELECT id FROM purchase_invoices WHERE id = ? AND org_id = ?", [docId, orgId]);
    if (!h.length) return null;
    const rows = await all(
      db,
      "SELECT id, grn_item_id, po_item_id FROM purchase_invoice_items WHERE pi_id = ? ORDER BY created_at ASC, id ASC",
      [docId],
    );
    const lineIds = rows.map((r) => str(r.id));
    const grnLineIds = rows.map((r) => str(r.grn_item_id ?? r.grnItemId)).filter(Boolean);
    const grnToPo = await grnLinesToPoLines(db, grnLineIds);
    for (const r of rows) {
      const id = str(r.id);
      const grnLine = str(r.grn_item_id ?? r.grnItemId);
      const poLine = str(r.po_item_id ?? r.poItemId) || grnToPo.get(grnLine) || "";
      push(upstream, id, { type: "PO_LINE", id: poLine });
      push(upstream, id, { type: "GRN_LINE", id: grnLine });
    }
    return { lineIds, ownType, upstream };
  }

  if (doc === "DO") {
    const h = await all(db, "SELECT id FROM delivery_orders WHERE id = ? AND org_id = ?", [docId, orgId]);
    if (!h.length) return null;
    const rows = await all(
      db,
      "SELECT id, production_order_id FROM delivery_order_items WHERE delivery_order_id = ? ORDER BY id",
      [docId],
    );
    const lineIds = rows.map((r) => str(r.id));
    const toSo = await prodOrdersToSoLines(db, rows.map((r) => str(r.production_order_id ?? r.productionOrderId)));
    for (const r of rows) {
      push(upstream, str(r.id), { type: "SO_LINE", id: toSo.get(str(r.production_order_id ?? r.productionOrderId)) ?? "" });
    }
    return { lineIds, ownType, upstream };
  }

  if (doc === "INVOICE" || doc === "DR") {
    const header =
      doc === "INVOICE"
        ? await all(db, "SELECT id, delivery_order_id FROM invoices WHERE id = ? AND org_id = ?", [docId, orgId])
        : await all(db, "SELECT id, delivery_order_id FROM delivery_returns WHERE id = ? AND org_id = ?", [docId, orgId]);
    if (!header.length) return null;
    const doId = str(header[0].delivery_order_id ?? header[0].deliveryOrderId);
    // SELECT * on invoice_items: delivery_order_item_id / so_item_id are added
    // at runtime by the invoice routes and may not exist yet on every database.
    const rows =
      doc === "INVOICE"
        ? await all(db, "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id", [docId])
        : await all(
            db,
            "SELECT id, production_order_id FROM delivery_return_items WHERE delivery_return_id = ? ORDER BY id",
            [docId],
          );
    const lineIds = rows.map((r) => str(r.id));
    const prodOf = (r: Row) => str(r.production_order_id ?? r.productionOrderId);
    const doByProd = await doLinesByProdOrder(db, doId);
    const soByProd = await prodOrdersToSoLines(db, rows.map(prodOf));
    for (const r of rows) {
      const id = str(r.id);
      const doLine = str(r.delivery_order_item_id ?? r.deliveryOrderItemId) || doByProd.get(prodOf(r)) || "";
      const soLine = str(r.so_item_id ?? r.soItemId) || soByProd.get(prodOf(r)) || "";
      push(upstream, id, { type: "SO_LINE", id: soLine });
      push(upstream, id, { type: "DO_LINE", id: doLine });
    }
    return { lineIds, ownType, upstream };
  }

  return null;
}

/**
 * Every file_assets row on the given (type, ids) pairs, in this org. One query.
 * Types with no ids are skipped; nothing to ask → no query.
 */
export async function loadFilesForRefs(
  db: D1Database,
  orgId: string,
  idsByType: Map<string, string[]>,
): Promise<Row[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [orgId];
  for (const [type, ids] of idsByType) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (uniq.length === 0) continue;
    clauses.push(`(resourceType = ? AND resourceId IN (${ph(uniq.length)}))`);
    binds.push(type, ...uniq);
  }
  if (clauses.length === 0) return [];
  return all(
    db,
    `SELECT id, resourceType, resourceId, filename, contentType, sizeBytes, uploadedAt
       FROM file_assets WHERE orgId = ? AND (${clauses.join(" OR ")})
      ORDER BY uploadedAt ASC LIMIT 2000`,
    binds,
  );
}
