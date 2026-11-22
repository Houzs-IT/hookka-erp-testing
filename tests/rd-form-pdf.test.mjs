// rd-form-pdf.test.mjs — plan D11: the R&D Spec Form prints the BOM's
// current minutes ("now"), materials on file in bold with qty + unit, blank
// lines, an Extra table and sign-off; WIPs numbered like the costing editor.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./tests/_alias-loader.mjs", pathToFileURL("./"));
register("./tests/_asset-loader.mjs", pathToFileURL("./"));
const { computeCosting } = await import("../src/lib/product-costing.ts");
const { buildRdFormPdf, rdFormRows, rdFormNo } = await import("../src/lib/generate-rd-form-pdf.ts");

const costing = computeCosting({
  rawMaterials: [{ itemCode: "PLY18", description: "Plywood", baseUOM: "PCS" }],
  bindings: [],
  bom: { wipComponents: [
    { wipType: "DIVAN", wipCode: "{DIVAN_HEIGHT} Divan- {SIZE}", quantity: 2, processes: [{ dept: "Packing", deptCode: "PACKING", minutes: 18 }],
      children: [{ wipType: "DIVAN", wipCode: "Frame", quantity: 2, processes: [{ dept: "Framing", deptCode: "FRAMING", minutes: 25 }], materials: [{ code: "PLY18", qty: 0.5, unit: "PCS" }, { autoDetect: "FABRIC", qty: 3.25, unit: "MTR" }] }] },
  ] },
});
const input = { product: { code: "1003-(K)", name: "HILTON BEDFRAME (6FT)", category: "BEDFRAME", sizeLabel: "6FT" }, bom: { version: "1.0" }, nodes: costing.nodes, blankLines: 2, issuedOn: "2026-11-22" };

test("form number is readable and per day", () => {
  assert.equal(rdFormNo("1003-(K)", "2026-11-22"), "RD-1003K-261122");
});

test("rows: numbered WIPs, 'now' minutes + empty box, bold materials with qty AND unit, blank lines", () => {
  const rows = rdFormRows(input);
  const headers = rows.filter((r) => r.length === 1).map((r) => r[0].content);
  assert.match(headers[0], /^#1 {3}L2 {3}8" Divan- 6FT/);
  assert.match(headers[1], /^#2 {3}L3 {3}Frame/);
  const proc = rows.find((r) => r[1]?.content === "now 18");
  assert.equal(proc[2], "", "the box to write in is empty");
  const ply = rows.find((r) => r[0]?.content === "PLY18");
  assert.equal(ply[0].styles.fontStyle, "bold");
  assert.equal(ply[1].content, "1"); // 0.5 × 2 pieces, per product
  assert.equal(ply[2].content, "PCS");
  assert.ok(rows.some((r) => /Fabric \(from order\)$/.test(r[0]?.content ?? "")));
  const blanks = rows.filter((r) => r.length === 4 && r[0]?.content === "" && r[1] === "");
  assert.equal(blanks.length, 2 * 2, "2 blank lines under each of the 2 WIPs");
});

test("the PDF builds", () => {
  const doc = buildRdFormPdf(input);
  assert.ok(doc.getNumberOfPages() >= 1);
  if (process.env.COSTING_PDF_OUT) writeFileSync(`${process.env.COSTING_PDF_OUT}/rd-form.pdf`, Buffer.from(doc.output("arraybuffer")));
});

test("key-in: editor numbers WIPs like the form and records the form with the save", async () => {
  const { readFileSync } = await import("node:fs");
  const editor = readFileSync("src/pages/products/costing-editor.tsx", "utf8");
  assert.match(editor, /#\{no\}<\/span>/);
  assert.match(editor, /level, \+\+wipNo\)\)/);
  assert.match(editor, /These changes come from a filled <b>R&amp;D Spec Form<\/b>/);
  assert.match(editor, /\/rd-entry`, \{\s*method: "POST"/);
  const route = readFileSync("src/api/routes/product-costing.ts", "utf8");
  assert.match(route, /app\.post\("\/:productId\/rd-entry"/);
  assert.match(route, /enteredBy: await actorName\(c\)/);
  assert.match(route, /action: "rd-form-entry"/);
  const page = readFileSync("src/pages/products/costing.tsx", "utf8");
  assert.match(page, /R&amp;D Spec Form \(to fill in\)/);
  assert.match(page, /\.filter\(\(e\) => e\.action === "rd-form-entry"\)/);
});
