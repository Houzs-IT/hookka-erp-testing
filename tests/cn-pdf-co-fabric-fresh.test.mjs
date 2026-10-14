// ---------------------------------------------------------------------------
// cn-pdf-co-fabric-fresh.test.mjs — the CN PDF's CO No. and fabric come from
// GET /api/consignment-notes/:id/print-extras, not only from the page's
// /ready-planning lookups (BUG-2026-10-14-285, IT Hub HK-0093).
//
// /ready-planning is a stale-while-revalidate snapshot: the first read after a
// CN is created returns the blob built before it, whose poLookups lack the new
// CN's production orders. CGN-2610-002 printed straight after creation with
// "-" under CO No. and no fabric, while its racks (already from print-extras)
// printed fine. print-extras joins production_orders on every call.
//
// Second ask on the same ticket: the customer's own CO number (2990's
// "2990-PCO-2610-019", consignment_orders.customer_co_id) prints as the PO on
// the CN line and on the CO-origin packing sticker's "PO No" line.
//
// Style: structural regex pins on source (cn-pdf-size-column.test.mjs).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...p) => readFileSync(join(process.cwd(), ...p), "utf8");
const PAGE = read("src", "pages", "consignment", "note.tsx");
const PDF = read("src", "lib", "generate-cn-pdf.ts");
const PROD = read("src", "pages", "production", "index.tsx");
const API = read("src", "api", "routes", "consignment-notes.ts");

const printExtras = API.slice(
  API.indexOf('app.get("/:id/print-extras"'),
  API.indexOf("// POST /api/consignment-notes\n") > 0
    ? API.indexOf("// POST /api/consignment-notes\n")
    : API.indexOf("// POST /api/consignment-notes\r\n"),
);

test("print-extras reads the PO's CO No. and fabric", () => {
  assert.ok(printExtras.length > 0);
  assert.match(printExtras, /po\.fabricCode AS fabricCode,/);
  assert.match(printExtras, /po\.companyCOId AS companyCOId,/);
  assert.match(printExtras, /fabricCode: r\.fabricCode \|\| null,/);
  assert.match(printExtras, /companyCOId: r\.companyCOId \|\| null,/);
});

test("buildCnPdfData prefers print-extras over the snapshot lookups", () => {
  assert.match(PAGE, /fabricCode: ex\?\.fabricCode \|\| it\.fabricCode,/);
  assert.match(PAGE, /consignmentOrderNo: ex\?\.companyCOId \|\| it\.consignmentOrderNo,/);
});

test("the print handlers fetch print-extras before building the PDF", () => {
  assert.match(
    PAGE,
    /await ensureCnExtras\(\[row\.id\]\);\s*const \{ generateCNPdf \} = await import\("@\/lib\/generate-cn-pdf"\);\s*generateCNPdf\(buildCnPdfData\(row\), mode\);/,
  );
});

test("print-extras reads the customer's CO number from the line's CO", () => {
  assert.match(printExtras, /co\.customerCOId AS customerCOId\s+FROM consignment_items ci/);
  // A line without a production order falls back to the CN's own CO.
  assert.match(
    printExtras,
    /LEFT JOIN consignment_orders co\s+ON co\.id = COALESCE\(po\.consignmentOrderId, \?\)/,
  );
  assert.match(printExtras, /\.bind\(cnRow\.consignmentOrderId, id\)/);
  assert.match(printExtras, /customerPOId: r\.customerCOId \|\| null,/);
});

test("CN PDF stacks our CO and the customer's PO in the Order column", () => {
  assert.match(PAGE, /customerPOId: ex\?\.customerPOId \?\? null,/);
  assert.match(PDF, /\{ content: "Order" \},/);
  assert.match(
    PDF,
    /`Our CO: \$\{it\.consignmentOrderNo \|\| "-"\}\\nPO: \$\{\(it\.customerPOId \|\| ""\)\.trim\(\) \|\| "-"\}`/,
  );
  assert.match(PDF, /1: \{ cellWidth: 32 \}, \/\/ Order/);
});

test("CO-origin packing sticker falls back to the customer CO number for PO No", () => {
  assert.match(
    PROD,
    /customerPOId:\s*o\.customerPOId \|\| \(o\.consignmentOrderId \? o\.customerSO : ""\) \|\| "",/,
  );
});
