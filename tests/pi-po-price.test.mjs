import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attachPoPrices } from "../src/api/routes/purchase-invoices.ts";

const db = (rows) => ({ prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) });
const ROWS = [
  { id: "p1", poId: "PO1", mc: "PC151-01", price: 800 },
  { id: "p2", poId: "PO1", mc: "MHW", price: 120 },
  { id: "p3", poId: "PO1", mc: "MHW", price: 130 },
];
const line = (o) => ({ id: "x", poId: "PO1", poItemId: null, materialCode: null, unitPriceSen: 900, ...o });

test("the PO line named by the PI line gives the ordered price", async () => {
  const [a] = await attachPoPrices(db(ROWS), [line({ poItemId: "p1" })]);
  assert.equal(a.poUnitPriceSen, 800);
});

test("without a PO line id, a single same-code PO line is used; an ambiguous code is not guessed", async () => {
  const [a, b] = await attachPoPrices(db(ROWS), [line({ materialCode: "pc151-01" }), line({ materialCode: "MHW" })]);
  assert.equal(a.poUnitPriceSen, 800);
  assert.equal(b.poUnitPriceSen, undefined);
});

test("lines with no PO and a failing lookup are left as they are", async () => {
  const [a] = await attachPoPrices(db(ROWS), [line({ poId: null })]);
  assert.equal(a.poUnitPriceSen, undefined);
  const broken = { prepare: () => { throw new Error("db down"); } };
  const [b] = await attachPoPrices(broken, [line({ poItemId: "p1" })]);
  assert.equal(b.poUnitPriceSen, undefined);
});

test("the detail page shows the PO price only when it differs", () => {
  const src = readFileSync("src/pages/procurement/PurchaseInvoiceDetail.tsx", "utf8");
  assert.match(src, /it\.poUnitPriceSen != null && it\.poUnitPriceSen !== it\.unitPriceSen/);
});
