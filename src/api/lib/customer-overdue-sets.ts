// Customer overdue sets: per sales order, sets ordered (less cancelled
// production orders) minus sets dispatched, for
// orders past the customer's delivery date. Dispatched = on a DO past Pending
// Dispatch (not DRAFT, not CANCELLED), joined through production_orders (same path as
// on-time-delivery.ts; delivery_orders.sales_order_id is only half filled).
import { mytYmd, type DbLike } from "./on-time-delivery";

export interface OverdueSetsOrderRow {
  soId: string;
  soNo: string | null;
  customerPo: string | null;
  customerState: string | null;
  customerId: string | null;
  customerName: string | null;
  customerDeliveryDate: string | null;
  orderedSets: number | string | null;
  cancelledSets?: number | string | null;
  dispatchedSets: number | string | null;
  productionOrders?: number | string | null;
  unfinishedProductionOrders?: number | string | null;
}

export interface OverdueSetsOrder {
  soId: string;
  soNo: string | null;
  customerPo: string | null;
  customerState: string | null;
  dueDate: string;
  daysLate: number;
  orderedSets: number;
  remainingSets: number;
  isProductionComplete: boolean;
}

export interface CustomerOverdueSets {
  customerId: string | null;
  customerName: string;
  overdueSets: number;
  oldestDueDate: string;
  orders: OverdueSetsOrder[];
}

export interface OverdueSetsSummary {
  asOf: string;
  totalSets: number;
  totalOrders: number;
  ordersWithoutCustomerDate: number;
  customers: CustomerOverdueSets[];
}

const DAY_MILLISECONDS = 86_400_000;

export function todayInMalaysia(now: Date = new Date()): string {
  return mytYmd(now.toISOString());
}

export async function collectOverdueSetsRows(
  db: DbLike,
  orgId: string,
  todayYmd: string,
): Promise<OverdueSetsOrderRow[]> {
  const result = await db
    .prepare(
      `WITH ordered AS (
         SELECT soi.sales_order_id AS so_id, SUM(soi.quantity) AS ordered_sets
           FROM sales_order_items soi
          GROUP BY soi.sales_order_id
       ), cancelled AS (
         SELECT po.sales_order_id AS so_id, SUM(po.quantity) AS cancelled_sets
           FROM production_orders po
          WHERE po.status = 'CANCELLED'
            AND NULLIF(po.sales_order_id, '') IS NOT NULL
          GROUP BY po.sales_order_id
       ), production AS (
         SELECT po.sales_order_id AS so_id,
                COUNT(*) AS production_orders,
                SUM(CASE WHEN po.status IN ('COMPLETED', 'TRANSFERRED') THEN 0 ELSE 1 END) AS unfinished_production_orders
           FROM production_orders po
          WHERE po.status <> 'CANCELLED'
            AND NULLIF(po.sales_order_id, '') IS NOT NULL
          GROUP BY po.sales_order_id
       ), dispatched AS (
         SELECT po.sales_order_id AS so_id, SUM(di.quantity) AS dispatched_sets
           FROM delivery_orders d
           JOIN delivery_order_items di ON di.delivery_order_id = d.id
           JOIN production_orders po ON po.id = di.production_order_id
          WHERE d.status NOT IN ('DRAFT', 'CANCELLED')
            AND NULLIF(po.sales_order_id, '') IS NOT NULL
          GROUP BY po.sales_order_id
       )
       SELECT so.id AS "soId",
              COALESCE(so.company_so_id, so.company_so) AS "soNo",
              COALESCE(NULLIF(so.customer_po_id, ''), NULLIF(so.customer_po, '')) AS "customerPo",
              NULLIF(so.customer_state, '') AS "customerState",
              so.customer_id AS "customerId",
              so.customer_name AS "customerName",
              NULLIF(substr(so.customer_delivery_date::text, 1, 10), '') AS "customerDeliveryDate",
              COALESCE(o.ordered_sets, 0) AS "orderedSets",
              COALESCE(cx.cancelled_sets, 0) AS "cancelledSets",
              COALESCE(dl.dispatched_sets, 0) AS "dispatchedSets",
              COALESCE(pr.production_orders, 0) AS "productionOrders",
              COALESCE(pr.unfinished_production_orders, 0) AS "unfinishedProductionOrders"
         FROM sales_orders so
         LEFT JOIN ordered o ON o.so_id = so.id
         LEFT JOIN cancelled cx ON cx.so_id = so.id
         LEFT JOIN production pr ON pr.so_id = so.id
         LEFT JOIN dispatched dl ON dl.so_id = so.id
        WHERE so.org_id = ?
          AND so.status NOT IN ('CANCELLED', 'DRAFT')
          AND NOT COALESCE(so.is_service_order, FALSE)
          AND (NULLIF(substr(so.customer_delivery_date::text, 1, 10), '') IS NULL
               OR substr(so.customer_delivery_date::text, 1, 10) < ?)`,
    )
    .bind(orgId, todayYmd)
    .all<OverdueSetsOrderRow>();
  return result.results ?? [];
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / DAY_MILLISECONDS);
}

function toOverdueOrder(row: OverdueSetsOrderRow, dueDate: string, todayYmd: string): OverdueSetsOrder | null {
  const orderedSets = Math.max(0, (Number(row.orderedSets) || 0) - (Number(row.cancelledSets) || 0));
  const remainingSets = Math.max(0, orderedSets - (Number(row.dispatchedSets) || 0));
  if (remainingSets === 0 || dueDate >= todayYmd) return null;
  const isProductionComplete = (Number(row.productionOrders) || 0) > 0 && (Number(row.unfinishedProductionOrders) || 0) === 0;
  return { soId: row.soId, soNo: row.soNo, customerPo: row.customerPo, customerState: row.customerState, dueDate, daysLate: daysBetween(dueDate, todayYmd), orderedSets, remainingSets, isProductionComplete };
}

function groupByCustomer(entries: { row: OverdueSetsOrderRow; order: OverdueSetsOrder }[]): CustomerOverdueSets[] {
  const customers = new Map<string, CustomerOverdueSets>();
  for (const { row, order } of entries) {
    const customerName = row.customerName?.trim() || "(no customer)";
    const key = row.customerId || customerName;
    const customer = customers.get(key) ?? { customerId: row.customerId, customerName, overdueSets: 0, oldestDueDate: order.dueDate, orders: [] };
    customer.overdueSets += order.remainingSets;
    if (order.dueDate < customer.oldestDueDate) customer.oldestDueDate = order.dueDate;
    customer.orders.push(order);
    customers.set(key, customer);
  }
  for (const customer of customers.values()) customer.orders.sort((first, second) => (first.dueDate < second.dueDate ? -1 : 1));
  return [...customers.values()].sort(
    (first, second) => second.overdueSets - first.overdueSets || (first.oldestDueDate < second.oldestDueDate ? -1 : 1),
  );
}

export function summarizeOverdueSets(rows: OverdueSetsOrderRow[], todayYmd: string): OverdueSetsSummary {
  const entries: { row: OverdueSetsOrderRow; order: OverdueSetsOrder }[] = [];
  let ordersWithoutCustomerDate = 0;
  for (const row of rows) {
    const dueDate = (row.customerDeliveryDate ?? "").slice(0, 10).trim();
    if (!dueDate) {
      ordersWithoutCustomerDate++;
      continue;
    }
    const order = toOverdueOrder(row, dueDate, todayYmd);
    if (order) entries.push({ row, order });
  }
  const customers = groupByCustomer(entries);
  return {
    asOf: todayYmd,
    totalSets: customers.reduce((sum, customer) => sum + customer.overdueSets, 0),
    totalOrders: entries.length,
    ordersWithoutCustomerDate,
    customers,
  };
}

export const PRODUCTION_FILTERS = ["all", "inProduction", "productionComplete"] as const;
export type ProductionFilter = (typeof PRODUCTION_FILTERS)[number];

function matchesProductionFilter(order: OverdueSetsOrder, filter: ProductionFilter): boolean {
  if (filter === "all") return true;
  return order.isProductionComplete === (filter === "productionComplete");
}

export function filterCustomersByProduction(customers: CustomerOverdueSets[], filter: ProductionFilter): CustomerOverdueSets[] {
  if (filter === "all") return customers;
  return customers
    .map((customer) => {
      const orders = customer.orders.filter((order) => matchesProductionFilter(order, filter));
      return {
        ...customer,
        orders,
        overdueSets: orders.reduce((sum, order) => sum + order.remainingSets, 0),
        oldestDueDate: orders[0]?.dueDate ?? customer.oldestDueDate,
      };
    })
    .filter((customer) => customer.orders.length > 0)
    .sort((first, second) => second.overdueSets - first.overdueSets || (first.oldestDueDate < second.oldestDueDate ? -1 : 1));
}
