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

// ── H3 B4: two saves of one PO within ms cannot both pass the stale check ─
test("B4: the PO PUT batch row-locks the PO and re-checks updated_at first", () => {
  const s = read("src/api/routes/purchase-orders.ts");
  const put = s.slice(s.indexOf("const staleMsg = editConflictMessage("), s.indexOf("// No supplier email on → SUBMITTED any more"));
  assert.match(put, /if \(body\?\.expectedUpdatedAt != null && body\.expectedUpdatedAt !== "" && readIso/);
  assert.match(put, /statements\.unshift\(\s*c\.var\.DB\.prepare\(\s*`SELECT CASE WHEN date_trunc\('milliseconds', updated_at::timestamptz\) = date_trunc\('milliseconds', \?::timestamptz\)/);
  assert.match(put, /ELSE CAST\('\$\{PO_EDIT_CONFLICT\} ' \|\| id AS INTEGER\) END AS ok\s+FROM purchase_orders WHERE id = \? FOR UPDATE`/);
  assert.match(put, /includes\(PO_EDIT_CONFLICT\)\)[\s\S]{0,200}conflict: true \},\s*409/);
});

// ── H3 B5: scan-queue jsonb columns hold arrays / objects, not strings ────
test("B5: every scan_queue jsonb write binds text and casts ?::text::jsonb", () => {
  const s = read("src/api/routes/scan-queue.ts");
  const code = s.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(code, /\?::jsonb/, "a ?::jsonb placeholder is double-encoded by postgres.js unsafe");
  assert.equal((s.match(/consumed_doc_idxs = \?::text::jsonb/g) ?? []).length, 2);
  assert.match(s, /raw_json = \?::text::jsonb,/);
  assert.equal((s.match(/'cached', \?::text::jsonb,/g) ?? []).length, 2, "both cache-hit copies");
  assert.equal((s.match(/jsonbText\(cacheSource\.rawJson\)/g) ?? []).length, 2);
});

test("B5: jsonbText passes JSON text through and serialises a parsed value once", async () => {
  const { jsonbText } = await import("../src/api/routes/scan-queue.ts");
  assert.equal(jsonbText(null), null);
  assert.equal(jsonbText(undefined), null);
  assert.equal(jsonbText('{"docs":[1]}'), '{"docs":[1]}');
  assert.equal(jsonbText({ docs: [1] }), '{"docs":[1]}');
  assert.equal(jsonbText([0, 2]), "[0,2]");
});

// ── H3 B8: a full session-mode pool is retried like the other connect errors
import { isTransientDbError } from "../src/api/lib/supabase-compat.ts";

test("B8: 'max clients reached in session mode' / EMAXCONNSESSION is a connect-time retry", () => {
  const compat = read("src/api/lib/supabase-compat.ts");
  const createRe = new RegExp(compat.match(/const CONN_CREATE_RE =\s*\/(.*)\/i/)?.[1] ?? "^$", "i");
  assert.ok(createRe.test("(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15"));
  assert.ok(createRe.test("Max clients reached in session mode"));
  assert.match(compat, /if \(code === 'EMAXCONNSESSION'\) return true/);
  const byCode = Object.assign(new Error("pool full"), { code: "EMAXCONNSESSION" });
  assert.ok(isTransientDbError(byCode), "answers 503, not 500");
  assert.ok(!createRe.test("connection terminated unexpectedly"), "a mid-statement drop is still never retried");
});

// ── C1-7: Idempotency-Key on credit note, debit note, adjustment, advance ─
test("C1-7: the four create routes are wrapped in idempotent()", () => {
  for (const f of ["credit-notes", "debit-notes", "stock-adjustments", "employee-advances"]) {
    const s = read(`src/api/routes/${f}.ts`);
    assert.match(s, /import \{ idempotent \} from "\.\.\/lib\/idempotency";/, f);
    assert.match(s, /app\.post\("\/", idempotent\(\), async \(c\) => \{/, f);
  }
});

test("C1-7: every create screen sends an Idempotency-Key", () => {
  const cn = read("src/pages/invoices/credit-notes.tsx");
  assert.match(cn, /createIdem\.withKey\(\(key\) =>\s*fetchJson\("\/api\/credit-notes", CNMutationSchema, \{\s*method: "POST",\s*headers: \{ "Idempotency-Key": key \}/);
  const dn = read("src/pages/invoices/debit-notes.tsx");
  assert.match(dn, /createIdem\.withKey\(\(key\) =>\s*fetchJson\("\/api\/debit-notes", DNMutationSchema, \{ method: "POST", body, headers: \{ "Idempotency-Key": key \} \}\)/);
  const adj = read("src/pages/inventory/adjustments.tsx");
  assert.match(adj, /adjIdem\.withKey\(`row:\$\{row\.uid\}`, \(key\) =>\s*fetch\("\/api\/stock-adjustments", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json", "Idempotency-Key": key \}/);
  const emp = read("src/pages/employees.tsx");
  assert.match(emp, /advIdem\.withKey\(`worker:\$\{row\.id\}`, \(key\) =>\s*fetch\("\/api\/employee-advances", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json", "Idempotency-Key": key \}/);
  const sc = read("src/pages/service-cases/detail.tsx");
  assert.match(sc, /issueIdem\.withKey\(\(key\) => fetch\("\/api\/stock-adjustments", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json", "Idempotency-Key": key \}/);
  const m = read("src/pages/m/config/forms.ts");
  assert.match(m, /mutateJson\("\/api\/stock-adjustments", "POST", body, \{\s*"Idempotency-Key": uuid\(\),/);
  // The submit buttons still disable while sending (what stops a double click).
  assert.match(cn, /disabled=\{creating \|\|/);
  assert.match(dn, /disabled=\{creating \|\|/);
});

// ── C2-11: System Health checks each outside key with a harmless read ─────
import { classifyKeyProbe, keyProblems } from "../src/lib/key-probe.ts";
import { computeHealthStatus } from "../src/lib/health-status.ts";

test("C2-11: probe answers map to ok / refused / no-answer", () => {
  assert.equal(classifyKeyProbe({ status: 200 }).verdict, "ok");
  assert.equal(classifyKeyProbe({ status: 429 }).verdict, "ok");
  assert.equal(classifyKeyProbe({ status: 401 }).verdict, "refused");
  assert.equal(classifyKeyProbe({ status: 403 }).verdict, "refused");
  assert.equal(classifyKeyProbe({ status: 400, marker: "invalid_grant" }).verdict, "refused");
  assert.equal(classifyKeyProbe({ status: 401, marker: "restricted_api_key" }).verdict, "ok", "send-only Resend key");
  assert.equal(classifyKeyProbe({ status: 503 }).verdict, "no-answer");
  assert.equal(classifyKeyProbe({ status: 404 }).verdict, "no-answer");
  assert.equal(classifyKeyProbe({ error: true }).verdict, "no-answer");
});

const calm = { p50: 100, p95: 300, longTaskCount: 0, cacheHitRatio: 0.9, fiveXX: 0, feErrCount: 0 };
test("C2-11: a refused key turns the banner red; no answer only amber; none changes nothing", () => {
  assert.equal(computeHealthStatus(calm).tone, "green");
  assert.equal(computeHealthStatus({ ...calm, keysRefused: [], keysNoAnswer: [] }).tone, "green");
  const red = computeHealthStatus({ ...calm, keysRefused: ["Mail (Brevo)"] });
  assert.equal(red.tone, "red");
  assert.match(red.detail, /Key refused: Mail \(Brevo\)/);
  const amber = computeHealthStatus({ ...calm, keysNoAnswer: ["Anthropic (scans, assistant)"] });
  assert.equal(amber.tone, "amber");
  assert.deepEqual(
    keyProblems([
      { key: "a", label: "A", verdict: "refused", note: "" },
      { key: "b", label: "B", verdict: "no-answer", note: "" },
      { key: "c", label: "C", verdict: "not-set", note: "" },
      { key: "d", label: "D", verdict: "ok", note: "" },
    ]),
    { refused: ["A"], noAnswer: ["B"] },
  );
});

test("C2-11: probes read only, skip unset keys, never echo a key, and cache", async () => {
  const { runKeyProbes, _resetKeyProbeCache } = await import("../src/api/lib/key-probes.ts");
  _resetKeyProbeCache();
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, method: init?.method });
    if (url.startsWith("https://api.brevo.com")) return new Response(JSON.stringify({ message: "Key not found", code: "unauthorized" }), { status: 401 });
    if (url.startsWith("https://api.anthropic.com")) throw new Error("timeout");
    return new Response("{}", { status: 200 });
  };
  const env = { BREVO_API_KEY: "xkeysib-SECRET", ANTHROPIC_API_KEY: "sk-ant-SECRET" };
  const res = await runKeyProbes(env, { fresh: true, fetch: fakeFetch, now: 1000 });
  const by = Object.fromEntries(res.map((r) => [r.key, r.verdict]));
  assert.deepEqual(by, { brevo: "refused", resend: "not-set", anthropic: "no-answer", "google-sheets": "not-set" });
  assert.ok(calls.every((c) => c.method === "GET"), "harmless reads only");
  assert.doesNotMatch(JSON.stringify(res), /SECRET/);
  await runKeyProbes(env, { fetch: fakeFetch, now: 2000 });
  assert.equal(calls.length, 2, "second call within 10 minutes served from cache");
});

test("C2-11: the health banner (page + alert email) carries the key verdicts", () => {
  const route = read("src/api/routes/admin-health.ts");
  assert.match(route, /app\.get\("\/key-probes", async \(c\) => \{/);
  assert.match(route, /const keys = keyProblems\(await runKeyProbes\(env\)\.catch\(\(\) => \[\]\)\);/);
  assert.match(route, /keysRefused: keys\.refused,\s*keysNoAnswer: keys\.noAnswer,/);
  const page = read("src/pages/admin/health.tsx");
  assert.match(page, /`\/api\/admin\/health\/key-probes`/);
  assert.match(page, /keysRefused: keyProblems\(keyResults\)\.refused,/);
  assert.match(page, /<KeyProbesCard results=\{keyResults\} \/>/);
});

// ── H3-7: "Remind approver" on a checked payment voucher ──────────────────
import {
  grantsApprove, pvRemindLink, pvRemindNotificationId, remindTooSoonMessage, remindWaitMinutes,
} from "../src/api/lib/pv-remind.ts";

test("H3-7: at most once an hour per voucher; approvers by the same wildcard rules", () => {
  const now = Date.parse("2026-11-10T10:00:00.000Z");
  assert.equal(remindWaitMinutes(null, now), 0);
  assert.equal(remindWaitMinutes("2026-11-10T08:59:00.000Z", now), 0);
  assert.equal(remindWaitMinutes("2026-11-10T09:30:00.000Z", now), 30);
  assert.equal(remindWaitMinutes("2026-11-10T09:59:30.000Z", now), 60);
  assert.equal(remindWaitMinutes("garbage", now), 0);
  assert.match(remindTooSoonMessage(1), /in 1 minute\.$/);
  assert.equal(grantsApprove(new Set(["accounting:approve"])), true);
  assert.equal(grantsApprove(new Set(["accounting:*"])), true);
  assert.equal(grantsApprove(new Set(["*:*"])), true);
  assert.equal(grantsApprove(new Set(["accounting:check", "accounting:update"])), false);
  assert.equal(pvRemindLink("pv-1"), "/accounting?tab=payments&pv=pv-1");
  // Same voucher + approver + hour -> same id, so a double press inserts once.
  assert.equal(pvRemindNotificationId("pv-1", "u-1", now), pvRemindNotificationId("pv-1", "u-1", now + 59_000));
});

test("H3-7: the endpoint only reminds on CHECKED, refuses within the hour, never touches the voucher", () => {
  const acc = read("src/api/routes/accounting.ts");
  const a = acc.indexOf('app.post("/payment-vouchers/:id/remind"');
  assert.ok(a > 0);
  const r = acc.slice(a, acc.indexOf("\napp.", a + 10));
  assert.match(r, /requirePermission\(c, "accounting", "update"\)/);
  assert.match(r, /if \(state !== "CHECKED"\)/);
  assert.match(r, /if \(wait > 0\) return c\.json\(\{ success: false, error: remindTooSoonMessage\(wait\), code: "too_soon" \}, 429\);/);
  assert.match(r, /if \(grantsApprove\(perms\)\) approvers\.push/);
  assert.match(r, /u\.id === actorUserId\) continue;/);
  assert.match(r, /INSERT INTO notifications[\s\S]*ON CONFLICT \(id\) DO NOTHING/);
  assert.doesNotMatch(r, /UPDATE payment_vouchers/);
  const page = read("src/pages/accounting/index.tsx");
  assert.match(page, /fetch\(`\/api\/accounting\/payment-vouchers\/\$\{r\.id\}\/remind`, \{ method: "POST" \}\)/);
  assert.match(page, /\{ label: "Remind approver", disabled: ladderBusy, action: \(\) => void handleRemind\(r\) \}/);
  assert.match(page, /onClick=\{\(\) => void handleRemind\(r\)\}>Remind approver<\/Button>/);
  assert.match(page, /const pvFromLink = pvLinkParams\.get\("pv"\);/);
});
