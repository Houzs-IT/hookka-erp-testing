// ---------------------------------------------------------------------------
// po-picker-unique-rows.test.mjs — BUG-2026-10-12-276.
//
// New PO → Select Materials lists one row per supplier when no supplier is
// picked. Rows are keyed `${rm.id}|${supplierId}`, and prod has 31 supplier +
// material pairs stored twice, so two rows shared a key and React stopped
// updating the list: typing "pearl" left plywood rows on screen.
//
// Pins the three parts of the fix: the options are one per supplier, the row
// key is built from that supplier, and Add picks the same binding the row shows.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/pages/procurement/create.tsx", import.meta.url), "utf8");

test("popup options are deduped by supplier", () => {
  const block = src.slice(src.indexOf("optionsFor={(code) =>"), src.indexOf("addedKeys={addedKeys}"));
  assert.ok(block.length > 0, "optionsFor prop not found");
  assert.match(block, /findIndex\(\(x\) => x\?\.supplierId === b\.supplierId\) === i/);
});

test("row key is material id + supplier id", () => {
  assert.match(src, /key=\{`\$\{rm\.id\}\|\$\{opt\?\.supplierId \?\? ""\}`\}/);
});

test("Add uses the first sorted binding for the row's supplier, like the row", () => {
  const add = src.slice(src.indexOf("const addItemFromRM"), src.indexOf("const seedQty"));
  assert.match(add, /getSortedBindingsForRM\(rmItemCode\)\.find\(\(b\) => b\.supplierId === supplierId\)/);
});
