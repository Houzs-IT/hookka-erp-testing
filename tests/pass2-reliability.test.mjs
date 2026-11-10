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

// ── H3 B2: two saves at once cannot take the same number ──────────────────
import { docNoGuardSql, docNoGuardStatements, isDocNoTaken, withDocNoRetry } from "../src/api/lib/doc-no-guard.ts";

test("B2: guard SQL locks the table's numbering and fails when the number exists", () => {
  const g = docNoGuardSql("delivery_returns");
  assert.equal(g.lock, "SELECT pg_advisory_xact_lock(hashtext(?)::bigint)");
  // The CAST names a column, so Postgres cannot fold it into an error that
  // fires even when the number is free (zero rows -> no error).
  assert.match(g.free, /^SELECT CAST\('DOC_NO_TAKEN ' \|\| return_no AS INTEGER\) AS "docNoFree" FROM delivery_returns WHERE return_no = \?$/);
  assert.match(docNoGuardSql("stock_adjustments").free, /FROM stock_adjustments WHERE adjNo = \?/);
  const bound = [];
  const db = { prepare: (sql) => ({ bind: (...a) => { bound.push([sql, a]); return { sql, a }; } }) };
  docNoGuardStatements(db, "purchase_returns", "PR-2611-004");
  assert.deepEqual(bound.map((b) => b[1]), [["docno:purchase_returns"], ["PR-2611-004"]]);
});

test("B2: a taken number is retried with a fresh one; other errors are not", async () => {
  assert.equal(isDocNoTaken(new Error('invalid input syntax for type integer: "DOC_NO_TAKEN DR-2611-003"')), true);
  assert.equal(isDocNoTaken(new Error("division by zero")), false);
  let n = 0;
  const seen = [];
  const out = await withDocNoRetry(async (tryNo) => {
    seen.push(tryNo);
    if (++n < 3) throw new Error("DOC_NO_TAKEN DR-2611-00" + n);
    return "saved";
  });
  assert.equal(out, "saved");
  assert.deepEqual(seen, [0, 1, 2]);
  await assert.rejects(withDocNoRetry(async () => { throw new Error("division by zero"); }), /division by zero/);
  let tries = 0;
  await assert.rejects(withDocNoRetry(async () => { tries++; throw new Error("DOC_NO_TAKEN x"); }), /DOC_NO_TAKEN/);
  assert.equal(tries, 5, "gives up after five tries");
});

test("B2: DR / PR / stock adjustment batches open with the guard and retry", () => {
  const dr = read("src/api/lib/delivery-return-create.ts");
  assert.match(dr, /\.\.\.docNoGuardStatements\(db, "delivery_returns", returnNo\),/);
  assert.match(dr, /withDocNoRetry\(async \(tryNo\) => \{\s*if \(tryNo > 0\) \{\s*returnNo = await nextReturnNo\(db\);/);
  const pr = read("src/api/lib/purchase-return-create.ts");
  assert.match(pr, /stmts\.push\(\.\.\.docNoGuardStatements\(db, "purchase_returns", returnNo\), headerInsert\(returnNo\)\);/);
  assert.match(pr, /returnNo = await nextPurchaseReturnNo\(db\);\s*stmts\.splice\(0, 3,/);
  const sa = read("src/api/routes/stock-adjustments.ts");
  assert.match(sa, /stmts\.push\(\.\.\.docNoGuardStatements\(c\.var\.DB, "stock_adjustments", adjNo\), headerInsert\(adjNo\)\);/);
  assert.match(sa, /adjNo = await nextAdjNo\(c\.var\.DB\);\s*stmts\.splice\(0, 3,/);
});

// ── H3 B3: two Approve presses cannot both build a voucher's postings ─────
test("B3: every PV ladder rung is compare-and-set on the state it read", () => {
  const acc = read("src/api/routes/accounting.ts");
  const a = acc.indexOf("async function pvApprovalCore(");
  const core = acc.slice(a, acc.indexOf("\napp.", a));
  // prepare / withdraw / reject / check: single UPDATE, 0 rows -> refused.
  assert.equal((core.match(/WHERE id = \? AND approval_state = \?"/g) ?? []).length, 6, "4 single rungs + 2 approve UPDATEs");
  assert.equal((core.match(/if \(changed\(r\)\) return raced\(\);/g) ?? []).length, 4);
  // approve (GL and AP branches): the guard sits right after the UPDATE so
  // the postings roll back with it.
  assert.match(core, /db\.batch\(\[\.\.\.stmts\.slice\(0, 1\), db\.prepare\(casGuardSql\("payment_vouchers", "approval_state"\)\)\.bind\(id, "APPROVED", now\), \.\.\.stmts\.slice\(1\)\]\)/);
  assert.match(core, /const lostAp = await runGuarded\(\[/);
  assert.match(core, /const lost = await runGuarded\(\[/);
  assert.doesNotMatch(core, /await db\.batch\(\[\s*db\.prepare\(\s*"UPDATE payment_vouchers SET approval_state = 'APPROVED'/);
  assert.match(acc, /if \(!r\.ok\) return c\.json\(\{ success: false, error: r\.error, \.\.\.\(r\.status === 409 \? \{ code: "status_changed" \} : \{\}\) \}, r\.status \?\? 400\);/);
});
