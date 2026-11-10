// Backfill of the #1218 link for system GRNs made before it (owner approved
// 2026-11-10). Pure planner + route wiring pins.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { planAutoGrnLinkBackfill } from "../src/api/lib/pi-auto-grn.ts";

const g = (id, poItemId, code, qty, inv = 0, poId = "po-1") => ({ id, poId, poItemId, materialCode: code, qty, invoicedQty: inv });
const p = (id, poItemId, code, grnItemId = null, poId = "po-1") => ({ id, poId, poItemId, materialCode: code, grnItemId });

test("each untouched GRN line is billed at its received qty; one-to-one lines get the pointer", () => {
  const plan = planAutoGrnLinkBackfill(
    [g("11", "poi-a", "RM-1", 10), g("12", "poi-b", "RM-2", 4)],
    [p("pl-1", "poi-a", "RM-1"), p("pl-2", null, "rm-2 ")],
  );
  assert.deepEqual(plan.setInvoiced, [{ grnItemId: "11", qty: 10 }, { grnItemId: "12", qty: 4 }]);
  // pl-2 has no PO line id: matched on PO + material code, case/space-blind.
  assert.deepEqual(plan.setPointer, [{ piLineId: "pl-1", grnItemId: "11" }, { piLineId: "pl-2", grnItemId: "12" }]);
  assert.equal(plan.noPointer, 0);
});

test("a PI line split across two GRN lines bills both but points at neither", () => {
  const plan = planAutoGrnLinkBackfill(
    [g("21", "poi-a", "RM-1", 6), g("22", "poi-c", "RM-1", 4)],
    [p("pl-1", null, "RM-1")],
  );
  assert.equal(plan.setInvoiced.length, 2);
  assert.deepEqual(plan.setPointer, []);
  assert.equal(plan.noPointer, 2);
});

test("a PI line that already points somewhere is left alone", () => {
  const plan = planAutoGrnLinkBackfill([g("31", "poi-a", "RM-1", 5)], [p("pl-1", "poi-a", "RM-1", "99")]);
  assert.deepEqual(plan.setInvoiced, [{ grnItemId: "31", qty: 5 }]);
  assert.deepEqual(plan.setPointer, []);
});

test("a line another invoice already billed is never touched, only reported", () => {
  const plan = planAutoGrnLinkBackfill([g("41", "poi-a", "RM-1", 8, 8), g("42", "poi-b", "RM-2", 3)], [p("pl-1", "poi-a", "RM-1"), p("pl-2", "poi-b", "RM-2")]);
  assert.deepEqual(plan.billedElsewhere, [{ grnItemId: "41", materialCode: "RM-1", qty: 8, invoicedQty: 8 }]);
  assert.deepEqual(plan.setInvoiced, [{ grnItemId: "42", qty: 3 }]);
  assert.equal(plan.alreadyLinked, false);
});

test("a GRN whose every line is already billed (made after #1218) counts as linked", () => {
  const plan = planAutoGrnLinkBackfill([g("51", "poi-a", "RM-1", 2, 2)], [p("pl-1", "poi-a", "RM-1", "51")]);
  assert.equal(plan.alreadyLinked, true);
  assert.deepEqual(plan.setInvoiced, []);
});

test("routes: GET previews, POST needs update permission and the confirm word; writes are guarded", () => {
  const route = readFileSync("src/api/routes/purchase-invoices.ts", "utf8");
  const get = route.slice(route.indexOf('app.get("/auto-grn-link-backfill"'), route.indexOf('app.post("/auto-grn-link-backfill"'));
  assert.match(get, /requirePermission\(c, "purchase-invoices", "read"\)/);
  assert.match(get, /backfillAutoGrnLinks\(c\.var\.DB, getOrgId\(c\), false\)/);
  const post = route.slice(route.indexOf('app.post("/auto-grn-link-backfill"'));
  assert.match(post.slice(0, 600), /requirePermission\(c, "purchase-invoices", "update"\)/);
  assert.match(post.slice(0, 600), /confirm"\) !== "LINK_AUTO_GRNS"/);
  const lib = readFileSync("src/api/lib/pi-auto-grn.ts", "utf8");
  // Re-runs and lines billed between read and write are never overwritten.
  assert.match(lib, /UPDATE grn_items SET invoiced_qty = \? WHERE id = \? AND COALESCE\(invoiced_qty, 0\) = 0/);
  assert.match(lib, /UPDATE purchase_invoice_items SET grn_item_id = \? WHERE id = \? AND \(grn_item_id IS NULL OR grn_item_id = ''\)/);
  // Only system GRNs of active invoices.
  assert.match(lib, /g\.id LIKE 'grn-pi-%'/);
  assert.match(lib, /String\(g\.status\)\.toUpperCase\(\) === "CANCELLED" \|\| !ACTIVE_PI\.has/);
});
