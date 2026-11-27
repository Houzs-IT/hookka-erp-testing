// R&D finding #6 (2026-11-27): #1631 locked product cost to the costing gate in
// the UI only; /api/products and /api/bom still sent the cost to every reader.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");

test("/api/products drops costPriceSen unless product-costing or cost-ledger read", () => {
  const src = read("src/api/routes/products.ts");
  const fn = src.slice(src.indexOf("async function stripSellingPrice"), src.indexOf('app.get("/"'));
  assert.match(fn, /hasPermission\(c, "product-costing", "read"\)/);
  assert.match(fn, /hasPermission\(c, "cost-ledger", "read"\)/);
  assert.match(fn, /canCosting \|\| canLedger \? \[\] : \["costPriceSen"\]/);
  // Both product reads go through it.
  assert.match(src, /data: await stripSellingPrice\(c, data\)/);
  assert.match(src, /data: \(await stripSellingPrice\(c, \[product\]\)\)\[0\]/);
});

test("/api/bom drops labourCost / materialCost / totalCost on both reads without the costing gate", () => {
  const src = read("src/api/routes/bom.ts");
  assert.match(src, /if \(\(await hasPermission\(c, "product-costing", "read"\)\) \|\| \(await hasPermission\(c, "cost-ledger", "read"\)\)\) return rows;/);
  assert.match(src, /\{ labourCost: _l, materialCost: _m, totalCost: _t, \.\.\.rest \}/);
  assert.match(src, /const data = await hideBomCost\(c, \(res\.results \?\? \[\]\)\.map\(rowToVersion\)\);/);
  assert.match(src, /data: \(await hideBomCost\(c, \[rowToVersion\(row\)\]\)\)\[0\]/);
});

test("the AI connector loads product-costing:read, so R&D sees costs inside the costing module", () => {
  const src = read("src/api/routes/mcp.ts");
  const perms = src.match(/const perms = \[([^\]]*)\];/)[1];
  assert.match(perms, /"product-costing:read"/);
});
