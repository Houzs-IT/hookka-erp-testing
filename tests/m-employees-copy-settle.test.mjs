// m-employees-copy-settle.test.mjs — HK-0125: the two actions that WRITE from the Employees menus — Working Hours "Copy yesterday / Copy
// from another date" (drafts first, Save writes) and Labor Cost "Settle month". Both run against a fake fetch: no network, no database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCopyDrafts, copyTarget, fetchDay, saveBody, saveDraft, toSave, yesterdayOf } from "../src/pages/m/screens/employees/working-hours-copy.ts";
import { SETTLE_CONFIRM_LABEL, SETTLE_TITLE, runSettle, settleAvailable, settleConfirmMessage, settleText } from "../src/pages/m/screens/employees/settle-month.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, "");

// ---- Copy ----------------------------------------------------------------------------------------------------------------------------

const E = (workerId, departmentCode, category, hours, notes = "") => ({ workerId, date: "2026-11-12", departmentCode, category, hours, notes });

test("the target is the selected work date when it is ONE day, else a picker that starts at today; yesterday is plain date arithmetic", () => {
  assert.deepEqual(copyTarget("2026-11-12", "2026-11-17"), { fixed: true, date: "2026-11-12" });
  assert.deepEqual(copyTarget("", "2026-11-17"), { fixed: false, date: "2026-11-17" });
  assert.equal(yesterdayOf("2026-11-01"), "2026-10-31");
  assert.equal(yesterdayOf("2026-01-01"), "2025-12-31");
  assert.equal(yesterdayOf("2026-03-01"), "2026-02-28");
});

test("copying builds DRAFTS only: desktop's checks and its dedup (same worker + department + category already on the target day)", () => {
  const source = [E("w1", "UPH", "SOFA", 5, "set 1"), E("w1", "FRM", "BEDFRAME", 4), E("w2", "UPH", "SOFA", 8)];
  const onTarget = [{ ...E("w1", "UPH", "SOFA", 3), date: "2026-11-13" }];
  const r = buildCopyDrafts({ source, onTarget, sourceDate: "2026-11-12", targetDate: "2026-11-13" });
  assert.ok(r.ok);
  assert.equal(r.drafts.length, 2, "w1 UPH SOFA already exists on the target day, so it is skipped; w1 FRM (another segment) is kept");
  assert.deepEqual(r.drafts.map((d) => [d.workerId, d.deptCode, d.category, d.hours, d.notes, d.keep, d.state]), [
    ["w1", "FRM", "BEDFRAME", "4", "", true, "idle"],
    ["w2", "UPH", "SOFA", "8", "", true, "idle"],
  ]);
  assert.deepEqual(buildCopyDrafts({ source, onTarget, sourceDate: "", targetDate: "2026-11-13" }), { ok: false, message: "Pick a source date first" });
  assert.deepEqual(buildCopyDrafts({ source, onTarget, sourceDate: "2026-11-13", targetDate: "2026-11-13" }), { ok: false, message: "Source date can't equal target date" });
  assert.deepEqual(buildCopyDrafts({ source: [], onTarget, sourceDate: "2026-11-12", targetDate: "2026-11-13" }), { ok: false, message: "No entries on 2026-11-12 to copy" });
  assert.deepEqual(buildCopyDrafts({ source: [E("w1", "UPH", "SOFA", 3)], onTarget, sourceDate: "2026-11-12", targetDate: "2026-11-13" }), { ok: false, message: "All matching entries already exist on this date" });
});

test("Save posts the body desktop's saveRow sends, one row at a time; edited hours and notes are what is posted; unticked and saved rows are not", async () => {
  const r = buildCopyDrafts({ source: [E("w1", "UPH", "SOFA", 5), E("w2", "FRM", "BEDFRAME", 8), E("w3", "UPH", "SOFA", 2)], onTarget: [], sourceDate: "2026-11-12", targetDate: "2026-11-13" });
  const [a, b, c] = r.drafts;
  const drafts = [{ ...a, hours: "4.5", notes: "left early" }, { ...b, keep: false }, c];
  assert.deepEqual(toSave(drafts).map((d) => d.workerId), ["w1", "w3"]);
  assert.deepEqual(saveBody(drafts[0], "2026-11-13"), { workerId: "w1", date: "2026-11-13", departmentCode: "UPH", category: "SOFA", hours: 4.5, notes: "left early" });

  const calls = [];
  let active = 0;
  let overlap = false;
  const fakeFetch = async (url, init) => {
    active++;
    if (active > 1) overlap = true;
    calls.push({ url, method: init?.method, body: JSON.parse(init?.body ?? "{}") });
    await new Promise((res) => setTimeout(res, 2));
    active--;
    return { ok: true, status: 200, json: async () => ({ success: true, data: { id: "new" } }) };
  };
  const out = [];
  for (const d of toSave(drafts)) out.push(await saveDraft(d, "2026-11-13", fakeFetch));
  assert.deepEqual(out.map((d) => d.state), ["saved", "saved"]);
  assert.deepEqual(calls.map((c) => [c.url, c.method, c.body.workerId, c.body.hours]), [["/api/working-hour-entries", "POST", "w1", 4.5], ["/api/working-hour-entries", "POST", "w3", 2]]);
  assert.equal(overlap, false, "never two posts in flight (they race the server's attendance auto-create)");
  assert.deepEqual(toSave(out), [], "saved rows are not posted again on a second Save");
});

test("a failed save keeps the draft with the server's message and can be retried; nothing else is lost", async () => {
  const d = buildCopyDrafts({ source: [E("w1", "UPH", "SOFA", 5)], onTarget: [], sourceDate: "2026-11-12", targetDate: "2026-11-13" }).drafts[0];
  const denied = await saveDraft(d, "2026-11-13", async () => ({ ok: false, status: 403, json: async () => ({ success: false, error: "Permission denied" }) }));
  assert.equal(denied.state, "failed");
  assert.equal(denied.error, "Permission denied");
  assert.equal(toSave([denied]).length, 1, "a failed draft is offered again");
  const noBody = await saveDraft(d, "2026-11-13", async () => ({ ok: false, status: 500, json: async () => { throw new Error("not json"); } }));
  assert.equal(noBody.error, "HTTP 500");
  const thrown = await saveDraft(d, "2026-11-13", async () => { throw new Error("offline"); });
  assert.equal(thrown.error, "offline");
});

test("a day is read from the existing endpoint; a response that is not a list is 'failed', not 'empty'", async () => {
  let asked = "";
  const ok = await fetchDay("2026-11-12", async (url) => { asked = url; return { ok: true, status: 200, json: async () => ({ success: true, data: [E("w1", "UPH", "SOFA", 1)] }) }; });
  assert.equal(asked, "/api/working-hour-entries?date=2026-11-12");
  assert.equal(ok.length, 1);
  assert.equal(await fetchDay("2026-11-12", async () => ({ ok: true, status: 200, json: async () => ({ success: false }) })), null);
  assert.equal(await fetchDay("2026-11-12", async () => { throw new Error("offline"); }), null);
});

test("Copy is wired behind attendance:create (the server's gate); nothing is written until Save; no row is saved twice", () => {
  const sec = strip(src("WorkingHoursSection.tsx"));
  assert.match(sec, /hasPermission\("attendance", "create"\)/);
  assert.match(sec, /"copy-yesterday": \{ run: \(\) => setCopyMode\("yesterday"\) \}/);
  assert.match(sec, /"copy-from": \{ run: \(\) => setCopyMode\("from"\) \}/);
  const sheet = strip(src("CopySheet.tsx"));
  assert.match(sheet, /if \(!drafts \|\| running\.current\) return;/, "a double tap does not post twice");
  assert.match(sheet, /for \(const d of toSave\(drafts\)\)/);
  assert.match(sheet, /invalidateCachePrefix\("\/api\/working-hour-entries"\)/);
  assert.ok(!/method:\s*["']POST["']|mutateJson/.test(sheet), "the sheet itself posts nothing — only working-hours-copy.ts saveDraft does");
  assert.match(sheet, /Nothing is saved until you tap Save/);
  assert.match(sheet, /selectedDate/, "the selected single day is the target");
});

// ---- Settle month ----------------------------------------------------------------------------------------------------------------------

const ok = { range: { from: "2026-10-01", to: "2026-10-31" }, category: "", today: "2026-11-17", hasPayslips: true, canUpdate: true, canCreate: true };

test("Settle month is offered only for ONE full, finished month, no category, with stored payslips, and BOTH permissions the server enforces", () => {
  assert.equal(settleAvailable(ok), true);
  assert.equal(settleAvailable({ ...ok, range: { from: "2026-11-01", to: "2026-11-30" } }), false, "the current month is not finished");
  assert.equal(settleAvailable({ ...ok, range: { from: "2026-10-01", to: "2026-10-30" } }), false, "not a full calendar month");
  assert.equal(settleAvailable({ ...ok, range: { from: "2026-09-01", to: "2026-10-31" } }), false, "two months");
  assert.equal(settleAvailable({ ...ok, category: "SOFA" }), false, "a category narrows the buckets");
  assert.equal(settleAvailable({ ...ok, hasPayslips: false }), false, "no stored payslips yet");
  assert.equal(settleAvailable({ ...ok, canUpdate: false }), false, "settle-period needs payslips:update");
  assert.equal(settleAvailable({ ...ok, canCreate: false }), false, "regenerate needs payslips:create — a settle without it would leave docks out of pay");
});

test("desktop's confirmation text, verbatim, with the month named", () => {
  assert.equal(SETTLE_TITLE, "Auto-settle this month?");
  assert.equal(SETTLE_CONFIRM_LABEL, "Settle now");
  const m = settleConfirmMessage("October 2026");
  assert.match(m, /^Apply the shift rules \(≥9h, late past grace, OT from 30 min past 18:00\) to every punch AND auto-dock under-logged \(To-fill\) days in October 2026, then regenerate payslips\?/);
  assert.match(m, /Your own MANUAL Keep-pay \/ Deduct decisions are never overridden, and an already-approved month is not touched\.$/);
});

const settleData = { applied: 4, "no-shortfall": 20, "manual-exists": 1, "punch-source": 3, "logged-source": 1, dockedHours: 6.5, periodLocked: false };
const fakeServer = ({ settle = { status: 200, body: { success: true, data: settleData } }, regen = { status: 200, body: { success: true } } } = {}) => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    const r = url.includes("settle-period") ? settle : regen;
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  return { calls, fetchFn };
};

test("Settle month: the settlement, then ONE regenerate; the two results are reported separately", async () => {
  const s = fakeServer();
  const out = await runSettle("2026-10", "October 2026", s.fetchFn);
  assert.deepEqual(s.calls.map((c) => [c.url, c.method, c.body]), [
    ["/api/payroll-hour-deductions/settle-period", "POST", { period: "2026-10" }],
    ["/api/payslips", "POST", { period: "2026-10", regenerate: true }],
  ]);
  assert.deepEqual(out.settle, { state: "ok", text: "4 day(s) auto-docked (6.5h — 3 from punches, 1 from under-logged hours), 20 full day(s), 1 left on your manual pick." });
  assert.deepEqual(out.regenerate, { state: "ok", text: "Payslips for October 2026 regenerated." });
});

test("a finalised month: nothing changed, and no regenerate is sent", async () => {
  const s = fakeServer({ settle: { status: 200, body: { success: true, data: { ...settleData, periodLocked: true } } } });
  const out = await runSettle("2026-10", "October 2026", s.fetchFn);
  assert.equal(s.calls.length, 1, "the regenerate is not sent when nothing was changed");
  assert.equal(out.settle.state, "locked");
  assert.match(out.settle.text, /^Month already finalised — nothing changed\./);
  assert.equal(out.regenerate.state, "skipped");
  assert.match(settleText({ ...settleData, periodLocked: true }), /desktop Payroll tab/);
});

test("a settlement that fails stops there: no regenerate, a plain message", async () => {
  const s = fakeServer({ settle: { status: 403, body: { success: false, error: "Permission denied" } } });
  const out = await runSettle("2026-10", "October 2026", s.fetchFn);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(out.settle, { state: "failed", text: "Could not settle — please try again." });
  assert.equal(out.regenerate.state, "skipped");
  const thrown = await runSettle("2026-10", "October 2026", async () => { throw new Error("offline"); });
  assert.equal(thrown.settle.state, "failed");
});

test("a regenerate that fails is REPORTED (desktop ignores it) and says what to do; the settlement result still stands", async () => {
  const s = fakeServer({ regen: { status: 403, body: { success: false, error: "Permission denied" } } });
  const out = await runSettle("2026-10", "October 2026", s.fetchFn);
  assert.equal(out.settle.state, "ok");
  assert.equal(out.regenerate.state, "failed");
  assert.match(out.regenerate.text, /NOT regenerated.*desktop Payroll tab/);
});

test("Settle month is wired: gated, confirmed first, one run at a time, caches dropped, two separate result rows", () => {
  const sec = strip(src("LaborCostSection.tsx"));
  assert.match(sec, /settleAvailable\(\{/);
  assert.match(sec, /"settle-month": \{ run: \(\) => setSettleOpen\(true\) \}/, "the menu only opens the confirm sheet");
  const sheet = strip(src("SettleSheet.tsx"));
  assert.match(sheet, /<DecisionSheet/);
  assert.match(sheet, /if \(running\.current\) return;/);
  assert.match(sheet, /invalidateCachePrefix\("\/api\/payslips"\)/);
  assert.match(sheet, /invalidateCachePrefix\("\/api\/payroll-hour-deductions"\)/);
  assert.match(sheet, /\["Settlement", outcome\.settle\]/);
  assert.match(sheet, /\["Payslip regeneration", outcome\.regenerate\]/);
  assert.ok(!/method:\s*["']POST["']/.test(sheet), "the sheet posts nothing itself — settle-month.ts does");
});
