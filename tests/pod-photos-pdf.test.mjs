// POD photos in PDFs (cross-system review 2026-11-10, D3 / D4; Houzs#5488,
// Conts#544, #641, #649): the DO PDF prints its POD photos two per page after
// the document, and "POD photos PDF" makes one PDF of a DO's photos to send on
// WhatsApp. Display only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";

import {
  formatMyt,
  podPhotoCaption,
  podPageCount,
  fitInBox,
  photoSlots,
  buildPodPhotosPdf,
  appendPodPagesToPdfBytes,
} from "../src/lib/pod-photos-pdf.ts";
import {
  dataUrlToBytes,
  podPhotoCount,
  podPhotosFileName,
  POD_PDF_PHOTO_MAX_DIM,
  POD_PDF_PHOTO_QUALITY,
} from "../src/lib/pod-photos-load.ts";

const read = (p) => readFileSync(p, "utf8");
// 1×1 PNG.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const png = () => ({ bytes: dataUrlToBytes(`data:image/png;base64,${PNG_B64}`), kind: "png" });

test("captions say which photo and when, in Malaysia time", () => {
  // 06:05 UTC = 2:05 pm in Kuala Lumpur.
  assert.equal(formatMyt("2026-11-10T06:05:00Z"), "10 Nov 2026, 2:05 pm MYT");
  assert.equal(formatMyt(""), "");
  assert.equal(formatMyt("not a date"), "");
  assert.equal(podPhotoCaption(2, 8, "2026-11-10T06:05:00Z"), "Photo 3 of 8, captured 10 Nov 2026, 2:05 pm MYT");
  assert.equal(podPhotoCaption(0, 1), "Photo 1 of 1");
});

test("two photos per page, fitted without stretching or upscaling", () => {
  assert.equal(podPageCount(0), 0);
  assert.equal(podPageCount(1), 1);
  assert.equal(podPageCount(2), 1);
  assert.equal(podPageCount(5), 3);
  assert.deepEqual(fitInBox(2000, 1000, 500, 500), { width: 500, height: 250 });
  assert.deepEqual(fitInBox(100, 50, 500, 500), { width: 100, height: 50 });
  assert.deepEqual(fitInBox(0, 50, 500, 500), { width: 0, height: 0 });
  const [a, b] = photoSlots();
  assert.ok(b.y + b.height < a.y, "the two slots must not overlap");
  assert.ok(b.y > 40, "the bottom slot clears the footer");
});

test("the POD photos PDF has one page per two photos", async () => {
  const input = { docNo: "DO-2611-001", customerName: "Acme", deliveredAt: "2026-11-10T06:05:00Z", photos: [png(), png(), png()] };
  const pdf = await PDFDocument.load(await buildPodPhotosPdf(input));
  assert.equal(pdf.getPageCount(), 2);
  // Signature only (no photos) still gives the signature page.
  const sigOnly = await PDFDocument.load(await buildPodPhotosPdf({ docNo: "DO-1", photos: [], signature: png() }));
  assert.equal(sigOnly.getPageCount(), 1);
});

test("the DO PDF gets the photo pages after its own pages, and is untouched without a POD", async () => {
  const base = await PDFDocument.create();
  base.addPage();
  const bytes = await base.save();
  const withPod = await PDFDocument.load(await appendPodPagesToPdfBytes(bytes, { docNo: "DO-1", photos: [png(), png(), png(), png()] }));
  assert.equal(withPod.getPageCount(), 3);
  assert.equal(await appendPodPagesToPdfBytes(bytes, { docNo: "DO-1", photos: [] }), bytes);
  // A photo that cannot be decoded is left out instead of failing the PDF.
  const bad = { bytes: new Uint8Array([1, 2, 3]), kind: "jpg" };
  const skipped = await PDFDocument.load(await appendPodPagesToPdfBytes(bytes, { docNo: "DO-1", photos: [bad, png()] }));
  assert.equal(skipped.getPageCount(), 2);
});

test("photos are downscaled for the PDF and the file is named after the DO", () => {
  assert.ok(POD_PDF_PHOTO_MAX_DIM <= 1000);
  assert.ok(POD_PDF_PHOTO_QUALITY <= 0.75);
  assert.equal(podPhotosFileName("DO-2611-001", "Acme"), "DO-2611-001 Acme - POD photos.pdf");
  assert.equal(podPhotosFileName("DO-2611-001"), "DO-2611-001 POD photos.pdf");
  assert.equal(podPhotoCount({ photoDataUrls: ["data:a", "", "data:b"] }), 2);
  assert.equal(podPhotoCount(null), 0);
  const load = read("src/lib/pod-photos-load.ts");
  assert.ok(/compressImage\(file, \{ maxDim: POD_PDF_PHOTO_MAX_DIM, quality: POD_PDF_PHOTO_QUALITY \}\)/.test(load));
});

test("the DO page prints the POD in the DO PDF and offers the POD photos PDF", () => {
  const page = read("src/pages/delivery/detail.tsx");
  assert.ok(/await downloadUnifiedDoPdf\(order, extras, mode, pod\)/.test(page));
  assert.ok(/loadPodPdfInput\(order\.doNo, order\.customerName, order\.proofOfDelivery\)/.test(page));
  assert.ok(/POD photos PDF/.test(page));
  assert.ok(/openPodPhotosPdf\(order\.doNo, order\.customerName, order\.proofOfDelivery, "view"\)/.test(page));
  const unified = read("src/lib/unified-doc-download.ts");
  assert.ok(/if \(pod\) bytes = await appendPodPagesToPdfBytes\(bytes, pod\)/.test(unified));
  // The customer-notify email path renders without photos.
  assert.ok(!/appendPodPagesToPdfBytes/.test(read("src/api/lib/unified-do-invoice-pdf.ts")));
  // The preview can hand the file to the phone's share sheet (WhatsApp).
  assert.ok(/navigator\.share\(\{ files: \[shareFile as File\], title \}\)/.test(read("src/lib/pdf-preview.ts")));
});
