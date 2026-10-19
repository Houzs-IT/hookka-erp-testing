// ---------------------------------------------------------------------------
// production-stock.ts (loader) — reads the production orders, their job cards,
// the sales / consignment order lines that price them and the delivery orders
// / consignment notes that take them out, for the pure valuation in
// src/lib/production-stock.ts (FG / WIP of a month the Stock Take leaves blank,
// owner 2026-10-13).
// ---------------------------------------------------------------------------
import type { Env } from "../worker";
import { timedFn } from "./step-timing";
import { prepareProduction, type PreparedProduction, type PsJobCard, type PsLine, type PsOrder } from "../../lib/production-stock";

const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const pick = (r: Record<string, unknown>, camel: string, snake: string) => r[camel] ?? r[snake];

// A timestamp's calendar day in Malaysia time; a bare date stays as it is.
export function mytDay(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s.includes("T") || /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return s.slice(0, 10);
  return new Date(t + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function loadPreparedProductionUntimed(
  db: Env["Variables"]["DB"],
  floorIso: string | null,
): Promise<PreparedProduction> {
  const [poRes, jcRes, soRes, coRes, doRes, cnRes] = await Promise.all([
    db.prepare(
      `SELECT id, poNo, status, completedDate, quantity, itemCategory, productCode, productName,
              salesOrderId, consignmentOrderId, lineNo
         FROM production_orders`,
    ).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT productionOrderId, status, completedDate, productionTimeMinutes, estMinutes FROM job_cards`,
    ).all<Record<string, unknown>>(),
    db.prepare(`SELECT salesOrderId, lineNo, productCode, unitPriceSen FROM sales_order_items`).all<Record<string, unknown>>(),
    db.prepare(`SELECT consignmentOrderId, lineNo, productCode, unitPriceSen FROM consignment_order_items`)
      .all<Record<string, unknown>>()
      .catch(() => ({ results: [] as Record<string, unknown>[] })),
    db.prepare(
      `SELECT doi.productionOrderId AS "productionOrderId", d.dispatchedAt AS "dispatchedAt", d.deliveredAt AS "deliveredAt"
         FROM delivery_order_items doi
         JOIN delivery_orders d ON d.id = doi.deliveryOrderId
        WHERE doi.productionOrderId IS NOT NULL AND doi.productionOrderId <> '' AND d.status <> 'CANCELLED'`,
    ).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT ci.productionOrderId AS "productionOrderId", cn.dispatchedAt AS "dispatchedAt",
              cn.inTransitAt AS "inTransitAt", cn.deliveredAt AS "deliveredAt"
         FROM consignment_items ci
         JOIN consignment_notes cn ON cn.id = ci.consignmentNoteId
        WHERE ci.productionOrderId IS NOT NULL AND ci.productionOrderId <> '' AND cn.status <> 'CANCELLED'`,
    ).all<Record<string, unknown>>()
      .catch(() => ({ results: [] as Record<string, unknown>[] })),
  ]);

  const orders: PsOrder[] = (poRes.results ?? []).map((r) => ({
    id: String(r.id ?? ""),
    poNo: str(pick(r, "poNo", "po_no")),
    status: String(r.status ?? ""),
    completedDate: str(pick(r, "completedDate", "completed_date")),
    qty: num(r.quantity),
    itemCategory: str(pick(r, "itemCategory", "item_category")),
    productCode: str(pick(r, "productCode", "product_code")),
    productName: str(pick(r, "productName", "product_name")),
    salesOrderId: str(pick(r, "salesOrderId", "sales_order_id")),
    consignmentOrderId: str(pick(r, "consignmentOrderId", "consignment_order_id")),
    lineNo: (() => { const v = pick(r, "lineNo", "line_no"); return v === null || v === undefined ? null : Number(v); })(),
  }));
  // Standard minutes: the card's production time, its estimate when unset.
  const jobCards: PsJobCard[] = (jcRes.results ?? []).map((r) => {
    const std = num(pick(r, "productionTimeMinutes", "production_time_minutes"));
    return {
      productionOrderId: String(pick(r, "productionOrderId", "production_order_id") ?? ""),
      status: String(r.status ?? ""),
      completedDate: str(pick(r, "completedDate", "completed_date")),
      minutes: std > 0 ? std : num(pick(r, "estMinutes", "est_minutes")),
    };
  });
  const line = (r: Record<string, unknown>, idCamel: string, idSnake: string): PsLine => ({
    orderId: String(pick(r, idCamel, idSnake) ?? ""),
    lineNo: (() => { const v = pick(r, "lineNo", "line_no"); return v === null || v === undefined ? null : Number(v); })(),
    productCode: str(pick(r, "productCode", "product_code")),
    unitPriceSen: num(pick(r, "unitPriceSen", "unit_price_sen")),
  });
  const soLines = (soRes.results ?? []).map((r) => line(r, "salesOrderId", "sales_order_id"));
  const coLines = (coRes.results ?? []).map((r) => line(r, "consignmentOrderId", "consignment_order_id"));
  // Out = the earliest of a delivery order's dispatch / delivery, or a
  // consignment note's dispatch / in-transit / delivery.
  const dispatches: { productionOrderId: string; date: string }[] = [];
  const out = (r: Record<string, unknown>, keys: string[]) => {
    const days = keys.map((k) => mytDay(r[k])).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (days.length) dispatches.push({ productionOrderId: String(r.productionOrderId ?? ""), date: days[0] });
  };
  for (const r of doRes.results ?? []) out(r, ["dispatchedAt", "deliveredAt"]);
  for (const r of cnRes.results ?? []) out(r, ["dispatchedAt", "inTransitAt", "deliveredAt"]);

  return prepareProduction({ orders, jobCards, soLines, coLines, dispatches, floorIso });
}
export const loadPreparedProduction = timedFn("prod-orders", loadPreparedProductionUntimed);
