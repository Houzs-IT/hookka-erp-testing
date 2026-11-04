// m-pi-links-and-documents.test.mjs — the two PI gaps, as far as the EXISTING APIs allow (client side only; the backend parts are a
// proposal awaiting approval, docs/WORK-TRACKER.md item 21).
//   1. Per-line PO links through GET → edit → PUT. The PUT already stores a line's own `poId` (else it falls back to the header PO),
//      so the phone echoes each line's `poId` back untouched when the GET provides it; it never invents one. The GET does not provide
//      it yet, so today this changes nothing — and the day it does, an edit keeps every line where it was.
//   2. Documents on a saved invoice: the source file linked at create PLUS files attached later through the generic file API,
//      attached at most once, behind the right permissions.
// Fixture data only; nothing here touches a server.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { piEditBody, piEditLines } from "../src/pages/m/lib/procurement-mobile.ts";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const H = { invoiceDate: "2026-11-04", dueDate: "", remarks: "r", supplierInvoiceNo: "I1", supplierDoNo: "" };
const ITEMS = [
  { id: "pii-1", materialCode: "A", materialName: "Alpha", qty: 10, unitPriceSen: 100, poId: "po-1" },
  { id: "pii-2", materialCode: "B", materialName: "Bravo", qty: 5, unitPriceSen: 200, poId: "po-2" },
  { id: "pii-3", materialCode: "C", materialName: "Charlie", qty: 2, unitPriceSen: 300, poId: "po-1" },
];

test("each line's PO comes off the invoice and goes back on the PUT unchanged (multi-PO, edited, one line removed)", () => {
  const lines = piEditLines({ items: ITEMS });
  assert.deepEqual(lines.map((l) => l.poId), ["po-1", "po-2", "po-1"]);
  const edited = lines.filter((l) => l.materialCode !== "A").map((l) => (l.materialCode === "B" ? { ...l, qty: "7" } : l));
  const body = piEditBody(H, edited);
  assert.deepEqual(body.items.map((i) => [i.materialCode, i.qty, i.poId]), [["B", 7, "po-2"], ["C", 2, "po-1"]]);
});

test("a line whose PO the GET did not say gets NO poId key (an invented null would read as the header PO and move it)", () => {
  const lines = piEditLines({ items: [{ materialName: "A", qty: 1, unitPriceSen: 100 }, { materialName: "B", qty: 1, unitPriceSen: 100, poId: "" }, { materialName: "C", qty: 1, unitPriceSen: 100, poId: null }] });
  assert.deepEqual(lines.map((l) => l.poId), [null, null, null]);
  for (const it of piEditBody(H, lines).items) assert.ok(!("poId" in it), "no poId sent");
});

test("existing edit behaviour is unchanged otherwise (notes, grn link, discount allocation)", () => {
  const lines = piEditLines({ items: [{ materialName: "A", qty: 2, unitPriceSen: 500, notes: "n", grnItemId: 9, poId: "po-1" }] });
  const b = piEditBody(H, lines).items[0];
  assert.deepEqual([b.notes, b.grnItemId, b.qty, b.unitPriceSen], ["n", "9", 2, 500]);
});

test("the PI detail lists the source file AND files attached later (resourceType PI), deduplicated, and views them inline", () => {
  const d = read("screens/procurement/PiDetail.tsx");
  assert.match(d, /listRecordFiles\("PI", id\)/);
  assert.match(d, /label: "Source document"/);
  assert.match(d, /filter\(\(f\) => f\.id !== srcId\)/, "the source file is not listed twice");
  assert.match(d, /\/download\?inline=1/);
});

test("Add document needs BOTH files:create and purchase-invoices:update, is never offered on a cancelled invoice, and attaches at most once", () => {
  const d = read("screens/procurement/PiDetail.tsx");
  assert.match(d, /!== "CANCELLED" && hasPermission\("files", "create"\) && hasPermission\("purchase-invoices", "update"\)/);
  assert.match(d, /attachOnceReturningId\(\{ kind: "file", file: f \}, "PI", id, f\.name\)/);
  const a = read("screens/scan/attach-once.ts");
  assert.match(a, /existing\?\.find\(\(f\) => !fileName \|\| f\.filename === fileName\);\n\s+if \(hit\) return hit\.id;/, "the record's files are listed first");
  assert.ok(a.indexOf("listRecordFiles(resourceType, resourceId)") < a.indexOf("uploadSourceDoc(origin"), "look before uploading");
});

test("the PI and GRN scan follow-up steps use the same attach-once helper (a retry cannot store the file twice)", () => {
  assert.match(read("screens/procurement/ScanPiSheet.tsx"), /attachOnceReturningId\(/);
  assert.match(read("screens/procurement/ScanGrnSheet.tsx"), /attachOriginalOnce\(.*"GRN", r\.docId/);
});

test("Add document links the file as the SOURCE only when there is none; replacing an existing source is a separate, confirmed action", () => {
  const d = read("screens/procurement/PiDetail.tsx");
  const add = d.slice(d.indexOf("const addDocument"), d.indexOf("const makeSource"));
  assert.match(add, /if \(!srcId\) \{/);
  assert.match(add, /linkSourceDocument\(id, fid\)/);
  assert.doesNotMatch(add, /linkSourceDocument\(id, fid, true\)/, "adding a document never replaces the source");
  const make = d.slice(d.indexOf("const makeSource"), d.indexOf("const raw = p"));
  assert.match(make, /if \(srcId\) \{[\s\S]*confirmSheet\.confirm/);
  assert.match(make, /linkSourceDocument\(id, fileId, !!srcId\)/);
  assert.match(read("screens/scan/attach-once.ts"), /replace \? \{ fileId, replace: true \} : \{ fileId \}/, "replace is only ever sent when asked for");
});

test("the PI scan follow-up attaches once then links the file as the source (a 409 = already linked counts as done)", () => {
  const sheet = read("screens/procurement/ScanPiSheet.tsx");
  assert.match(sheet, /attachOnceReturningId\(/);
  assert.match(sheet, /linkSourceDocument\(r\.docId, fid\)/);
  assert.match(sheet, /linked\.ok \|\| linked\.status === 409/);
});

test("both edit clients send each line's id with the PO, so the server keeps the id and the links", () => {
  const lines = piEditLines({ items: ITEMS });
  assert.deepEqual(lines.map((l) => l.id), ["pii-1", "pii-2", "pii-3"]);
  assert.deepEqual(piEditBody(H, lines).items.map((i) => [i.id, i.poId]), [["pii-1", "po-1"], ["pii-2", "po-2"], ["pii-3", "po-1"]]);
  const added = piEditBody(H, [...lines, { materialCode: "N", materialName: "New", supplierSku: "", qty: "1", unitPriceSen: 100, taxSen: 0, discountSen: 0, lineType: "STOCKED", grnItemId: null }]).items[3];
  assert.ok(!("id" in added) && !("poId" in added), "a new line carries neither");
});
