export const PRODUCTION_ORDER_LINE_SQL = "COALESCE(po.source_line_no, po.lineNo)";

let isSourceLineColumnEnsured = false;

export async function ensureProductionOrderSourceLine(db: D1Database): Promise<void> {
  if (isSourceLineColumnEnsured) return;
  await db
    .prepare("ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS source_line_no INTEGER")
    .run();
  isSourceLineColumnEnsured = true;
}

export interface OrderLineItem {
  lineNo: number;
  productCode: string;
  quantity: number;
  itemCategory: string | null;
}

export interface ProductionOrderLineRow {
  id: string;
  lineNo: number;
  productCode: string;
}

export type SourceLineMethod = "pieceSequence" | "sameLineNo" | "onlyLineForProduct" | "unresolved";

export interface SourceLineAssignment {
  productionOrderId: string;
  sourceLineNo: number | null;
  method: SourceLineMethod;
}

type LineLookup = Map<number, OrderLineItem>;

export function piecesOfLine(item: OrderLineItem): number {
  return item.itemCategory === "SOFA" ? 1 : Math.max(1, item.quantity || 1);
}

export function lineByPieceSequence(items: readonly OrderLineItem[]): LineLookup {
  const bySequence: LineLookup = new Map();
  let sequence = 0;
  for (const item of [...items].sort((left, right) => left.lineNo - right.lineNo)) {
    for (let piece = 0; piece < piecesOfLine(item); piece++) {
      sequence++;
      bySequence.set(sequence, item);
    }
  }
  return bySequence;
}

function countProductMatches(orders: readonly ProductionOrderLineRow[], lookup: LineLookup): number {
  return orders.filter((order) => lookup.get(order.lineNo)?.productCode === order.productCode).length;
}

function onlyLineForProduct(items: readonly OrderLineItem[], productCode: string): OrderLineItem | null {
  const matches = items.filter((item) => item.productCode === productCode);
  return matches.length === 1 ? matches[0] : null;
}

export function assignSourceLines(
  items: readonly OrderLineItem[],
  productionOrders: readonly ProductionOrderLineRow[],
): SourceLineAssignment[] {
  const bySequence = lineByPieceSequence(items);
  const byLineNo: LineLookup = new Map(items.map((item) => [item.lineNo, item]));
  const isLegacyNumbering = countProductMatches(productionOrders, byLineNo) > countProductMatches(productionOrders, bySequence);
  const attempts: Array<{ method: SourceLineMethod; lookup: LineLookup }> = isLegacyNumbering
    ? [{ method: "sameLineNo", lookup: byLineNo }, { method: "pieceSequence", lookup: bySequence }]
    : [{ method: "pieceSequence", lookup: bySequence }, { method: "sameLineNo", lookup: byLineNo }];

  return productionOrders.map((order) => {
    for (const { method, lookup } of attempts) {
      const item = lookup.get(order.lineNo);
      if (item && item.productCode === order.productCode) {
        return { productionOrderId: order.id, sourceLineNo: item.lineNo, method };
      }
    }
    const single = onlyLineForProduct(items, order.productCode);
    if (single) return { productionOrderId: order.id, sourceLineNo: single.lineNo, method: "onlyLineForProduct" };
    return { productionOrderId: order.id, sourceLineNo: null, method: "unresolved" };
  });
}
