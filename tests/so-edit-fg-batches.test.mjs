// ---------------------------------------------------------------------------
// so-edit-fg-batches.test.mjs — HK-0118. SV-2610-036 was completed (fg_units
// PACKED, fg_batches written), then its job cards went back to WAITING. Saving
// a price on the Edit page wrote the items, then the PO rebuild hit
// fg_batches_production_order_id_fkey: a raw 500 shown as "Something went
// wrong" with the price already saved. Price-only edits now keep production;
// production edits on such an order are refused before any write.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  soProductionLinesChanged,
  soProductionHeaderChanged,
} from "../src/api/lib/so-production-fields.ts";

// The stored SV-2610-036 line, as SELECT * returns it.
const stored = {
  lineNo: 1,
  productId: "prod-svc",
  productCode: "SERVICE CHARGE",
  productName: "SERVICE CHARGE",
  itemCategory: "ACCESSORY",
  sizeCode: "",
  sizeLabel: "",
  fabricCode: "RANDOM",
  quantity: 4,
  gapInches: null,
  divanHeightInches: null,
  legHeightInches: null,
  specialOrder: "",
  notes: "",
  repairscope: null,
  basePriceSen: 0,
  unitPriceSen: 0,
  discountSen: 0,
};

test("price, discount and catalog-name drift are not production changes", () => {
  const edited = {
    ...stored,
    repairScope: null,
    basePriceSen: 10000,
    unitPriceSen: 10000,
    discountSen: 500,
    productName: "Service Charge (renamed in catalog)",
    productCode: "SERVICE CHARGE ",
    gapInches: "",
  };
  delete edited.repairscope;
  assert.equal(soProductionLinesChanged([stored], [edited]), false);
});

test("quantity, product, fabric, size, notes, specials, repair scope or a line count change are", () => {
  for (const patch of [
    { quantity: 3 },
    { productCode: "OTHER", productId: "prod-x" },
    { fabricCode: "KN-01" },
    { sizeCode: "6FT" },
    { notes: "rush" },
    { specialOrder: "OTHER: extra foam" },
    { repairScope: '{"preset":"FABRIC"}' },
  ]) {
    assert.equal(soProductionLinesChanged([stored], [{ ...stored, ...patch }]), true, JSON.stringify(patch));
  }
  assert.equal(soProductionLinesChanged([stored], [stored, { ...stored, lineNo: 2 }]), true);
});

test("line order in the payload does not matter, lineNo does", () => {
  const a = { ...stored, lineNo: 1 };
  const b = { ...stored, lineNo: 2, productCode: "PILLOW" };
  assert.equal(soProductionLinesChanged([a, b], [b, a]), false);
});

test("header: customer / state / reference / customer PO / SO date are production; delivery dates are not", () => {
  const h = { customerId: "c-1", customerState: "JOHOR", reference: "", customerPOId: "", companySODate: "2026-10-27" };
  assert.equal(soProductionHeaderChanged(h, { ...h, companySODate: "2026-10-27T00:00:00Z" }), false);
  assert.equal(soProductionHeaderChanged(h, { ...h, customerId: "c-2" }), true);
  assert.equal(soProductionHeaderChanged(h, { ...h, reference: "R1" }), true);
});

test("PUT: the fg_batches check runs before the write batch and switches the rebuild off", () => {
  const src = readFileSync(resolve(process.cwd(), "src/api/routes/sales-orders.ts"), "utf8");
  const put = src.slice(src.indexOf('app.put("/:id"'));
  const check = put.indexOf("FROM fg_batches b");
  const write = put.indexOf("await c.var.DB.batch(statements)");
  const rebuild = put.indexOf("const shouldRebuild =");
  assert.ok(check > 0 && write > 0 && check < write, "fg_batches check precedes the first write");
  assert.ok(put.indexOf("productionLinesChanged = soProductionLinesChanged(oldItems, newItems)") < check);
  assert.match(put.slice(rebuild, rebuild + 200), /!keepProduction &&/);
  assert.match(put.slice(check, write), /409/);
});
