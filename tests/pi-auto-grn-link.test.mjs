import test from "node:test";
import assert from "node:assert/strict";
import { buildPiGrnLinkStatements } from "../src/api/lib/pi-auto-grn.ts";

function fakeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return { bind: (...args) => { calls.push({ sql, args }); return { sql, args }; } };
    },
  };
}

test("every system GRN line is marked billed by the invoice that made it", () => {
  const db = fakeDb();
  buildPiGrnLinkStatements(db, "grn-pi-1", [
    { piLineId: "a", qty: 5 },
    { piLineId: "b", qty: 2.5 },
  ]);
  const billed = db.calls.filter((c) => c.sql.includes("invoiced_qty"));
  assert.equal(billed.length, 2);
  assert.deepEqual(billed.map((c) => c.args), [[5, "grn-pi-1"], [2.5, "grn-pi-1"]]);
  assert.match(billed[0].sql, /OFFSET 0\)/);
  assert.match(billed[1].sql, /OFFSET 1\)/);
});

test("a PI line on one GRN line points at it; a split line keeps no pointer", () => {
  const db = fakeDb();
  buildPiGrnLinkStatements(db, "grn-pi-2", [
    { piLineId: "one", qty: 3 },
    { piLineId: "split", qty: 4 },
    { piLineId: "split", qty: 1 },
  ]);
  const links = db.calls.filter((c) => c.sql.includes("purchase_invoice_items"));
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].args, ["grn-pi-2", "one"]);
  assert.match(links[0].sql, /grn_item_id IS NULL OR grn_item_id = ''/);
});

test("the link rides in the same batch as the receipt", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/api/lib/pi-auto-grn.ts", "utf8");
  assert.match(src, /\.\.\.buildPiGrnLinkStatements\(db, grnId, lines\),\s*\n?\s*\];/);
});
