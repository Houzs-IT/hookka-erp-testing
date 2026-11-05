// Customer overdue sets: per sales order, sets ordered minus sets already on a
// non-cancelled DO (any stage, owner 2026-11-05), for orders past the customer's
// delivery date. Joined through production_orders (same path as
// on-time-delivery.ts; delivery_orders.sales_order_id is only half filled).
import { mytYmd, type DbLike } from "./on-time-delivery";

export interface OverdueSetsOrderRow {
  soId: string;
  soNo: string | null;
  customerId: string | null;
  customerName: string | null;
  customerDeliveryDate: string | null;
  orderedSets: number | string | null;
  setsOnDeliveryOrder: number | string | null;
}

export interface OverdueSetsOrder {
  soId: string;
  soNo: string | null;
  dueDate: string;
  daysLate: number;
  orderedSets: number;
  remainingSets: number;
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
       ), on_delivery_order AS (
         SELECT po.sales_order_id AS so_id, SUM(di.quantity) AS sets_on_delivery_order
           FROM delivery_orders d
           JOIN delivery_order_items di ON di.delivery_order_id = d.id
           JOIN production_orders po ON po.id = di.production_order_id
          WHERE d.status <> 'CANCELLED'
            AND NULLIF(po.sales_order_id, '') IS NOT NULL
          GROUP BY po.sales_order_id
       )
       SELECT so.id AS "soId",
              COALESCE(so.company_so_id, so.company_so) AS "soNo",
              so.customer_id AS "customerId",
              so.customer_name AS "customerName",
              NULLIF(substr(so.customer_delivery_date::text, 1, 10), '') AS "customerDeliveryDate",
              COALESCE(o.ordered_sets, 0) AS "orderedSets",
              COALESCE(dl.sets_on_delivery_order, 0) AS "setsOnDeliveryOrder"
         FROM sales_orders so
         LEFT JOIN ordered o ON o.so_id = so.id
         LEFT JOIN on_delivery_order dl ON dl.so_id = so.id
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
  const orderedSets = Number(row.orderedSets) || 0;
  const remainingSets = Math.max(0, orderedSets - (Number(row.setsOnDeliveryOrder) || 0));
  if (remainingSets === 0 || dueDate >= todayYmd) return null;
  return { soId: row.soId, soNo: row.soNo, dueDate, daysLate: daysBetween(dueDate, todayYmd), orderedSets, remainingSets };
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
