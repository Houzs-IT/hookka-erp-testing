// m-so-edit.test.mjs — editing a SAVED Sales Order must not lose anything on its lines.
// PUT /api/sales-orders/:id replaces ALL lines from the payload and trusts every price it is sent, so the
// mobile edit has to send every stored field back and only let the server re-price what actually changed
// (src/pages/m/lib/so-edit.ts). Fixture orders only: this proves the payload, not a real save.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  editItemFromServer, soEditItemsBody, soEditBody, soEditBlockers, editHeaderFromDoc, formLineFromServer, itemFromFormLine, splitSofaLine,
} from "../src/pages/m/lib/so-edit.ts";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");

// A scanned bedframe line as GET /api/sales-orders/:id returns it (the columns of sales_order_items).
const BED = {
  id: "soi-1", lineNo: 1, productId: "p-bed", productCode: "HB-5001-Q", productName: "Harbour Bedframe Queen", itemCategory: "BEDFRAME",
  sizeCode: "5FT", sizeLabel: "5FT", fabricCode: "LINEN-SAND", quantity: 4, gapInches: 2, divanHeightInches: 10, divanPriceSen: 8000,
  legHeightInches: 4, legPriceSen: 3000, specialOrder: "Headrest Firm", specialOrderPriceSen: 5000, totalHeightPriceSen: 1500,
  customSpecials: [{ description: "Custom foam 35D", surchargeSen: 2500 }], basePriceSen: 189000, unitPriceSen: 208500, discountSen: 10000,
  lineTotalSen: 724000, notes: "deliver after 2pm", repairScope: null,
};
const SOFA = {
  id: "soi-2", lineNo: 1, productId: "p-sofa", productCode: "ASPEN-3S", productName: "Aspen", itemCategory: "SOFA", sizeCode: '28"', sizeLabel: '28"',
  fabricCode: "VELVET", quantity: 1, gapInches: null, divanHeightInches: null, divanPriceSen: 0, legHeightInches: null, legPriceSen: 0,
  specialOrder: "", specialOrderPriceSen: 0, totalHeightPriceSen: 0, customSpecials: [], basePriceSen: 330000, unitPriceSen: 330000, discountSen: 0, notes: "",
};
const line = (raw) => editItemFromServer(raw, 0);
const body = (raw, patch = (x) => x) => soEditItemsBody([patch(line(raw))])[0];

test("UNTOUCHED: saving a scanned line sends back every stored field, byte for byte", () => {
  const out = body(BED);
  assert.equal(out.id, "soi-1");
  assert.equal(out.productId, "p-bed");
  assert.equal(out.productCode, "HB-5001-Q");
  assert.equal(out.productName, "Harbour Bedframe Queen");
  assert.equal(out.itemCategory, "BEDFRAME");
  assert.equal(out.sizeCode, "5FT");
  assert.equal(out.sizeLabel, "5FT");
  assert.equal(out.fabricCode, "LINEN-SAND");
  assert.equal(out.quantity, 4);
  assert.equal(out.basePriceSen, 189000);
  assert.equal(out.gapInches, 2);
  assert.equal(out.divanHeightInches, 10);
  assert.equal(out.legHeightInches, 4);
  assert.equal(out.divanPriceSen, 8000);
  assert.equal(out.legPriceSen, 3000);
  assert.equal(out.specialOrder, "Headrest Firm");
  assert.equal(out.specialOrderPriceSen, 5000);
  assert.equal(out.totalHeightPriceSen, 1500);
  assert.deepEqual(out.customSpecials, [{ description: "Custom foam 35D", surchargeSen: 2500 }]);
  assert.equal(out.discountSen, 10000);
  assert.equal(out.notes, "deliver after 2pm");
});

test("the OLD form's blind spot is closed: divan / leg / gap / special / custom / notes / discount all survive", () => {
  const out = body(BED);
  for (const k of ["gapInches", "divanHeightInches", "legHeightInches", "divanPriceSen", "legPriceSen", "specialOrder", "specialOrderPriceSen", "totalHeightPriceSen", "customSpecials", "discountSen", "notes"]) {
    assert.notEqual(out[k], undefined, `${k} must be sent`);
  }
});

test("stored nulls stay null: an untouched sofa has no heights, and a blank is never turned into 0", () => {
  const out = body(SOFA);
  assert.equal(out.gapInches, null);
  assert.equal(out.divanHeightInches, null);
  assert.equal(out.legHeightInches, null);
  assert.equal(out.seatHeight, "28");
  assert.equal(out.sizeLabel, '28"', "the stored size label is kept while the seat height is unchanged");
});

test("changing a divan height WITHOUT touching its surcharge omits the surcharge so the server re-prices it", () => {
  const out = body(BED, (it) => ({ ...it, divan: "12" }));
  assert.equal(out.divanHeightInches, 12);
  assert.equal("divanPriceSen" in out, false, "left for the server to price the 12-inch divan");
  assert.equal("totalHeightPriceSen" in out, false, "the total-height surcharge depends on the heights");
  assert.equal(out.legPriceSen, 3000, "an unrelated surcharge is untouched");
  assert.equal(out.specialOrderPriceSen, 5000);
});

test("changing the height AND typing a new surcharge keeps the operator's amount", () => {
  const out = body(BED, (it) => ({ ...it, divan: "12", edit: { ...it.edit, divanPriceRm: "120.00" } }));
  assert.equal(out.divanPriceSen, 12000);
});

test("editing the special-order text re-prices it (surcharge omitted); a hand-set surcharge is trusted", () => {
  const changed = body(BED, (it) => ({ ...it, specialOrder: "Headrest Firm, Divan Full Cover" }));
  assert.equal(changed.specialOrder, "Headrest Firm, Divan Full Cover");
  assert.equal("specialOrderPriceSen" in changed, false);
  const hand = body(BED, (it) => ({ ...it, specialOrder: "Headrest Firm, Divan Full Cover", edit: { ...it.edit, specialPriceRm: "80" } }));
  assert.equal(hand.specialOrderPriceSen, 8000);
});

test("changing the seat height of a sofa sends the new size; a changed product code drops the stale product id", () => {
  const seat = body(SOFA, (it) => ({ ...it, seatHeight: "30" }));
  assert.equal(seat.seatHeight, "30");
  assert.equal(seat.sizeLabel, "30");
  assert.equal(seat.sizeCode, "30");
  const code = body(BED, (it) => ({ ...it, productCode: "HB-5003-S" }));
  assert.equal(code.productId, "", "the server resolves the product from the new code");
  assert.equal(code.productCode, "HB-5003-S");
});

test("price edits: base price and discount are read as RM and sent as integer sen", () => {
  const out = body(BED, (it) => ({ ...it, priceRm: "1,950.50", edit: { ...it.edit, discountRm: "25" } }));
  assert.equal(out.basePriceSen, 195050);
  assert.equal(out.discountSen, 2500);
});

test("the whole-order body keeps the header, trims text and forwards an override token only when there is one", () => {
  const doc = { customerId: "c1", customerPO: "DI-8840", customerSO: "S-1", reference: "R", companySODate: "2026-11-03T00:00:00Z", customerDeliveryDate: "2026-11-20", hookkaExpectedDD: "", notes: " hi " };
  const header = editHeaderFromDoc(doc);
  assert.equal(header.companySODate, "2026-11-03");
  const b = soEditBody(header, [line(BED)]);
  assert.equal(b.notes, "hi");
  assert.equal(b.customerPOId, "DI-8840");
  assert.equal("overrideToken" in b, false);
  assert.equal(soEditBody(header, [line(BED)], "tok").overrideToken, "tok");
  assert.equal(b.items.length, 1);
});

test("validation: the same rules as the desktop edit page and the server", () => {
  const ok = { customerId: "c1" };
  assert.deepEqual(soEditBlockers(ok, [line(BED)]), []);
  assert.ok(soEditBlockers({ customerId: "" }, [line(BED)]).some((m) => /customer/i.test(m)));
  assert.ok(soEditBlockers(ok, []).some((m) => /at least one item/i.test(m)));
  assert.ok(soEditBlockers(ok, [{ ...line(BED), productCode: "" }]).some((m) => /product code/i.test(m)));
  assert.ok(soEditBlockers(ok, [{ ...line(SOFA), seatHeight: "" }]).some((m) => /seat height/i.test(m)));
  assert.ok(soEditBlockers(ok, [line(BED), line(SOFA)]).some((m) => /Sofa and Bedframe cannot be on the same Sales Order/.test(m)));
  assert.ok(soEditBlockers(ok, [{ ...line(SOFA), qty: "2" }]).some((m) => /Sofa .*qty=2/.test(m)));
});

test("a sofa line of 3 splits into 3 lines of 1; the copies are new lines (no saved id), the first keeps its own", () => {
  const sofa = { ...line(SOFA), qty: "3" };
  const out = splitSofaLine([line(BED), sofa], sofa.key);
  assert.equal(out.length, 4);
  const parts = out.filter((i) => i.category === "SOFA");
  assert.deepEqual(parts.map((p) => p.qty), ["1", "1", "1"]);
  assert.equal(parts[0].edit.id, "soi-2");
  assert.equal(parts[1].edit.id, "");
  assert.equal(parts[2].edit.id, "");
  assert.equal(new Set(parts.map((p) => p.key)).size, 3);
  assert.equal(splitSofaLine([line(BED)], line(BED).key).length, 1, "only sofas split");
});

// ---- the generic FormSheet path (editSalesOrderSpec / editSpecFor) round-trips too -------------

test("the FormSheet path carries the whole saved row and sends every field back", () => {
  const form = formLineFromServer(BED);
  assert.equal(form.__src, BED);
  assert.equal(form.gapInches, 2);
  const out = soEditItemsBody([itemFromFormLine(form, 0)])[0];
  assert.equal(out.divanHeightInches, 10);
  assert.equal(out.specialOrder, "Headrest Firm");
  assert.deepEqual(out.customSpecials, [{ description: "Custom foam 35D", surchargeSen: 2500 }]);
  assert.equal(out.specialOrderPriceSen, 5000);
  assert.equal(out.discountSen, 10000);
  assert.equal(out.id, "soi-1");
});

test("the FormSheet path: editing a visible field changes only that field; a new line carries what was typed", () => {
  const form = { ...formLineFromServer(BED), quantity: 6, divanHeightInches: 12 };
  const out = soEditItemsBody([itemFromFormLine(form, 0)])[0];
  assert.equal(out.quantity, 6);
  assert.equal(out.divanHeightInches, 12);
  assert.equal("divanPriceSen" in out, false, "re-priced by the server");
  assert.equal(out.legPriceSen, 3000);
  const fresh = soEditItemsBody([itemFromFormLine({ productCode: "CUSH-45", itemCategory: "ACCESSORY", quantity: 2, basePriceSen: 4500, discountSen: 500, notes: "n" }, 1)])[0];
  assert.equal(fresh.productCode, "CUSH-45");
  assert.equal(fresh.quantity, 2);
  assert.equal(fresh.basePriceSen, 4500);
  assert.equal(fresh.discountSen, 500);
  assert.equal(fresh.id, undefined, "no saved id: the server inserts it");
});

test("editSalesOrderSpec no longer rebuilds lines from the narrow field list", () => {
  const forms = read("config/forms.ts");
  const spec = forms.slice(forms.indexOf("export function editSalesOrderSpec"), forms.indexOf("// PURCHASE ORDER — create + edit"));
  assert.match(spec, /formLineFromServer/);
  assert.match(spec, /soEditItemsBody\(/);
  assert.doesNotMatch(spec, /soItemsForServer/, "the lossy builder is not used for an edit");
});

// ---- wiring ------------------------------------------------------------------------------------

test("the order screen saves through the same checks as desktop: blockers, PUT whole order, read-back", () => {
  const sheet = read("screens/so/SoEditSheet.tsx");
  assert.match(sheet, /soEditBlockers\(header, items\)/);
  assert.match(sheet, /soEditBody\(header, items, overrideToken\)/);
  assert.match(sheet, /method: "PUT"/);
  assert.match(sheet, /verifiedSave</);
  assert.match(sheet, /formatMismatchError/);
  const detail = read("screens/SalesOrderDetail.tsx");
  assert.match(detail, /<SoEditSheet/);
  assert.match(detail, /<SalesOrderActionBar\s+plan=\{plan\}/);
  assert.doesNotMatch(detail, /\{wide \? \(\s*<>\s*<SalesOrderActionBar/, "the bar is not wide-only any more");
});
