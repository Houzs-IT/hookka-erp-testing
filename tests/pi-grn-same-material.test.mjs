import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { piGrnMaterialMismatch } from "../src/api/routes/purchase-invoices.ts";

test("a PI line billing a different material than its GRN line is refused", () => {
  const err = piGrnMaterialMismatch({ materialCode: "PC151-02", materialName: "Fabric B" }, { materialCode: "PC151-01" });
  assert.match(err, /bills PC151-02, but the goods-receipt line it draws from received PC151-01/);
});

test("same code passes, case- and space-blind; the CODE - NAME prefix counts", () => {
  assert.equal(piGrnMaterialMismatch({ materialCode: " pc151-01 " }, { materialCode: "PC151-01" }), null);
  assert.equal(piGrnMaterialMismatch({ materialCode: null, materialName: "PC151-01 - Ivory" }, { material_code: "PC151-01" }), null);
  assert.equal(piGrnMaterialMismatch({ materialCode: "PC151-01" }, { materialCode: null, materialName: "PC151-01 - Ivory" }), null);
});

test("nothing to compare when either side has no code", () => {
  assert.equal(piGrnMaterialMismatch({ materialCode: "", materialName: "Freight" }, { materialCode: "PC151-01" }), null);
  assert.equal(piGrnMaterialMismatch({ materialCode: "PC151-01" }, { materialCode: "", materialName: "misc" }), null);
});

test("both create and edit run the check; unchanged rows of an old invoice are not re-judged", () => {
  const src = readFileSync("src/api/routes/purchase-invoices.ts", "utf8");
  assert.match(src, /const wrongMaterial = piGrnMaterialMismatch\(r, gi\);/);
  assert.match(src, /const bad = g \? piGrnMaterialMismatch\(r, g\) : null;/);
  assert.match(src, /if \(kept\.has\(/);
  assert.doesNotMatch(src, /\u0000\$\{\(r\.materialCode/);
});

test("the PI form does not offer a material picker on a GRN-drawn line", () => {
  const fe = readFileSync("src/pages/procurement/pi/create.tsx", "utf8");
  assert.match(fe, /\{line\.grnItemId \? \(/);
});
