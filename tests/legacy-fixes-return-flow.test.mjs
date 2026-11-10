// Legacy repair-order fixes: return flow = desktop ReturnRow / LogReturnModal, neutral FG note, plain copy, back paths.
// Pure logic, no network, no real data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  returnActions, markRepairedBody, logReturnBody, RETURN_COND_OPTIONS, confirmCopy, modeConfirmCopy, classifyConflict, conflictText, CONFLICT_COPY,
  MODE_OPTIONS, LEGACY_LIST_PATH, legacyDetailHref, approvalStateFromMessage,
} from "../src/pages/m/screens/orders/legacy-logic.ts";
import { FG_BATCH_BLOCKED_NOTE, STOCK_SWAP_UNAVAILABLE_NOTE, SCRAP_UNAVAILABLE_NOTE, legacyDetailPath, ORDERS_LIST } from "../src/pages/m/screens/orders/order-model.ts";

const ALL = { create: true, update: true };

test("PENDING_DECISION row -> one 'Mark repaired' (+ disabled Scrap); no 'set-repairable' step exists", () => {
  const a = returnActions({ condition: "PENDING_DECISION" }, "IN_REPAIR", ALL);
  assert.deepEqual(a, [{ action: "mark-repaired", blocked: false }, { action: "scrap", blocked: true }]);
  assert.ok(!a.some((x) => x.action === "set-repairable"));
});

test("REPAIRABLE (already repaired) / SCRAPPED rows offer no action, as desktop", () => {
  for (const condition of ["REPAIRABLE", "SCRAPPED", ""]) assert.deepEqual(returnActions({ condition }, "IN_REPAIR", ALL), [], condition);
});

test("desktop does not gate the row by order status; only update permission applies", () => {
  for (const st of ["OPEN", "IN_REPAIR", "DELIVERED", "CLOSED", "CANCELLED"]) assert.equal(returnActions({ condition: "PENDING_DECISION" }, st, ALL).length, 2, st);
  assert.deepEqual(returnActions({ condition: "PENDING_DECISION" }, "IN_REPAIR", { create: true, update: false }), []);
});

test("Scrap is always blocked: the only unblocked action is mark-repaired", () => {
  const unblocked = returnActions({ condition: "PENDING_DECISION" }, "OPEN", ALL).filter((x) => !x.blocked);
  assert.deepEqual(unblocked.map((x) => x.action), ["mark-repaired"]);
});

test("Mark repaired body has exactly the desktop shape", () => {
  const b = markRepairedBody({ id: "u1", name: "Ann" }, "2026-11-10T01:02:03.000Z");
  assert.deepEqual(Object.keys(b).sort(), ["condition", "repairedAt", "repairedBy", "repairedByName"]);
  assert.equal(b.condition, "REPAIRABLE");
  assert.deepEqual(markRepairedBody(null, "x"), { condition: "REPAIRABLE", repairedAt: "x", repairedBy: null, repairedByName: null });
});

test("Log return: only Pending decision is offered; body = desktop fields; no date / SCRAPPED / REPAIRABLE", () => {
  assert.deepEqual(RETURN_COND_OPTIONS.map((c) => c.value), ["PENDING_DECISION"]);
  const lines = [{ id: "l1", productId: "p1", productCode: "SF-1" }];
  const b = logReturnBody({ lineId: "l1", notes: "x", condition: "SCRAPPED", receivedOn: "2020-01-01" }, lines, { id: "u", name: "N" });
  assert.deepEqual(Object.keys(b).sort(), ["condition", "notes", "productCode", "productId", "receivedBy", "receivedByName", "serviceOrderLineId"]);
  assert.equal(b.condition, "PENDING_DECISION");
  assert.equal(logReturnBody({ lineId: "", notes: "" }, lines, null).serviceOrderLineId, null); // "(unspecified)"
});

test("FG note wording is neutral (no stated cause) for stock swap and scrap", () => {
  for (const s of [FG_BATCH_BLOCKED_NOTE, STOCK_SWAP_UNAVAILABLE_NOTE, SCRAP_UNAVAILABLE_NOTE]) {
    assert.doesNotMatch(s, /picker|batch|catalogue|temporar|desktop/i, s);
    assert.match(s, /available on mobile yet/);
  }
  assert.match(STOCK_SWAP_UNAVAILABLE_NOTE, /Stock swap/);
  assert.match(SCRAP_UNAVAILABLE_NOTE, /Scrap/);
});

test("Stock swap stays blocked in the mode list", () => {
  assert.equal(MODE_OPTIONS.find((m) => m.mode === "STOCK_SWAP").blocked, true);
});

test("undo-cancel copy for stock swap no longer says it fails", () => {
  const t = confirmCopy("UNDO", { no: "S", mode: "STOCK_SWAP", preCancelStatus: "RESERVED" }, "").text;
  assert.doesNotMatch(t, /fail/i);
  assert.match(t, /reserved again only if the batch still has enough units/);
});

test("Reproduce confirm copy mentions the pending approval request and that nothing is created", () => {
  const t = modeConfirmCopy("REPRODUCE", { no: "S", lines: [{}] }).text;
  assert.match(t, /no approved exchange approval/);
  assert.match(t, /pending approval request/);
  assert.match(t, /creates nothing/);
  assert.doesNotMatch(modeConfirmCopy("REPAIR", { no: "S", lines: [] }).text, /approval/);
});

test("409 sheet has no developer jargon and classification is unchanged", () => {
  for (const k of Object.keys(CONFLICT_COPY)) {
    assert.deepEqual(Object.keys(CONFLICT_COPY[k]), ["title"], k);
    assert.doesNotMatch(CONFLICT_COPY[k].title, /409|403|not an approval problem/i);
  }
  assert.equal(classifyConflict(409, "Cannot transition from CLOSED to OPEN"), "transition");
  assert.equal(classifyConflict(409, "This exchange is waiting for approval."), "approval");
  assert.equal(classifyConflict(409, "Only 1 unit left in batch"), "stock");
  assert.equal(classifyConflict(403, "x"), "forbidden");
  assert.equal(approvalStateFromMessage("rejected"), "REJECTED");
});

test("conflictText keeps the server message and fixes punctuation before the refresh note", () => {
  const msg = "Cannot transition from CLOSED to OPEN. Allowed next states: (none)";
  assert.equal(conflictText("transition", msg), `${msg}. The order has been refreshed — check its status and try again.`);
  assert.equal(conflictText("transition", "Mode is already set."), "Mode is already set. The order has been refreshed — check its status and try again.");
  assert.equal(conflictText("approval", "Server says no"), "Server says no");
  assert.doesNotMatch(conflictText("transition", "x"), /409|not an approval/);
});

test("back / card paths keep the legacy family; bare deep link path is unchanged", () => {
  assert.equal(LEGACY_LIST_PATH, `${ORDERS_LIST}?fam=legacy`);
  assert.equal(legacyDetailHref("a b"), `${legacyDetailPath("a b")}?fam=legacy`);
  assert.equal(legacyDetailPath("x1"), "/m/serviceorders/x1");
});
