// m-invoices-v2.test.mjs — the phone Invoices list v2 (src/pages/m/lib/invoices-mobile.ts)
// and the Invoice PDF card wiring. Rows mimic GET /api/invoices (rowToInvoiceList).
//
// Owner decisions 2026-10-21: desktop status colours; "Overdue" = backend
// status, "Past due" = calculated from the due date and the balance, never
// mixed; Outstanding = the /stats SQL; "PAID IN FULL" with no date; the PDF
// card is invoice-only and gated on invoices:read.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  invoiceTone, statusLabel, isPastDue, daysUntil, dueChip, amountBox, payProgress, refChips,
  invoiceList, matchesInvoiceQuery, statusCounts, summarize, filterInvoices,
  paymentCard, supplierPayCard, noteCard, eInvoiceCard, eInvoiceSen, eInvoiceTone, longDate,
  canRecordPayment, lifecycle, detailBanner, balanceTone, itemRows, paymentHistory, relatedChain,
  adjustments, auditLines, methodLabel, TAB_READ_RESOURCE, allowedTabs, pickTab, isForbidden,
  canUseArAging, UNRESTRICTED_ROLES, AGING_SERVER_SCOPED, meRole,
  AGING_BUCKETS, agingList, agingTotals, oldestBucket, oldestLabel, agingAmount, agingSegments, filterAging,
} from "../src/pages/m/lib/invoices-mobile.ts";

const TODAY = "2026-10-16";
// formatCurrency puts a no-break space after "RM"; compare on plain spaces.
const nb = (v) => JSON.parse(JSON.stringify(v).replace(/\u00a0| /g, " "));
const inv = (o) => ({
  id: "inv-x", invoiceNo: "INV-X", customerName: "Cust", doNo: "", companySOId: "", customerPOId: "",
  invoiceDate: "2026-10-01", dueDate: "2026-11-01", totalSen: 100000, paidAmount: 0, status: "SENT", items: [], payments: [],
  ...o,
});

const LIST = [
  inv({ id: "inv-1", invoiceNo: "INV-2610-081", customerName: "Mewah Home", doNo: "DO-2610-031", companySOId: "SO-2610-021", customerPOId: "MH-5520", status: "SENT", dueDate: "2026-11-13", totalSen: 4356000 }),
  inv({ id: "inv-2", invoiceNo: "INV-2610-077", status: "PAID", totalSen: 3324000, paidAmount: 3324000, dueDate: "2026-11-05" }),
  inv({ id: "inv-3", invoiceNo: "INV-2609-054", status: "OVERDUE", totalSen: 2133000, paidAmount: 800000, dueDate: "2026-10-01" }),
  inv({ id: "inv-4", invoiceNo: "INV-2610-079", status: "PARTIAL_PAID", totalSen: 387000, paidAmount: 150000, dueDate: "2026-10-18" }),
  inv({ id: "inv-5", invoiceNo: "INV-2610-083", status: "DRAFT", totalSen: 1260000, dueDate: "2026-09-01" }),
  inv({ id: "inv-6", invoiceNo: "INV-2609-061", status: "CANCELLED", totalSen: 910000, dueDate: "2026-10-12" }),
  // Past due but still SENT — the backend never advanced it to OVERDUE.
  inv({ id: "inv-7", invoiceNo: "INV-2609-050", status: "SENT", totalSen: 500000, dueDate: "2026-10-10" }),
];

test("status tones follow desktop getStatusColor", () => {
  assert.equal(invoiceTone("DRAFT"), "neutral");
  assert.equal(invoiceTone("SENT"), "info");
  assert.equal(invoiceTone("PARTIAL_PAID"), "warning");
  assert.equal(invoiceTone("PAID"), "success");
  assert.equal(invoiceTone("OVERDUE"), "warningHigh");
  assert.equal(invoiceTone("CANCELLED"), "neutral");
  assert.equal(invoiceTone("SOMETHING_ELSE"), "neutral");
  assert.equal(statusLabel("PARTIAL_PAID"), "Partial Paid");
  assert.equal(statusLabel("LEGACY_STATE"), "Legacy State");
});

test("past due is calculated from the due date and balance, not the status", () => {
  const byId = (id) => LIST.find((r) => r.id === id);
  assert.equal(isPastDue(byId("inv-7"), TODAY), true, "SENT past its due date counts");
  assert.equal(isPastDue(byId("inv-3"), TODAY), true);
  assert.equal(isPastDue(byId("inv-5"), TODAY), false, "Draft never counts");
  assert.equal(isPastDue(byId("inv-6"), TODAY), false, "Cancelled never counts");
  assert.equal(isPastDue(inv({ status: "OVERDUE", dueDate: "2026-12-01" }), TODAY), false, "OVERDUE status with a future date is not past due");
  assert.equal(isPastDue(inv({ dueDate: "2026-10-16" }), TODAY), false, "due today is not past due");
  assert.equal(isPastDue(inv({ dueDate: "" }), TODAY), false);
  assert.equal(isPastDue(inv({ dueDate: "2026-10-01", paidAmount: 100000 }), TODAY), false, "no balance left");
  assert.equal(daysUntil("2026-10-18", TODAY), 2);
  assert.equal(daysUntil("bad", TODAY), null);
});

test("due chip states and wording", () => {
  assert.deepEqual(dueChip(inv({ status: "PAID", paidAmount: 100000 }), TODAY), { kind: "paid" });
  assert.deepEqual(dueChip(inv({ dueDate: "2026-10-01" }), TODAY), { kind: "due", date: "2026-10-01", tone: "past", countdown: "15 days past due" });
  assert.deepEqual(dueChip(inv({ dueDate: "2026-10-15" }), TODAY), { kind: "due", date: "2026-10-15", tone: "past", countdown: "1 day past due" });
  assert.equal(dueChip(inv({ dueDate: TODAY }), TODAY).countdown, "Due today");
  assert.equal(dueChip(inv({ dueDate: "2026-10-17", status: "PARTIAL_PAID", paidAmount: 1 }), TODAY).countdown, "In 1 day");
  assert.deepEqual(dueChip(inv({ dueDate: "2026-10-30" }), TODAY), { kind: "due", date: "2026-10-30", tone: "plain", countdown: "" });
  assert.equal(dueChip(inv({ status: "DRAFT", dueDate: "2026-09-01" }), TODAY).tone, "plain", "Draft: no countdown");
  assert.equal(dueChip(inv({ status: "CANCELLED", dueDate: "2026-09-01" }), TODAY).countdown, "");
  assert.deepEqual(dueChip(inv({ dueDate: "" }), TODAY), { kind: "due", date: "", tone: "plain", countdown: "" });
});

test("amount box, payment bar and ref chips", () => {
  assert.deepEqual(amountBox(inv({ paidAmount: 40000 })), { key: "BALANCE", sen: 60000 });
  assert.deepEqual(amountBox(inv({ paidAmount: 0 })), { key: "TOTAL", sen: 100000 });
  assert.deepEqual(amountBox(inv({ paidAmount: 100000, status: "PAID" })), { key: "TOTAL", sen: 100000 });
  assert.deepEqual(payProgress(inv({ paidAmount: 150000, totalSen: 387000 })), { paidSen: 150000, totalSen: 387000, pct: 39 });
  assert.equal(payProgress(inv({ paidAmount: 0 })), null);
  assert.equal(payProgress(inv({ paidAmount: 100000 })), null);
  assert.deepEqual(refChips(LIST[0]), [{ k: "DO", v: "DO-2610-031" }, { k: "SO", v: "SO-2610-021" }]);
  assert.deepEqual(refChips(inv({ doNo: "DO-1" })), [{ k: "DO", v: "DO-1" }]);
  assert.deepEqual(refChips(inv({})), []);
});

test("totals are only authoritative for a complete, unpaged list", () => {
  assert.equal(invoiceList({ success: true, data: LIST, total: LIST.length }).complete, true);
  assert.equal(invoiceList({ success: true, data: LIST }).complete, true);
  assert.equal(invoiceList({ success: true, data: LIST, total: 500 }).complete, false, "fewer rows than the server total");
  assert.equal(invoiceList({ success: true, data: LIST, page: 1, total: LIST.length }).complete, false, "a paged answer");
  assert.equal(invoiceList({ success: false, data: [] }).complete, false);
  assert.equal(invoiceList(null).complete, false);
  assert.equal(invoiceList({ error: "x" }).complete, false);
});

test("search covers invoice no, customer, DO, SO and customer PO", () => {
  for (const q of ["2610-081", "mewah", "DO-2610-031", "so-2610-021", "MH-5520"]) {
    assert.equal(matchesInvoiceQuery(LIST[0], q), true, q);
  }
  assert.equal(matchesInvoiceQuery(LIST[0], "nope"), false);
  assert.equal(matchesInvoiceQuery(LIST[0], "  "), true);
});

test("status counts are backend statuses; summary uses the /stats outstanding set", () => {
  const c = statusCounts(LIST);
  assert.deepEqual(c, { "": 7, DRAFT: 1, SENT: 2, PARTIAL_PAID: 1, PAID: 1, OVERDUE: 1, CANCELLED: 1 });
  assert.equal(statusCounts([inv({ status: "VOID" })])[""], 1, "legacy status counts under All only");

  const all = summarize(LIST, "", TODAY);
  assert.equal(all.count, 7);
  assert.equal(all.invoicedSen, 4356000 + 3324000 + 2133000 + 387000 + 1260000 + 910000 + 500000);
  // SENT 4356000 + OVERDUE (2133000-800000) + PARTIAL (387000-150000) + SENT 500000
  assert.equal(all.outstandingSen, 4356000 + 1333000 + 237000 + 500000);
  // Past due: inv-3 (OVERDUE, 1 Oct) + inv-7 (SENT, 10 Oct). Not the Draft.
  assert.equal(all.pastDueSen, 1333000 + 500000);
  assert.equal(all.pastDueCount, 2);

  const sent = summarize(LIST, "SENT", TODAY);
  assert.equal(sent.count, 2);
  assert.equal(sent.invoicedSen, 4356000 + 500000);
  assert.equal(sent.outstandingSen, all.outstandingSen, "outstanding is independent of the chip");
  assert.equal(sent.pastDueSen, all.pastDueSen, "past due is independent of the chip");
});

test("the Past Due filter is separate from the Overdue status chip", () => {
  const ids = (xs) => xs.map((r) => r.id);
  assert.deepEqual(ids(filterInvoices(LIST, { chip: "", pastDue: true, q: "", today: TODAY })), ["inv-3", "inv-7"]);
  assert.deepEqual(ids(filterInvoices(LIST, { chip: "OVERDUE", pastDue: false, q: "", today: TODAY })), ["inv-3"]);
  assert.deepEqual(ids(filterInvoices(LIST, { chip: "SENT", pastDue: true, q: "", today: TODAY })), ["inv-7"]);
  assert.deepEqual(ids(filterInvoices(LIST, { chip: "", pastDue: false, q: "mewah", today: TODAY })), ["inv-1"]);
});

// ---------------------------------------------------------------------------
// Other five tabs — real API fields (D5: Payments + e-Invoice used to read
// fields the API never returns and showed RM 0.00).
// ---------------------------------------------------------------------------
test("Payments card reads receiptNumber + amount (sen)", () => {
  const c = paymentCard({ id: "pay-1", receiptNumber: "OR-2610-041", customerName: "Sri Damai", date: "2026-10-11", amount: 3324000, method: "BANK_TRANSFER" });
  assert.equal(c.code, "OR-2610-041");
  assert.equal(c.title, "Sri Damai");
  assert.equal(c.sub, "Bank Transfer");
  assert.deepEqual(nb(c.metas.map((m) => m.v)), ["11 Oct 2026", "RM 33,240.00"]);
  assert.equal(c.rail, "success");
  assert.equal(c.status, null);
  assert.equal(paymentCard({ id: "x" }).metas[1].v, "—", "a missing amount is unknown, not RM 0.00");
});

test("Supplier Pay card", () => {
  const c = supplierPayCard({ paymentNo: "SPY-2610-018", supplierName: "Global Foam", date: "2026-10-10", totalBankSen: 1845000 });
  assert.equal(c.code, "SPY-2610-018");
  assert.deepEqual(nb(c.metas.map((m) => m.v)), ["10 Oct 2026", "RM 18,450.00"]);
  assert.equal(c.rail, "taupe");
});

test("Credit / Debit note cards: invoice + reason, signed amount, real status", () => {
  const cn = noteCard("CN", { noteNumber: "CN-2610-004", customerName: "Kian", invoiceNumber: "INV-2609-054", reason: "PRICING_ERROR", date: "2026-10-03", totalAmount: 378000, status: "POSTED" });
  assert.equal(cn.sub, "INV-2609-054 · Pricing Error");
  assert.equal(nb(cn.metas[1].v), "− RM 3,780.00");
  assert.equal(cn.metas[1].tone, "danger");
  assert.deepEqual(cn.status, { label: "Posted", tone: "success" });
  const dn = noteCard("DN", { noteNumber: "DN-1", totalAmount: 35000, status: "DRAFT" });
  assert.equal(nb(dn.metas[1].v), "+ RM 350.00");
  assert.equal(dn.metas[1].tone, undefined);
  assert.equal(dn.status.tone, "neutral");
  assert.equal(noteCard("CN", { status: "APPROVED" }).status.tone, "success");
});

test("e-Invoice: totalIncludingTax is ringgit → sen once; VALID is success", () => {
  assert.equal(eInvoiceSen({ totalIncludingTax: 33240 }), 3324000);
  assert.equal(eInvoiceSen({ totalIncludingTax: 1234.56 }), 123456);
  assert.equal(eInvoiceSen({ totalIncludingTax: null }), null);
  const c = eInvoiceCard({ invoiceNo: "INV-2610-077", customerName: "Sri Damai", totalIncludingTax: 33240, status: "VALID", submittedAt: "2026-10-12T03:00:00Z" });
  assert.equal(nb(c.metas[1].v), "RM 33,240.00");
  assert.equal(c.metas[0].v, "12 Oct 2026");
  assert.equal(c.sub, "LHDN MyInvois");
  assert.deepEqual(c.status, { label: "Valid", tone: "success" });
  assert.equal(eInvoiceTone("PENDING"), "warning");
  assert.equal(eInvoiceTone("SUBMITTED"), "info");
  assert.equal(eInvoiceTone("CANCELLED"), "neutral");
  assert.equal(eInvoiceCard({ status: "PENDING" }).metas[0].v, "Not submitted");
  assert.equal(longDate(""), "—");
});

// ---------------------------------------------------------------------------
// Invoice Detail rules.
// ---------------------------------------------------------------------------
test("Record Payment: SENT / PARTIAL_PAID / OVERDUE with invoices:update only (D2)", () => {
  for (const st of ["SENT", "PARTIAL_PAID", "OVERDUE"]) assert.equal(canRecordPayment(st, true), true, st);
  for (const st of ["DRAFT", "CANCELLED", "PAID", "", "VOID"]) assert.equal(canRecordPayment(st, true), false, st);
  assert.equal(canRecordPayment("SENT", false), false, "no invoices:update");
});

test("lifecycle uses real statuses; exceptional statuses are off-flow", () => {
  const states = (st) => lifecycle(st).steps.map((x) => x.state).join(",");
  assert.equal(states("DRAFT"), "current,pending,pending");
  assert.equal(states("SENT"), "done,current,pending");
  assert.equal(states("PAID"), "done,done,done");
  const pp = lifecycle("PARTIAL_PAID");
  assert.equal(pp.steps[2].state, "current", "Paid is NOT done while partly paid");
  assert.equal(pp.steps[2].stateText, "Partially paid");
  for (const st of ["OVERDUE", "CANCELLED", "SOMETHING"]) {
    const l = lifecycle(st);
    assert.equal(l.inFlow, false, st);
    assert.ok(l.note.length > 0);
  }
});

test("detail banner, balance tone", () => {
  assert.deepEqual(detailBanner(inv({ status: "CANCELLED" }), TODAY), { tone: "neutral", text: "This invoice was cancelled." });
  assert.deepEqual(nb(detailBanner(inv({ status: "SENT", dueDate: "2026-10-10", totalSen: 500000 }), TODAY)), { tone: "danger", text: "6 days past due · RM 5,000.00 outstanding" });
  assert.equal(detailBanner(inv({ status: "SENT" }), TODAY), null);
  assert.equal(balanceTone(inv({ dueDate: "2026-10-10" }), TODAY), "danger");
  assert.equal(balanceTone(inv({}), TODAY), "warning");
  assert.equal(balanceTone(inv({ paidAmount: 100000, status: "PAID" }), TODAY), "success");
});

test("line rows: real fields, discount only when > 0, no SO line", () => {
  const rowsA = itemRows({ sizeLabel: "Queen 5ft", fabricCode: "VLV-021", unitPriceSen: 189000, discountSen: 0, totalSen: 2268000 });
  assert.deepEqual(rowsA.map((r) => r.k), ["Size", "Fabric", "Unit price", "Line total"]);
  const rowsB = itemRows({ unitPriceSen: 1000, discountSen: 200, totalSen: 800 });
  assert.deepEqual(nb(rowsB.map((r) => `${r.k}=${r.v}`)), ["Unit price=RM 10.00", "Discount=− RM 2.00", "Line total=RM 8.00"]);
});

test("payment history never fakes a transaction", () => {
  const h = paymentHistory({ paidAmount: 800000, payments: [{ id: "p1", date: "2026-09-20", amountSen: 800000, method: "CHEQUE", reference: "PBB 004412" }] });
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].method, "Cheque");
  assert.equal(h.unitemisedSen, null);
  const legacy = paymentHistory({ paidAmount: 150000, payments: [] });
  assert.deepEqual(legacy, { rows: [], unitemisedSen: 150000 });
  assert.deepEqual(paymentHistory({ paidAmount: 0, payments: [] }), { rows: [], unitemisedSen: null });
  assert.equal(methodLabel("SOMETHING_NEW"), "Something New");
});

test("related chain: real ids only", () => {
  const full = relatedChain({ invoiceNo: "INV-1", salesOrderId: "so-1", companySOId: "SO-2610-021", deliveryOrderId: "do-1", doNo: "DO-2610-031" }, null);
  assert.deepEqual(full.map((x) => [x.label, x.doc, x.href ?? null]), [
    ["Sales Order", "SO-2610-021", "/m/sales/so-1"],
    ["Delivery Order", "DO-2610-031", "/m/delivery/do-1"],
    ["Sales Invoice", "INV-1", null],
  ]);
  const noDoId = relatedChain({ invoiceNo: "INV-2", doNo: "DO-9" }, null);
  assert.equal(noDoId[0].href, undefined, "no deliveryOrderId → no link");
  const fromCn = relatedChain({ invoiceNo: "INV-3" }, { id: "cn-1", noteNumber: "CSN-0001" });
  assert.deepEqual(fromCn.map((x) => x.label), ["Consignment Note", "Sales Invoice"]);
  assert.equal(fromCn[0].href, undefined);
});

test("adjustments: real notes; issued total only when a note is issued", () => {
  const none = adjustments({ linkedCreditNotes: [], linkedDebitNotes: [] }, 100000);
  assert.deepEqual(none, { rows: [], issuedSen: null });
  const draftOnly = adjustments({ linkedCreditNotes: [{ id: "c", noteNumber: "CN-1", status: "DRAFT", totalAmount: 5000, reason: "OTHER", date: "2026-10-15" }] }, 100000);
  assert.equal(draftOnly.issuedSen, null, "a draft note is not issued");
  assert.equal(draftOnly.rows[0].sub, "Credit note · Other · 15 Oct 2026");
  const issued = adjustments({
    linkedCreditNotes: [{ id: "c", noteNumber: "CN-2", status: "POSTED", totalAmount: 378000 }],
    linkedDebitNotes: [{ id: "d", noteNumber: "DN-1", status: "POSTED", totalAmount: 35000 }],
  }, 1755000);
  // desktop invoiceIssuedSen: total + credit − debit
  assert.equal(issued.issuedSen, 1755000 + 378000 - 35000);
  assert.deepEqual(issued.rows.map((r) => r.kind), ["CN", "DN"]);
});

test("audit lines come from real before/after values", () => {
  const lines = auditLines([
    { id: "e1", action: "post", actorUserName: "Aina", ts: "2026-10-14T08:20:00Z", before: { status: "DRAFT" }, after: { status: "SENT" } },
    { id: "e2", action: "update", actorUserName: null, ts: "2026-10-15T01:00:00Z", before: { paidAmount: 0 }, after: { paidAmount: 150000 } },
    { id: "e3", action: "create", ts: "2026-10-14T07:02:00Z", before: null, after: null },
  ]);
  assert.deepEqual(nb(lines.map((l) => [l.title, l.detail, l.actor])), [
    ["Posted", "Status: Draft → Sent", "Aina"],
    ["Updated", "Paid: RM 0.00 → RM 1,500.00", "—"],
    ["Created", "", "—"],
  ]);
  assert.deepEqual(auditLines(null), []);
});

// ---------------------------------------------------------------------------
// Two tabs (two-tab handoff, owner 2026-10-22): Invoices · AR Aging.
// ---------------------------------------------------------------------------
test("both tabs need invoices:read — the permission their routes check", () => {
  assert.deepEqual(TAB_READ_RESOURCE, { invoices: "invoices", aging: "invoices" });
  const inv = readFileSync(new URL("../src/api/routes/invoices.ts", import.meta.url), "utf8");
  const agingHandler = inv.slice(inv.indexOf('app.get("/aging"'), inv.indexOf('app.get("/aging"') + 300);
  assert.match(agingHandler, /requirePermission\(c, "invoices", "read"\)/);
});

test("hidden tabs, kept selection, removed-tab fallback, 403 detection", () => {
  const tabs = [{ key: "invoices" }, { key: "aging" }];
  const grant = (set) => (res) => set.includes(res);
  assert.deepEqual(allowedTabs(tabs, grant(["invoices"])).map((t) => t.key), ["invoices", "aging"]);
  assert.deepEqual(allowedTabs(tabs, grant(["payments"])), [], "no invoices:read → no tab");
  const allowed = allowedTabs(tabs, grant(["invoices"]));
  assert.equal(pickTab(allowed, "aging").key, "aging", "the selected tab is kept when allowed");
  for (const old of ["payments", "supplier_pay", "credit_notes", "debit_notes", "e_invoice", "nonsense"]) {
    assert.equal(pickTab(allowed, old).key, "invoices", `old ?tab=${old} falls back to Invoices`);
  }
  assert.equal(pickTab([], "invoices"), null);
  assert.equal(isForbidden({ status: 403 }), true);
  assert.equal(isForbidden({ status: 500 }), false);
  assert.equal(isForbidden(null), false);
});

// ---------------------------------------------------------------------------
// AR Aging — GET /api/invoices/aging rows (SEN, server buckets).
// ---------------------------------------------------------------------------
const AGING_RESP = {
  success: true,
  data: [
    { customerName: "Mewah Home Living Sdn Bhd", current: 4356000, days31_60: 0, days61_90: 0, days90plus: 0, total: 4356000 },
    { customerName: "Kian Furniture Gallery", current: 0, days31_60: 1333000, days61_90: 0, days90plus: 0, total: 1333000 },
    { customerName: "Kian Furniture Gallery", current: 100, days31_60: 0, days61_90: 0, days90plus: 900, total: 1000 },
  ],
};

test("aging: rows used only when success && Array.isArray(data); error ≠ empty", () => {
  const ok = agingList(AGING_RESP);
  assert.equal(ok.ok, true);
  assert.equal(ok.rows.length, 3);
  assert.deepEqual(agingList({ success: true, data: [] }), { rows: [], ok: true }, "genuinely empty");
  for (const bad of [null, { success: false, error: "x" }, { success: true }, { data: "nope" }, "text"]) {
    assert.equal(agingList(bad).ok, false, `not data: ${JSON.stringify(bad)}`);
  }
});

test("aging: customerName is not a unique key", () => {
  const keys = agingList(AGING_RESP).rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, "two rows with the same name get distinct keys");
});

test("aging: totals are the sum of the returned rows, in sen, never re-bucketed", () => {
  const t = agingTotals(agingList(AGING_RESP).rows);
  assert.deepEqual(t, { current: 4356100, days31_60: 1333000, days61_90: 0, days90plus: 900, total: 5690000, count: 3 });
  // Buckets are taken as given: a row whose total is not the sum of its buckets is NOT corrected.
  const odd = agingTotals(agingList({ success: true, data: [{ customerName: "X", current: 1, total: 99 }] }).rows);
  assert.equal(odd.total, 99);
});

test("aging: exact bucket labels, oldest bucket, en dash for zero, segments", () => {
  assert.deepEqual(AGING_BUCKETS.map((b) => b.label), ["Current (0-30)", "31-60 Days", "61-90 Days", "90+ Days"]);
  const rows = agingList(AGING_RESP).rows;
  assert.equal(oldestBucket(rows[0]), "current");
  assert.equal(oldestLabel(oldestBucket(rows[0])), "Current (0-30)");
  assert.equal(oldestLabel(oldestBucket(rows[1])), "Oldest · 31-60 Days");
  assert.equal(oldestLabel(oldestBucket(rows[2])), "Oldest · 90+ Days");
  assert.equal(oldestLabel(null), "No balance");
  assert.equal(agingAmount(0), "–");
  assert.equal(nb(agingAmount(999999999)), "RM 9,999,999.99", "large amounts are formatted, never truncated by the helper");
  assert.deepEqual(agingSegments(rows[2]).map((g) => [g.key, g.sen]), [["current", 100], ["days90plus", 900]]);
});

test("aging: customer search filters loaded rows by name only", () => {
  const rows = agingList(AGING_RESP).rows;
  assert.deepEqual(filterAging(rows, "kian").map((r) => r.total), [1333000, 1000]);
  assert.equal(filterAging(rows, "  ").length, 3);
  assert.equal(filterAging(rows, "zzz").length, 0);
});

test("aging bucket colours: exact handoff hex (light) + a dark value for every token", () => {
  const css = readFileSync(new URL("../src/pages/m/theme-vars.css", import.meta.url), "utf8");
  for (const [tok, hex] of [["current", "#4F7C3A"], ["d31", "#9C6F1E"], ["d61", "#B8601A"], ["d90", "#9A3A2D"]]) {
    assert.match(css, new RegExp(`--m-age-${tok}: ${hex};`));
    assert.equal((css.match(new RegExp(`--m-age-${tok}:`, "g")) || []).length, 2, `${tok}: light + dark`);
    assert.equal((css.match(new RegExp(`--m-age-${tok}-fg:`, "g")) || []).length, 2);
  }
  assert.match(css, /--m-age-d31-fg: #85600F;/, "31-60 pill text #85600F (handoff)");
  assert.match(css, /--m-age-d61-bg: #FBE9DA;/);
});

// ---------------------------------------------------------------------------
// Source guards — wiring the build cannot check.
// ---------------------------------------------------------------------------
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the list never writes: no status change, no mutation", () => {
  const src = read("src/pages/m/screens/invoices/InvoicesScreen.tsx") + read("src/pages/m/lib/invoices-mobile.ts");
  assert.doesNotMatch(src, /method:\s*["'](PUT|POST|PATCH|DELETE)["']/);
  assert.doesNotMatch(src, /mutateJson/);
});

test("Invoices list + detail are dedicated screens; the line route keeps its generic pair (D4)", () => {
  const layout = read("src/pages/m/MobileLayout.tsx");
  assert.match(layout, /CUSTOM_L1[\s\S]*?\binvoices:\s*InvoicesRoute/);
  const l2 = layout.slice(layout.indexOf("const CUSTOM_L2"));
  assert.match(l2.slice(0, l2.indexOf("};")), /\binvoices:\s*InvoiceDetailRoute/);
  // /:id/item/:itemId still uses LineItemDetailScreen (line attachments).
  assert.match(layout, /<LineItemDetailScreen config=\{cfg\} \/>/);
  // Tablet line route: invoices (only) put the dedicated detail in the left pane.
  assert.match(layout, /left=\{cfg\.slug === "invoices" && CustomL2 \? <CustomL2 \/> : <DocumentDetailScreen config=\{cfg\} \/>\}/);
  // …where its Record Payment dock stays over the left (list-width) pane.
  const detail = read("src/pages/m/screens/invoices/InvoiceDetailScreen.tsx");
  assert.match(detail, /const \{ id = "", itemId \} = useParams\(\)/);
  assert.match(detail, /inLinePane \? "list" : "detail"/);
});

test("list: two-tab switch, permission-gated, each tab fetches only while active, 403 is 'no access'", () => {
  const src = read("src/pages/m/screens/invoices/InvoicesScreen.tsx");
  assert.match(src, /allowedTabs\(TABS, \(resource\) => hasPermission\(resource, "read"\)\)/);
  assert.match(src, /<ModuleSwitch tabs=\{allowed\}/);
  assert.match(src, /allowed\.length > 1 \? <ModuleSwitch/, "the switch shows only with two tabs");
  assert.match(src, /useCachedJson<unknown>\(isInv \? INVOICE_SOURCE\.url : null\)/);
  assert.match(src, /useCachedJson<unknown>\(agingOk && isAging \? AGING_URL : null\)/, "aging fetched only while allowed AND active");
  assert.equal(src.match(/"\/api\/invoices\/aging"/g)?.length, 1);
  assert.doesNotMatch(src, /accounting\/aging/, "not the Receivables endpoint");
  assert.match(src, /permLoading \? \(\s*<SkeletonCards/, "loading permissions waits — not a denial");
  assert.match(src, /const forbidden = !hasData && isForbidden\(active\.failure\)/);
  assert.match(src, /isAging && hasData && !aging\?\.ok/, "a bad aging envelope is an error, not 'no outstanding invoices'");
  // Tab switch resets search + chip (+ past-due) and closes the sheet.
  const goTab = src.slice(src.indexOf("const goTab"), src.indexOf("const goChip"));
  assert.match(goTab, /status: null, due: null/);
  assert.match(goTab, /setQ\(""\)/);
  // AR Aging: customer filter only — no Scan QR, no Filter & sort, no status chips.
  assert.match(src, /<SearchPill q=\{q\} setQ=\{setQ\} placeholder="Filter by customer" \/>/);
  assert.match(src, /\{isInv && !forbidden \? \(\s*<>\s*<StatusChips/);
  // The five former tabs are gone from the UI; their sources stay for global search.
  assert.doesNotMatch(src, /RECORD_CARD|RecordCardView|"Payments"|"Supplier Pay"/);
  const modules = read("src/pages/m/config/modules.ts");
  const cfg = modules.slice(modules.indexOf("export const invoicesConfig"));
  assert.match(cfg.slice(0, cfg.indexOf("};")), /invoicesSource,\s*paymentsSource,\s*supplierPaySource,\s*creditNotesSource,\s*debitNotesSource,\s*eInvoiceSource,/);
});

test("AR Aging access: one rule — invoices:read AND (backend id-scoped OR '*' confirmed by users.role)", () => {
  const base = { canRead: true, wildcard: true, accountRole: "SUPER_ADMIN", serverScoped: false };
  assert.equal(canUseArAging(base), true, "Super Admin, confirmed twice");
  assert.equal(canUseArAging({ ...base, accountRole: "admin" }), true, "Admin is unrestricted too (case-insensitive)");
  assert.equal(canUseArAging({ ...base, accountRole: null }), false, "'*' alone is not trusted (roleId drift)");
  assert.equal(canUseArAging({ ...base, accountRole: "SALES" }), false, "'*' from a stale roleId, users.role SALES → hidden");
  assert.equal(canUseArAging({ ...base, wildcard: false }), false, "users.role alone is not enough either");
  assert.equal(canUseArAging({ ...base, accountRole: "FINANCE", wildcard: false }), false, "unscoped non-admin roles wait for the backend fix");
  assert.equal(canUseArAging({ ...base, canRead: false }), false, "no invoices:read → never");
  assert.equal(canUseArAging({ canRead: true, wildcard: false, accountRole: null, serverScoped: true }), true, "after the backend fix: invoices:read is enough");
  assert.equal(canUseArAging({ canRead: false, wildcard: false, accountRole: null, serverScoped: true }), false);
  // The unrestricted list must never overlap the backend's scoped roles.
  const scope = read("src/api/lib/customer-scope.ts");
  const scoped = [...scope.match(/SCOPED_ROLES = new Set\(\[([^\]]*)\]\)/)[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(scoped.length > 0);
  for (const r of scoped) assert.equal(UNRESTRICTED_ROLES.has(r), false, `${r} is scoped by the backend`);
  assert.equal(AGING_SERVER_SCOPED, false, "flips only after BUG-2026-10-22-349 is fixed and verified on prod");
});

test("AR Aging access by role: SUPER_ADMIN / ADMIN only; SALES and every other role hidden", () => {
  const ok = (role, extra = {}) => canUseArAging({ canRead: true, wildcard: true, accountRole: role, serverScoped: false, ...extra });
  assert.equal(ok("SUPER_ADMIN"), true);
  assert.equal(ok("ADMIN"), true);
  assert.equal(ok("SALES"), false, "SALES is customer-scoped by the backend");
  for (const r of ["FINANCE", "OFFICE", "PRODUCTION", "WAREHOUSE", "HR", "READ_ONLY", "MANAGER", ""]) {
    assert.equal(ok(r), false, `${r || "(blank)"} stays hidden until BUG-2026-10-22-349`);
    assert.equal(ok(r, { wildcard: false }), false);
  }
  // Missing permissions: no invoices:read (or permissions still loading → the screen passes false).
  assert.equal(ok("SUPER_ADMIN", { canRead: false }), false);
  assert.equal(ok("SUPER_ADMIN", { canRead: false, wildcard: false }), false);
  // Role not confirmed (loading / 401 / 5xx / network / bad body → null).
  assert.equal(ok(null), false);
});

test("summary tile: 'PAST DUE' label, amount only (count kept for a11y + filter)", () => {
  const parts = read("src/pages/m/screens/invoices/parts.tsx");
  const card = parts.slice(parts.indexOf("export function SummaryCard"));
  assert.match(card, />\s*PAST DUE\s*</);
  assert.doesNotMatch(card, /PAST DUE OUTSTANDING/);
  assert.doesNotMatch(card, /·\s*\{sum\.pastDueCount\}/, "no visible count under the amount");
  assert.match(card, /aria-label=\{`Past Due\$\{ready && sum \? `: \$\{money\(sum\.pastDueSen\)\}, \$\{sum\.pastDueCount\} invoice/);
  // The separate Past Due filter chip keeps its label.
  assert.match(parts, /aria-label="Remove Past Due filter"/);
});

test("search bar: Invoices keeps Scan QR, Filter & sort is gone; list stays newest-first", () => {
  const src = read("src/pages/m/screens/invoices/InvoicesScreen.tsx");
  const parts = read("src/pages/m/screens/invoices/parts.tsx");
  assert.match(src, /placeholder="Search invoice, customer, DO, SO"\s*onScan=\{\(\) => setScanOpen\(true\)\}\s*\/>/);
  assert.match(src, /<ScanSheet/);
  assert.doesNotMatch(src, /FilterSheet|onFilter|filterCount|applyFilters|setFilterOpen/);
  assert.doesNotMatch(parts, /onFilter|filterCount|SlidersHorizontal|Filter and sort/);
  assert.match(src, /const sort = INVOICE_DEFAULT_SORT;/);
  assert.match(src, /const INVOICE_DEFAULT_SORT: Sort = \{ key: "invoiceDate", dir: "desc" \};/);
});

test("meRole: only a successful /api/auth/me user body confirms a role", () => {
  assert.equal(meRole({ success: true, data: { user: { id: "u1", role: "SUPER_ADMIN" } } }), "SUPER_ADMIN");
  assert.equal(meRole({ success: true, data: { user: { role: " admin " } } }), "ADMIN");
  assert.equal(meRole({ success: true, data: { user: { role: "SALES" } } }), "SALES");
  for (const bad of [null, undefined, "x", {}, { success: false, error: "Unauthorized" }, { success: false, data: { user: { role: "SUPER_ADMIN" } } },
    { success: true }, { success: true, data: {} }, { success: true, data: { user: {} } }, { success: true, data: { user: { role: "" } } },
    { success: true, data: { user: { role: 1 } } }]) {
    assert.equal(meRole(bad), null, JSON.stringify(bad));
  }
  // The body shape it reads is the one auth.ts actually returns.
  const auth = read("src/api/routes/auth.ts");
  assert.match(auth, /return c\.json\(\{ success: true, data: \{ user: publicUser\(user\) \} \}\)/);
  assert.match(auth.slice(auth.indexOf("function publicUser")), /role: u\.role,/);
});

test("AR Aging security condition: fresh users.role read, no aging request unless allowed; no sample data shipped", () => {
  const src = read("src/pages/m/screens/invoices/InvoicesScreen.tsx");
  // users.role is read fresh: plain fetch, no-store, never the SWR cache or the stored login blob.
  const hook = src.slice(src.indexOf("function useVerifiedAccountRole"), src.indexOf("export function InvoicesScreen"));
  assert.match(hook, /fetch\(ME_URL, \{ cache: "no-store"/);
  assert.match(hook, /res\.ok \? res\.json\(\) : null/, "a 401 / 5xx confirms nothing");
  assert.match(hook, /\.catch\(\(\) => \{ if \(!ctrl\.signal\.aborted\) setRole\(null\); \}\)/, "a network error confirms nothing");
  assert.doesNotMatch(hook, /useCachedJson/);
  assert.match(src, /const ME_URL = "\/api\/auth\/me";/);
  assert.doesNotMatch(src, /AR_AGING_LIVE|getCurrentUser/, "no old flag; no browser-stored role");
  // Permissions must have loaded; the rule gets the fresh role.
  assert.match(src, /canRead: !permLoading && hasPermission\("invoices", "read"\)/);
  assert.match(src, /wildcard: !permLoading && permissions\.has\("\*"\)/);
  assert.match(src, /accountRole,\s*serverScoped: AGING_SERVER_SCOPED/);
  assert.match(src, /const TABS = agingOk \? ALL_TABS : NO_AGING_TABS;/);
  // No /api/invoices/aging request when access is denied: the ONLY aging fetch is gated on agingOk.
  assert.equal(src.match(/AGING_URL/g)?.length, 2, "declared once, used once");
  assert.match(src, /useCachedJson<unknown>\(agingOk && isAging \? AGING_URL : null\)/);
  const parts = read("src/pages/m/screens/invoices/aging-parts.tsx");
  assert.doesNotMatch(parts + src, /sample data|Mewah|Kian|Desa Interior/, "no prototype rows or footer");
  assert.match(parts, /<Sheet open=\{row != null\} onClose=\{onClose\}[^>]*bare>/, "the shared Sheet (Esc, scrim, focus trap)");
  // Long names: 2-line clamp with break-word; big money: wraps, never ellipsized.
  assert.match(parts, /WebkitLineClamp: 2/);
  assert.doesNotMatch(parts, /textOverflow/);
});

test("money is never ellipsized on the summary, overview or record cards (owner Q1–Q3)", () => {
  const parts = read("src/pages/m/screens/invoices/parts.tsx");
  const summary = parts.slice(parts.indexOf("export function SummaryCard"), parts.indexOf("export function InvoiceCard"));
  assert.doesNotMatch(summary, /textOverflow/, "summary card: no ellipsis anywhere");
  assert.match(summary, /repeat\(auto-fit, minmax\(140px, 1fr\)\)/);
  const card = parts.slice(parts.indexOf("export function InvoiceCard"), parts.indexOf("export function InvPill"));
  const payRow = card.slice(card.indexOf("Wraps onto two lines"), card.indexOf("% of"));
  assert.match(payRow, /flexWrap: "wrap"/);
  const parts2 = read("src/pages/m/screens/invoices/detail-parts.tsx");
  const tile = parts2.slice(parts2.indexOf("export function MoneyTile"), parts2.indexOf("export function IconFact"));
  assert.doesNotMatch(tile, /textOverflow/);
  const detail = read("src/pages/m/screens/invoices/InvoiceDetailScreen.tsx");
  assert.match(detail, /repeat\(auto-fit, minmax\(140px, 1fr\)\)/);
  assert.match(parts2, /var\(--m-inv-dot-ring\)/);
  const css = read("src/pages/m/theme-vars.css");
  assert.equal((css.match(/--m-inv-dot-ring:/g) || []).length, 2, "light + dark");
});

test("generic DocumentDetailScreen carries no invoice PDF plumbing; shared maps untouched", () => {
  const generic = read("src/pages/m/screens/DocumentDetailScreen.tsx");
  assert.doesNotMatch(generic, /DocPdfCard|eff\.pdf|InvoicePdf/);
  assert.doesNotMatch(read("src/pages/m/config/types.ts"), /DetailPdf|pdf\?:/);
  const modules = read("src/pages/m/config/modules.ts");
  assert.doesNotMatch(modules, /\bpdf:\s*\{/);
  const detail = modules.slice(modules.indexOf("const invoiceDetail"), modules.indexOf("export const invoicesConfig"));
  assert.match(detail, /getStatusColor/, "invoice-only desktop colours (generic pair on the tablet line route)");
  assert.match(detail, /primaryCta: \(d\) => \(PAYABLE_STATUSES\.has\(/, "the generic pane offers Record Payment only on payable statuses (D2)");
  // The shared map itself is untouched (other modules rely on it).
  const helpers = read("src/pages/m/config/helpers.ts");
  assert.match(helpers, /OVERDUE: DANGER,/);
  assert.doesNotMatch(helpers, /PARTIAL_PAID/);
});

test("Invoice Detail: Record Payment guarded in the button AND the handler; PDF card gated; no demo data", () => {
  const src = read("src/pages/m/screens/invoices/InvoiceDetailScreen.tsx");
  assert.match(src, /const payable = canRecordPayment\(st, canUpdate\)/);
  const handler = src.slice(src.indexOf("const startPayment"), src.indexOf("const startEdit"));
  assert.match(handler, /canRecordPayment\(statusOf\(doc\), canUpdate\)/, "the handler re-checks eligibility");
  assert.match(handler, /recordPaymentSpec\(doc, id\)/, "the existing payment form + API");
  assert.match(src, /hasPermission\("invoices", "update"\)/);
  assert.match(src, /canRead \? \(\s*<InvoicePdfCard/);
  assert.match(src, /editSpec = canUpdate \?/, "Edit only with invoices:update");
  assert.doesNotMatch(src, /Illustrative sample data|desktop-only|runs in the desktop app/);
  // Only a 404 may say "not found" (class C15).
  assert.match(src, /failure\?\.kind === "notFound"/);
});

test("Invoice PDF: window pre-opened in the tap, closed on every failure, read-only", () => {
  const pdf = read("src/pages/m/lib/invoice-pdf.ts");
  // Opened before the first await.
  const open = pdf.indexOf('window.open("", "_blank")');
  assert.ok(open > 0);
  assert.ok(open < pdf.indexOf("await"), "window.open must run before any await");
  assert.match(pdf, /\.close\(\)/);
  assert.match(pdf, /print-extras/);
  assert.match(pdf, /viewUnifiedInvoicePdf/);
  assert.match(pdf, /downloadUnifiedInvoicePdf/);
  assert.doesNotMatch(pdf, /method:\s*["'](PUT|POST|PATCH|DELETE)["']/);
});
