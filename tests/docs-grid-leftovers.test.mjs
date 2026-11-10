// ---------------------------------------------------------------------------
// docs-grid-leftovers.test.mjs — the documents / grid leftovers from the
// 2026-11-10 cross-system review (WORK-TRACKER 118).
//
// D5  item codes stay on one line on the PO / GRN / PI PDFs.
//
// Pure helpers are exercised directly; the wiring is pinned by source pattern
// (house style, see tests/fe-quality-batch-a.test.mjs).
// Run: node --import tsx/esm --test tests/docs-grid-leftovers.test.mjs
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jsPDF } from "jspdf";

import { fitCodeColumn } from "../src/lib/pdf-code-column.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// ── D5 ────────────────────────────────────────────────────────────────────
test("D5: a short code keeps the column's old width and font", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  assert.deepEqual(fitCodeColumn(doc, ["PC151", "", null], { minWidth: 24, maxWidth: 38 }), {
    cellWidth: 24,
    fontSize: 8,
  });
});

test("D5: a long code widens the column so it fits on one line at 8 pt", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const code = "HB-1003-QUEEN-FAB";
  const fit = fitCodeColumn(doc, ["PC151", code], { minWidth: 24, maxWidth: 38 });
  assert.equal(fit.fontSize, 8);
  assert.ok(fit.cellWidth > 24 && fit.cellWidth <= 38, `width ${fit.cellWidth}`);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  // Room inside the padding is at least the code's printed width.
  assert.ok(fit.cellWidth - 3.6 >= doc.getTextWidth(code));
});

test("D5: only past the cap does the font shrink, and never below the floor", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const long = "SUPPLIER-ITEM-CODE-2026";
  const fit = fitCodeColumn(doc, [long], { minWidth: 24, maxWidth: 38 });
  assert.equal(fit.cellWidth, 38);
  assert.ok(fit.fontSize < 8 && fit.fontSize >= 6, `font ${fit.fontSize}`);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fit.fontSize);
  assert.ok(38 - 3.6 >= doc.getTextWidth(long));
  const absurd = fitCodeColumn(doc, ["X".repeat(80)], { minWidth: 24, maxWidth: 38 });
  assert.equal(absurd.fontSize, 6);
});

test("D5: measuring leaves the document's font as it found it", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFont("helvetica", "italic");
  doc.setFontSize(13);
  fitCodeColumn(doc, ["SOME-CODE-1234567890"], { minWidth: 24, maxWidth: 38 });
  assert.equal(doc.getFontSize(), 13);
  assert.equal(doc.getFont().fontStyle, "italic");
});

test("D5: PO, GRN and PI size the Item Code column from their own codes", () => {
  for (const f of ["purchase-order", "grn", "purchase-invoice"]) {
    const src = read(`src/lib/generate-${f}-pdf.ts`);
    assert.match(src, /const codeCol = fitCodeColumn\(doc, tableBody\.map\(\(r\) => r\[1\]\)/, f);
    assert.match(src, /1: \{ cellWidth: codeCol\.cellWidth,[^}]*fontSize: codeCol\.fontSize \}/, f);
  }
});
