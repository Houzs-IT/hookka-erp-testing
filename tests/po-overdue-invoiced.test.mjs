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

test("/stats flags deliveredInFull and the page's overdue check skips it", () => {
  const route = readFileSync(resolve(process.cwd(), "src/api/routes/purchase-orders.ts"), "utf8");
  const page = readFileSync(resolve(process.cwd(), "src/pages/procurement/index.tsx"), "utf8");
  assert.match(route, /deliveredInFull: delivered\.has\(p\.id\)/);
  assert.match(route, /pi\.status NOT IN \('CANCELLED','DRAFT'\)/);
  const fn = page.slice(page.indexOf("const isOverdue = useCallback"), page.indexOf("const daysLate"));
  assert.match(fn, /deliveredPoIds\.has\(po\.id\)/);
});
