// m-scan-grn.test.mjs — "scan a supplier delivery document → DRAFT Goods Receipt" on mobile
// (src/pages/m/lib/scan-grn.ts, which reuses the Purchase Invoice scanner), and the Goods Receipt steps the phone adds
// to the existing detail (src/pages/m/lib/grn-mobile.ts: arrival pipeline + Edit Quantities).
// Fixture data only: this proves matching / request body / the desktop rules, not that real OCR reads a real delivery
// order, and not that the real API accepts the request.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildGrnCard, grnBlockers, grnChangeSupplier, grnCorrected, grnDraftBody, grnPickMaterial, grnRelink, newGrnLine, overReceiptNotes, setReceived, setRejected,
} from "../src/pages/m/lib/scan-grn.ts";
import { grnArrivalAdvance, grnQtyBody, grnQtyCheck, grnQtyEditState } from "../src/pages/m/lib/grn-mobile.ts";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");

const SUP = [{ id: "s1", name: "ADD WOOD INDUSTRIES SDN BHD", code: "400-A002", purchaseOrgCode: "HOOKKA" }];
const MAT = [{ itemCode: "PLY-9-48-AB", description: "9MM 4' X 8' PLYWOOD AB" }, { itemCode: "PLY-18-48-AB", description: "18MM 4' X 8' PLYWOOD AB" }];
const BIND = [{ supplierId: "s1", materialCode: "PLY-9-48-AB", supplierSku: "SL 27", supplierDescription: "9MM PLYWOOD" },
  { supplierId: "s1", materialCode: "PLY-18-48-AB", supplierSku: "OST-SL 31", supplierDescription: "18MM 4X8 PLYWOOD AB" }];
const PO = [
  { id: "po-1", poNo: "PO-2607-003", supplierId: "s1", status: "CONFIRMED", items: [{ id: "i1", materialCode: "PLY-9-48-AB", materialName: "9MM PLY", quantity: 10, receivedQty: 0, unitPriceSen: 4550 }] },
  { id: "po-2", poNo: "PO-2607-020", supplierId: "s1", status: "CONFIRMED", items: [{ id: "i2", materialCode: "PLY-18-48-AB", materialName: "18MM PLY", quantity: 5, receivedQty: 4, unitPriceSen: 8800 }] },
];
const ctx = (over = {}) => ({ suppliers: SUP, materials: MAT, bindings: BIND, purchaseOrders: PO, orgs: [{ code: "HOOKKA", name: "Hookka" }], aliases: {}, ...over });
const DOC = {
  supplierName: "ADD WOOD INDUSTRIES SDN. BHD.", docType: "DELIVERY_NOTE", docNo: "DO-3381", docDate: "2026-11-02", customerPoRef: "2607-003 / 2607-020",
  lines: [
    { supplierCode: "SL 27", description: "9MM PLYWOOD AB", qty: 10, uom: "pcs" },
    { supplierCode: "OST-SL 31", description: "18MM 4X8 PLYWOOD AB", qty: 3, uom: "pcs" },
    { supplierCode: "9", description: "Mystery trim", qty: 2, uom: "roll" },
  ],
};

test("a delivery note's number is the DO number; lines start accepted = received, nothing rejected", () => {
  const c = buildGrnCard(DOC, ctx(), { today: "2026-11-04" });
  assert.equal(c.supplierId, "s1");
  assert.equal(c.supplierDoNo, "DO-3381");
  assert.deepEqual(c.lines.map((l) => [l.qty, l.acceptedQty, l.rejectedQty]), [["10", "10", "0"], ["3", "3", "0"], ["2", "2", "0"]]);
});

test("each line draws down ITS OWN purchase-order line (two orders = one receipt); an unmatched line gets none", () => {
  const c = buildGrnCard(DOC, ctx());
  assert.deepEqual(c.purchaseOrderIds.sort(), ["po-1", "po-2"]);
  assert.deepEqual(c.lines.map((l) => [l.poId, l.poItemId, l.poItemIndex]), [["po-1", "i1", 0], ["po-2", "i2", 0], [null, null, null]]);
});

test("quantities: received drives accepted (minus rejected); rejecting some lowers accepted", () => {
  const c = buildGrnCard(DOC, ctx());
  const l = setRejected(setReceived(c.lines[0], "8"), "3");
  assert.equal(l.acceptedQty, "5");
  assert.equal(setReceived(l, "20").acceptedQty, "17");
  assert.equal(setRejected(l, "99").acceptedQty, "0", "never negative");
});

test("blockers: supplier, a received quantity, every line bound, and accepted + rejected must not exceed received", () => {
  const c = buildGrnCard(DOC, ctx());
  assert.ok(grnBlockers(c, ctx()).some((m) => /not matched to a catalogue item/.test(m)), "the mystery line is unbound");
  const bound = grnPickMaterial(c, c.lines[2].key, "PLY-9-48-AB", ctx());
  assert.deepEqual(grnBlockers(bound, ctx()), []);
  assert.ok(grnBlockers({ ...bound, supplierId: "" }, ctx()).includes("Choose the supplier."));
  const over = { ...bound, lines: bound.lines.map((l, i) => (i === 0 ? { ...l, acceptedQty: "9", rejectedQty: "3" } : l)) };
  assert.ok(grnBlockers(over, ctx()).some((m) => /more than received/.test(m)));
  assert.ok(grnBlockers({ ...bound, lines: [] }, ctx()).some((m) => /at least one line/.test(m)));
});

test("the request is the desktop's: ocrUsed:true, supplier_do_no, per-line PO line, catalogue-tier guesses not learnt, header PO from the lines", () => {
  const c = grnPickMaterial(buildGrnCard(DOC, ctx()), "l2", "PLY-9-48-AB", ctx());
  const b = grnDraftBody(c, ctx(), "do-3381.jpg");
  assert.equal(b.ocrUsed, true);
  assert.equal(b.supplier_do_no, "DO-3381");
  assert.equal(b.notes, "Scanned: do-3381.jpg");
  assert.equal(b.receivedBy, "Scanned");
  assert.equal(b.poId, "po-1");
  assert.equal(b.status, undefined, "never a status: the server decides, and a scan never posts");
  assert.deepEqual(b.items.slice(0, 2).map((i) => [i.materialCode, i.receivedQty, i.acceptedQty, i.poId, i.poItemId, i.poItemIndex, i.unitPriceSen]), [["PLY-9-48-AB", 10, 10, "po-1", "i1", 0, 0], ["PLY-18-48-AB", 3, 3, "po-2", "i2", 0, 0]]);
  assert.equal(b.items.length, 3);
});

test("no purchase order named: a manual receipt (no poId); changing supplier / relinking keeps each line's own quantities", () => {
  const none = buildGrnCard({ ...DOC, customerPoRef: null }, ctx());
  assert.equal(grnDraftBody(none, ctx(), "x").poId, undefined);
  const edited = { ...none, lines: none.lines.map((l, i) => (i === 0 ? setRejected(l, "2") : l)) };
  const relinked = grnRelink(edited, ["po-1"], ctx());
  assert.deepEqual([relinked.lines[0].rejectedQty, relinked.lines[0].acceptedQty, relinked.lines[0].poItemId], ["2", "8", "i1"]);
  assert.equal(grnChangeSupplier(relinked, "s1", ctx()).lines[0].rejectedQty, "2");
});

test("over-receipt: 4 already received + 3 on a line ordered 5 passes 110%", () => {
  const c = buildGrnCard(DOC, ctx());
  const notes = overReceiptNotes(c, ctx());
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /PO-2607-020/);
  assert.equal(notes[0].key, c.lines[1].key);
});

test("the accuracy report carries the final received quantities and DO number", () => {
  const c = grnPickMaterial(buildGrnCard(DOC, ctx()), "l2", "PLY-9-48-AB", ctx());
  const e = grnCorrected({ ...c, lines: c.lines.map((l, i) => (i === 0 ? setReceived(l, "7") : l)) }, DOC);
  assert.equal(e.docNo, "DO-3381");
  assert.equal(e.lines[0].qty, 7);
  assert.equal(newGrnLine("z").acceptedQty, "1");
});

// ---- arrival pipeline (desktop grn-detail.tsx nextArrivalState / advanceLabel) -----------------------------------
test("arrival advances one step at a time and is withheld once ARRIVED or cancelled", () => {
  const g = (arrival_state, status = "DRAFT", poId = "po-1") => ({ status, arrival_state, poId });
  assert.deepEqual(grnArrivalAdvance(g("NOT_ARRIVED")), { target: "IN_TRANSIT", label: "Mark In Transit" });
  assert.deepEqual(grnArrivalAdvance(g("IN_TRANSIT")), { target: "AT_CUSTOMS", label: "Mark At Customs" });
  assert.deepEqual(grnArrivalAdvance(g("AT_CUSTOMS")), { target: "ARRIVED", label: "Mark Arrived" });
  assert.equal(grnArrivalAdvance(g("ARRIVED")), null);
  assert.equal(grnArrivalAdvance(g("NOT_ARRIVED", "CANCELLED")), null);
  assert.equal(grnArrivalAdvance({ status: "DRAFT", poId: "" }), null, "a receipt with no PO defaults to ARRIVED");
});

// ---- Edit Quantities (desktop saveQtyEdit + lib/purchase-edit-rules) ---------------------------------------------
const GRN = (over = {}, items) => ({
  id: "grn-1", status: "POSTED", poId: "", arrival_state: "ARRIVED",
  items: items ?? [
    { id: 1, poItemIndex: 0, materialCode: "A", materialName: "A", orderedQty: 10, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, unitPrice: 100, invoicedQty: 0 },
    { id: 2, poItemIndex: 1, materialCode: "B", materialName: "B", orderedQty: 5, receivedQty: 5, acceptedQty: 5, rejectedQty: 0, unitPrice: 200, invoicedQty: 5 },
  ],
  ...over,
});

test("Edit Quantities: offered on POSTED / CONFIRMED, never on a cancelled one; a billed line is frozen", () => {
  assert.deepEqual(grnQtyEditState(GRN()), { ok: true, lockedKeys: [1] });
  assert.equal(grnQtyEditState(GRN({ status: "CANCELLED" })).ok, false);
  const allBilled = GRN({}, [{ id: 1, poItemIndex: 0, materialName: "A", receivedQty: 4, acceptedQty: 4, invoicedQty: 4 }]);
  const st = grnQtyEditState(allBilled);
  assert.equal(st.ok, false);
  assert.match(st.reason, /billed on a purchase invoice/);
});

test("Edit Quantities is offered on a PO-linked DRAFT too (the server now edits draft lines by id and keeps their PO links)", () => {
  assert.equal(grnQtyEditState(GRN({ status: "DRAFT", poId: "po-1" })).ok, true);
  assert.equal(grnQtyEditState(GRN({ status: "DRAFT", poId: "" })).ok, true);
});

test("quantity check uses the shared rule: blank rejected, below-invoiced refused, delta text only when something moved", () => {
  const g = GRN();
  assert.equal(grnQtyCheck(g, ["", "5"]).ok, false);
  assert.equal(grnQtyCheck(g, ["-1", "5"]).ok, false);
  const same = grnQtyCheck(g, ["10", "5"]);
  assert.deepEqual([same.ok, same.changed, same.deltaText], [true, false, null]);
  const moved = grnQtyCheck(g, ["8", "999"]);
  assert.equal(moved.ok, true, "the billed line's typed value is ignored: it keeps its stored quantity");
  assert.match(moved.deltaText, /A: −2/);
});

test("the PUT carries the FULL items[] with only accepted changed (a locked line keeps its stored value)", () => {
  const b = grnQtyBody(GRN(), ["8", "999"]);
  assert.deepEqual(b.items.map((i) => [i.id, i.materialCode, i.receivedQty, i.acceptedQty, i.rejectedQty, i.unitPrice, i.poItemIndex]), [[1, "A", 10, 8, 0, 100, 0], [2, "B", 5, 5, 0, 200, 1]]);
});

// ---- wiring (source-level: no network, no OCR) ----------------------------------------------------------------------
test("the GRN tile is live behind grn:create + the scan permission and opens the GRN sheet", () => {
  const s = read("screens/dashboard/ScanToCreate.tsx");
  assert.match(s, /hasPermission\("grn", "create"\) && canScan, live: true/);
  assert.match(s, /<ScanGrnSheet/);
});

test("the GRN sheet creates only with ocrUsed (via grnDraftBody), reuses an Idempotency-Key, never posts or approves, and shows success only for a real id + grnNumber", () => {
  const s = read("screens/procurement/ScanGrnSheet.tsx");
  const create = s.slice(s.indexOf("const createReceipt"), s.indexOf("const resumeReady"));
  assert.match(create, /grnDraftBody/);
  assert.match(create, /"\/api\/grn", "POST"/);
  assert.match(create, /Idempotency-Key/);
  assert.match(create, /!data\?\.id \|\| !data\.grnNumber/);
  assert.ok(create.indexOf("!res.ok") < create.indexOf('setStep("done")'));
  const code = s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /status: "POSTED"|status: "CONFIRMED"|\/arrival|\/approve/, "a scan never posts, approves or moves arrival");
});

test("the original is attached to the receipt AFTER create, once (it looks for the same file first), and a retry runs only the follow-ups", () => {
  const s = read("screens/procurement/ScanGrnSheet.tsx");
  const helper = read("screens/scan/attach-once.ts");
  assert.ok(helper.includes("/api/files?resourceType=${encodeURIComponent(resourceType)}&resourceId="), "the shared helper lists the record files first");
  assert.match(s, /attachOriginalOnce\(.*"GRN", r\.docId/);
  const fin = s.slice(s.indexOf("const finishFollowUps"), s.indexOf("const openFinish"));
  assert.doesNotMatch(fin, /"\/api\/grn"/);
  assert.match(fin, /runFollowUps/);
  assert.match(s, /needsOriginal: true/, "the original is always a follow-up for a receipt");
});

test("the GRN detail shows the stored source document inline and offers arrival + Edit Quantities by permission", () => {
  const d = read("screens/procurement/GrnDetail.tsx");
  assert.match(d, /\/api\/files\?resourceType=GRN&resourceId=/);
  assert.match(d, /\/download\?inline=1/);
  assert.match(d, /grnArrivalAdvance/);
  assert.match(d, /grnQtyEditState/);
  assert.match(read("lib/grn-mobile.ts"), /\["grn", "update"\]/);
});
