// ---------------------------------------------------------------------------
// bom-l1-materials-persist.test.mjs — BOM product-level (L1) raw materials
// were sent by the BOM editor but never stored (no column, no handler read
// them), so they vanished on reload. Found 2026-11-22 while planning product
// costing (docs/plans/product-costing.md). Every template write now stores
// them in the self-applied snake_case column l1_materials and every read
// returns them.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(process.cwd(), "src/api/routes/bom.ts"), "utf8");
const handler = (start) => SRC.slice(SRC.indexOf(start), SRC.indexOf("\napp.", SRC.indexOf(start) + 10));

test("the column is self-applied (migrations do not run on deploy)", () => {
  assert.ok(SRC.includes(`() => runSelfApply(db, "bom", ["ALTER TABLE bom_templates ADD COLUMN IF NOT EXISTS l1_materials TEXT"])`));
  assert.ok(SRC.includes("memoizeSelfApply("));
});

test("POST /templates stores l1Materials", () => {
  const h = handler('app.post("/templates"');
  assert.match(h, /await ensureL1MaterialsColumn\(c\.var\.DB\)/);
  assert.match(h, /l1Materials: JSON\.stringify\(Array\.isArray\(body\.l1Materials\)/);
  assert.match(h, /l1Processes, wipComponents, l1_materials, version/);
});

test("bulk PUT /templates keeps l1Materials (it deletes and re-inserts every row)", () => {
  const h = handler('app.put("/templates", ');
  assert.match(h, /await ensureL1MaterialsColumn\(c\.var\.DB\)/);
  assert.match(h, /l1Materials: JSON\.stringify\(Array\.isArray\(raw\.l1Materials\)/);
  assert.match(h, /l1Processes, wipComponents, l1_materials, version/);
});

test("PUT /templates/:id patches l1_materials when sent", () => {
  const h = handler('app.put("/templates/:id"');
  assert.match(h, /if \(Array\.isArray\(body\.l1Materials\)\) \{\s*await ensureL1MaterialsColumn\(c\.var\.DB\);\s*patch\.l1_materials = JSON\.stringify\(body\.l1Materials\);/);
});

test("reads return l1Materials, dual-keyed", () => {
  assert.match(SRC, /safeParse<unknown\[\]>\(row\.l1_materials \?\? row\.l1Materials \?\? null, \[\]\)/);
  assert.equal((SRC.match(/l1Materials: l1MaterialsOf\(row\)/g) ?? []).length, 2, "full and list shapes");
});
