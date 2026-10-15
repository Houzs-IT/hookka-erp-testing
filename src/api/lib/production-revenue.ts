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
export async function loadProductionRevenue(
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
// ---------------------------------------------------------------------------
// Production revenue per day — ONE query, shared by the dashboard's Daily
// (Lim) tab (routes/dashboard-prototype.ts) and the evening efficiency email
// (routes/reports.ts, BUG-36), so the two can never disagree.
//
// Definition (same as the main dashboard's Production line and the Employee
// page's /production-revenue): a PO books on the day its LAST upholstery job
// card completes, priced SO line → CO line → product master × qty,
// SOFA/BEDFRAME/ACCESSORY only. It is the value of what production finished,
// NOT invoiced or delivered revenue. Orders whose price resolves to 0 are
// counted in `unpricedOrders`, not hidden.
//
// Owner-confirmed 2026-09-29: 28 Sep 2026 = RM 12,002.50 (24 orders, 1
// unpriced) on the dashboard, which is this query.
// ---------------------------------------------------------------------------

export type ProductionRevenueDay = {
  date: string;
  orders: number | string;
  unpricedOrders: number | string;
  revenueSen: number | string;
};

type Db = {
  prepare(sql: string): {
    bind(...v: unknown[]): { all<T>(): Promise<{ results?: T[] }> };
  };
};

/** Every day with production revenue for the org, or just `day` when given. */
export async function productionRevenueByDay(
  db: Db,
  orgId: string,
  day?: string,
): Promise<ProductionRevenueDay[]> {
  const r = await db
    .prepare(
      `WITH per_po AS (
         SELECT production_order_id,
                MAX(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completed_date IS NOT NULL
                         THEN completed_date END) AS unit_completed_at
           FROM job_cards
          WHERE department_code = 'UPHOLSTERY'
          GROUP BY production_order_id
         HAVING COUNT(*) > 0
            AND SUM(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completed_date IS NOT NULL
                         THEN 1 ELSE 0 END) = COUNT(*)
       ), priced AS (
         SELECT to_char(per_po.unit_completed_at::date, 'YYYY-MM-DD') AS day,
                COALESCE(
                  soi.unit_price_sen,
                  coi.unit_price_sen,
                  (SELECT COALESCE(p.base_price_sen, p.price1_sen)
                     FROM products p
                    WHERE p.code = po.product_code
                    ORDER BY p.base_price_sen DESC NULLS LAST, p.id
                    LIMIT 1),
                  0
                ) * po.quantity AS sen
           FROM per_po
           JOIN production_orders po ON po.id = per_po.production_order_id
           LEFT JOIN sales_order_items soi
                  ON soi.sales_order_id = po.sales_order_id AND soi.line_no = po.line_no
           LEFT JOIN consignment_order_items coi
                  ON coi.consignment_order_id = po.consignment_order_id AND coi.line_no = po.line_no
          WHERE po.org_id = ?
            AND po.item_category IN ('SOFA','BEDFRAME','ACCESSORY')
            AND per_po.unit_completed_at IS NOT NULL
       )
       SELECT day AS "date",
              COUNT(*) AS "orders",
              SUM(CASE WHEN sen > 0 THEN 0 ELSE 1 END) AS "unpricedOrders",
              COALESCE(SUM(sen), 0) AS "revenueSen"
         FROM priced
        GROUP BY day`,
    )
    .bind(orgId)
    .all<ProductionRevenueDay>();
  // Day filter in JS so the SQL stays exactly what the dashboard has run in
  // production. It scans every day for a one-day email; push the filter
  // into SQL if this ever gets slow (the dashboard pays the same scan).
  const rows = r.results ?? [];
  return day ? rows.filter((x) => x.date === day) : rows;
}

// HK-0092: the SAME rule once per department. Department X books a PO's full
// value on the day its LAST department-X job card completes, and only once
// every department-X card of that PO is COMPLETED/TRANSFERRED with a completed
// date. A PO with no card in a department books nothing there. The UPHOLSTERY
// rows equal productionRevenueByDay's. Every department books the FULL order
// value, so the rows are not meant to sum to anything.
export async function productionRevenueByDeptDay(
  db: Db,
  orgId: string,
): Promise<(ProductionRevenueDay & { dept: string })[]> {
  const r = await db
    .prepare(
      `WITH per_po AS (
         SELECT production_order_id, department_code,
                MAX(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completed_date IS NOT NULL
                         THEN completed_date END) AS unit_completed_at
           FROM job_cards
          WHERE department_code IS NOT NULL
          GROUP BY production_order_id, department_code
         HAVING COUNT(*) > 0
            AND SUM(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completed_date IS NOT NULL
                         THEN 1 ELSE 0 END) = COUNT(*)
       ), priced AS (
         SELECT to_char(per_po.unit_completed_at::date, 'YYYY-MM-DD') AS day,
                per_po.department_code AS dept,
                COALESCE(
                  soi.unit_price_sen,
                  coi.unit_price_sen,
                  (SELECT COALESCE(p.base_price_sen, p.price1_sen)
                     FROM products p
                    WHERE p.code = po.product_code
                    ORDER BY p.base_price_sen DESC NULLS LAST, p.id
                    LIMIT 1),
                  0
                ) * po.quantity AS sen
           FROM per_po
           JOIN production_orders po ON po.id = per_po.production_order_id
           LEFT JOIN sales_order_items soi
                  ON soi.sales_order_id = po.sales_order_id AND soi.line_no = po.line_no
           LEFT JOIN consignment_order_items coi
                  ON coi.consignment_order_id = po.consignment_order_id AND coi.line_no = po.line_no
          WHERE po.org_id = ?
            AND po.item_category IN ('SOFA','BEDFRAME','ACCESSORY')
            AND per_po.unit_completed_at IS NOT NULL
       )
       SELECT day AS "date",
              dept AS "dept",
              COUNT(*) AS "orders",
              SUM(CASE WHEN sen > 0 THEN 0 ELSE 1 END) AS "unpricedOrders",
              COALESCE(SUM(sen), 0) AS "revenueSen"
         FROM priced
        GROUP BY day, dept`,
    )
    .bind(orgId)
    .all<ProductionRevenueDay & { dept: string }>();
  return r.results ?? [];
}
