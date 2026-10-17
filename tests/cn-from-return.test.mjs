// ---------------------------------------------------------------------------
// A Credit Note from a Delivery Return (owner 2026-10-17, Finance v2
// 「这些都做」): pick a return on the Credit Notes page — customer, the invoice
// that billed its delivery order and one line per returned item at that
// invoice's price per unit fill in; the note remembers its return, one note
// per return. Made-up figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { priceReturnLines } from "../src/lib/cn-from-return.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("returned lines are priced at what their invoice charged per unit, on the invoice that billed most of them", () => {
  const draft = priceReturnLines(
    [
      { productionOrderId: "po-1", productCode: "BF-1", productName: "Bed frame", quantity: 1 },
      { productionOrderId: "po-2", productCode: "SF-2", productName: "Sofa", quantity: 2 },
      { productionOrderId: "po-9", productCode: "AC-9", productName: "Pillow", quantity: 1 },   // billed elsewhere
      { productionOrderId: null, productCode: "X", productName: "No order", quantity: 1 },      // never billed
    ],
    [{ id: "inv-A", invoiceNo: "INV-A", outstandingSen: 500000 }, { id: "inv-B", invoiceNo: "INV-B", outstandingSen: 100000 }],
    [
      { invoiceId: "inv-A", productionOrderId: "po-1", quantity: 1, totalSen: 120000 },
      { invoiceId: "inv-A", productionOrderId: "po-2", quantity: 3, totalSen: 100000 },  // after its line discount: 333.33 a unit
      { invoiceId: "inv-B", productionOrderId: "po-9", quantity: 1, totalSen: 5000 },
      { invoiceId: "inv-Z", productionOrderId: "po-1", quantity: 1, totalSen: 1 },       // not this return's invoice
    ],
  );
  assert.equal(draft.invoice?.id, "inv-A");
  assert.deepEqual(draft.lines, [
    { description: "BF-1 Bed frame", quantity: 1, unitPriceSen: 120000 },
    { description: "SF-2 Sofa", quantity: 2, unitPriceSen: 33333 },
    { description: "AC-9 Pillow", quantity: 1, unitPriceSen: null },
    { description: "X No order", quantity: 1, unitPriceSen: null },
  ]);
  assert.equal(draft.valueSen, 120000 + 2 * 33333);
  assert.equal(draft.unpriced, 2);
});

test("a return whose delivery order was never invoiced has no invoice and no prices", () => {
  const draft = priceReturnLines([{ productionOrderId: "po-1", productCode: "A", productName: "", quantity: 1 }], [], []);
  assert.equal(draft.invoice, null);
  assert.equal(draft.unpriced, 1);
  assert.equal(draft.valueSen, 0);
});

test("GET /from-returns: reachable before /:id, gated like creating a note, links a used return to its note", () => {
  const api = read("src/api/routes/credit-notes.ts");
  const at = api.indexOf('app.get("/from-returns"');
  assert.ok(at > 0 && at < api.indexOf('app.get("/:id"'), "registered before /:id, or /:id would swallow it");
  const body = api.slice(at, api.indexOf("\n});\n", at));
  assert.match(body, /requirePermission\(c, "credit-notes", "create"\)/);
  assert.match(body, /FROM delivery_returns WHERE org_id = \? AND status <> 'CANCELLED'/);
  assert.match(body, /FROM invoices\n\s*WHERE delivery_order_id IN \(\$\{marks\(doIds\.length\)\}\) AND status NOT IN \('DRAFT','CANCELLED'\)/);
  assert.match(body, /const draft = priceReturnLines\(lines, invoices, invLines\);/);
  assert.match(body, /str\(n, "deliveryReturnId", "delivery_return_id"\) === id\)/);
  assert.match(body, /`Delivery Return \$\{returnNo\}`/, "notes raised before the link existed still count");
});

test("POST: one note per return, the link stored and written back to the return", () => {
  const api = read("src/api/routes/credit-notes.ts");
  const post = api.slice(api.indexOf('app.post("/", async (c) => {'), api.indexOf('app.get("/:id"'));
  assert.match(post, /await ensureCreditNoteReturnColumn\(c\.var\.DB\);/);
  assert.match(post, /SELECT noteNumber FROM credit_notes WHERE delivery_return_id = \?/);
  assert.match(post, /This delivery return already has credit note/);
  assert.match(post, /date, reason, reasonDetail, totalAmount, status, approvedBy, items, delivery_return_id\)/);
  assert.match(post, /UPDATE delivery_returns SET credit_note_id = \? WHERE id = \? AND COALESCE\(credit_note_id, ''\) = ''/);
  assert.match(api, /ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS delivery_return_id TEXT/);
});

test("the Credit Notes page: From Delivery Return picker, priced prefill, the link sent on save", () => {
  const ui = read("src/pages/invoices/credit-notes.tsx");
  assert.match(ui, /<Button variant="outline" onClick=\{openPicker\}>From Delivery Return<\/Button>/);
  assert.match(ui, /fetch\("\/api\/credit-notes\/from-returns"\)/);
  assert.match(ui, /fetch\(`\/api\/credit-notes\/from-returns\?returnId=\$\{encodeURIComponent\(fromReturn\)\}`\)/, "a return's own page lands on the same prefill");
  assert.match(ui, /unitPriceSen: l\.unitPriceSen \?\? 0,\n\s*priceStr: l\.unitPriceSen != null \? \(l\.unitPriceSen \/ 100\)\.toFixed\(2\) : "",/);
  assert.match(ui, /\.\.\.\(fromReturnDraft \? \{ deliveryReturnId: fromReturnDraft\.id \} : \{\}\),/);
  const block = ui.slice(ui.indexOf("function returnCandidateBlock("), ui.indexOf("export default function CreditNotesPage"));
  assert.match(block, /if \(d\.creditNote\) return `CN issued · \$\{d\.creditNote\.noteNumber\}`;/);
  assert.match(block, /if \(!d\.invoice\) return "Not invoiced";/);
  assert.match(block, /if \(d\.invoice\.outstandingSen <= 0\) return "Invoice settled";/);
  assert.match(ui, /data-cn-unpriced=""/);
});

test("the return's page names its credit note", () => {
  const api = read("src/api/routes/delivery-returns.ts");
  assert.match(api, /creditNoteNo = String\(\(cn\?\.noteNumber \?\? cn\?\.note_number\) \?\? ""\);/);
  const ui = read("src/pages/delivery-returns/detail.tsx");
  assert.match(ui, /\{dr\.creditNoteNo \|\| dr\.creditNoteId\}/);
});
