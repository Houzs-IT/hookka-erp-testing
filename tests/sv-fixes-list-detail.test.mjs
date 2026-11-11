import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CASE_LIST_CAP, EMPTY_SV_FILTERS, caseCoverage, caseLinkNote, classifyListFailure, matchesSv, resolveCaseLink, toSvRow,
} from "../src/pages/m/screens/orders/sv-list-model.ts";
import { svActionPlan, svRestoreTarget, svTapOutcome } from "../src/pages/m/screens/orders/sv-actions.ts";
import { svStageInfo } from "../src/pages/m/screens/orders/sv-detail-model.ts";

const F = (caseLink) => ({ ...EMPTY_SV_FILTERS, caseLink });
const row = toSvRow({ id: "s1", companySOId: "SV-1", customerName: "Acme" });

// ---- D1 --------------------------------------------------------------------------------------
test("D1 coverage: loading / error / capped / complete", () => {
  assert.equal(caseCoverage({ loaded: false, count: 0, hasError: false }), "loading");
  assert.equal(caseCoverage({ loaded: false, count: 0, hasError: true }), "error");
  assert.equal(caseCoverage({ loaded: true, count: CASE_LIST_CAP - 1, hasError: false }), "complete");
  assert.equal(caseCoverage({ loaded: true, count: CASE_LIST_CAP, hasError: false }), "capped");
  assert.equal(caseCoverage({ loaded: true, count: 0, hasError: false }), "complete");
});

test("D1 unresolved links are never standalone", () => {
  for (const cov of ["loading", "error", "capped"]) assert.equal(resolveCaseLink(false, cov), "unknown");
  assert.equal(resolveCaseLink(false, "complete"), "standalone");
  for (const cov of ["loading", "error", "capped", "complete"]) assert.equal(resolveCaseLink(true, cov), "linked");
});

test("D1 filter shows only positively classified rows; unknown only under Any", () => {
  for (const [link, linked, standalone, any] of [["linked", true, false, true], ["standalone", false, true, true], ["unknown", false, false, true]]) {
    assert.equal(matchesSv(row, "", F("linked"), "", link), linked, `linked/${link}`);
    assert.equal(matchesSv(row, "", F("standalone"), "", link), standalone, `standalone/${link}`);
    assert.equal(matchesSv(row, "", F("any"), "", link), any, `any/${link}`);
  }
});

test("D1 caseId on the row is no longer a classification source", () => {
  const r = toSvRow({ id: "s2", caseId: "c1" });
  assert.equal(matchesSv(r, "", F("linked"), "", "unknown"), false);
});

test("D1 search by case number still works", () => {
  assert.ok(matchesSv(row, "sc-2611", EMPTY_SV_FILTERS, "SC-2611-006", "linked"));
  assert.ok(!matchesSv(row, "sc-9999", EMPTY_SV_FILTERS, "SC-2611-006", "linked"));
});

test("D1 notes: only when filter active and links not complete", () => {
  assert.equal(caseLinkNote("any", "capped"), null);
  assert.equal(caseLinkNote("linked", "complete"), null);
  assert.match(caseLinkNote("linked", "loading"), /still loading/);
  assert.match(caseLinkNote("standalone", "error"), /Couldn’t load case links/);
  assert.match(caseLinkNote("standalone", "capped"), /newest 500 cases only/);
});

// ---- D2 --------------------------------------------------------------------------------------
test("D2 failure classification", () => {
  assert.equal(classifyListFailure(null), "none");
  assert.equal(classifyListFailure({ kind: "http", status: 403 }), "forbidden");
  assert.equal(classifyListFailure({ status: 401 }), "unauthorized");
  assert.equal(classifyListFailure({ status: 500 }), "error");
  assert.equal(classifyListFailure({ status: 0 }), "error");
});

test("D2 screen uses failure, not a regex on the humanized error text", () => {
  const src = fs.readFileSync(new URL("../src/pages/m/screens/orders/ServiceOrdersScreen.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /403\|forbidden\|permission/);
  assert.match(src, /classifyListFailure\(failure\) === "forbidden"/);
});

// ---- D3 --------------------------------------------------------------------------------------
test("D3 restore target = preHoldStatus / preCancelStatus with the hook defaults", () => {
  assert.equal(svRestoreTarget("ON_HOLD", { preHoldStatus: "IN_PRODUCTION" }), "IN_PRODUCTION");
  assert.equal(svRestoreTarget("ON_HOLD", {}), "CONFIRMED");
  assert.equal(svRestoreTarget("ON_HOLD", { preHoldStatus: "" }), "CONFIRMED");
  assert.equal(svRestoreTarget("CANCELLED", { preCancelStatus: "CONFIRMED" }), "CONFIRMED");
  assert.equal(svRestoreTarget("CANCELLED", null), "IN_PRODUCTION");
  assert.equal(svRestoreTarget("CONFIRMED", { preHoldStatus: "X" }), null);
});

test("D3 helper matches the hook's literal logic (source pin)", () => {
  const hook = fs.readFileSync(new URL("../src/pages/m/lib/use-so-actions.ts", import.meta.url), "utf8");
  assert.match(hook, /str\(doc \?\? \{\}, "preCancelStatus"\) \|\| "IN_PRODUCTION"/);
  assert.match(hook, /str\(doc \?\? \{\}, "preHoldStatus"\) \|\| "CONFIRMED"/);
});

test("D3 stage info uses the restore target, never history", () => {
  const history = [{ toStatus: "ON_HOLD", fromStatus: "READY_TO_SHIP", timestamp: "2026-01-01" }];
  assert.equal(svStageInfo("ON_HOLD", history, "CONFIRMED").pre, "CONFIRMED");
  assert.equal(svStageInfo("ON_HOLD", history, "IN_PRODUCTION").pre, "IN_PRODUCTION");
  assert.equal(svStageInfo("ON_HOLD", history).pre, "READY_TO_SHIP"); // legacy callers unchanged
});

test("D3 detail screen feeds the restore target into the subtitle/header", () => {
  const src = fs.readFileSync(new URL("../src/pages/m/screens/orders/SvOrderDetail.tsx", import.meta.url), "utf8");
  assert.match(src, /svStageInfo\(status, history, svRestoreTarget\(status, doc\)\)/);
});

// ---- D4 --------------------------------------------------------------------------------------
test("D4 locked / disabled rows give feedback and never close silently", () => {
  const all = { update: true, confirm: true, create: true, del: true, deliveryCreate: true, invoiceCreate: true, caseCreate: true };
  const plan = svActionPlan({ status: "CONFIRMED", perms: all, locks: { customer: "A delivery order exists", hub: "" } });
  const cust = plan.menu.find((m) => m.key === "change-customer");
  assert.deepEqual(svTapOutcome(cust), { kind: "toast", message: "A delivery order exists", closeMenu: false });
  const hub = plan.menu.find((m) => m.key === "change-hub");
  assert.equal(svTapOutcome(hub).kind, "run");
  const lockedEdit = svActionPlan({ status: "IN_PRODUCTION", perms: all, eligibility: { editable: false, reason: "production_started" } }).menu.find((m) => m.key === "edit");
  assert.equal(svTapOutcome(lockedEdit).kind, "lock-sheet");
  assert.ok(svTapOutcome({ disabled: true }).message.length > 0);
});
