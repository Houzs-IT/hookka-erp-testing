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
const { buildCostingPdf, costingBlocks } = await import("../src/lib/generate-costing-pdf.ts");

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

test("v3 blocks: one box per WIP, processes and materials in separate tables, labels filled", () => {
  const blocks = costingBlocks(input, "full");
  assert.equal(blocks.length, costing.nodes.length);
  assert.equal(blocks[1].title, '8" Divan- 6FT part 1');
  assert.deepEqual(blocks[1].head, ["Process", "Min / pc", "× PCS", "Minutes", "Labour"]);
  assert.deepEqual(blocks[1].matHead, ["Raw material", "Qty / pc", "UOM", "Per product", "Unit price", "Amount"]);
  assert.equal(blocks[1].procRows.length, 1);
  assert.equal(blocks[1].matRows.length, 3);
  assert.equal(blocks[2].level, 3);
});

test("spec sheet carries no money; labour report carries no materials", () => {
  const spec = JSON.stringify(costingBlocks(input, "spec"));
  assert.doesNotMatch(spec, /RM /);
  assert.doesNotMatch(spec, /No price|WIP cost/);
  const lab = costingBlocks(input, "labour");
  assert.ok(lab.every((b) => b.matHead === null && b.matRows.length === 0));
  assert.match(JSON.stringify(lab), /Labour RM/);
});

test("no price line is flagged red, never RM 0.00", () => {
  const box = costingBlocks(input, "full")[1].matRows.find((r) => r.cells[0].startsWith("BOX"));
  assert.equal(box.red, true);
  assert.equal(box.cells[4], "No price");
  assert.equal(box.cells[5], "—");
});

test("all three PDFs build and paginate", () => {
  for (const kind of ["full", "spec", "labour"]) {
    const doc = buildCostingPdf(input, kind);
    assert.ok(doc.getNumberOfPages() >= 1, kind);
    if (process.env.COSTING_PDF_OUT) writeFileSync(`${process.env.COSTING_PDF_OUT}/${kind}.pdf`, Buffer.from(doc.output("arraybuffer")));
  }
  assert.ok(buildCostingPdf(input, "full").getNumberOfPages() >= 2, "a long BOM runs onto more pages");
});
