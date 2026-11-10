// Documents and PDFs (cross-system review 2026-11-10, section 2a).
//   D1 / P7 — one in-app PDF preview, every saved PDF named after the document,
//             and a blocked new tab is reported instead of silent.
// Pure helpers are exercised directly; the wiring is pinned by source pattern
// (house style for UI, see tests/fe-quality-batch-a.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  pdfFileName,
  cleanFileNamePart,
  pdfTitle,
  openUrlInNewTab,
  PDF_PREVIEW_CACHE,
  PDF_PREVIEW_PREFIX,
} from "../src/lib/pdf-preview.ts";

const read = (p) => readFileSync(p, "utf8");

// ── D1: file names ────────────────────────────────────────────────────────
test("pdfFileName names the file after the document and its party", () => {
  assert.equal(pdfFileName("PO-2611-012", "Supplier Name"), "PO-2611-012 Supplier Name.pdf");
  assert.equal(pdfFileName("SO-2611-001", "  Acme   Sdn Bhd "), "SO-2611-001 Acme Sdn Bhd.pdf");
  assert.equal(pdfFileName("GRN-2611-003"), "GRN-2611-003.pdf");
  assert.equal(pdfFileName("", "Acme", "INVOICE"), "INVOICE Acme.pdf");
  assert.equal(pdfFileName(undefined, undefined, "DO"), "DO.pdf");
  // The same text twice is not repeated.
  assert.equal(pdfFileName("DO-1", "DO-1"), "DO-1.pdf");
});

test("pdfFileName drops characters a file system refuses and caps the length", () => {
  assert.equal(pdfFileName("PI-2611-004", 'A/B: "C" <D>|E?*'), "PI-2611-004 A B C D E.pdf");
  assert.equal(cleanFileNamePart("a\u0000b\tc\nd"), "a b c d");
  assert.equal(pdfFileName("INV-1", "Trailing Co."), "INV-1 Trailing Co.pdf");
  const long = pdfFileName("PO-1", "x".repeat(300));
  assert.ok(long.length <= 124, `too long: ${long.length}`);
  assert.ok(long.endsWith(".pdf"));
  assert.equal(pdfTitle("PO-1 Acme.pdf"), "PO-1 Acme");
});

// ── P7: a blocked tab is reported ─────────────────────────────────────────
test("openUrlInNewTab reports a blocked tab and clears the opener of an open one", () => {
  const prev = globalThis.window;
  try {
    globalThis.window = { open: () => null };
    assert.equal(openUrlInNewTab("/x"), false);
    const tab = { opener: "page" };
    globalThis.window = { open: () => tab };
    assert.equal(openUrlInNewTab("/x"), true);
    assert.equal(tab.opener, null);
    globalThis.window = { open: () => { throw new Error("blocked"); } };
    assert.equal(openUrlInNewTab("/x"), false);
  } finally {
    globalThis.window = prev;
  }
});

// ── D1: wiring ────────────────────────────────────────────────────────────
test("no generator opens a PDF blob in a new tab any more; 'view' is the in-app preview", () => {
  for (const f of [
    "src/lib/generate-invoice-pdf.ts",
    "src/lib/generate-do-pdf.ts",
    "src/lib/generate-cn-pdf.ts",
  ]) {
    const src = read(f);
    assert.ok(!/window\.open\(/.test(src), `${f} still calls window.open`);
    assert.ok(/deliverJsPdf\(doc, fileName, mode\)/.test(src), `${f} does not use deliverJsPdf`);
  }
  for (const f of [
    "src/lib/generate-purchase-order-pdf.ts",
    "src/lib/generate-grn-pdf.ts",
    "src/lib/generate-purchase-invoice-pdf.ts",
  ]) {
    const src = read(f);
    assert.ok(/mode\?: PdfOutputMode/.test(src), `${f} has no view mode`);
    assert.ok(/deliverJsPdf\(doc, pdfFileName\(/.test(src), `${f} does not name the file after the document`);
  }
  const unified = read("src/lib/unified-doc-download.ts");
  assert.ok(!/w\.location\.href = URL\.createObjectURL/.test(unified), "invoice view still writes a blob into a tab");
  assert.equal((unified.match(/deliverPdf\(bytes, pdfFileName\(/g) ?? []).length, 4, "SO / CO / DO / Invoice named + previewable");
  for (const f of [
    "src/lib/generate-credit-note-pdf.ts",
    "src/lib/generate-debit-note-pdf.ts",
    "src/lib/generate-delivery-return-pdf.ts",
  ]) {
    assert.ok(/doc\.save\(pdfFileName\(/.test(read(f)), `${f} file not named after the document`);
  }
});

test("SO / PO / PI / GRN / DO / CO / Invoice pages open the preview", () => {
  const sites = [
    ["src/pages/sales/detail.tsx", /generateSOPdf\(order, customer, "view"\)/],
    ["src/pages/consignment/detail.tsx", /generateCOPdf\(order, customer, "view"\)/],
    ["src/pages/procurement/detail.tsx", /generatePurchaseOrderPdf\(\{ \.\.\.po, purchaseOrgCode \}, lh, \{ mode: "view" \}\)/],
    ["src/pages/procurement/detail.tsx", /generateGRNPdf\(po, lh, \{ mode: "view" \}\)/],
    ["src/pages/procurement/grn-detail.tsx", /\}, lh, \{ mode: "view" \}\)/],
    ["src/pages/procurement/PurchaseInvoiceDetail.tsx", /\{ mode: "view" \}/],
    ["src/pages/delivery/detail.tsx", /doPdf\("view"\)/],
    ["src/pages/invoices/detail.tsx", /downloadUnifiedInvoicePdf\(invoice, extras, mode\)/],
  ];
  for (const [file, re] of sites) assert.ok(re.test(read(file)), `${file}: ${re}`);
  // The invoice page no longer pre-opens a tab for the view.
  assert.ok(!/window\.open\("", "_blank"\)/.test(read("src/pages/invoices/detail.tsx")));
  // The PI source document reports a blocked tab (noopener used to hide it).
  const pi = read("src/pages/procurement/PurchaseInvoiceDetail.tsx");
  assert.ok(/openUrlInNewTab\(url\)\) toast\.error\(BLOCKED_TAB_MESSAGE\)/.test(pi));
});

test("the service worker serves the named preview path from its own cache, before the navigate rule", () => {
  const sw = read("public/sw.js");
  assert.ok(sw.includes(`const PDF_PREVIEW_CACHE = '${PDF_PREVIEW_CACHE}'`), "cache name out of step with pdf-preview.ts");
  assert.ok(sw.includes(`const PDF_PREVIEW_PREFIX = '${PDF_PREVIEW_PREFIX}'`), "path prefix out of step with pdf-preview.ts");
  const route = sw.indexOf("url.pathname.startsWith(PDF_PREVIEW_PREFIX)");
  const nav = sw.indexOf("if (req.mode === 'navigate')");
  assert.ok(route > 0 && route < nav, "the preview route must come before the navigate rule (an iframe load is a navigation)");
  assert.ok(/k !== CACHE && k !== PDF_PREVIEW_CACHE/.test(sw), "activate must not drop the preview cache");
  // The page only uses the path when THIS worker answered it.
  const lib = read("src/lib/pdf-preview.ts");
  assert.ok(/probe\.headers\.get\(PDF_PREVIEW_HEADER\) !== "1"/.test(lib));
});
