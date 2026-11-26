// ---------------------------------------------------------------------------
// hk-0169-scan-pi-uom.test.mjs — a scanned supplier invoice may bill a PO line
// in another unit (PO in ROLL, invoice in MTR). The scan wizard used to drop
// the unit, so every scanned line was saved in the PO line's unit. Now the
// scanned (or picked) unit is sent when it is a known unit, and the line must
// say how much of the PO line it covers (po_qty), as on the PI form (HK-0149).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanPiLineUnit } from "../src/lib/scan-pi-line-uom.ts";
import { ALL_RM_UOMS } from "../src/lib/material-variants.ts";

const units = ALL_RM_UOMS;

test("same unit as the PO line, or no PO line: nothing of its own", () => {
  assert.deepEqual(scanPiLineUnit({ uom: "roll" }, "ROLL", units), { uom: null, poQty: null, missingPoQty: false });
  assert.deepEqual(scanPiLineUnit({ uom: "MTR" }, null, units), { uom: null, poQty: null, missingPoQty: false });
  assert.deepEqual(scanPiLineUnit({ uom: "" }, "ROLL", units), { uom: null, poQty: null, missingPoQty: false });
});

test("a unit the scanner misread (not on the unit list) falls back to the PO line's unit", () => {
  assert.deepEqual(scanPiLineUnit({ uom: "mtrs" }, "ROLL", units), { uom: null, poQty: null, missingPoQty: false });
});

test("billed in another known unit: sent, and po_qty is required", () => {
  assert.deepEqual(scanPiLineUnit({ uom: " mtr " }, "ROLL", units), { uom: "MTR", poQty: null, missingPoQty: true });
  assert.deepEqual(scanPiLineUnit({ uom: "MTR", poQty: 2 }, "ROLL", units), { uom: "MTR", poQty: 2, missingPoQty: false });
  assert.deepEqual(scanPiLineUnit({ uom: "KG", poQty: 1.5 }, "BUNDLE", [...units, "BUNDLE"]), { uom: "KG", poQty: 1.5, missingPoQty: false });
  // A cleared box comes back as 0: still missing.
  assert.equal(scanPiLineUnit({ uom: "MTR", poQty: 0 }, "ROLL", units).missingPoQty, true);
});

test("the scan wizard sends uom and poQty, and blocks Create while po_qty is missing", () => {
  const src = readFileSync(resolve(process.cwd(), "src/components/scan-supplier-modal.tsx"), "utf8");
  assert.match(src, /uom: unit\.uom,\s*poQty: unit\.poQty,/);
  assert.match(src, /missingPoQty/);
  assert.match(src, /<PiLineUomCell/);
});
