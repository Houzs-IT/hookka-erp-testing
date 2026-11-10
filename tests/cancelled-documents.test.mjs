// Cancelled documents (cross-system review 2026-11-10, D2 / G5; Houzs#5049,
// #4493; Conts#804): a red CANCELLED stamp on the PDF of a cancelled
// SO / CO / PO / PI / DO / GRN / invoice, and the document number struck
// through (row faded) on the main lists, desktop and phone. Display only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jsPDF } from "jspdf";
import { PDFDocument, PDFName } from "pdf-lib";

import {
  isCancelledStatus,
  cancelledDocNoClass,
  cancelledRowClass,
  CANCELLED_DOC_NO_CLASS,
} from "../src/lib/cancelled-doc.ts";
import {
  stampOrigin,
  stampCancelledJsPdf,
  CANCELLED_ANGLE,
} from "../src/lib/pdf-cancelled-stamp.ts";
import { buildUnifiedDocPdf } from "../src/api/lib/unified-do-invoice-pdf.ts";

const read = (p) => readFileSync(p, "utf8");

test("isCancelledStatus matches cancelled / voided statuses only", () => {
  for (const s of ["CANCELLED", "cancelled", " Canceled ", "VOID", "VOIDED"]) assert.equal(isCancelledStatus(s), true, s);
  for (const s of ["DRAFT", "CONFIRMED", "DELIVERED", "PAID", "", null, undefined, 0]) assert.equal(isCancelledStatus(s), false, String(s));
  assert.equal(cancelledDocNoClass("CANCELLED"), CANCELLED_DOC_NO_CLASS);
  assert.ok(CANCELLED_DOC_NO_CLASS.includes("line-through"));
  assert.equal(cancelledDocNoClass("POSTED"), "");
  assert.equal(cancelledRowClass("POSTED"), "");
  assert.notEqual(cancelledRowClass("CANCELLED"), "");
});

test("stampOrigin puts the middle of the rotated stamp on the page centre", () => {
  const a = (CANCELLED_ANGLE * Math.PI) / 180;
  const w = 300, h = 60, cx = 297, cy = 421;
  // pdf-lib (y up): baseline u = (cos, sin), up v = (-sin, cos).
  const up = stampOrigin(cx, cy, w, h, CANCELLED_ANGLE, true);
  const midUp = [up.x + (w / 2) * Math.cos(a) - (h / 2) * Math.sin(a), up.y + (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a)];
  assert.ok(Math.abs(midUp[0] - cx) < 1e-9 && Math.abs(midUp[1] - cy) < 1e-9, `${midUp}`);
  // jsPDF (y down): baseline u = (cos, -sin), up v = (-sin, -cos).
  const dn = stampOrigin(cx, cy, w, h, CANCELLED_ANGLE, false);
  const midDn = [dn.x + (w / 2) * Math.cos(a) - (h / 2) * Math.sin(a), dn.y - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a)];
  assert.ok(Math.abs(midDn[0] - cx) < 1e-9 && Math.abs(midDn[1] - cy) < 1e-9, `${midDn}`);
});

test("stampCancelledJsPdf stamps every page of a jsPDF document", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: false });
  doc.text("Page one", 20, 20);
  doc.addPage();
  doc.text("Page two", 20, 20);
  stampCancelledJsPdf(doc);
  const out = doc.output();
  assert.equal((out.match(/\(CANCELLED\) Tj/g) ?? []).length, 2);
  assert.equal(doc.getNumberOfPages(), 2);
});

test("the unified SO / DO / invoice renderer stamps a cancelled document and leaves a live one alone", async () => {
  const data = {
    kind: "INVOICE",
    docNo: "INV-2611-001",
    docDate: "10 Nov 2026",
    statusText: "NET 30",
    leftFields: [["Bill To", "Acme"]],
    rightFields: [],
    groups: [{ category: "BEDFRAME", items: [{ orderRefs: ["Our SO: SO-1"], code: "BF-1", name: "Bed", specLines: [], set: 1, priceSen: 10000, lineTotalSen: 10000 }] }],
    totalSets: 1,
    subtotalSen: 10000,
    totalSen: 10000,
  };
  const hasExtGState = async (bytes) => {
    const pdf = await PDFDocument.load(bytes);
    // pdf-lib leaves an empty ExtGState dict on every page; the stamp adds
    // one graphics state carrying its opacity (/ca 0.3).
    return pdf
      .getPages()
      .every((p) => /\/ca 0\.3/.test(String(p.node.Resources()?.lookup(PDFName.of("ExtGState")) ?? "")));
  };
  assert.equal(await hasExtGState(await buildUnifiedDocPdf(data)), false, "a live document has no stamp");
  assert.equal(await hasExtGState(await buildUnifiedDocPdf({ ...data, cancelled: true })), true, "the stamp (opacity) is on every page");
});

test("every cancellable document PDF calls the stamp", () => {
  const sites = [
    ["src/lib/generate-purchase-order-pdf.ts", /isCancelledStatus\(po\.status\)\) stampCancelledJsPdf\(doc\)/],
    ["src/lib/generate-grn-pdf.ts", /isCancelledStatus\(data\.status\)\) stampCancelledJsPdf\(doc\)/],
    ["src/lib/generate-purchase-invoice-pdf.ts", /isCancelledStatus\(pi\.status\)\) stampCancelledJsPdf\(doc\)/],
    ["src/lib/generate-invoice-pdf.ts", /isCancelledStatus\(invoice\.status\)\) stampCancelledJsPdf\(doc\)/],
    ["src/lib/generate-do-pdf.ts", /isCancelledStatus\(order\.status\)\) stampCancelledJsPdf\(doc\)/],
    ["src/api/lib/unified-do-invoice-pdf.ts", /if \(data\.cancelled\) stampCancelledPages\(pdf, fonts\.bold\)/],
  ];
  for (const [file, re] of sites) assert.ok(re.test(read(file)), `${file}: ${re}`);
  // The stamp must be applied BEFORE returnDoc hands the doc to a batch merge
  // or the supplier email, so those copies carry it too.
  for (const f of ["src/lib/generate-purchase-order-pdf.ts", "src/lib/generate-grn-pdf.ts", "src/lib/generate-purchase-invoice-pdf.ts"]) {
    const s = read(f);
    assert.ok(s.indexOf("stampCancelledJsPdf(doc)") < s.indexOf("if (opts?.returnDoc) return doc;"), f);
  }
  const unified = read("src/lib/unified-doc-download.ts");
  assert.equal((unified.match(/cancelled: isCancelledStatus\(/g) ?? []).length, 4, "SO / CO / DO / Invoice");
  // The GRN pages pass the status through to the generator.
  assert.equal((read("src/pages/procurement/grn.tsx").match(/status: (grn|row)\.status/g) ?? []).length, 2);
  assert.ok(/status: grn\.status/.test(read("src/pages/procurement/grn-detail.tsx")));
});

test("the main document lists strike a cancelled number through and fade the row", () => {
  const grid = read("src/components/ui/data-grid.tsx");
  assert.ok(/cellClassName\?: \(row: T\) =>/.test(grid));
  assert.ok(/col\.cellClassName\?\.\(row\)/.test(grid), "DataGrid must apply cellClassName to the body cell");
  const lists = [
    ["src/pages/sales/index.tsx", "companySOId"],
    ["src/pages/consignment/index.tsx", "companyCOId"],
    ["src/pages/procurement/index.tsx", "poNo"],
    ["src/pages/procurement/grn.tsx", "grnNumber"],
    ["src/pages/procurement/pi.tsx", "piNo"],
    ["src/pages/invoices/index.tsx", "invoiceNo"],
    ["src/pages/delivery/index.tsx", "doNo"],
  ];
  for (const [file, key] of lists) {
    const s = read(file);
    const re = new RegExp(`key: "${key}"[^\\n]*cellClassName: \\(r\\) => cancelledDocNoClass\\(r\\.status\\)`);
    assert.ok(re.test(s), `${file}: ${key} not struck through`);
    assert.ok(/cancelledRowClass\((r|row)\.status\)/.test(s), `${file}: row not faded`);
  }
  // Phone cards.
  assert.ok(/cancelled=\{isCancelledStatus\(vm\.status\?\.label\)\}/.test(read("src/pages/m/screens/ModuleListScreen.tsx")));
  assert.ok(/textDecoration: cancelled \? "line-through"/.test(read("src/pages/m/components/DocCard.tsx")));
});
