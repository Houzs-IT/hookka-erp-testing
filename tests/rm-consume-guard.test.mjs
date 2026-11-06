import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/api/lib/po-cost-cascade.ts", "utf8");

test("the over-pull guard allows for float rounding and never goes negative", () => {
  assert.match(src, /SET remainingQty = GREATEST\(0, remainingQty - \?\) WHERE id = \? AND remainingQty >= \?/);
  assert.match(src, /\.bind\(slice\.qty, slice\.batchId, slice\.qty - RM_GUARD_TOLERANCE\)/);
});

test("the tolerance is noise-sized, not a real quantity", () => {
  const m = /RM_GUARD_TOLERANCE = ([\d.]+)/.exec(src);
  assert.ok(Number(m[1]) > 1e-9 && Number(m[1]) < 1e-3);
});

test("a duplicated code resolves to the row holding the stock", () => {
  const body = src.slice(src.indexOf("async function resolveRmFromBom"), src.indexOf("function genLedgerId"));
  assert.equal((body.match(/WHERE itemCode = \? ORDER BY balanceQty DESC LIMIT 1/g) ?? []).length, 2);
  assert.ok(!/WHERE itemCode = \? LIMIT 1/.test(body));
});
