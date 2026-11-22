// ---------------------------------------------------------------------------
// products-cost-columns.test.mjs — owner 2026-11-22 (plan D4): the Products
// list shows Raw mat. / Total cost / Margin (P2) / Cost % from the costing
// summary; "No materials" when the BOM has none; margin is on the TOTAL cost.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(process.cwd(), "src/pages/products/index.tsx"), "utf8");
const route = readFileSync(resolve(process.cwd(), "src/api/routes/product-costing.ts"), "utf8");

test("summary route is declared before /:productId and uses the same engine + pick", () => {
  assert.ok(route.indexOf('app.get("/summary"') < route.indexOf('app.get("/:productId"'));
  assert.match(route, /const r = computeCosting\(\{ bom: bomOf\(tpl\), \.\.\.inputs \}\)/);
  assert.match(route, /s === "ACTIVE" \? 0 : s === "DRAFT" \? 1 : 2/);
});

test("columns: Raw mat. and Total cost added; % columns are Cost %", () => {
  assert.match(page, /key: "rawMat",[\s\S]{0,140}label: \(\) => "Raw mat\."/);
  assert.match(page, /key: "totalCost",[\s\S]{0,140}label: \(\) => "Total cost"/);
  assert.match(page, /"Cost % \(P2\)"/);
  assert.doesNotMatch(page, /"Labor % \(P2\)"/);
});

test("margin and cost % read the total cost; no materials = no total, shown as 'No materials'", () => {
  assert.match(page, /const totalCost = cs && cs\.materialLines > 0 \? laborSen \+ cs\.materialSen : null;/);
  assert.match(page, /return \(totalCost \/ priceFor\) \* 100;/);
  assert.match(page, /return priceFor - totalCost;/);
  assert.match(page, /No materials<\/span>/);
  assert.match(page, /no price<\/span>/);
});

test("filters: All / No materials yet / Has a material with no price", () => {
  for (const s of ['"No materials yet"', '"Has a material with no price"']) assert.ok(page.includes(s), s);
  assert.match(page, /costFiltered\.map\(\(p\) => \{/);
});
