// AI Connector round 3 (owner 2026-11-26): the new quick answers, daily brief,
// export_excel's xlsx, the rate limit, the answer cache and the latency figures.
// Pure logic only — the tools' reads go through routes/mcp.ts readValue.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  addDays,
  daysBetween,
  listRows,
  summariseInventory,
  summarisePurchasing,
  summarisePayables,
  summariseOverdueSales,
  summariseDeliveriesDue,
  summariseShippedNotInvoiced,
  summariseProductionLate,
  summariseAttendance,
  buildDailyBrief,
  promptText,
  PROMPTS,
} from "../src/api/lib/mcp-quick.ts";
import {
  EXPORT_LISTS,
  EXPORT_MAX_ROWS,
  buildXlsx,
  cellValue,
  columnLabel,
  exportRows,
  exportTotal,
  filterRows,
  pagesToRead,
  pickColumns,
  sheetData,
} from "../src/api/lib/mcp-export.ts";
import {
  AnswerCache,
  CACHEABLE_TOOLS,
  RATE_DAY_MESSAGE,
  RATE_MINUTE_MESSAGE,
  latencyByTool,
  myMidnightIso,
  percentile,
  rateDecision,
} from "../src/api/lib/mcp-limits.ts";
import { pickPurchaseAnchor, shapePurchaseFlow } from "../src/api/lib/mcp-flow.ts";
import { classifyPath } from "../src/api/lib/mcp-access.ts";

const O = "https://erp.example";
const TODAY = "2026-11-26";

test("date helpers and list shapes", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-11-20", "2026-11-26"), 6);
  assert.deepEqual(listRows([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(listRows({ success: true, data: [{ a: 1 }] }), [{ a: 1 }]);
  assert.deepEqual(listRows({ data: { rows: [{ a: 2 }] } }), [{ a: 2 }]);
  assert.deepEqual(listRows(null), []);
});

test("inventory: negative, below minimum (worst first), zero, finished goods", () => {
  const inv = { success: true, data: { rawMaterials: [
    { itemCode: "A", balanceQty: -5, minStock: 0, itemGroup: "FABRIC", isActive: true },
    { itemCode: "B", balanceQty: 2, minStock: 10, itemGroup: "FOAM", isActive: true },
    { itemCode: "C", balanceQty: 8, minStock: 10, itemGroup: "FOAM", isActive: true },
    { itemCode: "D", balanceQty: 0, minStock: 0, isActive: true },
    { itemCode: "E", balanceQty: -99, minStock: 0, isActive: false },
  ] } };
  const fg = { success: true, data: { counts: [{ id: "p1", stockQty: 3, reservedQty: 1 }], dyn: [{ id: "fg-dyn-x", stockQty: 2, reservedQty: 0 }] } };
  const s = summariseInventory(inv, fg);
  assert.equal(s.rawMaterials.active, 4); // inactive E ignored
  assert.equal(s.rawMaterials.negative, 1);
  assert.deepEqual(s.rawMaterials.lowest.map((x) => x.code), ["B", "C"]);
  assert.equal(s.rawMaterials.zero, 1);
  assert.deepEqual(s.rawMaterials.belowMinimumByGroup, { FOAM: 2 });
  assert.deepEqual(s.finishedGoods, { productsWithStock: 2, unitsInStock: 5, unitsReserved: 1 });
  assert.equal(summariseInventory(inv, null).finishedGoods, undefined);
});

const POS = { success: true, data: [
  { id: "p1", poNo: "PO-1", supplierName: "Meditex", status: "CONFIRMED", expectedDate: "2026-11-20", totalSen: 10000 },
  { id: "p2", poNo: "PO-2", supplierName: "Meditex", status: "PARTIAL_RECEIVED", expectedDate: "2026-11-28", totalSen: 5000 },
  { id: "p3", poNo: "PO-3", supplierName: "Foamco", status: "CONFIRMED", expectedDate: "2026-11-10", totalSen: 2000, deliveredInFull: true },
  { id: "p4", poNo: "PO-4", supplierName: "Foamco", status: "RECEIVED", expectedDate: "2026-11-01", receivedDate: "2026-11-06", totalSen: 1 },
  { id: "p5", poNo: "PO-5", supplierName: "Woodco", status: "CLOSED", expectedDate: "2026-11-05", receivedDate: "2026-11-04", totalSen: 1 },
  { id: "p6", poNo: "PO-6", supplierName: "Woodco", status: "DRAFT", expectedDate: "", totalSen: 700 },
] };

test("purchasing: the Procurement page's open / overdue rule, and the views", () => {
  const o = summarisePurchasing(POS, { data: [{ status: "DRAFT", arrival_state: "IN_TRANSIT" }, { status: "POSTED" }] }, TODAY, O);
  assert.equal(o.openOrders, 3); // p1, p2, p6 (p3 billed in full, p4/p5 done)
  assert.equal(o.overdue.count, 1);
  assert.equal(o.overdue.oldest[0].poNo, "PO-1");
  assert.equal(o.overdue.oldest[0].daysLate, 6);
  assert.equal(o.overdue.oldest[0].link, `${O}/procurement/p1`);
  assert.deepEqual(o.awaitingGrn, { count: 2, rm: 150 });
  assert.deepEqual(o.draftGrns, { count: 1, byArrivalState: { IN_TRANSIT: 1 } });

  const aw = summarisePurchasing(POS, null, TODAY, O, "awaiting");
  assert.equal(aw.awaitingGrn.orders[0].poNo, "PO-2"); // partly received first
  assert.equal(aw.draftGrns, undefined);

  const sup = summarisePurchasing(POS, null, TODAY, O, "suppliers", 90);
  assert.equal(sup.receivedOrdersInWindow, 2);
  assert.equal(sup.deliveredLateInWindow, 1);
  const foam = sup.suppliers.find((x) => x.supplier === "Foamco");
  assert.deepEqual(foam, { supplier: "Foamco", receivedOrders: 1, deliveredLate: 1, onTimePct: 0, avgDaysLate: 5, overdueNow: 0 });
  assert.equal(sup.suppliers.find((x) => x.supplier === "Meditex").overdueNow, 1);
  assert.equal(sup.suppliers.some((x) => x.supplier === "Woodco"), false); // on time, nothing overdue

  assert.ok(summarisePurchasing(POS, null, TODAY, O, "overdue").overdue);
});

test("payables: AP half of the ageing, past due and due this week", () => {
  const aging = { data: { ar: [{ customerName: "X", currentSen: 999 }], ap: [
    { supplierName: "S1", currentSen: 10000, days30Sen: 0, days60Sen: 5000, days90Sen: 0, over90Sen: 0, docs: [
      { no: "PI-1", date: "2026-09-01", due: "2026-10-01", amountSen: 5000 },
      { no: "PI-2", date: "2026-11-20", due: "2026-11-29", amountSen: 10000 },
    ] },
  ] } };
  const p = summarisePayables(aging, TODAY);
  assert.equal(p.totalOwedRm, 150);
  assert.equal(p.byAgeRm.days60, 50);
  assert.equal(p.pastDue.invoices, 1);
  assert.equal(p.dueNext7Days.first[0].invoice, "PI-2");
  assert.equal(p.suppliers[0].over60Rm, 50);
});

const DUE = { success: true, data: [
  { id: "s1", companySOId: "SO-1", customerName: "A", status: "IN_PRODUCTION", hookkaExpectedDD: "2026-11-20", totalSen: 100000 },
  { id: "s2", companySOId: "SO-2", customerName: "A", status: "CONFIRMED", hookkaExpectedDD: "2026-11-26", totalSen: 2000 },
  { id: "s3", companySOId: "SO-3", customerName: "B", status: "READY_TO_SHIP", hookkaExpectedDD: "2026-11-29", totalSen: 3000 },
  { id: "s4", companySOId: "SO-4", customerName: "B", status: "CONFIRMED", hookkaExpectedDD: "2026-12-05", totalSen: 3000 },
] };

test("overdue sales orders and deliveries due", () => {
  const s = summariseOverdueSales(DUE, TODAY, O);
  assert.equal(s.overdueOrders, 1);
  assert.equal(s.orders[0].daysLate, 6);
  assert.equal(s.overdueRm, 1000);
  assert.equal(s.atLeast, undefined);

  const dos = { data: [
    { id: "d1", doNo: "DO-1", customerName: "A", deliveryDate: "2026-11-26", status: "LOADED" },
    { id: "d2", doNo: "DO-2", customerName: "B", deliveryDate: "2026-11-30", status: "DRAFT" },
    { id: "d3", doNo: "DO-3", customerName: "C", deliveryDate: "2026-11-20", status: "DRAFT" },
  ] };
  const t = summariseDeliveriesDue("today", dos, DUE, TODAY, O);
  assert.equal(t.deliveryOrders.count, 1);
  assert.equal(t.deliveryOrders.pastDateNotDelivered, 1);
  assert.equal(t.salesOrdersDue.count, 1);
  const w = summariseDeliveriesDue("week", dos, null, TODAY, O);
  assert.equal(w.to, "2026-12-02");
  assert.equal(w.deliveryOrders.count, 2);
  assert.equal(w.salesOrdersDue, undefined);
});

test("shipped not invoiced, late production", () => {
  const sni = summariseShippedNotInvoiced({ data: [
    { id: "d1", doNo: "DO-1", status: "DELIVERED", deliveryDate: "2026-11-01", invoiceNo: "" },
    { id: "d2", doNo: "DO-2", status: "DELIVERED", deliveryDate: "2026-11-02", invoiceNo: "INV-9" },
  ] }, TODAY, O);
  assert.equal(sni.count, 1);
  assert.equal(sni.oldest[0].daysSince, 25);

  const pl = summariseProductionLate({ success: true, data: { items: [
    { id: "a", poNo: "P1", status: "IN_PROGRESS", targetEndDate: "2026-11-20", currentDepartment: "FAB_SEW", customerName: "A" },
    { id: "b", poNo: "P2", status: "PENDING", targetEndDate: "2026-12-20", currentDepartment: "FOAM" },
    { id: "c", poNo: "P3", status: "TRANSFERRED", targetEndDate: "2026-11-01" },
  ] } }, TODAY, O);
  assert.equal(pl.liveOrders, 2);
  assert.equal(pl.lateOrders, 1);
  assert.deepEqual(pl.byDepartment, [{ name: "Fabric Sewing", orders: 1 }]);
  assert.equal(pl.oldest[0].link, `${O}/production/a`);
});

test("attendance today: leave covering today, absent, not clocked in; missing parts left out", () => {
  const att = { data: [
    { employeeId: "w1", employeeName: "Ali", status: "PRESENT" },
    { employeeId: "w2", employeeName: "Bala", status: "ABSENT", departmentName: "Sewing" },
  ] };
  const leaves = { data: [
    { workerId: "w3", workerName: "Chong", type: "ANNUAL", startDate: "2026-11-25", endDate: "2026-11-27", status: "APPROVED" },
    { workerId: "w9", workerName: "Old", type: "ANNUAL", startDate: "2026-10-01", endDate: "2026-10-02", status: "APPROVED" },
  ] };
  const workers = { data: [{ id: "w1", status: "ACTIVE" }, { id: "w2", status: "ACTIVE" }, { id: "w3", status: "ACTIVE" }, { id: "w4", name: "Devi", status: "ACTIVE" }, { id: "w5", status: "RESIGNED" }] };
  const a = summariseAttendance(TODAY, att, leaves, workers);
  assert.deepEqual(a.byStatus, { PRESENT: 1, ABSENT: 1 });
  assert.deepEqual(a.awayOrAbsent, [{ name: "Bala", department: "Sewing", status: "ABSENT" }]);
  assert.equal(a.onApprovedLeave.count, 1);
  assert.deepEqual(a.noAttendanceRecordYet, { count: 1, first: [{ name: "Devi", department: "" }] });
  const b = summariseAttendance(TODAY, null, leaves, workers);
  assert.equal(b.attendanceRecords, undefined);
  assert.equal(b.noAttendanceRecordYet, undefined);
});

test("daily brief: counts + top 5 with links, sections only where readable, small", () => {
  const mail = [
    { id: "t1", subject: "Quote please", counterpartyName: "Cust", lastDirection: "inbound", unread: true },
    { id: "t2", subject: "Assigned", lastDirection: "inbound", unread: false, assignedToUserId: "me" },
    { id: "t3", subject: "We replied", lastDirection: "outbound", unread: true },
    { id: "t4", subject: "Read, not mine", lastDirection: "inbound", unread: false, assignedToUserId: "other" },
  ];
  const b = buildDailyBrief({
    today: TODAY, origin: O, userId: "me",
    salesDue: DUE, poStats: POS, mailThreads: mail,
    serviceApprovals: { data: [{ id: "c1", caseNo: "SC-1", customerName: "A", issue: "x", requestedAt: "2026-11-25T01:00:00Z" }] },
    leaveApprovals: null,
    noAccess: ["Mail Center"],
  });
  assert.equal(b.sections.salesOrdersOverdue.count, 1);
  assert.equal(b.sections.salesOrdersDueIn3Days.count, 2); // 26th and 29th
  assert.equal(b.sections.purchaseOrdersOverdue.count, 1);
  assert.equal(b.sections.purchaseOrdersDueIn3Days.count, 1); // PO-2 on the 28th
  assert.equal(b.sections.mailWaitingForYou.count, 2);
  assert.equal(b.sections.mailWaitingForYou.top[1].assignedToYou, true);
  assert.equal(b.sections.mailWaitingForYou.top[0].link, `${O}/mail-center/t1`);
  assert.equal(b.sections.serviceCaseApprovals.count, 1);
  assert.equal(b.sections.leaveApprovals, undefined);
  assert.equal(b.itemsNeedingAttention, 1 + 2 + 1 + 1 + 2 + 1);
  assert.deepEqual(b.noAccess, ["You don't have access to Mail Center."]);
  assert.ok(JSON.stringify(b).length < 6000);
  // A big mailbox still answers top 5 only.
  const many = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, subject: "s".repeat(500), lastDirection: "inbound", unread: true }));
  const big = buildDailyBrief({ today: TODAY, origin: O, userId: "me", salesDue: null, poStats: null, mailThreads: many, serviceApprovals: null, leaveApprovals: null, noAccess: [] });
  assert.equal(big.sections.mailWaitingForYou.top.length, 5);
  assert.ok(big.sections.mailWaitingForYou.top[0].subject.length <= 80);
  assert.ok(big.sections.mailWaitingForYou.countedFrom);
});

test("daily-brief prompt exists and expands", () => {
  assert.ok(PROMPTS.find((p) => p.name === "daily-brief"));
  assert.match(promptText("daily-brief", {}), /daily_brief/);
});

test("export: every list is a readable module, paging plan, filters, columns, RM", () => {
  for (const [k, l] of Object.entries(EXPORT_LISTS)) assert.ok(classifyPath(l.api).ok, `${k} must be readable through the module gate`);
  assert.equal(pagesToRead(1200, 500), 3);
  assert.equal(pagesToRead(99999, 500), EXPORT_MAX_ROWS / 500);
  assert.equal(pagesToRead(null, 500), 10);
  assert.equal(pagesToRead(80, 80), 1);
  assert.equal(exportTotal({ total: 42 }), 42);
  assert.equal(exportTotal({}), null);
  assert.deepEqual(exportRows({ data: { rawMaterials: [{ a: 1 }] } }, "rawMaterials"), [{ a: 1 }]);

  const rows = [
    { id: "1", companySOId: "SO-1", customerName: "Houzs", status: "CONFIRMED", companySODate: "2026-11-02", totalSen: 123456, items: [{ x: 1 }], isStock: false },
    { id: "2", companySOId: "SO-2", customerName: "Other", status: "DELIVERED", companySODate: "2026-10-02", totalSen: 100 },
  ];
  assert.equal(filterRows(rows, { search: "houzs" }).rows.length, 1);
  assert.equal(filterRows(rows, { status: "delivered" }).rows[0].id, "2");
  const d = filterRows(rows, { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(d.dateKey, "companySODate");
  assert.equal(d.rows.length, 1);

  const cols = pickColumns(rows, EXPORT_LISTS["sales-orders"].prefer);
  assert.equal(cols[0].key, "companySOId");
  assert.ok(!cols.some((c) => c.key === "items")); // nested lines left out
  const money = cols.find((c) => c.key === "totalSen");
  assert.deepEqual(money, { key: "totalSen", label: "Total (RM)", money: true });
  assert.equal(columnLabel("companySODate"), "Company SO Date");
  assert.equal(columnLabel("arrival_state"), "Arrival State");
  assert.equal(columnLabel("isStock"), "Is Stock");
  assert.deepEqual(pickColumns(rows, [], ["Customer Name", "totalSen", "nope"]).map((c) => c.key), ["customerName", "totalSen"]);
  assert.equal(cellValue(123456, true), 1234.56);
  assert.equal(cellValue(true, false), "Yes");
  assert.equal(cellValue("", false), null);
  assert.equal(cellValue("x".repeat(5000), false).length, 2000);
  const { aoa, widths } = sheetData(rows, cols);
  assert.equal(aoa.length, 3);
  assert.ok(widths.every((w) => w >= 8 && w <= 50));
});

test("export: a real xlsx — header row, RM values, number format, widths", () => {
  const rows = [{ soNo: "SO-1", totalSen: 123456 }, { soNo: "SO-2", totalSen: 50 }];
  const cols = pickColumns(rows, ["soNo"]);
  const bytes = buildXlsx("Sales orders", rows, cols);
  assert.equal(bytes[0], 0x50); // "PK" — a zip
  assert.equal(bytes[1], 0x4b);
  const wb = XLSX.read(bytes, { type: "array", cellStyles: true, cellNF: true });
  assert.equal(wb.Sheets["Sales orders"].B2.z, "#,##0.00");
  assert.deepEqual(wb.SheetNames, ["Sales orders"]);
  const ws = wb.Sheets["Sales orders"];
  assert.equal(ws.A1.v, "So No");
  assert.equal(ws.B1.v, "Total (RM)");
  assert.equal(ws.B2.v, 1234.56);
  assert.equal(ws.B3.v, 0.5);
  assert.ok(ws["!cols"] && ws["!cols"].length === 2);
});

test("rate limit: 30 a minute, 600 a day, plain messages", () => {
  assert.equal(rateDecision(0, 0), null);
  assert.equal(rateDecision(29, 599), null);
  assert.equal(rateDecision(30, 10), RATE_MINUTE_MESSAGE);
  assert.equal(rateDecision(1, 600), RATE_DAY_MESSAGE);
  assert.match(RATE_MINUTE_MESSAGE, /^Too many requests — wait a minute/);
  assert.match(RATE_DAY_MESSAGE, /^Daily limit reached/);
  assert.equal(myMidnightIso(new Date("2026-11-26T03:00:00Z")), "2026-11-25T16:00:00.000Z");
  assert.equal(myMidnightIso(new Date("2026-11-25T17:00:00Z")), "2026-11-25T16:00:00.000Z");
});

test("answer cache: per person + role + args, 30 s, bounded", () => {
  const c = new AnswerCache(30_000, 3);
  const k1 = AnswerCache.key("u1", "SALES", "sales_summary", { period: "2026-11" });
  const k2 = AnswerCache.key("u2", "SALES", "sales_summary", { period: "2026-11" });
  assert.notEqual(k1, k2);
  assert.equal(AnswerCache.key("u", "R", "t", { a: 1, b: 2 }), AnswerCache.key("u", "R", "t", { b: 2, a: 1 }));
  c.set(k1, "v1", 1000);
  assert.equal(c.get(k1, 20_000), "v1");
  assert.equal(c.get(k2, 20_000), null);
  assert.equal(c.get(k1, 31_001), null);
  for (let i = 0; i < 10; i++) c.set(`k${i}`, i, 50_000);
  assert.ok(c.size <= 3);
  assert.ok(CACHEABLE_TOOLS.has("daily_brief"));
  assert.ok(!CACHEABLE_TOOLS.has("export_excel"));
  assert.ok(!CACHEABLE_TOOLS.has("erp_get"));
});

test("latency per tool: median, p95, cached count", () => {
  assert.equal(percentile([], 50), 0);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => ({ tool: "sales_summary", ms: (i + 1) * 100, note: i === 0 ? "cached" : "" })),
    { tool: "search", ms: 50 },
  ];
  const l = latencyByTool(rows);
  assert.equal(l[0].tool, "sales_summary");
  assert.equal(l[0].p50, 1000);
  assert.equal(l[0].p95, 1900);
  assert.equal(l[0].max, 2000);
  assert.equal(l[0].cached, 1);
});

test("purchase flow: anchor from search, chain PO → GRN → PI", () => {
  const sr = { data: { groups: [{ kind: "purchase_order", items: [{ id: "po1", label: "PO-2611-003" }] }, { kind: "production_order", items: [{ id: "x", label: "PO-2611-003-01" }] }] } };
  assert.equal(pickPurchaseAnchor("PO-2611-003", sr), "po1");
  assert.equal(pickPurchaseAnchor("purchase_order:abc", null), "abc");
  assert.equal(pickPurchaseAnchor("SO-1", { data: { groups: [{ kind: "sales_order", items: [{ id: "s", label: "SO-1" }] }] } }), null);
  const f = shapePurchaseFlow(
    { data: { id: "po1", poNo: "PO-2611-003", supplierName: "Meditex", status: "PARTIAL_RECEIVED", orderDate: "2026-11-01", totalSen: 10000, expectedDate: "2026-11-20" } },
    { data: [{ id: "g1", grnNumber: "GRN-1", status: "POSTED", receiveDate: "2026-11-21" }] },
    { data: [
      { id: "pi1", piNo: "PI-1", purchaseOrderId: "po1", amountSen: 5000, paidAmountSen: 0, status: "OPEN", invoiceDate: "2026-11-22" },
      { id: "pi2", piNo: "PI-2", grnId: "g1", amountSen: 100, status: "PAID" },
      { id: "pi3", piNo: "PI-3", purchaseOrderId: "other", amountSen: 1 },
    ] },
    O,
  );
  assert.deepEqual(f.links.map((l) => l.type), ["purchase-order", "grn", "purchase-invoice", "purchase-invoice"]);
  assert.equal(f.links[0].amountRm, 100);
  assert.equal(f.links[1].url, `${O}/procurement/grn/g1`);
  assert.equal(f.links[2].url, `${O}/procurement/pi/pi1`);
});
