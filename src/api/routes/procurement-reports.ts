// ---------------------------------------------------------------------------
// /api/procurement-reports — Procurement › Reports (read-only).
//
//   GET /outstanding-lines  every outstanding PO line, layered by days late (H2-6)
//   GET /supplier-delay     0–100 delay score per supplier, last 90 days (H2-5)
//
// Gated like the PO list (`purchase-orders:read`). The PO list shows unit
// prices and totals to every reader it lets in, so these amounts go to the same
// people — there is no separate PO-price permission in Hookka today.
//
// Read-only: SELECTs only, no self-apply, no write. The rules live in
// src/lib/procurement-reports.ts.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { getOrgId } from "../lib/tenant";
import { requirePermission } from "../lib/rbac";
import { todayYmdMY } from "../../lib/utils";
import {
  OPEN_PO_STATUSES,
  bucketSummary,
  coverPoLines,
  outstandingLines,
  supplierScores,
  windowStart,
  ymd,
  type PoInvoicedInput,
  type QualityCaseInput,
  type ReportLineInput,
} from "../../lib/procurement-reports";

const app = new Hono<Env>();

type LineRow = {
  poId: string;
  poNo: string | null;
  supplierId: string | null;
  supplierName: string | null;
  poStatus: string | null;
  orderDate: string | null;
  expectedDate: string | null;
  receivedDate: string | null;
  lineId: string | number;
  lineNo: number | null;
  materialCode: string | null;
  materialName: string | null;
  category: string | null;
  supplierSku: string | null;
  unit: string | null;
  qty: number | null;
  recv: number | null;
  priceSen: number | null;
};

const OPEN_SQL = OPEN_PO_STATUSES.map((s) => `'${s}'`).join(",");

// Lines of open POs, plus (for the score) POs due on or after `since`.
async function loadLines(db: D1Database, orgId: string, since: string | null): Promise<ReportLineInput[]> {
  const res = await db
    .prepare(
      `SELECT p.id AS "poId", p.po_no AS "poNo", p.supplier_id AS "supplierId", p.supplier_name AS "supplierName",
              p.status AS "poStatus", p.order_date AS "orderDate", p.expected_date AS "expectedDate",
              p.received_date AS "receivedDate",
              poi.id AS "lineId", poi.line_no AS "lineNo", poi.material_code AS "materialCode",
              poi.material_name AS "materialName", poi.material_category AS "category",
              poi.supplier_sku AS "supplierSku", poi.unit AS "unit", poi.quantity AS "qty",
              poi.received_qty AS "recv", poi.unit_price_sen AS "priceSen"
         FROM purchase_order_items poi
         JOIN purchase_orders p ON p.id = poi.purchase_order_id
        WHERE p.org_id = ? AND p.status NOT IN ('DRAFT','CANCELLED')
          AND (p.status IN (${OPEN_SQL})${since ? " OR p.expected_date >= ?" : ""})`,
    )
    .bind(...(since ? [orgId, since] : [orgId]))
    .all<LineRow>();
  return (res.results ?? []).map((r) => ({
    poId: String(r.poId),
    poNo: String(r.poNo ?? ""),
    poStatus: String(r.poStatus ?? ""),
    supplierId: r.supplierId ? String(r.supplierId) : null,
    supplierName: r.supplierName,
    orderDate: r.orderDate,
    expectedDate: r.expectedDate,
    receivedDate: r.receivedDate,
    lineId: String(r.lineId),
    lineNo: Number(r.lineNo) || 0,
    materialCode: r.materialCode,
    materialName: r.materialName,
    category: r.category,
    supplierSku: r.supplierSku,
    unit: r.unit,
    quantity: Number(r.qty) || 0,
    receivedQty: Number(r.recv) || 0,
    unitPriceSen: Number(r.priceSen) || 0,
  }));
}

// Confirmed bills against POs — the same read as openPoIdsDeliveredInFull
// (src/api/lib/po-delivered.ts), plus each group's latest bill date. A failed
// read degrades to received-qty only, as there.
async function loadInvoiced(db: D1Database, orgId: string): Promise<PoInvoicedInput[]> {
  try {
    const res = await db
      .prepare(
        `SELECT COALESCE(pii.po_id, pi.purchase_order_id) AS "poId",
                COALESCE(pii.po_item_id, gi.po_item_id) AS "poItemId",
                pii.material_code AS "mc", pii.material_name AS "mn",
                COALESCE(SUM(pii.qty), 0) AS "qty", MAX(pi.invoice_date) AS "lastDate"
           FROM purchase_invoice_items pii
           JOIN purchase_invoices pi ON pi.id = pii.pi_id
           LEFT JOIN grn_items gi ON gi.id::text = pii.grn_item_id
          WHERE pi.org_id = ? AND pi.status NOT IN ('CANCELLED','DRAFT')
          GROUP BY COALESCE(pii.po_id, pi.purchase_order_id), COALESCE(pii.po_item_id, gi.po_item_id),
                   pii.material_code, pii.material_name`,
      )
      .bind(orgId)
      .all<{ poId: string | null; poItemId: string | null; mc: string | null; mn: string | null; qty: number; lastDate: string | null }>();
    return (res.results ?? [])
      .filter((r) => r.poId)
      .map((r) => ({
        poId: String(r.poId),
        poItemId: r.poItemId == null ? null : String(r.poItemId),
        materialCode: r.mc,
        materialName: r.mn,
        qty: Number(r.qty) || 0,
        lastDate: ymd(r.lastDate),
      }));
  } catch (err) {
    console.warn("[procurement-reports] invoiced-qty read failed; coverage uses received qty only", err);
    return [];
  }
}

// GET /api/procurement-reports/outstanding-lines
app.get("/outstanding-lines", async (c) => {
  const denied = await requirePermission(c, "purchase-orders", "read");
  if (denied) return denied;
  const orgId = getOrgId(c);
  const today = todayYmdMY();
  const [lines, invoiced] = await Promise.all([loadLines(c.var.DB, orgId, null), loadInvoiced(c.var.DB, orgId)]);
  const rows = outstandingLines(lines, coverPoLines(lines, invoiced), today, { withAmounts: true });
  return c.json({ success: true, data: rows, buckets: bucketSummary(rows), today, total: rows.length });
});

// GET /api/procurement-reports/supplier-delay
app.get("/supplier-delay", async (c) => {
  const denied = await requirePermission(c, "purchase-orders", "read");
  if (denied) return denied;
  const orgId = getOrgId(c);
  const today = todayYmdMY();
  const from = windowStart(today);
  const db = c.var.DB;
  const [lines, invoiced] = await Promise.all([loadLines(db, orgId, from), loadInvoiced(db, orgId)]);

  // Latest posted GRN date per PO line.
  const grnDateByLine = new Map<string, string>();
  try {
    const grnRes = await db
      .prepare(
        `SELECT gi.po_item_id AS "poItemId", MAX(g.receive_date) AS "lastDate"
           FROM grn_items gi
           JOIN grns g ON g.id = gi.grn_id
          WHERE g.org_id = ? AND g.status IN ('POSTED','CONFIRMED') AND gi.po_item_id IS NOT NULL
          GROUP BY gi.po_item_id`,
      )
      .bind(orgId)
      .all<{ poItemId: string | number; lastDate: string | null }>();
    for (const r of grnRes.results ?? []) {
      const d = ymd(r.lastDate);
      if (d) grnDateByLine.set(String(r.poItemId), d);
    }
  } catch (err) {
    console.warn("[procurement-reports] GRN dates read failed", err);
  }

  // Quality cases tied to a supplier: a GRN line with a rejected quantity, and
  // a purchase-return line. A return of a rejected GRN line is ONE case (keyed
  // by the GRN line). Service cases carry no supplier, so they are not counted.
  let quality: QualityCaseInput[] | null = [];
  try {
    const [rej, ret] = await Promise.all([
      db
        .prepare(
          `SELECT gi.id AS "grnItemId", g.supplier_id AS "supplierId", g.receive_date AS "d"
             FROM grn_items gi
             JOIN grns g ON g.id = gi.grn_id
            WHERE g.org_id = ? AND g.status IN ('POSTED','CONFIRMED')
              AND COALESCE(gi.rejected_qty, 0) > 0 AND g.receive_date >= ?`,
        )
        .bind(orgId, from)
        .all<{ grnItemId: string | number; supplierId: string | null; d: string | null }>(),
      db
        .prepare(
          `SELECT pri.id AS "itemId", pri.grn_item_id AS "grnItemId", pr.supplier_id AS "supplierId",
                  COALESCE(pr.returned_at::text, pr.created_at::text) AS "d"
             FROM purchase_return_items pri
             JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
            WHERE (pr.org_id = ? OR pr.org_id IS NULL)`,
        )
        .bind(orgId)
        .all<{ itemId: string | number; grnItemId: string | number | null; supplierId: string | null; d: string | null }>(),
    ]);
    for (const r of rej.results ?? []) {
      quality.push({ supplierId: r.supplierId ? String(r.supplierId) : null, date: ymd(r.d), caseKey: `grn:${r.grnItemId}` });
    }
    for (const r of ret.results ?? []) {
      quality.push({
        supplierId: r.supplierId ? String(r.supplierId) : null,
        date: ymd(r.d),
        caseKey: r.grnItemId != null && r.grnItemId !== "" ? `grn:${r.grnItemId}` : `ret:${r.itemId}`,
      });
    }
  } catch (err) {
    console.warn("[procurement-reports] quality read failed; quality weight left out", err);
    quality = null;
  }

  const rows = supplierScores({
    lines,
    coverage: coverPoLines(lines, invoiced),
    grnDateByLine,
    quality,
    today,
    withAmounts: true,
  });
  return c.json({ success: true, data: rows, today, from, qualityIncluded: quality !== null });
});

export default app;
