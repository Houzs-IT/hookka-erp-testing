// ---------------------------------------------------------------------------
// pass2-reliability.test.mjs — cross-system review pass 2, batch A4
// (WORK-TRACKER 126). Race guards and double-submit protection that only
// REFUSE a conflicting write; nothing here changes a money / stock figure.
//
// Pure helpers are exercised directly; route wiring is pinned by source
// pattern (house style — see batch-confirm-and-return-guard.test.mjs).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { casGuardSql, isCasMiss, staleStatusMessage } from "../src/api/lib/status-cas.ts";

const read = (p) => readFileSync(p, "utf8");

// ── H3 B1: a late status tap cannot revive a cancelled DO / CN ────────────
test("B1: CAS guard SQL divides by zero unless the row carries the written state", () => {
  const sql = casGuardSql("delivery_orders");
  assert.match(sql, /SELECT 1 \/ CASE WHEN EXISTS/);
  assert.match(sql, /FROM delivery_orders WHERE id = \? AND status = \? AND updated_at = \?/);
  assert.match(casGuardSql("payment_vouchers", "approval_state"), /approval_state = \?/);
  assert.throws(() => casGuardSql("delivery_orders", "status; DROP"));
  assert.equal(isCasMiss(new Error("division by zero")), true);
  assert.equal(isCasMiss(new Error("duplicate key value")), false);
  const m = staleStatusMessage("delivery order", "CANCELLED", "LOADED");
  assert.match(m, /it is now CANCELLED, it was LOADED/);
  assert.match(m, /Nothing was saved/);
});

test("B1: DO update writes WHERE status = <read status> and guards the batch", () => {
  const s = read("src/api/routes/delivery-orders/_helpers.ts");
  assert.match(s, /delivery_incomplete = \?, updated_at = \?\s+WHERE id = \? AND status = \?`/);
  assert.match(s, /existing\.status,\s*\),\s*c\.var\.DB\.prepare\(casGuardSql\("delivery_orders"\)\)\.bind\(id, nextStatus, now\)/);
  assert.match(s, /if \(isCasMiss\(e\)\)[\s\S]{0,600}code: "status_changed"[\s\S]{0,120}409/);
});

test("B1: consignment-note PUT and return are compare-and-set", () => {
  const shared = read("src/api/lib/consignment-note-shared.ts");
  assert.match(shared, /consignmentOrderId = \?, hubId = \?\s+WHERE id = \? AND status IS NOT DISTINCT FROM \?`/);
  assert.match(shared, /meta\?\.changes \?\? 1\) === 0[\s\S]{0,300}reason: "status_changed"/);
  const r = read("src/api/routes/consignment-notes.ts");
  assert.match(r, /res\.reason === "status_changed"[\s\S]{0,120}status: 409/);
  assert.match(r, /status IS NOT DISTINCT FROM \? THEN 1\s+ELSE CAST\('\$\{CN_RETURN_RACE\}/);
  assert.match(r, /FROM consignment_items ci WHERE ci\.consignmentNoteId = cn\.id\) = \?/);
  assert.match(r, /CAST\('\$\{CN_RETURN_RACE\} ' \|\| cn\.id AS INTEGER\)/);
  assert.match(r, /msg\.includes\(CN_RETURN_RACE\)[\s\S]{0,300}409/);
});
