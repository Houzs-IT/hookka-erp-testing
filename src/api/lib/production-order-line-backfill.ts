import {
  assignSourceLines,
  type OrderLineItem,
  type SourceLineMethod,
} from "./production-order-line";

export interface SourceLineFill {
  productionOrderId: string;
  poNo: string;
  productCode: string;
  oldLineNo: number;
  sourceLineNo: number;
  method: SourceLineMethod;
  oldUnitPriceSen: number | null;
  newUnitPriceSen: number | null;
  quantity: number;
}

export interface SourceLineBackfillPlan {
  scanned: number;
  fills: SourceLineFill[];
  byMethod: Record<SourceLineMethod, number>;
  lineChanged: number;
  priceBasisDeltaSen: number;
  unresolvedSamples: Array<{ poNo: string; productCode: string; lineNo: number }>;
}

interface UnlinkedProductionOrder {
  id: string;
  poNo: string;
  orderKey: string;
  lineNo: number;
  productCode: string;
  quantity: number;
}

interface PricedOrderLineItem extends OrderLineItem {
  orderKey: string;
  unitPriceSen: number | null;
}

const SAMPLE_LIMIT = 50;

async function loadUnlinkedProductionOrders(db: D1Database): Promise<UnlinkedProductionOrder[]> {
  const result = await db
    .prepare(
      `SELECT id AS "id", poNo AS "poNo", lineNo AS "lineNo", productCode AS "productCode",
              quantity AS "quantity",
              CASE WHEN salesOrderId IS NOT NULL THEN 'SO:' || salesOrderId
                   ELSE 'CO:' || consignmentOrderId END AS "orderKey"
         FROM production_orders
        WHERE source_line_no IS NULL
          AND (salesOrderId IS NOT NULL OR consignmentOrderId IS NOT NULL)
        ORDER BY id`,
    )
    .all<UnlinkedProductionOrder>();
  return (result.results ?? []).map((row) => ({
    ...row,
    lineNo: Number(row.lineNo),
    quantity: Number(row.quantity) || 1,
  }));
}

async function loadOrderItems(db: D1Database): Promise<PricedOrderLineItem[]> {
  const result = await db
    .prepare(
      `SELECT 'SO:' || salesOrderId AS "orderKey", lineNo AS "lineNo", productCode AS "productCode",
              quantity AS "quantity", itemCategory AS "itemCategory", unitPriceSen AS "unitPriceSen"
         FROM sales_order_items
        WHERE salesOrderId IN (SELECT salesOrderId FROM production_orders WHERE source_line_no IS NULL)
       UNION ALL
       SELECT 'CO:' || consignmentOrderId, lineNo, productCode, quantity, itemCategory, unitPriceSen
         FROM consignment_order_items
        WHERE consignmentOrderId IN (SELECT consignmentOrderId FROM production_orders WHERE source_line_no IS NULL)`,
    )
    .all<PricedOrderLineItem>();
  return (result.results ?? []).map((row) => ({
    ...row,
    lineNo: Number(row.lineNo),
    quantity: Number(row.quantity) || 1,
    unitPriceSen: row.unitPriceSen === null ? null : Number(row.unitPriceSen),
  }));
}

function groupByOrder<T extends { orderKey: string }>(rows: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.orderKey) ?? [];
    group.push(row);
    groups.set(row.orderKey, group);
  }
  return groups;
}

function priceOf(items: readonly PricedOrderLineItem[], lineNo: number): number | null {
  return items.find((item) => item.lineNo === lineNo)?.unitPriceSen ?? null;
}

export async function planSourceLineBackfill(db: D1Database): Promise<SourceLineBackfillPlan> {
  const productionOrders = await loadUnlinkedProductionOrders(db);
  const itemsByOrder = groupByOrder(await loadOrderItems(db));
  const plan: SourceLineBackfillPlan = {
    scanned: productionOrders.length,
    fills: [],
    byMethod: { pieceSequence: 0, sameLineNo: 0, onlyLineForProduct: 0, unresolved: 0 },
    lineChanged: 0,
    priceBasisDeltaSen: 0,
    unresolvedSamples: [],
  };

  for (const [orderKey, orders] of groupByOrder(productionOrders)) {
    const items = itemsByOrder.get(orderKey) ?? [];
    const ordersById = new Map(orders.map((order) => [order.id, order]));
    for (const assignment of assignSourceLines(items, orders)) {
      plan.byMethod[assignment.method]++;
      const order = ordersById.get(assignment.productionOrderId);
      if (!order) continue;
      if (assignment.sourceLineNo === null) {
        if (plan.unresolvedSamples.length < SAMPLE_LIMIT) {
          plan.unresolvedSamples.push({ poNo: order.poNo, productCode: order.productCode, lineNo: order.lineNo });
        }
        continue;
      }
      const fill: SourceLineFill = {
        productionOrderId: order.id,
        poNo: order.poNo,
        productCode: order.productCode,
        oldLineNo: order.lineNo,
        sourceLineNo: assignment.sourceLineNo,
        method: assignment.method,
        oldUnitPriceSen: priceOf(items, order.lineNo),
        newUnitPriceSen: priceOf(items, assignment.sourceLineNo),
        quantity: order.quantity,
      };
      plan.fills.push(fill);
      if (fill.sourceLineNo === fill.oldLineNo) continue;
      plan.lineChanged++;
      plan.priceBasisDeltaSen += ((fill.newUnitPriceSen ?? 0) - (fill.oldUnitPriceSen ?? 0)) * fill.quantity;
    }
  }
  return plan;
}
