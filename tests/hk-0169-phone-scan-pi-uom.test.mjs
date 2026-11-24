// ---------------------------------------------------------------------------
// hk-0169-phone-scan-pi-uom.test.mjs — the phone PI scan keeps the billed unit
// (PO in ROLL, invoice in MTR) the same way the desktop wizard does: the unit
// is sent when it is a known unit other than the PO line's, with po_qty (how
// many PO units it covers), and Create stops while po_qty is missing.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { piLineUnit, piBlockers, piDraftBody, piContextFrom, blankLine } from "../src/pages/m/lib/scan-pi.ts";

const ctx = (units) => ({
  ...piContextFrom({
    suppliers: [{ id: "s1", name: "Fabric Co", code: "400-F1" }],
    purchaseOrders: [{ id: "po-1", poNo: "PO-1", supplierId: "s1", status: "CONFIRMED", items: [{ id: "i1", materialCode: "FAB-1", quantity: 3, unit: "ROLL", unitPriceSen: 800 }] }],
  }),
  ...(units ? { units } : {}),
});
const line = (over = {}) => ({ ...blankLine("k1"), materialCode: "FAB-1", materialName: "Fabric", qty: "150", unitPriceRm: "8", poId: "po-1", poItemId: "i1", ...over });
const card = (l) => ({ supplierId: "s1", supplierDocName: "", purchaseOrgCode: "HOOKKA", purchaseOrderIds: ["po-1"], unmatchedPoRefs: [], multiPoRefs: [], invoiceDate: "2026-11-20", supplierInvoiceNo: "INV-1", supplierDoNo: "", discountRm: "", docTaxRm: 0, lines: [l] });

test("piContextFrom keeps the PO line's unit", () => {
  assert.equal(ctx().purchaseOrders[0].items[0].unit, "ROLL");
});

test("piLineUnit: the PO line's unit, and what the line saves", () => {
  assert.deepEqual(piLineUnit(line({ uom: "MTR" }), ctx()), { poUnit: "ROLL", uom: "MTR", poQty: null, missingPoQty: true });
  assert.deepEqual(piLineUnit(line({ uom: "MTR", poQty: "3" }), ctx()), { poUnit: "ROLL", uom: "MTR", poQty: 3, missingPoQty: false });
  assert.equal(piLineUnit(line({ uom: "roll" }), ctx()).uom, null, "same unit as the PO line");
  assert.equal(piLineUnit(line({ uom: "mtrs" }), ctx()).uom, null, "a misread unit falls back to the PO unit");
  assert.equal(piLineUnit(line({ uom: "BUNDLE" }), ctx(["MTR", "ROLL", "BUNDLE"])).uom, "BUNDLE", "the loaded unit list counts");
});

test("Create stops while a line in another unit has no PO-unit cover", () => {
  assert.ok(piBlockers(card(line({ uom: "MTR" })), ctx()).some((s) => /billed in MTR/.test(s) && /ROLL/.test(s)));
  assert.ok(piBlockers(card(line({ uom: "MTR", poQty: "0" })), ctx()).some((s) => /billed in MTR/.test(s)));
  assert.ok(!piBlockers(card(line({ uom: "MTR", poQty: "3" })), ctx()).some((s) => /billed in/.test(s)));
});

test("the draft body sends uom + poQty only for a line in another unit", () => {
  const [it] = piDraftBody(card(line({ uom: "MTR", poQty: "3" })), ctx(), "x.jpg", null).items;
  assert.equal(it.uom, "MTR");
  assert.equal(it.poQty, 3);
  assert.equal(it.qty, 150, "qty stays as billed: no conversion");
  const [same] = piDraftBody(card(line({ uom: "ROLL", qty: "3" })), ctx(), "x.jpg", null).items;
  assert.equal("uom" in same, false);
  assert.equal("poQty" in same, false);
});
