// ---------------------------------------------------------------------------
// production-revenue.ts — "Production Revenue": a production order's selling
// value, booked the day its LAST upholstery piece completes.
//
// One loader for the two screens that print it — Employees › Labor Cost vs
// Revenue (GET /api/working-hour-entries/production-revenue, "Total Revenue")
// and the finance dashboard's Cost Structure + salary cards (owner 2026-10-12
// 「把这个 total revenue 放在 revenue 下面，显示 production revenue」) — so the
// two can never print different figures for the same month.
//
// Recognition is per PRODUCTION ORDER, not per job card: a PO can spawn several
// upholstery pieces (HB, Divan, Cushion, …), each its own UPHOLSTERY job card.
// The PO books once, on the date its last piece finished, and only when every
// one of its upholstery cards is COMPLETED or TRANSFERRED with a completedDate.
//
// Bucketing one wide window by recognition month equals asking month by month
// (a PO's recognition date is unique): measured on production 2026-10-12, May–
// October 2026 agree to the sen both ways.
// ---------------------------------------------------------------------------
import type { Env } from "../worker";
import { timedFn } from "./step-timing";

export type ProductionCategory = "SOFA" | "BEDFRAME" | "ACCESSORY";

export type RecognizedProductionOrder = {
  poId: string;
  /** Recognition date (YYYY-MM-DD): when the PO's last upholstery piece completed. */
  date: string;
  productCode: string;
  productName: string;
  customerName: string;
  soNo: string;
  category: ProductionCategory;
  qty: number;
  unitPriceSen: number;
  totalPriceSen: number;
};

// Newest first, so the Labor Cost tab's raw-data table needs no sort.
async function loadProductionRevenueUntimed(
  db: Env["Variables"]["DB"],
  from: string,
  to: string,
): Promise<RecognizedProductionOrder[]> {
  // Single SQL: per_po CTE collapses UPHOLSTERY job_cards to one row per PO
  // (recognition date = MAX completedDate of done JCs), then we join out to
  // PO/SO/SO line/product for qty/price/category/display.
  //
  // Bug fix 2026-04-28: revenue was being recognized when *any* upholstery
  // JC completed for a PO, not when ALL of them did. A bedframe with HB
  // and Divan would book full revenue the moment Divan upholstery
  // finished, even with HB still WAITING - so SO-2604-325 booked RM 520
  // when only the Divan was done.
  //
  // Fix: GROUP BY across the PO's full upholstery JC set (no status
  // filter in WHERE), then HAVING requires done_uph = total_uph - i.e.
  // every upholstery JC must be COMPLETED or TRANSFERRED with a non-null
  // completedDate. Recognition date is the MAX completedDate of the
  // done JCs (which equals MAX overall once they are all done).
  const rowsRes = await db
    .prepare(
      `WITH per_po AS (
         SELECT productionOrderId,
                COUNT(*) AS total_uph,
                SUM(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completedDate IS NOT NULL
                         THEN 1 ELSE 0 END) AS done_uph,
                MAX(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completedDate IS NOT NULL
                         THEN completedDate END) AS unit_completed_at
           FROM job_cards
          WHERE departmentCode = 'UPHOLSTERY'
          GROUP BY productionOrderId
         HAVING COUNT(*) > 0
            AND SUM(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completedDate IS NOT NULL
                         THEN 1 ELSE 0 END) = COUNT(*)
            AND MAX(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completedDate IS NOT NULL
                         THEN completedDate END) >= ?
            AND MAX(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completedDate IS NOT NULL
                         THEN completedDate END) <= ?
       )
       SELECT po.id                AS poId,
              per_po.unit_completed_at AS completedAt,
              po.productCode       AS productCode,
              po.productName       AS productName,
              po.customerName      AS customerName,
              COALESCE(po.salesOrderNo, po.companyCOId) AS soNo,
              po.quantity          AS qty,
              po.itemCategory      AS category,
              -- CO-aware unit price: SO line item OR CO line item OR
              -- product master fallback. Without the CO branch, every CO
              -- PO got 0 revenue contribution.
              COALESCE(
                soi.unitPriceSen,
                coi.unitPriceSen,
                (SELECT COALESCE(p.basePriceSen, p.price1Sen)
                   FROM products p
                  WHERE p.code = po.productCode
                  ORDER BY p.basePriceSen DESC NULLS LAST, p.id
                  LIMIT 1),
                0
              ) AS unitPriceSen
         FROM per_po
         JOIN production_orders po ON po.id = per_po.productionOrderId
         LEFT JOIN sales_order_items soi
                ON soi.salesOrderId = po.salesOrderId
               AND soi.lineNo = po.lineNo
         LEFT JOIN consignment_order_items coi
                ON coi.consignmentOrderId = po.consignmentOrderId
               AND coi.lineNo = po.lineNo
        WHERE po.itemCategory IN ('SOFA','BEDFRAME','ACCESSORY')
        ORDER BY per_po.unit_completed_at DESC`,
    )
    .bind(from, to)
    .all<{
      poId: string;
      completedAt: string;
      productCode: string | null;
      productName: string | null;
      customerName: string | null;
      soNo: string | null;
      qty: number | string | null;
      category: ProductionCategory;
      unitPriceSen: number | string | null;
    }>();

  const out: RecognizedProductionOrder[] = [];
  for (const r of rowsRes.results ?? []) {
    if (r.category !== "SOFA" && r.category !== "BEDFRAME" && r.category !== "ACCESSORY") continue;
    const unitPriceSen = Math.round(typeof r.unitPriceSen === "number" ? r.unitPriceSen : Number(r.unitPriceSen) || 0);
    // One row per PO: qty = production_orders.quantity, total = unit × qty.
    const qty = Math.max(1, Math.round(typeof r.qty === "number" ? r.qty : Number(r.qty) || 1));
    out.push({
      poId: r.poId,
      // completedAt may include time-of-day; the date is all anyone reads.
      date: (r.completedAt ?? "").slice(0, 10),
      productCode: r.productCode ?? "",
      productName: r.productName ?? "",
      customerName: r.customerName ?? "",
      soNo: r.soNo ?? "",
      category: r.category,
      qty,
      unitPriceSen,
      totalPriceSen: unitPriceSen * qty,
    });
  }
  return out;
}
export const loadProductionRevenue = timedFn("production-revenue", loadProductionRevenueUntimed);

export type ProductionRevenueSplit = { bedframe: number; sofa: number; accessory: number; total: number };

const emptySplit = (): ProductionRevenueSplit => ({ bedframe: 0, sofa: 0, accessory: 0, total: 0 });

// Recognised orders → per month (YYYY-MM), per category. An order with no
// recognition date books nowhere.
export function productionRevenueByMonth(
  orders: Pick<RecognizedProductionOrder, "date" | "category" | "totalPriceSen">[],
): Map<string, ProductionRevenueSplit> {
  const out = new Map<string, ProductionRevenueSplit>();
  for (const o of orders) {
    const ym = String(o.date ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const cur = out.get(ym) ?? emptySplit();
    if (o.category === "BEDFRAME") cur.bedframe += o.totalPriceSen;
    else if (o.category === "SOFA") cur.sofa += o.totalPriceSen;
    else if (o.category === "ACCESSORY") cur.accessory += o.totalPriceSen;
    else continue;
    cur.total += o.totalPriceSen;
    out.set(ym, cur);
  }
  return out;
}

// One dashboard period (a month, or a quarter's months). A period wholly after
// `nowYm` has not happened yet → null ("-" on screen), never a zero that reads
// as "nothing was produced"; a past month with nothing recognised is a real 0.
export function sumProductionRevenue(
  byMonth: Map<string, ProductionRevenueSplit>,
  months: string[],
  nowYm: string,
): ProductionRevenueSplit | null {
  if (!months.some((ym) => ym <= nowYm)) return null;
  const acc = emptySplit();
  for (const ym of months) {
    const s = byMonth.get(ym);
    if (!s) continue;
    acc.bedframe += s.bedframe;
    acc.sofa += s.sofa;
    acc.accessory += s.accessory;
    acc.total += s.total;
  }
  return acc;
}
