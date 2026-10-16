// ---------------------------------------------------------------------------
// po-add-picked-rm-row.test.mjs — BUG-2026-10-15-NNN.
//
// One item code can be several raw materials (prod: PC151-17 is a ROLL
// "FABRIC" row and two MTR "FROST LINEN" rows). The PO pages passed only the
// code to their add helper, which then took the first RM with that code, so
// picking the MTR row added the ROLL one. Pins that each add path takes the
// clicked row itself and that New PO marks rows as added by RM id.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../src/pages/procurement/${f}`, import.meta.url), "utf8");
const create = read("create.tsx");
const detail = read("detail.tsx");
const index = read("index.tsx");

test("New PO: Add hands over the clicked row, not its code", () => {
  assert.match(create, /const addItemFromRM = \(rm: RawMaterial, supplierId\?: string\)/);
  assert.match(create, /onClick=\{\(\) => onAdd\(rm, opt\?\.supplierId\)\}/);
  const add = create.slice(create.indexOf("const addItemFromRM"), create.indexOf("const seedQty"));
  assert.doesNotMatch(add, /rawMaterials\.find/);
});

test("New PO: 'Added' is per RM row, not per code", () => {
  assert.match(create, /new Set\(items\.map\(\(it\) => `\$\{it\.rmId\}\|\$\{it\.supplierId\}`\)\)/);
  assert.match(create, /addedKeys\.has\(`\$\{rm\.id\}\|\$\{opt\?\.supplierId \?\? ""\}`\)/);
});

test("Edit PO: add line takes the clicked row", () => {
  assert.match(detail, /const addLineFromRM = \(rm: RawMaterial\)/);
  assert.match(detail, /onClick=\{\(\) => addLineFromRM\(rm\)\}/);
});

test("PO popup: add takes the clicked row", () => {
  assert.match(index, /const addItemFromRM = \(rm: RawMaterial, qtyOverride\?: number\)/);
  assert.match(index, /onClick=\{\(\) => addItemFromRM\(rm\)\}/);
});
