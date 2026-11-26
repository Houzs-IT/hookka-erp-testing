// AI Connector round 4 (owner 2026-11-26): K1–K12 + company_report.
// Pure summaries over the endpoints' JSON, plus the permission proof the owner
// asked for first (「权限是第一位」): every new tool's endpoints sit behind the
// ERP permission in the table below, and a low-privilege role's redacted reply
// comes out as null money / "hidden", never as a figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePeriod,
  shiftMonths,
  summarisePoOverdue,
  summariseSupplierLateness,
  summariseUninvoiced,
  summariseStockCheck,
  pickProduct,
  summariseProductCost,
  mergeFloorWorkers,
  labourByDept,
  summariseProductionOutput,
  summariseRawMaterials,
  summariseGrossProfit,
  summariseLeadTimes,
  overdueDeliveries,
  reportMonths,
  summariseCompanyReport,
} from "../src/api/lib/mcp-round4.ts";
import { summariseDeliveriesDue } from "../src/api/lib/mcp-quick.ts";
import { classifyPath, makeRedactor } from "../src/api/lib/mcp-access.ts";
import { analyseToolText, leakCheckTargets, LEAK_CHECK_TOOLS } from "../src/api/lib/mcp-leak-check.ts";
import { CACHEABLE_TOOLS } from "../src/api/lib/mcp-limits.ts";

const O = "https://erp.example";
const TODAY = "2026-11-26"; // a Thursday

/** A storekeeper / production clerk: no pricing, costing, accounting or payroll. */
const lowPriv = () => false;
const redactAs = (can, path, body) => {
  const d = classifyPath(path);
  assert.ok(d.ok, path);
  return makeRedactor(can, d.resources)(body).value;
};

test("period: today / week / month / last_month / quarter / year / custom, each with the period before", () => {
  const p = (a) => resolvePeriod(a, TODAY);
  assert.deepEqual(p({ period: "today" }), { period: "today", from: TODAY, to: TODAY, prev: { from: "2026-11-25", to: "2026-11-25" } });
  assert.deepEqual(p({ period: "week" }), { period: "week", from: "2026-11-23", to: TODAY, prev: { from: "2026-11-16", to: "2026-11-19" } });
  assert.deepEqual(p({}), { period: "month", from: "2026-11-01", to: TODAY, prev: { from: "2026-10-01", to: "2026-10-26" } });
  assert.deepEqual(p({ period: "last_month" }), { period: "last_month", from: "2026-10-01", to: "2026-10-31", prev: { from: "2026-09-01", to: "2026-09-30" } });
  assert.deepEqual(p({ period: "quarter" }), { period: "quarter", from: "2026-10-01", to: TODAY, prev: { from: "2026-07-01", to: "2026-08-26" } });
  assert.deepEqual(p({ period: "year" }), { period: "year", from: "2026-01-01", to: TODAY, prev: { from: "2025-01-01", to: "2025-11-26" } });
  assert.deepEqual(p({ from: "2026-11-01", to: "2026-11-10" }), { period: "custom", from: "2026-11-01", to: "2026-11-10", prev: { from: "2026-10-22", to: "2026-10-31" } });
  assert.ok("error" in p({ period: "custom", from: "bad" }));
  assert.equal(shiftMonths("2026-03-31", -1), "2026-02-28");
});

const POS = [
  { id: "p1", poNo: "PO-1", supplierName: "Acme", status: "CONFIRMED", expectedDate: "2026-11-20", totalSen: 100000 },
  { id: "p2", poNo: "PO-2", supplierName: "Acme", status: "PARTIAL_RECEIVED", expectedDate: "2026-11-10", totalSen: 50000 },
  { id: "p3", poNo: "PO-3", supplierName: "Beta", status: "SUBMITTED", expectedDate: "2026-11-28", totalSen: 20000 },
  { id: "p4", poNo: "PO-4", supplierName: "Beta", status: "CONFIRMED", expectedDate: "2026-11-01", totalSen: 9000, deliveredInFull: true },
  { id: "p5", poNo: "PO-5", supplierName: "Acme", status: "RECEIVED", expectedDate: "2026-11-01", receivedDate: "2026-11-05", totalSen: 1 },
  { id: "p6", poNo: "PO-6", supplierName: "Beta", status: "RECEIVED", expectedDate: "2026-11-10", receivedDate: "2026-11-09", totalSen: 1 },
  { id: "p7", poNo: "PO-7", supplierName: "Acme", status: "CLOSED", expectedDate: "2026-10-01", receivedDate: "2026-10-04", totalSen: 1 },
];

test("K1 po_overdue: Houzs shape, the Procurement page's rule (billed in full is not open)", () => {
  const s = summarisePoOverdue({ data: POS }, TODAY, O);
  assert.equal(s.overdue.pos, 2);
  assert.equal(s.overdue.valueRm, 1500);
  assert.equal(s.overdue.top[0].po, "PO-2");
  assert.equal(s.overdue.top[0].daysLate, 16);
  assert.equal(s.overdue.top[0].url, `${O}/procurement/p2`);
  assert.deepEqual(s.overdueBySupplier[0], { supplier: "Acme", pos: 2, valueRm: 1500, worstDaysLate: 16 });
  assert.equal(s.awaitingReceipt.pos, 3);
  assert.equal(s.awaitingReceipt.partlyReceived, 1);
  assert.equal(s.dueThisWeek.pos, 1);
});

test("K2 supplier_lateness: received date vs expected, window + the window before", () => {
  const p = resolvePeriod({ period: "month" }, TODAY);
  const s = summariseSupplierLateness({ data: POS }, p, TODAY);
  assert.equal(s.receivedPosInWindow, 2);
  assert.equal(s.lateDeliveries, 1);
  assert.equal(s.onTimePct, 50);
  const acme = s.suppliers.find((x) => x.supplier === "Acme");
  assert.deepEqual(acme, { supplier: "Acme", receivedPos: 1, lateDeliveries: 1, onTimePct: 0, avgDaysLate: 4, openPosPastDate: 2 });
  assert.equal(s.previousPeriod.receivedPos, 1);
  assert.equal(s.previousPeriod.lateDeliveries, 1);
});

test("K3 uninvoiced deliveries: no invoice, age buckets, by customer", () => {
  const rows = [
    { id: "d1", doNo: "DO-1", customerName: "C1", status: "DELIVERED", deliveredAt: "2026-11-24T03:00:00Z", valueSen: 10000, invoiceNo: "" },
    { id: "d2", doNo: "DO-2", customerName: "C1", status: "SIGNED", signedAt: "2026-09-01", valueSen: 5000, invoiceNo: "" },
    { id: "d3", doNo: "DO-3", customerName: "C2", status: "DELIVERED", deliveredAt: "2026-11-01", valueSen: 7000, invoiceNo: "INV-9" },
  ];
  const s = summariseUninvoiced(rows, TODAY, O, false);
  assert.equal(s.count, 2);
  assert.equal(s.valueRm, 150);
  assert.deepEqual(s.byAgeDays, { "0-7": 1, "8-30": 0, "31-60": 0, over60: 1 });
  assert.equal(s.oldest[0].do, "DO-2");
  assert.equal(s.byCustomer[0].dos, 2);
});

const INV = { data: { rawMaterials: [
  { itemCode: "FAB-001", description: "Velvet grey", itemGroup: "Fabric", baseUOM: "M", balanceQty: 12, minStock: 50 },
  { itemCode: "FAB-002", description: "Velvet blue", itemGroup: "Fabric", baseUOM: "M", balanceQty: -3, minStock: 10 },
  { itemCode: "LEG-01", description: "Leg", itemGroup: "Leg", baseUOM: "PC", balanceQty: 0, minStock: 0 },
] } };
const LINES = { data: [
  { poNo: "PO-9", supplierName: "Acme", materialCode: "FAB-001", outstanding: 30, expectedDate: "2026-11-30" },
  { poNo: "PO-8", supplierName: "Acme", materialCode: "fab-001", outstanding: 5, expectedDate: "2026-11-20" },
] };

test("K4 stock_check: exact code first, open PO qty + next ETA, finished goods available", () => {
  const prods = { data: [{ id: "pr1", code: "1003-(K)", name: "Bed K" }] };
  const fg = { data: { counts: [{ id: "pr1", stockQty: 4, reservedQty: 1 }], dyn: [] } };
  const s = summariseStockCheck("fab-001", INV, prods, fg, LINES, TODAY);
  assert.equal(s.rawMaterials.length, 1);
  assert.equal(s.rawMaterials[0].onHand, 12);
  assert.equal(s.rawMaterials[0].onOpenPo, 35);
  assert.equal(s.rawMaterials[0].nextEta, "2026-11-20");
  assert.equal(s.rawMaterials[0].openPoLines[0].daysLate, 6);
  assert.deepEqual(s.finishedGoods[0], { code: "1003-(K)", name: "Bed K", inStock: 4, reserved: 1, available: 3 });
  assert.equal(summariseStockCheck("velvet", INV, null, null, null, TODAY).rawMaterials.length, 2);
});

const COSTING = { success: true, data: {
  product: { id: "pr1", code: "1003-(K)", name: "Bed K", category: "BEDFRAME" },
  bom: { version: "v2", status: "ACTIVE", effectiveFrom: "2026-11-01" },
  tier: "Lv1", labourRatePerMinSen: 50, minutes: 120, labourSen: 6000, materialSen: 24000, totalSen: 30000, materialLines: 3, missingLines: 1,
  tiers: [{ level: "Lv1", maxSen: 1000, materialSen: 24000, totalSen: 30000 }],
  byDept: [{ deptCode: "FRAMING", dept: "Framing", minutes: 120, labourSen: 6000 }],
  nodes: [{ label: "Bed", materials: [
    { code: "PLY", name: "Plywood", unit: "SHT", qty: 2, status: "priced", priceSen: 5000, amountSen: 10000, supplierName: "Acme" },
    { code: "LEG", name: "Leg", unit: "PC", qty: 4, status: "from-order", priceSen: null, amountSen: null, supplierName: "" },
  ] }],
  standard: { totalSen: 25000, setAt: "2026-11-02T00:00:00Z", setBy: "Lim" },
} };

test("K5 product_cost: breakdown in RM, lines not counted, change vs standard", () => {
  assert.deepEqual(pickProduct("1003-(k)", { data: [{ id: "x", code: "1003-(Q)", name: "Bed Q" }, { id: "pr1", code: "1003-(K)", name: "Bed K" }] }), { id: "pr1", code: "1003-(K)", name: "Bed K" });
  const s = summariseProductCost(COSTING, O);
  assert.equal(s.totalRm, 300);
  assert.equal(s.labourRm, 60);
  assert.equal(s.materials[0].amountRm, 100);
  assert.equal(s.materials[0].priceRm, 50);
  assert.deepEqual(s.notCounted, [{ code: "LEG", name: "Leg", why: "from-order" }]);
  assert.equal(s.standard.changeVsStandardPct, 20);
  assert.equal(s.moneyHidden, undefined);
});

const COMPLETED = { departments: [
  { dept: "FRAMING", bedframeUnits: 10, sofaSets: 0, usualBedframe: 8, usualSofa: 0, bedframeSen: 500000, sofaSen: 0, accessorySen: 0 },
  { dept: "UPHOLSTERY", bedframeUnits: 6, sofaSets: 3, usualBedframe: 5, usualSofa: 2, bedframeSen: 300000, sofaSen: 400000, accessorySen: 0 },
] };
const PREV = { departments: [{ dept: "FRAMING", bedframeUnits: 5, sofaSets: 0 }, { dept: "UPHOLSTERY", bedframeUnits: 5, sofaSets: 3 }] };
const SUMMARY = { savedDays: ["2026-11-23"], departments: [{ code: "FRAMING", name: "Framing" }], rows: [
  { id: "w1", name: "Ali", homeDept: "FRAMING", done: 10, workingMinutes: 480, earnedMinutes: 240, effPct: 50 },
  { id: "w2", name: "Bala", homeDept: "UPHOLSTERY", done: 6, workingMinutes: 480, earnedMinutes: 480, effPct: 100 },
  { id: "w3", name: "Chong", homeDept: "UPHOLSTERY", done: 0, workingMinutes: 480, earnedMinutes: 0, effPct: null, isHelper: true },
] };
const LIVE = { workers: [{ id: "w1", name: "Ali", homeDept: "FRAMING", done: 2, workingMinutes: 240, earnedMinutes: 240, effPct: 100 }] };

test("K6 / K11 production_output + worker_efficiency: saved days + today live, helpers left out, comparison", () => {
  const ws = mergeFloorWorkers(SUMMARY, LIVE);
  const ali = ws.find((w) => w.id === "w1");
  assert.equal(ali.workingMinutes, 720);
  assert.equal(ali.effPct, 67);
  const p = resolvePeriod({ period: "week" }, TODAY);
  const labour = labourByDept({ data: { rows: [{ key: "2026-11", salaryByDept: [{ dept: "FRAMING", costSen: 900000 }] }] } }, p.from, p.to);
  const out = summariseProductionOutput("output", p, COMPLETED, PREV, ws, new Map([["FRAMING", "Framing"]]), null);
  assert.equal(out.factory.bedframeUnits, 16);
  assert.equal(out.factory.valueRm, 12000);
  assert.equal(out.factory.change.bedframePct, 60);
  assert.equal(out.factory.efficiencyPct, Math.round(((480 + 480) / (720 + 480)) * 100));
  assert.equal(out.byDepartment[0].dept, "Framing");
  const eff = summariseProductionOutput("efficiency", p, COMPLETED, PREV, ws, new Map(), labour);
  assert.equal(eff.departmentsLowestFirst[0].dept, "Framing");
  assert.equal(eff.departmentsLowestFirst[0].labourCostRm, 9000);
  assert.equal(eff.lowestEfficiencyWorkers[0].name, "Ali");
  assert.ok(!eff.lowestEfficiencyWorkers.some((w) => w.name === "Chong"), "a helper has no efficiency rank");
});

test("K8 raw_material_summary: low / negative, MRP short, price changes in the period", () => {
  const plan = { data: { materials: [{ code: "FAB-001", description: "Velvet grey", short: 20, uom: "M", firstNeedBy: "2026-11-28" }, { code: "X", short: 0 }] } };
  const prices = { data: [
    { materialCode: "FAB-001", oldPrice: 1000, newPrice: 1200, effectiveFrom: "2026-11-10", approvalStatus: "APPROVED" },
    { materialCode: "FAB-002", oldPrice: 1000, newPrice: 900, changedDate: "2026-11-11" },
    { materialCode: "FAB-002", oldPrice: 800, newPrice: 1000, changedDate: "2026-09-01" },
  ] };
  const s = summariseRawMaterials(INV, plan, prices, resolvePeriod({}, TODAY));
  assert.equal(s.stock.negative, 1);
  assert.equal(s.stock.belowMinimum, 1);
  assert.equal(s.shortForProduction.count, 1);
  assert.equal(s.priceChanges.count, 2);
  assert.deepEqual(s.priceChanges.biggestIncreases[0], { code: "FAB-001", description: "Velvet grey", date: "2026-11-10", oldRm: 10, newRm: 12, changePct: 20, status: "APPROVED" });
  assert.equal(s.priceChanges.decreases[0].changePct, -10);
});

const INV_LINES = { data: [
  { invoiceNo: "INV-1", customerName: "C1", productCode: "1003-(K)", productName: "Bed K", quantity: 2, totalSen: 100000 },
  { invoiceNo: "INV-2", customerName: "C2", productCode: "NOBOM", productName: "Odd", quantity: 1, totalSen: 20000 },
] };
const COST_SUMMARY = { data: { "1003-(K)": { labourSen: 6000, materialSen: 24000, totalSen: 30000, missingLines: 1 } } };

test("K9 gross_profit: invoice revenue vs BOM cost, by product / customer, previous period, no-cost lines listed", () => {
  const p = resolvePeriod({}, TODAY);
  const s = summariseGrossProfit("product", p, INV_LINES, { data: [{ productCode: "1003-(K)", quantity: 1, totalSen: 50000 }] }, COST_SUMMARY);
  assert.equal(s.revenueRm, 1200);
  assert.equal(s.revenueWithCostRm, 1000);
  assert.equal(s.costRm, 600);
  assert.equal(s.grossProfitRm, 400);
  assert.equal(s.marginPct, 40);
  assert.equal(s.previousPeriod.grossProfitRm, 200);
  assert.equal(s.previousPeriod.grossProfitChangePct, 100);
  assert.equal(s.top[0].costUnderstated, true);
  assert.deepEqual(s.noCost, [{ product: "NOBOM", revenueRm: 200 }]);
  const byCust = summariseGrossProfit("customer", p, INV_LINES, null, COST_SUMMARY);
  assert.deepEqual(byCust.top.map((r) => r.customer), ["C1", "C2"]);
});

test("K10 production_lead_time: start → completed days, median / average, per product, previous period", () => {
  const rows = [
    { productCode: "A", productName: "Bed A", startDate: "2026-11-01", completedDate: "2026-11-11" },
    { productCode: "A", productName: "Bed A", startDate: "2026-11-05", completedDate: "2026-11-09" },
    { productCode: "B", productName: "Sofa B", startDate: "2026-11-02", completedDate: "2026-11-22" },
    { productCode: "A", productName: "Bed A", startDate: "2026-10-01", completedDate: "2026-10-07" },
  ];
  const p = resolvePeriod({}, TODAY);
  const s = summariseLeadTimes(rows, p, "", false);
  assert.equal(s.ordersCompleted, 3);
  assert.equal(s.medianDays, 10);
  assert.equal(s.averageDays, 11.3);
  assert.equal(s.previousPeriod.ordersCompleted, 1);
  assert.deepEqual(s.byProduct[0], { product: "A Bed A", category: null, orders: 2, medianDays: 7, averageDays: 7, slowestDays: 10, fastestDays: 4 });
  assert.equal(summariseLeadTimes(rows, p, "sofa", false).ordersCompleted, 1);
});

test("K12 delivery schedule: next week window + overdue delivery orders", () => {
  const dos = { data: [
    { id: "a", doNo: "DO-A", customerName: "C", deliveryDate: "2026-12-04", status: "DRAFT" },
    { id: "b", doNo: "DO-B", customerName: "C", deliveryDate: "2026-11-20", status: "LOADED" },
  ] };
  const s = summariseDeliveriesDue("next_week", dos, null, TODAY, O);
  assert.equal(s.from, "2026-12-03");
  assert.equal(s.to, "2026-12-09");
  assert.equal(s.deliveryOrders.count, 1);
  const od = overdueDeliveries(dos, TODAY, O);
  assert.equal(od.count, 1);
  assert.equal(od.oldest[0].daysLate, 6);
});

test("company_report: months of the period, P&L summed, change vs the period before, AR / AP", () => {
  assert.deepEqual(reportMonths("month", undefined, TODAY), { months: ["2026-10"], prevMonths: ["2026-09"], label: "2026-10" });
  assert.deepEqual(reportMonths("quarter", "2026-11", TODAY).months, ["2026-10", "2026-11"]);
  assert.deepEqual(reportMonths("quarter", "2026-11", TODAY).prevMonths, ["2026-07", "2026-08"]);
  assert.equal(reportMonths("year", "2026-10", TODAY).months.length, 10);
  const slice = (sales, gross, net) => ({ sales, cogs: sales - gross, gross, net, materials: 1, labour: 1, overhead: 0, stockMovement: 0, otherIncome: 0, expenses: gross - net, staffCost: 0, otherOpex: 0 });
  const dash = { data: { rows: [
    { key: "2026-09", partial: false, actual: slice(100000, 30000, 10000), cashFlow: { operating: 1, investing: 0, financing: 0, net: 1 }, productionRevenue: { total: 90000 }, labourBase: { headcount: 40 } },
    { key: "2026-10", partial: false, actual: slice(150000, 60000, 20000), cashFlow: { operating: 5000, investing: -1000, financing: 0, net: 4000 }, productionRevenue: { total: 120000 }, labourBase: { headcount: 42 }, balanceSheet: { assets: 900000, liabilities: 300000, equity: 600000, currentAssets: 400000, currentLiabilities: 200000, inventory: 100000 } },
  ] } };
  const aging = { data: { ar: [{ currentSen: 10000, days60Sen: 5000 }], ap: [{ currentSen: 3000 }] } };
  const s = summariseCompanyReport("month", reportMonths("month", "2026-10", TODAY), dash, aging);
  assert.equal(s.profitAndLoss.revenueRm, 1500);
  assert.equal(s.profitAndLoss.grossMarginPct, 40);
  assert.equal(s.change.revenuePct, 50);
  assert.equal(s.change.grossMarginPts, 10);
  assert.equal(s.balanceSheet.currentRatio, 2);
  assert.deepEqual(s.receivablesNow, { owedToUsRm: 150, over60DaysRm: 50 });
  assert.equal(s.production.changePct, 33.3);
  assert.deepEqual(s.headcount, { now: 42, previous: 40 });
});

// ── permissions first (owner 2026-11-26) ────────────────────────────────────

/** tool → every endpoint it reads → the resource(s) whose read opens it (the module gate). */
const GATES = {
  po_overdue: { "/api/purchase-orders/stats": ["purchase-orders"] },
  supplier_lateness: { "/api/purchase-orders/stats": ["purchase-orders"] },
  uninvoiced_deliveries: { "/api/delivery-orders": ["delivery-orders"] },
  stock_check: { "/api/inventory": ["inventory"], "/api/products": ["products"], "/api/inventory/fg-stock": ["inventory"], "/api/procurement-reports/outstanding-lines": ["purchase-orders"] },
  product_cost: { "/api/products": ["products"], "/api/product-costing/x": ["products"] },
  production_output: { "/api/dashboard/floor-live/completed": ["dashboard", "dashboard-experimental", "production-orders"], "/api/dashboard/floor-live/summary": ["dashboard", "dashboard-experimental", "production-orders"], "/api/dashboard/floor-live": ["dashboard", "dashboard-experimental", "production-orders"] },
  worker_efficiency: { "/api/dashboard/floor-live/completed": ["dashboard", "dashboard-experimental", "production-orders"], "/api/accounting/dashboard": ["accounting"] },
  raw_material_summary: { "/api/inventory": ["inventory"], "/api/mrp/plan": ["mrp"], "/api/price-history": ["price-history"] },
  gross_profit: { "/api/invoices/line-summary": ["invoices"], "/api/product-costing/summary": ["products"] },
  production_lead_time: { "/api/production-orders": ["production-orders"] },
  deliveries_due: { "/api/delivery-orders": ["delivery-orders"], "/api/sales-orders": ["sales-orders"] },
  company_report: { "/api/accounting/dashboard": ["accounting"], "/api/accounting/aging": ["accounting"] },
};

test("permissions: every round-4 endpoint is behind the module gate in the PR table (no open path)", () => {
  for (const [tool, eps] of Object.entries(GATES)) {
    for (const [path, resources] of Object.entries(eps)) {
      const d = classifyPath(path);
      assert.ok(d.ok, `${tool}: ${path} must be a gated module`);
      assert.deepEqual(d.resources, resources, `${tool}: ${path}`);
    }
  }
});

/** Strip every key a family's regex matches, as makeRedactor does for a family that is not unlocked. */
const stripMoney = (v) => (Array.isArray(v) ? v.map(stripMoney) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !/(sen$|price|amount|total)/i.test(k)).map(([k, x]) => [k, stripMoney(x)])) : v);

test("permissions: product costing has the ERP route's gate (products:read) and its money hides without cost permission", () => {
  for (const path of ["/api/product-costing/pr1", "/api/product-costing/summary"]) {
    const d = classifyPath(path);
    assert.ok(d.ok, path);
    assert.deepEqual(d.resources, ["products"], path);
  }
  const red = makeRedactor((p) => p === "products:read", ["products"])({ totalSen: 30000, materialCostSen: 20000, qty: 2 }).value;
  assert.deepEqual(red, { qty: 2 });
  // Without cost permission the reply never invents a figure.
  const s = summariseProductCost(stripMoney(COSTING), O);
  assert.equal(s.totalRm, null);
  assert.equal(s.labourRm, null);
  assert.equal(s.materials[0].amountRm, null);
  assert.equal(s.materials[0].priceRm, null);
  assert.equal(s.standard.totalRm, null);
  assert.ok(s.moneyHidden);
});

test("permissions: gross_profit when costing is refused or stripped → revenue only, cost / GP null", () => {
  const p = resolvePeriod({}, TODAY);
  for (const costs of [null, stripMoney(COST_SUMMARY)]) {
    const s = summariseGrossProfit("product", p, INV_LINES, null, costs);
    assert.equal(s.revenueRm, 1200);
    assert.equal(s.costRm, null);
    assert.equal(s.grossProfitRm, null);
    assert.equal(s.top[0].grossProfitRm, null);
    assert.ok(s.costHidden);
    assert.equal(s.lowestMargin, undefined);
  }
});

test("permissions: company_report / worker labour cost need accounting read — a production clerk is refused", () => {
  for (const path of ["/api/accounting/dashboard", "/api/accounting/aging"]) {
    const d = classifyPath(path);
    assert.deepEqual(d.resources, ["accounting"]);
    assert.ok(!d.resources.some((r) => lowPriv(`${r}:read`)));
  }
  // labour cost: a refused finance read is passed as null → no labourCostRm at all
  assert.equal(labourByDept(null, "2026-11-01", "2026-11-30"), null);
  const eff = summariseProductionOutput("efficiency", resolvePeriod({ period: "month" }, TODAY), COMPLETED, null, mergeFloorWorkers(SUMMARY, null), new Map(), null);
  assert.ok(!JSON.stringify(eff).includes("labourCostRm"));
});

test("permissions: production value hidden for a role without pricing → null, not 0; stock quantities stay", () => {
  const red = redactAs(lowPriv, "/api/dashboard/floor-live/completed", COMPLETED);
  const out = summariseProductionOutput("output", resolvePeriod({ period: "today" }, TODAY), red, null, null, new Map(), null);
  assert.equal(out.factory.valueRm, null);
  assert.equal(out.byDepartment[0].valueRm, null);
  assert.equal(out.factory.bedframeUnits, 16, "counts are not money and stay");
  const inv = redactAs(lowPriv, "/api/inventory", INV);
  const st = summariseStockCheck("FAB-001", inv, null, null, null, TODAY);
  assert.equal(st.rawMaterials[0].onHand, 12, "a quantity is not money (owner 2026-11-26)");
  assert.ok(!st.onHandHidden);
  const rmS = summariseRawMaterials(inv, null, null, resolvePeriod({}, TODAY));
  assert.ok(!rmS.stock.balancesHidden);
});

test("permissions: the leak check runs every round-4 tool as the chosen account; a refusal reads as refused", () => {
  const targets = leakCheckTargets([{ method: "GET", path: "/api/sales-orders" }]);
  for (const t of Object.keys(GATES)) assert.ok(targets.includes(`tool:${t}`), t);
  for (const t of LEAK_CHECK_TOOLS) if (t.name !== "deliveries_due") assert.ok(CACHEABLE_TOOLS.has(t.name), `${t.name} cacheable`);
  const refused = analyseToolText("tool:company_report", "You don't have access to the company figures (accounting / finance).", true);
  assert.equal(refused.outcome, "refused");
  const opened = analyseToolText("tool:product_cost", JSON.stringify({ totalRm: 300 }), false);
  assert.deepEqual(opened.kept, ["totalRm"]);
  assert.equal(opened.keptExpected, false, "money in a non-money tool is flagged for a human look");
});

test("permissions: a storekeeper sees stock quantities, never the amounts", () => {
  const row = { itemCode: "RM-1", balanceQty: 40, outstandingQty: 12, onHandQty: 40, balanceSen: 52000, unitPriceSen: 1300, costSen: 1100 };
  const out = makeRedactor((p) => p === "inventory:read", ["inventory"])(row).value;
  assert.deepEqual(out, { itemCode: "RM-1", balanceQty: 40, outstandingQty: 12, onHandQty: 40 });
});
