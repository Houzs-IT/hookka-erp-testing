import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const grn = readFileSync("src/api/routes/grn.ts", "utf8");
const po = readFileSync("src/api/routes/purchase-orders.ts", "utf8");
const twm = readFileSync("src/api/routes/three-way-match.ts", "utf8");

// A receipt spanning several POs has no header poId; a PO must still find it
// through the lines that receive its PO lines.
test("a GRN belongs to a PO by header OR by any of its lines", () => {
  assert.match(grn, /export const GRN_OF_PO_SQL = "\(poId = \? OR id IN \(SELECT grnId FROM grn_items WHERE po_id = \?\)\)"/);
  assert.match(grn, /idx_grn_items_po_id ON grn_items\(po_id\)/);
});

test("PO detail, the posted-receipt edit lock and mark-received all use it", () => {
  assert.equal((po.match(/\$\{GRN_OF_PO_SQL\}/g) ?? []).length, 3);
  assert.doesNotMatch(po, /FROM grns WHERE poId = \?/);
  assert.doesNotMatch(po, /FROM grns\s+WHERE poId = \?/);
});

test("three-way match counts only this PO's lines of a multi-PO receipt", () => {
  assert.match(twm, /\$\{GRN_OF_PO_SQL\} AND status = 'POSTED'/);
  assert.match(twm, /gi\.po_id = \? OR \(COALESCE\(gi\.po_id, ''\) = '' AND g\.poId = \?\)/);
});
