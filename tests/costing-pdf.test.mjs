// costing-pdf.test.mjs — plan D10: three reports, WIP hierarchy, the spec
// sheet carries no money.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./tests/_alias-loader.mjs", pathToFileURL("./"));
register("./tests/_asset-loader.mjs", pathToFileURL("./"));
const { computeCosting } = await import("../src/lib/product-costing.ts");
const { buildCostingPdf, costingRows } = await import("../src/lib/generate-costing-pdf.ts");

const bom = {
  l1Processes: [{ dept: "Packing", deptCode: "PACKING", minutes: 10 }],
  wipComponents: Array.from({ length: 14 }, (_, i) => ({
    id: `d${i}`, wipType: "DIVAN", wipCode: `{DIVAN_HEIGHT} Divan- {SIZE} part ${i + 1}`, quantity: 2,
    processes: [{ dept: "Upholstery", deptCode: "UPHOLSTERY", category: "CAT 9", minutes: 15 }],
    materials: [{ code: "PLY18", name: "Plywood", qty: 0.5, unit: "PCS" }, { autoDetect: "FABRIC", qty: 3.25, unit: "MTR" }, { code: "BOX", qty: 1, unit: "PCS" }],
    children: [{ id: `c${i}`, wipType: "DIVAN", wipCode: "Frame", quantity: 2, processes: [{ dept: "Framing", deptCode: "FRAMING", minutes: 25 }] }],
  })),
};
const costing = computeCosting({
  bom,
  rawMaterials: [{ itemCode: "PLY18", description: "Plywood", baseUOM: "PCS" }, { itemCode: "BOX", description: "Carton", baseUOM: "PCS" }],
  bindings: [{ materialCode: "PLY18", supplierName: "Wood Co", unitPrice: 6800, isMainSupplier: 1 }],
});
const input = {
  product: { code: "1003-(K)", name: "HILTON BEDFRAME (6FT)", category: "BEDFRAME", sizeLabel: "6FT" },
  bom: { version: "1.0", status: "ACTIVE" },
  costing,
  prices: [{ label: "Price 2", sen: 71000 }, { label: "Price 1", sen: null }],
  customers: [{ name: "Houzs Century", sen: 71000 }],
  standard: { totalSen: 20000, setAt: "2026-11-01T00:00:00Z", setBy: "Lim" },
};

test("rows: one tinted header per WIP, indented by level, labels filled", () => {
  const rows = costingRows(input, "full");
  const headers = rows.filter((r) => r.length === 1);
  assert.equal(headers.length, costing.nodes.length);
  assert.match(headers[1][0].content, /^L2 {2}8" Divan- 6FT part 1/);
  assert.ok(headers[2][0].styles.cellPadding.left > headers[1][0].styles.cellPadding.left, "L3 indented under L2");
});

test("spec sheet carries no money; labour report carries no materials", () => {
  const spec = JSON.stringify(costingRows(input, "spec"));
  assert.doesNotMatch(spec, /RM /);
  assert.doesNotMatch(spec, /No price|WIP cost|Labour /);
  const lab = JSON.stringify(costingRows(input, "labour"));
  assert.doesNotMatch(lab, /PLY18|material/);
  assert.match(lab, /Labour RM/);
});

test("no price line is flagged, never RM 0.00", () => {
  const full = JSON.stringify(costingRows(input, "full"));
  assert.match(full, /NO SUPPLIER PRICE/);
  assert.doesNotMatch(full, /BOX[^\]]*RM 0\.00/);
});

test("all three PDFs build and paginate", () => {
  for (const kind of ["full", "spec", "labour"]) {
    const doc = buildCostingPdf(input, kind);
    assert.ok(doc.getNumberOfPages() >= 1, kind);
    if (process.env.COSTING_PDF_OUT) writeFileSync(`${process.env.COSTING_PDF_OUT}/${kind}.pdf`, Buffer.from(doc.output("arraybuffer")));
  }
  assert.ok(buildCostingPdf(input, "full").getNumberOfPages() >= 2, "a long BOM runs onto more pages");
});
