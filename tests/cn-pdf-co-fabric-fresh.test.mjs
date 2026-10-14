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
// Style: structural regex pins on source (cn-pdf-size-column.test.mjs).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...p) => readFileSync(join(process.cwd(), ...p), "utf8");
const PAGE = read("src", "pages", "consignment", "note.tsx");
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
  assert.match(printExtras, /po\.companyCOId AS companyCOId\s+FROM consignment_items ci/);
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
