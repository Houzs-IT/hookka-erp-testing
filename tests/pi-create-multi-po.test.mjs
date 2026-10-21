// ---------------------------------------------------------------------------
// pi-create-multi-po.test.mjs — the PI create page can bill several POs.
//
// ADD WOOD prints `P/O No : 2607-003/2607-020` on one invoice. The backend
// guard already caps each line against its OWN purchase order; this page was
// the last thing that could only name one.
//
// The pins are the ones that keep the money right:
//   • every line must send its own poId, or the second PO is measured against
//     the first one's ceiling — over-invoicing one and wrongly rejecting the
//     other;
//   • re-picking a PO must not double-count a line already on the invoice;
//   • a second supplier must be refused (one invoice, one supplier);
//   • a GRN source must NOT append — it drives invoiced_qty draw-down and
//     there can only be one.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(process.cwd(), "src/pages/procurement/pi/create.tsx"),
  "utf8",
);

test("a line records the purchase order it bills", () => {
  assert.match(SRC, /poId\?: string \| null;/);
  assert.match(SRC, /grnItemId: null,\s*\n\s*poId: null,/, "a blank line has no PO");
});

test("submit sends each line's own PO, not just the header", () => {
  // A hand-added line is NOT stamped with the header PO any more (T-006 R8):
  // the server caps it against the header PO anyway, but a stamped poId would
  // make a blank-code fee line look PO-linked and get it refused.
  assert.match(SRC, /poId: l\.poId \?\? null,/);
  assert.match(SRC, /poItemId: l\.poItemId \?\? null/);
});

test("the ?poId= prefill stamps that PO onto its lines", () => {
  assert.match(SRC, /grnItemId: null,\s*\n\s*poId: po\.id,/);
});

test("adding a further PO appends instead of replacing the invoice", () => {
  assert.match(SRC, /const append = hasLines && res\.source === "po" && !sourceGrnId/);
  assert.match(SRC, /if \(!append\) return incoming/);
  assert.match(SRC, /\[\s*\n\s*\.\.\.kept,/);
});

test("a GRN source never appends — invoiced_qty draw-down allows only one", () => {
  assert.match(SRC, /res\.source === "po" && !sourceGrnId/);
});

test("the FIRST purchase order stays the header", () => {
  assert.match(SRC, /if \(!append \|\| !sourcePurchaseOrderId\) setSourcePurchaseOrderId\(res\.purchaseOrderId\)/);
});

test("re-picking a PO cannot double-count a line already billed", () => {
  // Keyed by PO line when known, so two lines of one material stay apart.
  assert.match(SRC, /l\.poItemId \? `item:\$\{l\.poItemId\}` : `\$\{l\.poId \?\? ""\}:\$\{l\.materialCode\}`/);
  assert.match(SRC, /const seen = new Set\(kept\.map\(lineKey\)\)/);
  assert.match(SRC, /incoming\.filter\(\(l\) => !seen\.has\(lineKey\(l\)\)\)/);
});

test("the blank starter row is dropped rather than billed", () => {
  assert.match(SRC, /const kept = prev\.filter\(\(l\) => l\.materialName\.trim\(\) \|\| l\.qty > 0\)/);
});

test("a second supplier is refused", () => {
  assert.match(SRC, /res\.supplierId !== supplierId/);
  assert.match(SRC, /Create a separate PI for/);
});

test("the remark names every purchase order on the invoice", () => {
  assert.match(SRC, /append && prev \? `\$\{prev\} \+ PO \$\{res\.docLabel\}`/);
});

test("the button says what it now does", () => {
  assert.match(SRC, /\? "Add another PO"\s*\n\s*: "Convert from GR or PO"/);
});
