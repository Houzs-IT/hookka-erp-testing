import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findDuplicateSupplierDoc, normSupplierDocNo } from "../src/api/routes/purchase-invoices.ts";

function fakeDb(row) {
  const seen = [];
  return {
    seen,
    prepare(sql) {
      return { bind: (...args) => { seen.push({ sql, args }); return { first: async () => row }; } };
    },
  };
}

test("supplier document numbers compare without case or spaces", () => {
  assert.equal(normSupplierDocNo(" inv 001 "), "INV001");
  assert.equal(normSupplierDocNo("INV001"), "INV001");
});

test("a match on either number field of a live PI is a duplicate", async () => {
  const db = fakeDb({ piNo: "PI-2611-004", supplierInvoiceNo: "Inv 001", supplierDoNo: null });
  const dup = await findDuplicateSupplierDoc(db, "sup1", ["inv001", null]);
  assert.deepEqual(dup, { piNo: "PI-2611-004", matched: "Inv 001" });
  const { sql, args } = db.seen[0];
  assert.match(sql, /status <> 'CANCELLED'/);
  assert.match(sql, /REPLACE\(UPPER\(TRIM\(COALESCE\(supplier_invoice_no, ''\)\)\), ' ', ''\) IN/);
  assert.match(sql, /REPLACE\(UPPER\(TRIM\(COALESCE\(supplier_do_no, ''\)\)\), ' ', ''\) IN/);
  assert.deepEqual(args, ["sup1", "INV001", "INV001"]);
});

test("the invoice being edited is left out of its own check", async () => {
  const db = fakeDb(null);
  assert.equal(await findDuplicateSupplierDoc(db, "sup1", ["X1"], "pi-9"), null);
  assert.match(db.seen[0].sql, /AND id <> \?/);
  assert.deepEqual(db.seen[0].args, ["sup1", "pi-9", "X1", "X1"]);
});

test("no number or no supplier: nothing to check", async () => {
  const db = fakeDb({ piNo: "x" });
  assert.equal(await findDuplicateSupplierDoc(db, "sup1", ["", null]), null);
  assert.equal(await findDuplicateSupplierDoc(db, "", ["A"]), null);
  assert.equal(db.seen.length, 0);
});

test("create and edit both use the shared rule; edit only judges a changed number", () => {
  const src = readFileSync("src/api/routes/purchase-invoices.ts", "utf8");
  assert.equal((src.match(/findDuplicateSupplierDoc\(db, /g) ?? []).length, 2);
  assert.match(src, /!before\.includes\(normSupplierDocNo\(n\)\)/);
});
