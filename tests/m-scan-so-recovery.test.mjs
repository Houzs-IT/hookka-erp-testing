// m-scan-so-recovery.test.mjs — what happens to a Sales Order scan AFTER the first screen: recovering a
// closed scan, finishing the steps that follow a created order, and the Confirm Order permission.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  newMadeRecord, runFollowUps, failedKeys, hasOpenFollowUps, loadMade, saveMade, upsertMade, sameDoc, pendingViews, MADE_KEY, MADE_TTL_MS, PENDING_SHOWN,
} from "../src/pages/m/lib/scan-so-recovery.ts";
import { soActionPlan } from "../src/pages/m/lib/so-actions.ts";

const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");
const base = { rowId: "sqi-1", docIdx: 0, soId: "so-1", soNo: "SO-2611-001", poNo: "DI-8840", sampleId: "pos-abc", corrected: { customerPO: "DI-8840" } };
const kv = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), _m: m }; };

// ---- follow-up steps after the order exists ---------------------------------------------------------
test("a new record starts with every applicable step todo; no accuracy sample / no queue row means that step is skipped", () => {
  assert.deepEqual(newMadeRecord(base).follow, { original: "todo", sample: "todo", consume: "todo" });
  assert.deepEqual(newMadeRecord({ ...base, sampleId: null }).follow, { original: "todo", sample: "skipped", consume: "todo" });
  assert.deepEqual(newMadeRecord({ ...base, rowId: "" }).follow, { original: "todo", sample: "todo", consume: "skipped" });
});

test("all steps succeed: nothing is left open", async () => {
  const calls = [];
  const rec = await runFollowUps(newMadeRecord(base), { original: async () => (calls.push("o"), true), sample: async () => (calls.push("s"), true), consume: async () => (calls.push("c"), true) });
  assert.deepEqual(calls, ["o", "s", "c"], "attach the original BEFORE consuming (consume clears the stored scan bytes)");
  assert.deepEqual(rec.follow, { original: "ok", sample: "ok", consume: "ok" });
  assert.equal(hasOpenFollowUps(rec), false);
});

test("PARTIAL SUCCESS: the saved order id survives and a retry runs ONLY the steps that failed", async () => {
  const first = await runFollowUps(newMadeRecord(base), { original: async () => false, sample: async () => true, consume: async () => true });
  assert.equal(first.soId, "so-1");
  assert.equal(first.soNo, "SO-2611-001");
  assert.deepEqual(first.follow, { original: "failed", sample: "ok", consume: "todo" }, "consume must not run while the original is still to be read from the stored scan");
  assert.deepEqual(failedKeys(first), ["original"]);
  assert.equal(hasOpenFollowUps(first), true);

  const calls = [];
  const second = await runFollowUps(first, { original: async () => (calls.push("o"), true), sample: async () => (calls.push("s"), true), consume: async () => (calls.push("c"), true) });
  assert.deepEqual(calls, ["o", "c"], "the accuracy report already went; it is not sent twice");
  assert.deepEqual(second.follow, { original: "ok", sample: "ok", consume: "ok" });
  assert.equal(second.soId, "so-1");
});

test("a step that throws counts as failed, the others still run, and a failing consume is retried alone", async () => {
  const r1 = await runFollowUps(newMadeRecord(base), { original: async () => true, sample: async () => { throw new Error("boom"); }, consume: async () => false });
  assert.deepEqual(r1.follow, { original: "ok", sample: "failed", consume: "failed" });
  const calls = [];
  const r2 = await runFollowUps(r1, { original: async () => (calls.push("o"), true), sample: async () => (calls.push("s"), true), consume: async () => (calls.push("c"), true) });
  assert.deepEqual(calls, ["s", "c"]);
  assert.equal(hasOpenFollowUps(r2), false);
});

test("the follow-up runner has no way to create an order: it is given only the three step functions", () => {
  const src = read("lib/scan-so-recovery.ts").split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join(" ");
  assert.doesNotMatch(src, /fetch\(|sales-orders|mutateJson/, "pure module: no network, no create endpoint");
  const sheet = read("screens/dashboard/ScanSoSheet.tsx");
  const finish = sheet.slice(sheet.indexOf("const finishFollowUps"), sheet.indexOf("const openFinish"));
  assert.doesNotMatch(finish, /\/api\/sales-orders|buildSoBody|mutateJson/, "retrying the follow-ups never POSTs an order");
  assert.match(finish, /runFollowUps\(r,/);
});

// ---- persistence ---------------------------------------------------------------------------------------
test("records persist across a closed sheet, expire after 7 days, and ignore corrupt storage", () => {
  const store = kv();
  const rec = newMadeRecord(base, 1_000);
  saveMade(store, upsertMade([], rec));
  assert.equal(loadMade(store, 2_000).length, 1);
  assert.equal(loadMade(store, 1_000 + MADE_TTL_MS + 1).length, 0, "old records drop out");
  store._m.set(MADE_KEY, "{not json");
  assert.deepEqual(loadMade(store), []);
  assert.deepEqual(loadMade(null), []);
  assert.match(MADE_KEY, /^hookka-cache:/, "under the prefix the sign-out / sign-in sweep clears, so a record never leaks to the next user");
  const again = upsertMade(upsertMade([], rec), { ...rec, soNo: "SO-2611-002" });
  assert.equal(again.length, 1, "one record per scanned PO");
  assert.equal(sameDoc(again[0], "sqi-1", 0), true);
});

// ---- recovering a pending scan ---------------------------------------------------------------------------
const PO = (n) => ({ customerPO: n, customerName: "Desa", items: [{ productCode: "X", quantity: 1 }] });
const done = (id, pos, extra = {}) => ({ id, status: "done", fileName: `${id}.pdf`, rawJson: { pos }, error: null, sampleId: "pos-1", consumedAt: null, consumedDocIdxs: [], ...extra });

test("a finished read comes back as ready-to-review from its stored result", () => {
  const v = pendingViews([done("r1", [PO("A"), PO("B")])], []);
  assert.equal(v.length, 1);
  assert.equal(v[0].state, "ready");
  assert.deepEqual(v[0].pos.map((p) => [p.po.customerPO, p.docIdx]), [["A", 0], ["B", 1]]);
  assert.equal(v[0].sampleId, "pos-1");
});

test("POs already consumed are not offered again; a consumed row disappears", () => {
  assert.equal(pendingViews([done("r1", [PO("A"), PO("B")], { consumedDocIdxs: [0] })], [])[0].pos.length, 1);
  assert.deepEqual(pendingViews([done("r1", [PO("A")], { consumedAt: "2026-11-03" })], []), []);
});

test("a PO that already became an order is offered again ONLY to finish its open steps — never to create it twice", () => {
  const open = { ...newMadeRecord({ ...base, rowId: "r1", docIdx: 0 }), follow: { original: "failed", sample: "ok", consume: "todo" } };
  const finished = { ...newMadeRecord({ ...base, rowId: "r1", docIdx: 1 }), follow: { original: "ok", sample: "ok", consume: "ok" } };
  const v = pendingViews([done("r1", [PO("A"), PO("B")])], [open, finished]);
  assert.equal(v[0].pos.length, 1);
  assert.equal(v[0].pos[0].made?.soNo, "SO-2611-001");
  assert.equal(v[0].pos[0].docIdx, 0);
  // A record whose row has already left /pending still shows while it owes a step.
  const lonely = pendingViews([], [open]);
  assert.equal(lonely.length, 1);
  assert.equal(lonely[0].pos[0].made?.soId, "so-1");
  assert.deepEqual(pendingViews([], [finished]), []);
});

test("queued / processing / failed rows are listed as not-yet-read, and only a lone row may be continued from the phone", () => {
  const rows = [{ id: "q1", status: "queued", fileName: "a.pdf", rawJson: null, error: null, sampleId: null }];
  assert.deepEqual(pendingViews(rows, []).map((v) => [v.state, v.solo]), [["reading", true]]);
  const failed = [{ id: "f1", status: "failed", fileName: "b.pdf", rawJson: null, error: "no JSON", sampleId: null }];
  assert.deepEqual(pendingViews(failed, []).map((v) => [v.state, v.solo, v.error]), [["failed", true, "no JSON"]]);
  const batch = [...rows, { id: "q2", status: "queued", fileName: "c.pdf", rawJson: null, error: null, sampleId: null }];
  assert.deepEqual(pendingViews(batch, []).map((v) => v.solo), [false, false], "continuing a batch would read every queued file in it");
});

test("at most five unfinished scans are shown", () => {
  const rows = Array.from({ length: 9 }, (_, i) => done(`r${i}`, [PO("A")]));
  assert.equal(pendingViews(rows, []).length, PENDING_SHOWN);
});

test("recovery never starts a paid read on its own: open only LOADS the list; reading starts from a button tap", () => {
  const src = read("screens/dashboard/ScanSoSheet.tsx");
  assert.match(src, /\/api\/scan-queue\/pending\?kind=po/);
  const openEffect = src.slice(src.indexOf("if (open) {"), src.indexOf("if (open) {") + 200);
  assert.match(openEffect, /void prepare\(\);\s*void fetchPending\(\)\.then\(setPendingRaw\);/);
  assert.doesNotMatch(openEffect, /createScanQueueDriver|continueReading|upload|retry/);
  // The only callers of continueReading are the explicit buttons.
  const callers = [...src.matchAll(/continueReading\(/g)].length;
  assert.equal(callers, 1, "only the button's onClick calls it");
  assert.match(src, /onClick=\{\(\) => void continueReading\(v\)\}/);
  assert.match(src, /if \(!batchId \|\| !v\.solo\) return;/);
  assert.match(src, /\/api\/scan-queue\/\$\{encodeURIComponent\(v\.rowId\)\}\/retry/);
  // A finished read is reviewed with NO queue call at all.
  const resume = src.slice(src.indexOf("const resumeReady"), src.indexOf("const continueReading"));
  assert.doesNotMatch(resume, /createScanQueueDriver|\/upload|\/work|\/retry/);
});

// ---- Confirm Order permission ------------------------------------------------------------------------------
test("a draft offers Confirm only to a user who may confirm (Edit Draft and Cancel stay)", () => {
  assert.deepEqual(soActionPlan("DRAFT").rows.flat(), ["confirm", "edit-draft", "cancel", "delete-draft"], "no context: every draft action the desktop has");
  assert.deepEqual(soActionPlan("DRAFT", { can: { confirm: true } }).rows.flat(), ["confirm", "edit-draft", "cancel", "delete-draft"]);
  const denied = soActionPlan("DRAFT", { can: { confirm: false } });
  assert.deepEqual(denied.rows.flat(), ["edit-draft", "cancel", "delete-draft"]);
  assert.match(denied.note, /Confirm permission/);
  for (const st of ["CONFIRMED", "CANCELLED", "IN_PRODUCTION"]) assert.deepEqual(soActionPlan(st, { can: { confirm: false } }), soActionPlan(st));
});

test("the live Sales Order screen gates every action on the server's own permission strings", () => {
  const detail = read("screens/SalesOrderDetail.tsx");
  assert.match(detail, /confirm: hasPermission\("sales-orders", "confirm"\)/);
  assert.match(detail, /update: hasPermission\("sales-orders", "update"\)/);
  assert.match(detail, /issueDo: hasPermission\("delivery-orders", "create"\)/);
});
