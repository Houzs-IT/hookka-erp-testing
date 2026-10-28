// ---------------------------------------------------------------------------
// po-overdue-invoiced.test.mjs — HK-0114 (BUG-2026-10-26-392). The Overdue POs
// widget counted 108 POs on prod 2026-10-26; 101 of them were already billed
// by a purchase invoice raised straight from the PO, which never moves
// receivedQty or status. A line now counts as delivered by
// max(received, invoiced), bucketed the way the PI double-bill guard buckets.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { poIdsDeliveredInFull } from "../src/api/lib/po-delivered.ts";

const item = (id, po, code, qty, recv = 0) => ({
  id,
  purchaseOrderId: po,
  materialCode: code,
  quantity: qty,
  receivedQty: recv,
});
const inv = (po, poItemId, code, qty) => ({ poId: po, poItemId, materialCode: code, qty });

test("fully invoiced PO with no GRN is delivered", () => {
  const out = poIdsDeliveredInFull(
    [item(1, "po-a", "RM-1", 10), item(2, "po-a", "RM-2", 5)],
    [inv("po-a", null, "RM-1", 10), inv("po-a", null, "RM-2", 5)],
  );
  assert.deepEqual([...out], ["po-a"]);
});

test("part-invoiced PO stays open (PO-2610-011 shape: 52 of 152)", () => {
  const out = poIdsDeliveredInFull([item(1, "po-b", "RM-1", 152)], [inv("po-b", null, "RM-1", 52)]);
  assert.equal(out.has("po-b"), false);
});

test("PO with no invoice and no receipt stays open", () => {
  const out = poIdsDeliveredInFull([item(1, "po-c", "RM-1", 16)], []);
  assert.equal(out.has("po-c"), false);
});

test("received by GRN alone still counts", () => {
  const out = poIdsDeliveredInFull([item(1, "po-d", "RM-1", 8, 8)], []);
  assert.equal(out.has("po-d"), true);
});

test("max, not sum: a GRN that is then billed is not counted twice", () => {
  const out = poIdsDeliveredInFull([item(1, "po-e", "RM-1", 10, 5)], [inv("po-e", "1", "RM-1", 5)]);
  assert.equal(out.has("po-e"), false);
});

test("two lines of one material share a bucket", () => {
  const out = poIdsDeliveredInFull(
    [item(1, "po-f", "RM-1", 4), item(2, "po-f", "RM-1", 6)],
    [inv("po-f", "1", "RM-1", 10)],
  );
  assert.equal(out.has("po-f"), true);
});

test("a line without a material code matches its invoice by PO line id", () => {
  const items = [item(7, "po-g", null, 3)];
  assert.equal(poIdsDeliveredInFull(items, [inv("po-g", "7", null, 3)]).has("po-g"), true);
  assert.equal(poIdsDeliveredInFull(items, [inv("po-g", "8", null, 3)]).has("po-g"), false);
});

test("an invoice for another PO, or a code not on this PO, does not cover it", () => {
  const items = [item(1, "po-h", "RM-1", 5)];
  assert.equal(poIdsDeliveredInFull(items, [inv("po-x", null, "RM-1", 5)]).has("po-h"), false);
  assert.equal(poIdsDeliveredInFull(items, [inv("po-h", null, "RM-9", 5)]).has("po-h"), false);
});

// HK-0119 — PO-000107 shape: the legacy line has no material code, the PI line
// has neither a code nor a PO line, only the same material name.
const named = (id, po, name, qty) => ({ ...item(id, po, null, qty), materialName: name });
const invNamed = (po, name, qty, code = null) => ({ ...inv(po, null, code, qty), materialName: name });

test("a code-less line matches a code-less invoice row by material name", () => {
  const items = [named(1, "po-i", "18MM 4' X 8' MR AA PLYWOOD", 10), item(2, "po-i", "6MM MDF/B", 50)];
  const out = poIdsDeliveredInFull(items, [
    invNamed("po-i", " 18mm 4' x 8' mr aa plywood ", 10),
    inv("po-i", null, "6MM MDF/B", 52),
  ]);
  assert.equal(out.has("po-i"), true);
});

test("name fallback: short billing stays open, and a coded invoice row never matches by name", () => {
  const items = [named(1, "po-j", "GREEN SPONGE", 20)];
  assert.equal(poIdsDeliveredInFull(items, [invNamed("po-j", "GREEN SPONGE", 19)]).has("po-j"), false);
  assert.equal(poIdsDeliveredInFull(items, [invNamed("po-j", "GREEN SPONGE", 20, "D30-3\"")]).has("po-j"), false);
});

test("two code-less lines of one name share a bucket", () => {
  const items = [named(1, "po-k", "WHITE SPONGE", 15), named(2, "po-k", "WHITE SPONGE", 25)];
  assert.equal(poIdsDeliveredInFull(items, [invNamed("po-k", "WHITE SPONGE", 40)]).has("po-k"), true);
});

test("/stats flags deliveredInFull and the page's overdue check skips it", () => {
  const route = readFileSync(resolve(process.cwd(), "src/api/routes/purchase-orders.ts"), "utf8");
  const lib = readFileSync(resolve(process.cwd(), "src/api/lib/po-delivered.ts"), "utf8");
  const page = readFileSync(resolve(process.cwd(), "src/pages/procurement/index.tsx"), "utf8");
  assert.match(route, /deliveredInFull: delivered\.has\(p\.id\)/);
  assert.match(lib, /pi\.status NOT IN \('CANCELLED','DRAFT'\)/);
  const fn = page.slice(page.indexOf("const isOverdue = useCallback"), page.indexOf("const daysLate"));
  assert.match(fn, /deliveredPoIds\.has\(po\.id\)/);
});
