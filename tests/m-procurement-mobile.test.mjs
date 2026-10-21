// m-procurement-mobile.test.mjs — the rules behind /m/procurement
// (src/pages/m/lib/procurement-mobile.ts). Each rule is a copy of desktop
// behaviour, so every block asserts the mobile answer AND that the desktop /
// server source still says the same thing. Spec: docs/mobile/PROCUREMENT-MOBILE.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SECTIONS, visibleSections, PO_STATUS, GRN_STATUS, PI_STATUS, normalizePiStatus, statusOf, CHIPS, chipMatches,
  matchesQuery, poOutstanding, poExpectedLate, grnIsFull, piPastDue, PO_FLOW, GRN_FLOW, PI_FLOW, flowSteps, piFlowStatus,
  poActions, PO_ACTION_PERMS, poAdvanceBody, RECEIVED_GATE_ERROR, cancelReasonError, CANCEL_REASON_ERROR, poCancelBody,
  PARTIAL_CANCEL_WARNING, poCreateError, poEditError, poCreateBody, poLowStockBody, splitBodies, splitResultToast, poEditBody,
  materialPickerRows, lineFromBinding, lowStockRms, lowStockLines, supplierLabel, grnReceiveBody, RECEIVED_BY_ERROR,
  RECEIVE_QTY_ERROR, receiveRemaining, grnActions, GRN_POST_NEEDS_ARRIVAL, grnCancelLines, landedCost, canVoidRole, piActions,
  markPaidBody, piCreateError, piMismatchError, grnImportCandidates, poImportCandidates, importLines, poDeepLinkLines,
  grnDeepLinkLines, mergeImport, piCreateBody, piEditError, piEditLines, piEditTotals, piEditBody, piEditNeedsConfirm,
} from "../src/pages/m/lib/procurement-mobile.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const PO_API = read("src/api/routes/purchase-orders.ts");
const GRN_API = read("src/api/routes/grn.ts");
const PI_API = read("src/api/routes/purchase-invoices.ts");
const PO_LIST = read("src/pages/procurement/index.tsx");
const PO_CREATE = read("src/pages/procurement/create.tsx");
const PO_DETAIL = read("src/pages/procurement/detail.tsx");
const GRN_LIST = read("src/pages/procurement/grn.tsx");
const GRN_CREATE = read("src/pages/procurement/grn/create.tsx");
const GRN_DETAIL = read("src/pages/procurement/grn-detail.tsx");
const PI_LIST = read("src/pages/procurement/pi.tsx");
const PI_CREATE = read("src/pages/procurement/pi/create.tsx");
const PI_DETAIL = read("src/pages/procurement/PurchaseInvoiceDetail.tsx");
const CONVERT = read("src/components/convert-to-pi-modal.tsx");
const RECEIVE_SHEET = read("src/pages/m/components/GrnReceiveSheet.tsx");

const po = (status, items = [], extra = {}) => ({ id: "po-1", poNo: "PO-1", status, items, notes: "", ...extra });
const item = (quantity, receivedQty = 0, extra = {}) => ({ id: `it-${quantity}-${receivedQty}`, quantity, receivedQty, ...extra });

test("sections, their read permission, and the switch hiding with one segment", () => {
  assert.deepEqual(SECTIONS.map((x) => [x.key, x.label, x.resource]), [
    ["po", "Orders", "purchase-orders"],
    ["grn", "Receipts", "grn"],
    ["pi", "Invoices", "purchase-invoices"],
  ]);
  assert.match(PO_API, /requirePermission\(c, "purchase-orders", "read"\)/);
  assert.match(GRN_API, /requirePermission\(c, "grn", "read"\)/);
  assert.match(PI_API, /requirePermission\(c, "purchase-invoices", "create"\)/);
  assert.deepEqual(visibleSections(() => true), ["po", "grn", "pi"]);
  assert.deepEqual(visibleSections((r) => r === "grn"), ["grn"]);
  assert.deepEqual(visibleSections(() => false), []);
});

test("PO statuses + timeline are the server's transitions and desktop STATUS_STEPS", () => {
  for (const st of ["DRAFT", "SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]) {
    assert.ok(PO_STATUS[st], st);
    assert.ok(PO_API.includes(`${st}:`) || PO_API.includes(`"${st}"`), st);
  }
  assert.deepEqual(PO_FLOW.map(([, l]) => l), ["Draft", "Sent", "Confirmed", "Partially Received", "Fully Received", "Closed"]);
  for (const [, l] of PO_FLOW) assert.ok(PO_DETAIL.includes(`"${l}"`), l);
  assert.deepEqual(flowSteps(PO_FLOW, "CONFIRMED").map((x) => x.state), ["done", "done", "current", "pending", "pending", "pending"]);
  assert.deepEqual(flowSteps(PO_FLOW, "CANCELLED").map((x) => x.state), Array(6).fill("pending"));
});

test("GRN statuses: CONFIRMED is shown as Approved; QC Pending filters qcStatus", () => {
  assert.equal(GRN_STATUS.CONFIRMED.label, "Approved");
  assert.match(GRN_LIST, /label: "Approved"/);
  assert.match(GRN_LIST, /label: "QC Pending"/);
  assert.deepEqual(GRN_FLOW.map(([k]) => k), ["DRAFT", "CONFIRMED", "POSTED"]);
  assert.equal(chipMatches("grn", "QC_PENDING", { status: "POSTED", qcStatus: "PENDING" }), true);
  assert.equal(chipMatches("grn", "QC_PENDING", { status: "DRAFT", qcStatus: "PASSED" }), false);
  assert.equal(chipMatches("grn", "CONFIRMED", { status: "CONFIRMED" }), true);
});

test("PI statuses: legacy PENDING_APPROVAL / APPROVED read as Confirmed; Partial Paid shown", () => {
  assert.match(PI_DETAIL, /if \(s === "PENDING_APPROVAL" \|\| s === "APPROVED"\) return "CONFIRMED";/);
  assert.equal(normalizePiStatus("APPROVED"), "CONFIRMED");
  assert.equal(statusOf("pi", "PENDING_APPROVAL").label, "Confirmed");
  assert.equal(PI_STATUS.PARTIAL_PAID.label, "Partial Paid");
  assert.equal(chipMatches("pi", "CONFIRMED", { status: "APPROVED" }), true);
  assert.equal(piFlowStatus("PARTIAL_PAID"), "CONFIRMED");
  assert.deepEqual(PI_FLOW.map(([k]) => k), ["DRAFT", "CONFIRMED", "PAID"]);
  // DRAFT → CONFIRMED → PAID is the server's lifecycle.
  assert.match(PI_API, /DRAFT: \["CONFIRMED"\]/);
  assert.match(PI_API, /CONFIRMED: \["PAID"\]/);
});

test("chips: desktop status filters, PO adds Closed (owner 2026-10-21)", () => {
  assert.deepEqual(CHIPS.po.map((c) => c.key), ["", "DRAFT", "SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]);
  assert.deepEqual(CHIPS.grn.map((c) => c.label), ["All", "Draft", "QC Pending", "Approved", "Posted"]);
  assert.deepEqual(CHIPS.pi.map((c) => c.label), ["All", "Draft", "Confirmed", "Paid", "Cancelled"]);
  assert.equal(chipMatches("po", "CLOSED", { status: "CLOSED" }), true);
  assert.equal(chipMatches("po", "", { status: "CLOSED" }), true);
});

test("lists fetch every row when no page/limit is sent (so chips never miss a page)", () => {
  assert.match(PO_API, /const paginate = pageParam !== undefined \|\| limitParam !== undefined;/);
  assert.match(GRN_API, /const paginate = pageParam !== undefined \|\| limitParam !== undefined;/);
});

test("search: PO matches line items (desktop itemsSearchText); GRN / PI match their refs", () => {
  const p = po("CONFIRMED", [{ materialCode: "FAB-1", supplierSKU: "SKU-9", materialName: "Velvet" }], { supplierName: "Kain" });
  assert.equal(matchesQuery("po", p, "sku-9"), true);
  assert.equal(matchesQuery("po", p, "velvet"), true);
  assert.equal(matchesQuery("po", p, "zzz"), false);
  assert.equal(matchesQuery("grn", { grnNumber: "GRN-1", supplier_do_no: "DO-77" }, "do-77"), true);
  assert.equal(matchesQuery("pi", { piNo: "PI-1", supplierInvoiceNo: "INV-5" }, "inv-5"), true);
});

test("PO card numbers: outstanding (desktop list), late expected date", () => {
  assert.equal(poOutstanding(po("CONFIRMED", [item(10, 4), item(5, 9)])), 6);
  assert.equal(poOutstanding(po("RECEIVED", [item(10, 4)])), null);
  assert.equal(poExpectedLate(po("CONFIRMED", [], { expectedDate: "2026-10-01" }), "2026-10-21"), true);
  assert.equal(poExpectedLate(po("RECEIVED", [], { expectedDate: "2026-10-01" }), "2026-10-21"), false);
  assert.equal(grnIsFull({ items: [{ orderedQty: 5, receivedQty: 5 }] }), true);
  assert.equal(grnIsFull({ items: [{ orderedQty: 5, receivedQty: 3 }] }), false);
  assert.equal(piPastDue({ status: "CONFIRMED", dueDate: "2026-10-01" }, "2026-10-21"), true);
  assert.equal(piPastDue({ status: "PAID", dueDate: "2026-10-01" }, "2026-10-21"), false);
});

test("PO actions per status match detail.tsx", () => {
  assert.match(PO_DETAIL, /const canEmail = \["SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED", "RECEIVED"\]/);
  assert.match(PO_DETAIL, /const canCancelWithReason = \["SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED"\]/);
  assert.match(PO_DETAIL, /const canPrintGRN = \["PARTIAL_RECEIVED", "RECEIVED"\]/);
  assert.match(PO_DETAIL, /relatedGrns\.some\(\(g\) => g\.status === "POSTED" \|\| g\.status === "CONFIRMED"\)/);

  const draft = poActions(po("DRAFT", [item(5)]), [], []);
  assert.equal(draft.primary, "EDIT");
  assert.ok(draft.menu.includes("DELETE"));
  assert.ok(!draft.menu.includes("CANCEL") && !draft.menu.includes("EMAIL") && !draft.menu.includes("CREATE_INVOICE"));

  const sub = poActions(po("SUBMITTED", [item(5)]), [], []);
  assert.equal(sub.primary, "MARK_CONFIRMED");
  assert.equal(sub.secondary, "EDIT");
  assert.ok(sub.menu.includes("CANCEL") && sub.menu.includes("EMAIL") && sub.menu.includes("CREATE_INVOICE"));

  const conf = poActions(po("CONFIRMED", [item(5)]), [], []);
  assert.deepEqual([conf.primary, conf.secondary], ["CREATE_GRN", "MARK_PARTIAL"]);
  const confPosted = poActions(po("CONFIRMED", [item(5, 2)]), [{ status: "POSTED" }], []);
  assert.deepEqual([confPosted.primary, confPosted.secondary], ["RECEIVE_GOODS", "MARK_RECEIVED"]);
  assert.ok(confPosted.menu.includes("MARK_PARTIAL"));
  assert.ok(!confPosted.menu.includes("EDIT"), "locked once anything is received");

  const partial = poActions(po("PARTIAL_RECEIVED", [item(5, 2)]), [], []);
  assert.equal(partial.primary, "CREATE_GRN");
  assert.equal(partial.secondary, null, "no Fully Received without a posted GRN");
  assert.ok(partial.menu.includes("PRINT_GRN") && partial.menu.includes("CANCEL"));

  assert.equal(poActions(po("RECEIVED", [item(5, 5)]), [{ status: "POSTED" }], []).primary, "CLOSE");
  const closed = poActions(po("CLOSED", [item(5, 5)]), [], []);
  assert.equal(closed.primary, null);
  assert.ok(!closed.menu.includes("EMAIL"));
  assert.deepEqual(poActions(po("CANCELLED"), [], []).menu, ["PDF"]);
  assert.equal(poActions(po("CONFIRMED"), [], [{ status: "DRAFT" }]).invoiced, true);
  assert.equal(poActions(po("CONFIRMED"), [], [{ status: "CANCELLED" }]).invoiced, false);
});

test("PO action gates are the server's (approve / receive extras)", () => {
  assert.match(PO_API, /requirePermission\(c, "purchase-orders", "approve"\)/);
  assert.match(PO_API, /requirePermission\(c, "purchase-orders", "receive"\)/);
  assert.deepEqual(PO_ACTION_PERMS.MARK_CONFIRMED, [["purchase-orders", "update"], ["purchase-orders", "approve"]]);
  assert.deepEqual(PO_ACTION_PERMS.MARK_RECEIVED, [["purchase-orders", "update"], ["purchase-orders", "receive"]]);
  assert.deepEqual(PO_ACTION_PERMS.DELETE, [["purchase-orders", "delete"]]);
});

test("PO transitions: received date, the GRN gate, cancel reason + note", () => {
  assert.deepEqual(poAdvanceBody("RECEIVED", "2026-10-21"), { status: "RECEIVED", receivedDate: "2026-10-21" });
  assert.deepEqual(poAdvanceBody("CLOSED", "2026-10-21"), { status: "CLOSED" });
  assert.ok(PO_DETAIL.includes(RECEIVED_GATE_ERROR));
  assert.ok(PO_DETAIL.includes(CANCEL_REASON_ERROR));
  assert.equal(cancelReasonError("short"), CANCEL_REASON_ERROR);
  assert.equal(cancelReasonError("supplier discontinued"), null);
  assert.deepEqual(poCancelBody("", "supplier discontinued", "2026-10-21"), { status: "CANCELLED", notes: "[CANCELLED 2026-10-21: supplier discontinued]" });
  assert.equal(poCancelBody("Q4 run", "supplier gone away", "2026-10-21").notes, "Q4 run\n[CANCELLED 2026-10-21: supplier gone away]");
  assert.match(PO_DETAIL, /\[CANCELLED \$\{today\}: \$\{reason\}\]/);
  assert.ok(PO_DETAIL.includes(PARTIAL_CANCEL_WARNING.split(" Run")[0]));
});

const line = (supplierId, extra = {}) => ({
  rmId: "rm", rmCode: "FAB-1", rmDescription: "Velvet", supplierId, supplierName: supplierId ? `S - ${supplierId}` : "", supplierSku: "SKU",
  quantity: 10, unitPriceSen: 2850, unit: "m", moq: 10, materialCategory: "FABRIC", ...extra,
});

test("PO create checks run in desktop order, with desktop's words", () => {
  assert.equal(poCreateError([]), "Add at least one item");
  assert.equal(poCreateError([line("")]), "Pick supplier for unbound material");
  assert.equal(poCreateError([line(""), line("")]), "Pick supplier for unbound materials");
  assert.equal(poCreateError([line("a"), line("b")]), "Lines belong to multiple suppliers — use Split by Supplier");
  assert.equal(poCreateError([line("a")]), null);
  for (const msg of ["Add at least one item", "Lines belong to multiple suppliers — use Split by Supplier", "Supplier missing"]) {
    assert.ok(PO_CREATE.includes(msg), msg);
  }
  assert.equal(poEditError([]), "PO must have at least one line item");
  assert.equal(poEditError([line("")]), "Pick a supplier for every line");
  assert.equal(poEditError([line("a"), line("b")]), "Lines must share a single supplier");
  for (const msg of ["PO must have at least one line item", "Pick a supplier for every line", "Lines must share a single supplier"]) {
    assert.ok(PO_DETAIL.includes(msg), msg);
  }
});

test("manual PO is born CONFIRMED; low-stock PO sends no status (server DRAFT)", () => {
  assert.match(PO_CREATE, /status: "CONFIRMED",\n    purchaseOrgCode,/);
  assert.match(PO_API, /body\.status \?\? "DRAFT"/);
  const b = poCreateBody([line("a")], { purchaseOrgCode: "OHANA", expectedDate: "2026-11-01", notes: "n" });
  assert.equal(b.status, "CONFIRMED");
  assert.equal(b.purchaseOrgCode, "OHANA");
  assert.deepEqual(Object.keys(b.items[0]), ["materialCategory", "materialCode", "materialName", "supplierSKU", "quantity", "unitPriceSen", "unit"]);
  const low = poLowStockBody([line("a")], { expectedDate: "", notes: "" });
  assert.equal("status" in low, false);
  assert.equal("purchaseOrgCode" in low, false);
});

test("Split by Supplier: manual = CONFIRMED + each supplier's company; low stock = Draft", () => {
  const lines = [line("a"), line("b"), line("a", { rmCode: "FAB-2" })];
  const manual = splitBodies(lines, { expectedDate: "", notes: "", purchaseOrgCode: "HOOKKA" }, "manual", (sid) => (sid === "b" ? "OHANA" : ""));
  assert.equal(manual.length, 2);
  assert.deepEqual(manual.map((g) => [g.supplierId, g.status, g.purchaseOrgCode, g.items.length]), [["a", "CONFIRMED", "HOOKKA", 2], ["b", "CONFIRMED", "OHANA", 1]]);
  const low = splitBodies(lines, { expectedDate: "", notes: "", purchaseOrgCode: "HOOKKA" }, "lowStock", () => "");
  assert.ok(low.every((g) => !("status" in g) && !("purchaseOrgCode" in g)));
  assert.equal(splitResultToast(2, 2), "Created 2 POs across 2 suppliers");
  assert.equal(splitResultToast(1, 2), "1/2 POs created — fix the rest and retry");
  assert.ok(PO_CREATE.includes("POs created — fix the rest and retry"));
});

test("PO edit body keeps line ids + receivedQty (detail.tsx saveEdits)", () => {
  const b = poEditBody([line("a", { id: "li-1", receivedQty: 0 })], { expectedDate: "2026-11-01", notes: "" });
  assert.equal(b.items[0].id, "li-1");
  assert.equal(b.items[0].receivedQty, 0);
  assert.equal("status" in b, false);
});

test("material picker: active RMs × active-supplier bindings, main first, one row per supplier", () => {
  const rms = [{ id: "r1", itemCode: "FAB-1", description: "Velvet", isActive: true, baseUOM: "m", itemGroup: "FABRIC" }, { id: "r2", itemCode: "OLD", isActive: false }];
  const bindings = [
    { supplierId: "b", materialCode: "fab-1", unitPrice: 3000, moq: 5 },
    { supplierId: "a", materialCode: "FAB-1", unitPrice: 2850, moq: 10, isMainSupplier: true },
    { supplierId: "a", materialCode: "FAB-1", unitPrice: 2900 },
    { supplierId: "x", materialCode: "FAB-1", unitPrice: 100 },
    { supplierId: "a", materialCode: "OLD", unitPrice: 1 },
  ];
  const r = materialPickerRows(rms, bindings, new Set(["a", "b"]), "");
  assert.deepEqual(r.map((x) => x.binding.supplierId), ["a", "b"]);
  assert.deepEqual(materialPickerRows(rms, bindings, new Set(["a", "b"]), "b").map((x) => x.binding.supplierId), ["b"]);
  const l = lineFromBinding(rms[0], bindings[1], "A - Kain");
  assert.deepEqual([l.quantity, l.unitPriceSen, l.unit, l.materialCategory], [10, 2850, "m", "FABRIC"]);
  assert.equal(supplierLabel({ code: "SUP-1", name: "Kain" }, "x"), "SUP-1 - Kain");
  assert.match(PO_CREATE, /return sup \? `\$\{sup\.code\} - \$\{sup\.name\}` : supplierId;/);
});

test("low stock: balance <= minStock (not <), main binding, qty = max(max − balance, MOQ)", () => {
  assert.match(PO_LIST, /\(rm\.balanceQty \?\? 0\) <= \(rm\.minStock \?\? 0\)/);
  assert.match(PO_LIST, /const refill = Math\.max\(\(rm\.maxStock \?\? 0\) - \(rm\.balanceQty \?\? 0\), moq\);/);
  const rms = [
    { id: "1", itemCode: "A", isActive: true, minStock: 10, balanceQty: 10, maxStock: 30 },
    { id: "2", itemCode: "B", isActive: true, minStock: 10, balanceQty: 11 },
    { id: "3", itemCode: "C", isActive: true, minStock: 0, balanceQty: 0 },
    { id: "4", itemCode: "D", isActive: false, minStock: 10, balanceQty: 0 },
  ];
  assert.deepEqual(lowStockRms(rms).map((r) => r.itemCode), ["A"]);
  const ls = lowStockLines(rms, [{ supplierId: "s2", materialCode: "A", moq: 50, unitPrice: 9 }, { supplierId: "s1", materialCode: "A", moq: 5, unitPrice: 7, isMainSupplier: true }], () => "S1");
  assert.deepEqual([ls[0].supplierId, ls[0].quantity, ls[0].unitPriceSen], ["s1", 20, 7]);
});

test("mobile receive body is GrnReceiveSheet's, plus desktop's Received By check", () => {
  assert.ok(GRN_CREATE.includes(RECEIVED_BY_ERROR));
  assert.ok(RECEIVE_SHEET.includes(RECEIVE_QTY_ERROR));
  assert.match(RECEIVE_SHEET, /arrival_state: "ARRIVED",/);
  const p = po("CONFIRMED", [item(10, 4, { availableQty: 6 }), item(3, 3)], { purchaseOrgCode: "OHANA" });
  assert.equal(receiveRemaining(p.items[0]), 6);
  assert.equal(receiveRemaining(p.items[1]), 0);
  assert.deepEqual(grnReceiveBody(p, () => 1, "  ", ""), { ok: false, error: RECEIVED_BY_ERROR });
  assert.deepEqual(grnReceiveBody(p, () => 0, "Hafiz", ""), { ok: false, error: RECEIVE_QTY_ERROR });
  const ok = grnReceiveBody(p, (i) => (i === 0 ? 6 : 0), " Hafiz ", " n ");
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.body, {
    poId: "po-1", purchaseOrgCode: "OHANA", receivedBy: "Hafiz", notes: "n", ocrUsed: false, arrival_state: "ARRIVED",
    items: [{ poItemIndex: 0, receivedQty: 6, acceptedQty: 6, rejectedQty: 0, rejectionReason: "" }],
  });
  // The server reads the same field.
  assert.match(GRN_API, /receivedBy,\n      notes,/);
});

test("GRN actions: no Approve; Post needs ARRIVED; Create Invoice on POSTED only", () => {
  assert.ok(GRN_DETAIL.includes(GRN_POST_NEEDS_ARRIVAL));
  const draft = grnActions({ status: "DRAFT", arrival_state: "NOT_ARRIVED" });
  assert.deepEqual([draft.primary, draft.postBlocked], ["POST", true]);
  assert.equal(grnActions({ status: "DRAFT", arrival_state: "ARRIVED" }).postBlocked, false);
  assert.equal(grnActions({ status: "CONFIRMED", arrival_state: "ARRIVED" }).primary, "POST");
  assert.equal(grnActions({ status: "POSTED" }).primary, "CREATE_INVOICE");
  assert.deepEqual(grnActions({ status: "CANCELLED" }), { primary: null, postBlocked: false, menu: ["PDF"] });
  for (const st of ["DRAFT", "CONFIRMED", "POSTED"]) {
    const a = grnActions({ status: st, arrival_state: "ARRIVED" });
    assert.ok(![a.primary, ...a.menu].includes("APPROVE"), st);
  }
  assert.match(GRN_DETAIL, /\{isPosted && !isCancelled && \(/);
});

test("GRN cancel lines name the PO and what leaves stock", () => {
  const lines = grnCancelLines({ status: "POSTED", poNumber: "PO-9", items: [{ materialName: "Foam", acceptedQty: 20 }] });
  assert.equal(lines[0], "PO PO-9 gets this quantity back and becomes receivable again — Foam: 20.");
  assert.ok(GRN_DETAIL.includes("gets this quantity back and becomes receivable again"));
  assert.equal(grnCancelLines({ status: "DRAFT", items: [] })[1], "No stock was posted, so nothing leaves inventory.");
});

test("landed cost = product + shipping + duty (grn-detail.tsx)", () => {
  const lc = landedCost({ totalAmount: 342000, shipping_cost_sen: 18000, customs_duty_sen: 0 });
  assert.equal(lc.totalSen, 360000);
  assert.equal(lc.currency, "MYR");
});

test("PI actions: Confirm / Mark Paid / Edit (Draft + Confirmed) / Delete / Void / Restore", () => {
  assert.match(PI_DETAIL, /return role === "FINANCE" \|\| role === "SUPER_ADMIN" \|\| role === "ADMIN";/);
  assert.equal(canVoidRole("finance"), true);
  assert.equal(canVoidRole("PURCHASING"), false);
  assert.deepEqual(piActions({ status: "DRAFT" }, true), { primary: "CONFIRM", menu: ["EDIT", "PDF", "DELETE"] });
  assert.deepEqual(piActions({ status: "CONFIRMED" }, true), { primary: "MARK_PAID", menu: ["EDIT", "PDF", "VOID"] });
  assert.deepEqual(piActions({ status: "CONFIRMED" }, false), { primary: "MARK_PAID", menu: ["EDIT", "PDF"] });
  assert.deepEqual(piActions({ status: "PENDING_APPROVAL" }, true).primary, "CONFIRM");
  assert.deepEqual(piActions({ status: "PAID" }, true), { primary: null, menu: ["PDF", "VOID"] });
  assert.deepEqual(piActions({ status: "PARTIAL_PAID" }, true), { primary: null, menu: ["PDF", "VOID"] });
  assert.deepEqual(piActions({ status: "CANCELLED" }, true), { primary: "RESTORE", menu: ["PDF"] });
  assert.deepEqual(piActions({ status: "CANCELLED" }, false), { primary: null, menu: ["PDF"] });
  assert.match(PI_DETAIL, /DRAFT: \[\{ label: "Confirm", next: "CONFIRMED" \}\]/);
  assert.match(PI_DETAIL, /CONFIRMED: \[\{ label: "Mark Paid", next: "PAID" \}\]/);
});

test("Mark Paid on a foreign PI sends the payment-day rate (pi.tsx)", () => {
  assert.match(PI_LIST, /updateStatus\(row\.id, "PAID", \{ payFxRate: r \}\)/);
  assert.deepEqual(markPaidBody({ currency: "MYR" }, ""), { ok: true, body: { status: "PAID" } });
  assert.deepEqual(markPaidBody({}, ""), { ok: true, body: { status: "PAID" } });
  assert.equal(markPaidBody({ currency: "USD" }, "0").ok, false);
  assert.deepEqual(markPaidBody({ currency: "USD" }, "4.45"), { ok: true, body: { status: "PAID", payFxRate: 4.45 } });
});

test("PI create checks + supplier mismatch wording (pi/create.tsx)", () => {
  assert.ok(PI_CREATE.includes('toast.error("Select a supplier")'));
  assert.ok(PI_CREATE.includes('toast.error("Add at least one item")'));
  assert.match(PI_CREATE, /`This invoice is for \$\{name\}\. Create a separate PI for \$\{res\.supplierName\}\.`/);
  assert.equal(piCreateError("", []), "Select a supplier");
  assert.equal(piCreateError("s1", [{ materialName: " ", qty: 1 }]), "Add at least one item");
  assert.equal(piMismatchError("Kayu Jati", "Foam Industries"), "This invoice is for Kayu Jati. Create a separate PI for Foam Industries.");
  assert.equal(piMismatchError("", "B"), "This invoice is for this supplier. Create a separate PI for B.");
});

test("PI import pickers: GRN non-cancelled (POSTED first), PO not Draft / Cancelled / Closed", () => {
  assert.match(CONVERT, /p\.status !== "CANCELLED" &&\n        p\.status !== "DRAFT" &&\n        p\.status !== "CLOSED"/);
  const grns = [{ id: "1", status: "DRAFT" }, { id: "2", status: "POSTED" }, { id: "3", status: "CANCELLED" }];
  assert.deepEqual(grnImportCandidates(grns, "").map((g) => g.id), ["2", "1"]);
  const pos = [{ id: "a", status: "DRAFT" }, { id: "b", status: "CONFIRMED" }, { id: "c", status: "CLOSED" }];
  assert.deepEqual(poImportCandidates(pos, "").map((p) => p.id), ["b"]);
});

test("imported lines carry grnItemId (GRN) / poId (PO) and cap at availableQty", () => {
  const grn = { id: "g1", poId: "p1", items: [{ id: "gi1", materialCode: "FAB", materialName: "Velvet", unitPrice: 2850, availableQty: 120 }] };
  const gl = importLines("grn", grn, { gi1: 100 });
  assert.deepEqual([gl[0].grnItemId, gl[0].poId, gl[0].qty, gl[0].unitPriceSen, gl[0].supplierSku], ["gi1", "p1", 100, 2850, "FAB"]);
  assert.equal(piCreateError("s", importLines("grn", grn, { gi1: 121 })), "A line exceeds the quantity available to invoice.");
  const p = { id: "p1", items: [{ id: "pi1", materialCode: "F", materialName: "Foam", supplierSKU: "FI", unitPriceSen: 3200, availableQty: 40, quantity: 40 }] };
  assert.deepEqual(importLines("po", p, { pi1: 40 })[0].poId, "p1");
  assert.equal(poDeepLinkLines(p)[0].qty, 40);
  const dl = grnDeepLinkLines({ id: "g", poId: "p", items: [{ id: "x", availableQty: 0, acceptedQty: 5 }, { id: "y", acceptedQty: 5 }] });
  assert.deepEqual(dl.map((l) => [l.grnItemId, l.qty]), [["y", 5]]);
});

test("import merge: a GRN replaces, a further PO appends and skips duplicates (handleConvert)", () => {
  const a = [{ materialName: "Foam", materialCode: "F", qty: 1, poId: "p1" }];
  const viaGrn = mergeImport(a, [{ materialName: "Velvet", materialCode: "V", qty: 2, poId: "p2" }], { source: "grn", hasGrnSource: false, prevRemarks: "x", docLabel: "GRN-1" });
  assert.deepEqual([viaGrn.lines.length, viaGrn.remarks, viaGrn.appended], [1, "From GRN GRN-1", false]);
  const viaPo = mergeImport(a, [{ materialName: "Foam", materialCode: "F", qty: 1, poId: "p1" }, { materialName: "Leg", materialCode: "L", qty: 1, poId: "p2" }], { source: "po", hasGrnSource: false, prevRemarks: "Created from PO P1", docLabel: "P2" });
  assert.deepEqual([viaPo.lines.length, viaPo.remarks, viaPo.appended], [2, "Created from PO P1 + PO P2", true]);
  assert.ok(PI_CREATE.includes("`${prev} + PO ${res.docLabel}`"));
});

test("PI create body: DRAFT, no due date, grnId / purchaseOrderId only when set", () => {
  assert.match(PI_CREATE, /status: "DRAFT",/);
  const b = piCreateBody({
    supplierId: "s1", supplierName: "Kain", invoiceDate: "2026-10-21", remarks: "From GRN G", purchaseOrgCode: "HOOKKA",
    supplierInvoiceNo: " INV ", supplierDoNo: "", purchaseOrderId: "p1", grnId: "g1",
    lines: [{ materialCode: "F", materialName: "Foam", supplierSku: "", qty: 2, unitPriceSen: 3200, grnItemId: "gi", poId: null }, { materialName: "", qty: 0 }],
  });
  assert.equal(b.status, "DRAFT");
  assert.equal("dueDate" in b, false);
  assert.deepEqual([b.supplierInvoiceNo, b.supplierDoNo, b.grnId, b.purchaseOrderId], ["INV", null, "g1", "p1"]);
  assert.equal(b.items.length, 1);
  assert.deepEqual([b.items[0].poId, b.items[0].grnItemId, b.items[0].lineType], ["p1", "gi", "STOCKED"]);
  // The server sets the due date itself on create.
  assert.match(PI_API, /nextMonthDueDate/);
});

test("PI edit: desktop checks, confirmed-amount prompt, discount kept", () => {
  assert.ok(PI_DETAIL.includes('"Every line needs a description."'));
  assert.ok(PI_DETAIL.includes('"Every line needs a valid quantity."'));
  assert.ok(PI_DETAIL.includes("Save changes to a confirmed invoice?"));
  const p = { status: "CONFIRMED", amountSen: 10000, items: [{ materialName: "Foam", qty: 2, unitPriceSen: 5000, taxSen: 0, discountSen: 0 }] };
  const ls = piEditLines(p);
  assert.equal(piEditError(ls), null);
  assert.equal(piEditError([{ ...ls[0], materialName: "" }]), "Every line needs a description.");
  assert.equal(piEditError([{ ...ls[0], qty: "x" }]), "Every line needs a valid quantity.");
  assert.equal(piEditTotals(ls).totalSen, 10000);
  assert.equal(piEditNeedsConfirm(p, 10000), false);
  assert.equal(piEditNeedsConfirm(p, 12000), true);
  assert.equal(piEditNeedsConfirm({ ...p, status: "DRAFT" }, 12000), false);
  const disc = piEditLines({ items: [{ materialName: "A", qty: 1, unitPriceSen: 6000, discountSen: 300 }, { materialName: "B", qty: 1, unitPriceSen: 4000, discountSen: 200 }] });
  assert.equal(piEditTotals(disc).totalSen, 9500);
  const body = piEditBody({ invoiceDate: "2026-10-21", dueDate: "", remarks: "", supplierInvoiceNo: "", supplierDoNo: "" }, disc);
  assert.deepEqual(body.items.map((i) => i.discountSen), [300, 200]);
  assert.equal(body.dueDate, undefined);
});

// ---------------------------------------------------------------------------
// Screen wiring + scope guards (owner 2026-10-21).
// ---------------------------------------------------------------------------
const LAYOUT = read("src/pages/m/MobileLayout.tsx");
const MODULES = read("src/pages/m/config/modules.ts");
const SCREEN_FILES = ["ProcurementScreen", "ProcurementDetailScreen", "PoDetail", "GrnDetail", "PiDetail", "PoForm", "ReceiveForm", "PiForm", "parts", "actions"]
  .map((f) => [f, read(`src/pages/m/screens/procurement/${f}.${f === "actions" ? "ts" : "tsx"}`)]);

test("/m/procurement list + detail are the custom screens (lazy, like Delivery)", () => {
  assert.match(LAYOUT, /procurement: ProcurementRoute,/);
  assert.match(LAYOUT, /procurement: ProcurementDetailRoute,/);
  assert.match(LAYOUT, /import\("\.\/screens\/procurement\/ProcurementScreen"\)/);
  const detail = read("src/pages/m/screens/procurement/ProcurementDetailScreen.tsx");
  assert.match(detail, /id\.startsWith\("grn-"\)/);
  assert.match(detail, /id\.startsWith\("pi-"\)/);
});

test("scope guards: no GRN Approve, no Purchase Return, no Maintenance segment", () => {
  for (const [name, src] of SCREEN_FILES) {
    assert.ok(!/status:\s*"CONFIRMED"\s*\}/.test(src) || name === "PiDetail", `${name} must not approve a GRN`);
    assert.ok(!src.includes("Create Purchase Return"), `${name}: Create Purchase Return is out of scope`);
    assert.ok(!src.includes("Maintenance"), `${name}: Maintenance segment was removed`);
  }
  const grn = SCREEN_FILES.find(([n]) => n === "GrnDetail")[1];
  assert.ok(!grn.includes('"Approve"'));
  assert.match(grn, /putGrn\(id, \{ status: "POSTED" \}\)/);
});

test("mobile receiving uses the shared receive body (arrival ARRIVED, Received By required)", () => {
  const rf = SCREEN_FILES.find(([n]) => n === "ReceiveForm")[1];
  assert.match(rf, /grnReceiveBody\(po, qtyFor, receivedBy, notes\)/);
  assert.match(rf, /send\("\/api\/grn", "POST", built\.body, \{ "Idempotency-Key": key \}\)/);
  assert.ok(!rf.includes("shipping_method"), "shipment fields would make the receipt NOT_ARRIVED");
});

test("generic procurement config: supplier wording + real statuses (feeds global search)", () => {
  const block = MODULES.slice(MODULES.indexOf("// PROCUREMENT —"), MODULES.indexOf("export const procurementConfig"));
  assert.ok(!block.includes('"Customer"') && !block.includes('"Customer PO"'), "no Customer labels on supplier documents");
  for (const bad of ['"AWAITING"', '"MATCHED"', '"UNPAID"', '"MISMATCH"']) assert.ok(!block.includes(bad), bad);
  assert.match(block, /\["DRAFT", "SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"\]/);
  assert.match(block, /\["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"\]/);
  assert.match(block, /\["DRAFT", "CONFIRMED", "PARTIAL_PAID", "PAID", "CANCELLED"\]/);
  assert.match(MODULES, /sources: \[poSource, grnSource, piSource\],/);
});

// ---------------------------------------------------------------------------
// Review fixes (2026-10-21).
// ---------------------------------------------------------------------------
import { moqOrOne, lineUid } from "../src/pages/m/lib/procurement-mobile.ts";

test("MOQ default is desktop's `moq ?? 1` (a stored 0 stays 0)", () => {
  assert.equal(moqOrOne(undefined), 1);
  assert.equal(moqOrOne({}), 1);
  assert.equal(moqOrOne({ moq: 0 }), 0);
  assert.equal(moqOrOne({ moq: 25 }), 25);
  const ls = lowStockLines([{ id: "1", itemCode: "A", isActive: true, minStock: 10, balanceQty: 10, maxStock: 5 }], [{ supplierId: "s", materialCode: "A", moq: 0, isMainSupplier: true }], () => "S");
  assert.equal(ls[0].quantity, 0, "max(5 − 10, 0) = 0, as desktop");
  assert.equal(lineFromBinding({ id: "r", itemCode: "A" }, { supplierId: "s", moq: 0 }, "S").quantity, 0);
});

test("PO unit price keeps sub-cent digits (desktop roundUnitPriceSen), and line uids never reach a request", () => {
  assert.match(PO_CREATE, /roundUnitPriceSen\(rm \* 100\)/);
  const parts = read("src/pages/m/screens/procurement/parts.tsx");
  assert.match(parts, /roundUnitPriceSen\(x \* 100\)/);
  const po = read("src/pages/m/screens/procurement/PoForm.tsx");
  assert.ok(po.includes("<RateBox"), "PO lines use the rate box");
  assert.ok(!po.includes("Math.round(x * 100)"));
  const l = { ...line("a", { unitPriceSen: 5.5 }), uid: lineUid() };
  const b = poCreateBody([l], { purchaseOrgCode: "HOOKKA", expectedDate: "", notes: "" });
  assert.equal(b.items[0].unitPriceSen, 5.5);
  assert.ok(!("uid" in b.items[0]));
  const pb = piCreateBody({ supplierId: "s", supplierName: "S", invoiceDate: "", remarks: "", purchaseOrgCode: "HOOKKA", supplierInvoiceNo: "", supplierDoNo: "", purchaseOrderId: null, grnId: null, lines: [{ uid: lineUid(), materialCode: "F", materialName: "Foam", supplierSku: "", qty: 1, unitPriceSen: 5.5, grnItemId: null, poId: null }] });
  assert.ok(!("uid" in pb.items[0]));
  const eb = piEditBody({ invoiceDate: "", dueDate: "", remarks: "", supplierInvoiceNo: "", supplierDoNo: "" }, piEditLines({ items: [{ materialName: "A", qty: 1, unitPriceSen: 100 }] }));
  assert.ok(!("uid" in eb.items[0]));
  assert.notEqual(lineUid(), lineUid());
});

test("detail screens are keyed by document id (tablet split view)", () => {
  const d = read("src/pages/m/screens/procurement/ProcurementDetailScreen.tsx");
  assert.match(d, /<GrnDetail key=\{id\} id=\{id\} \/>/);
  assert.match(d, /<PiDetail key=\{id\} id=\{id\} \/>/);
  assert.match(d, /<PoDetail key=\{id\} id=\{id\} \/>/);
});
