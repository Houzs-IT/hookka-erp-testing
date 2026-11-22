// ---------------------------------------------------------------------------
// costing-editor.test.mjs — owner 2026-11-22 (plan D6/D7/D8): edit WIP
// processes / minutes / raw materials on the costing page through the SAME
// BOM save as the BOM Builder; one "Copy from model…" with three parts; the
// material editor is the BOM Builder's own.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { wipLabel } from "../src/lib/wip-label.ts";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");
const editor = read("src/pages/products/costing-editor.tsx");

test("one data path: saves with PUT /api/bom/templates/:id after the job-card preview", () => {
  assert.match(editor, /previewBomTemplateSave\(template\.id, body\)/);
  assert.match(editor, /confirmJobCardImpact\(confirm, impact\)/);
  assert.match(editor, /fetch\(`\/api\/bom\/templates\/\$\{encodeURIComponent\(template\.id\)\}`, \{\s*method: "PUT"/);
  assert.doesNotMatch(editor, /\/api\/product-costing\/[^"`]*\/save/);
});

test("one Copy button, three independent parts", () => {
  assert.equal((editor.match(/Copy from another model…<\/button>/g) ?? []).length, 1);
  for (const s of ['"WIP processes"', '"WIP time"', '"Raw materials"']) assert.ok(editor.includes(s), s);
  assert.match(editor, /copyBomParts\(bom, toBom\(src\), parts\)/);
});

test("material editor = the BOM Builder's (scaling + from order), shared not copied", () => {
  assert.match(editor, /import \{ MaterialScalingEditor, RawMaterialSelect \} from "@\/components\/bom\/material-editor";/);
  assert.match(read("src/pages/bom.tsx"), /import \{ MaterialScalingEditor, RawMaterialSelect \} from "@\/components\/bom\/material-editor";/);
  assert.doesNotMatch(read("src/pages/bom.tsx"), /^function (RawMaterialSelect|MaterialScalingEditor)\(/m);
  assert.match(editor, /onSelectAutoDetect=\{\(kind\) => set\(i, autoDetectMaterialPatch\(kind\)\)\}/);
});

test("live cost while editing comes from the server engine and writes nothing", () => {
  assert.match(editor, /fetch\("\/api\/product-costing\/preview", \{\s*method: "POST"/);
  const route = read("src/api/routes/product-costing.ts");
  const i = route.indexOf('app.post("/preview"');
  const block = route.slice(i, route.indexOf("});", i));
  assert.doesNotMatch(block, /INSERT|UPDATE|DELETE/);
});

test("WIP names read as the BOM page shows them, not raw {TOKENS}", () => {
  assert.equal(wipLabel("{DIVAN_HEIGHT} Divan- {SIZE}", { sizeLabel: "6FT" }), '8" Divan- 6FT');
  assert.equal(wipLabel("{DIVAN_HEIGHT} Divan", { defaultVariants: { divanHeight: '10"' } }), '10" Divan');
  assert.equal(wipLabel("{PRODUCT_CODE} -HB {FABRIC} (FC)", { code: "1003-(K)", defaultVariants: { fabricCode: "PC151-01" } }), "1003-(K) -HB PC151-01 (FC)");
  assert.equal(wipLabel("Plain name", undefined), "Plain name");
});

test("editor v2 (owner-approved design ②): one toolbar, choices visible first, tidy tables, reorder like the BOM page", () => {
  assert.match(editor, /1\. WHAT TO COPY \(tick any\)/);
  assert.ok(editor.indexOf("1. WHAT TO COPY") < editor.indexOf("2. FROM WHICH MODEL"));
  assert.match(editor, />\s*\{scanning \? "Reading form…" : "More ▾"\}/);
  assert.match(editor, /PROCESSES<\/div>/);
  assert.match(editor, /RAW MATERIALS<\/div>/);
  assert.match(editor, /import \{ canMoveWipNode, moveWipNode \} from "@\/lib\/wip-tree-ops";/);
  assert.match(editor, /moveWipNode\(bom\.wipComponents, path\[0\], path\.slice\(1\), dir\)/);
  assert.match(editor, /\+ Scaling/);
  assert.match(editor, /wipLabel\(String\(node\.wipCode \?\? ""\), labelProduct\)/);
});
