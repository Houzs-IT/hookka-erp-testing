// rd-scan.test.mjs — phase 7: a reading of a filled R&D form becomes
// reviewable changes; nothing is applied blind, quantities per product →
// per piece.
import test from "node:test";
import assert from "node:assert/strict";
import { normaliseRdScan, rdScanChanges, applyRdScan, numberedWips } from "../src/lib/rd-scan.ts";

const bom = { wipComponents: [
  { wipType: "DIVAN", quantity: 2, processes: [{ dept: "Packing", deptCode: "PACKING", minutes: 18 }],
    children: [{ wipType: "DIVAN", quantity: 2, processes: [{ dept: "Framing", deptCode: "FRAMING", minutes: 25 }], materials: [{ code: "PLY18", name: "Plywood", qty: 0.5, unit: "PCS" }] }] },
  { wipType: "HEADBOARD", quantity: 1, processes: [{ dept: "Upholstery", deptCode: "UPHOLSTERY", minutes: 40 }] },
] };

test("numbered like the form: depth-first", () => {
  assert.equal(numberedWips(bom).length, 3);
  assert.equal(numberedWips(bom)[2].wipType, "HEADBOARD");
});

test("normalise drops junk and out-of-range WIP numbers", () => {
  const r = normaliseRdScan({
    formNo: "RD-1003K-261122", filledBy: "Ah Seng", filledOn: "2026-11-25",
    minutes: [{ wipNo: 1, dept: "Packing", minutes: "20" }, { wipNo: 9, dept: "X", minutes: 5 }, { wipNo: 2, dept: "", minutes: 3 }],
    corrections: [{ wipNo: 2, code: "PLY18", qty: "1.5" }],
    newMaterials: [{ wipNo: 3, code: "STAPLE", qty: 40, unit: "PCS" }, { wipNo: 3, code: "", qty: 1 }],
  }, 3);
  assert.deepEqual(r.minutes, [{ wipNo: 1, dept: "Packing", minutes: 20 }]);
  assert.equal(r.corrections[0].qty, 1.5);
  assert.equal(r.newMaterials.length, 1);
  assert.equal(r.filledOn, "2026-11-25");
  assert.equal(normaliseRdScan({ filledOn: "25/11/2026" }, 3).filledOn, "");
});

test("changes: only what differs; unknown department is reported, not guessed", () => {
  const reading = normaliseRdScan({
    minutes: [{ wipNo: 1, dept: "Packing", minutes: 18 }, { wipNo: 2, dept: "framing", minutes: 30 }, { wipNo: 3, dept: "Fab Sew", minutes: 10 }],
    corrections: [{ wipNo: 2, code: "PLY18", qty: 1.5 }],
    newMaterials: [{ wipNo: 3, code: "STAPLE", qty: 40, unit: "PCS" }],
  }, 3);
  const ch = rdScanChanges(bom, reading);
  assert.deepEqual(ch.map((c) => c.kind), ["minutes", "unmatched", "qty", "add"]);
  assert.deepEqual(ch[0], { kind: "minutes", wipNo: 2, dept: "Framing", from: 25, to: 30 });
  assert.equal(ch[2].fromPerProduct, 1); // 0.5 × 2 pieces
});

test("apply: per product → per piece, new material looked up, source untouched", () => {
  const before = JSON.stringify(bom);
  const ch = [
    { kind: "minutes", wipNo: 2, dept: "Framing", from: 25, to: 30 },
    { kind: "qty", wipNo: 2, code: "PLY18", fromPerProduct: 1, toPerProduct: 1.5 },
    { kind: "add", wipNo: 3, code: "STAPLE", perProduct: 40, unit: "" },
  ];
  const out = applyRdScan(bom, ch, (c) => (c === "STAPLE" ? { code: "STAPLE-01", name: "Staple", unit: "PCS" } : null));
  const [, frame, hb] = numberedWips(out);
  assert.equal(frame.processes[0].minutes, 30);
  assert.equal(frame.materials[0].qty, 0.75);
  assert.deepEqual(hb.materials[0], { code: "STAPLE-01", inventoryCode: "STAPLE-01", name: "Staple", unit: "PCS", qty: 40 });
  assert.equal(JSON.stringify(bom), before);
});

test("scan route: reads only (no BOM write), uses the shared Claude caller, normalises the reply", async () => {
  const { readFileSync } = await import("node:fs");
  const r = readFileSync("src/api/routes/product-costing.ts", "utf8");
  const i = r.indexOf('app.post("/:productId/rd-scan"');
  const block = r.slice(i, r.indexOf("\n});", i));
  assert.match(block, /claudeFetch\(/);
  assert.match(block, /"rd_form_scan"/);
  assert.match(block, /normaliseRdScan\(raw, no\)/);
  assert.match(block, /MISSING_ANTHROPIC_KEY_ERROR/);
  assert.doesNotMatch(block, /UPDATE bom_templates|INSERT INTO bom_templates|PUT/);
  const editor = readFileSync("src/pages/products/costing-editor.tsx", "utf8");
  assert.match(editor, /Scan filled R&amp;D form…/);
  assert.match(editor, /Put ticked lines into the editor/);
  assert.match(editor, /setBom\(applyRdScan\(bom, picked, lookup\)\)/);
});
