import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/pages/inventory/stock-value.tsx", "utf8");

// A failed load used to render the page with empty lists, so every total read
// RM 0.00 — the same as "no stock". It must say it failed instead.
test("a failed or refused load shows an error with Retry, not RM 0", () => {
  assert.match(src, /error: accountsError/);
  assert.match(src, /error: stockValuesError/);
  assert.match(src, /error: allStockValuesError/);
  assert.match(src, /resp && resp\.success === false/);
  assert.match(src, /\) : loadError \? \(/);
  assert.match(src, /onClick=\{fetchAll\}/);
});
