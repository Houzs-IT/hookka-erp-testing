import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizeOverdueSets, todayInMalaysia } from "../src/api/lib/customer-overdue-sets.ts";

const today = "2026-11-05";
const row = (overrides) => ({
  soId: "so-1",
  soNo: "SO-1",
  customerId: "cust-a",
  customerName: "Customer A",
  customerDeliveryDate: "2026-11-01",
  orderedSets: 3,
  deliveredSets: 0,
  ...overrides,
});

test("remaining sets are ordered minus delivered", () => {
  const summary = summarizeOverdueSets([row({ orderedSets: 5, deliveredSets: 2 })], today);
  assert.equal(summary.totalSets, 3);
  assert.equal(summary.customers[0].orders[0].remainingSets, 3);
  assert.equal(summary.customers[0].orders[0].daysLate, 4);
});

test("fully delivered and over-delivered orders are not overdue", () => {
  const summary = summarizeOverdueSets(
    [row({ soId: "full", deliveredSets: 3 }), row({ soId: "over", orderedSets: 2, deliveredSets: 4 })],
    today,
  );
  assert.equal(summary.totalOrders, 0);
  assert.equal(summary.totalSets, 0);
  assert.deepEqual(summary.customers, []);
});

test("an order due today is not overdue yet", () => {
  const summary = summarizeOverdueSets([row({ customerDeliveryDate: today })], today);
  assert.equal(summary.totalOrders, 0);
});

test("orders without a customer date are counted apart, not as overdue", () => {
  const summary = summarizeOverdueSets([row({ customerDeliveryDate: null }), row({ customerDeliveryDate: "" })], today);
  assert.equal(summary.ordersWithoutCustomerDate, 2);
  assert.equal(summary.totalSets, 0);
});

test("customers are grouped and sorted by most overdue sets", () => {
  const summary = summarizeOverdueSets(
    [
      row({ soId: "a1", customerId: "cust-a", orderedSets: 1, customerDeliveryDate: "2026-10-20" }),
      row({ soId: "b1", customerId: "cust-b", customerName: "Customer B", orderedSets: 4 }),
      row({ soId: "a2", customerId: "cust-a", orderedSets: 2, customerDeliveryDate: "2026-10-01" }),
    ],
    today,
  );
  assert.deepEqual(summary.customers.map((customer) => [customer.customerName, customer.overdueSets]), [["Customer B", 4], ["Customer A", 3]]);
  const customerA = summary.customers[1];
  assert.equal(customerA.oldestDueDate, "2026-10-01");
  assert.deepEqual(customerA.orders.map((order) => order.soId), ["a2", "a1"]);
  assert.equal(summary.totalOrders, 3);
});

test("bigint sums arriving as strings still add up", () => {
  const summary = summarizeOverdueSets([row({ orderedSets: "6", deliveredSets: "1" })], today);
  assert.equal(summary.totalSets, 5);
});

test("today is the Malaysia date, not the UTC date", () => {
  assert.equal(todayInMalaysia(new Date("2026-11-04T17:30:00Z")), "2026-11-05");
});

test("delivered sets come from delivered, non-cancelled DOs through production orders", () => {
  const source = readFileSync(new URL("../src/api/lib/customer-overdue-sets.ts", import.meta.url), "utf8");
  assert.match(source, /JOIN production_orders po ON po\.id = di\.production_order_id/);
  assert.match(source, /d\.status <> 'CANCELLED'/);
  assert.match(source, /NULLIF\(d\.delivered_at::text, ''\) IS NOT NULL/);
  assert.match(source, /so\.status NOT IN \('CANCELLED', 'DRAFT'\)/);
});
