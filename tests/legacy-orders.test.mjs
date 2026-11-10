// Mobile Legacy Repair Orders — pure rules (src/pages/m/screens/orders/legacy-logic.ts).
// Backend truth: src/api/routes/service-orders.ts STATUS_TRANSITIONS, POST/PUT returns; service-approval.ts.
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLegacyOrder, filterLegacy, chipCounts, normalizeChip, repairPath, pathIndex, primaryAction, undoTarget, canLogReturn, canCancel,
  classifyConflict, approvalStateFromMessage, returnActions, markRepairedBody, logReturnBody, confirmCopy, MODE_OPTIONS,
  firstReturnStartsRepair, legacyUnits,
} from "../src/pages/m/screens/orders/legacy-logic.ts";
import { LEGACY_TRANSITIONS } from "../src/pages/m/screens/orders/order-model.ts";

const ALL = { create: true, update: true };
const RO = { create: false, update: false };
const raw = (o = {}) => ({
  id: "svc-1", serviceOrderNo: "SVC-2611-001", caseId: "c1", sourceType: "SO", sourceId: "so1", sourceNo: "SO-1", customerName: "Acme",
  mode: "REPAIR", status: "OPEN", preCancelStatus: "", createdByName: "Ann", createdAt: "2026-11-09T01:00:00Z", notes: "",
  lines: [{ id: "l1", productId: "p1", productCode: "SF-1", productName: "Sofa", qty: 2, issueSummary: "torn" }, { id: "l2", productId: "", productCode: "", productName: "Typed", qty: 1 }],
  returns: [], ...o,
});
const ord = (o) => normalizeLegacyOrder(raw(o));

test("normalize: empty mode -> null, units sum, tolerant of missing arrays", () => {
  assert.equal(ord({ mode: "" }).mode, null);
  assert.equal(legacyUnits(ord()), 3);
  const bare = normalizeLegacyOrder({ id: "x" });
  assert.deepEqual([bare.lines.length, bare.returns.length, bare.status], [0, 0, ""]);
});

test("search covers number, customer, case no, source, line names; chip counts follow the search", () => {
  const a = ord(), b = ord({ id: "svc-2", serviceOrderNo: "SVC-2611-002", customerName: "Beta", status: "CLOSED", lines: [] });
  const caseNo = (o) => (o.id === "svc-1" ? "SC-9" : "SC-7");
  assert.equal(filterLegacy([a, b], "sc-9", "ALL", caseNo).rows.length, 1);
  assert.equal(filterLegacy([a, b], "sofa", "ALL", caseNo).rows[0].id, "svc-1");
  assert.equal(filterLegacy([a, b], "", "CLOSED", caseNo).rows[0].id, "svc-2");
  const { searched } = filterLegacy([a, b], "svc", "CLOSED", caseNo);
  assert.deepEqual([chipCounts(searched).ALL, chipCounts(searched).OPEN, chipCounts(searched).CLOSED], [2, 1, 1]);
  assert.equal(normalizeChip("nonsense"), "ALL");
  assert.equal(normalizeChip("IN_REPAIR"), "IN_REPAIR");
});

test("repair path: middle step follows the mode; cancelled is off the path", () => {
  assert.deepEqual(repairPath("REPRODUCE").steps, ["OPEN", "IN_PRODUCTION", "READY_TO_SHIP", "DELIVERED", "CLOSED"]);
  assert.equal(repairPath("STOCK_SWAP").steps[1], "RESERVED");
  assert.equal(repairPath(null).note, "Middle step depends on the mode");
  assert.equal(pathIndex({ status: "CANCELLED", mode: "REPAIR" }), -1);
  assert.equal(pathIndex({ status: "IN_REPAIR", mode: "REPAIR" }), 1);
});

test("primary action: mode decides, no repaired-return prerequisite, view-only gets none", () => {
  assert.deepEqual(primaryAction(ord({ mode: "" }), ALL), { kind: "choose-mode" });
  assert.deepEqual(primaryAction(ord({ mode: "REPAIR", status: "OPEN" }), ALL), { kind: "log-return" });
  // IN_REPAIR with an unrepaired return still offers Ready to ship (backend has no such gate)
  const inRepair = ord({ mode: "REPAIR", status: "IN_REPAIR", returns: [{ id: "r", condition: "REPAIRABLE" }] });
  assert.deepEqual(primaryAction(inRepair, ALL), { kind: "status", to: "READY_TO_SHIP" });
  assert.deepEqual(primaryAction(ord({ status: "READY_TO_SHIP" }), ALL), { kind: "status", to: "DELIVERED" });
  assert.deepEqual(primaryAction(ord({ status: "DELIVERED" }), ALL), { kind: "status", to: "CLOSED" });
  assert.equal(primaryAction(ord({ status: "CLOSED" }), ALL), null);
  assert.equal(primaryAction(ord({ status: "IN_PRODUCTION", mode: "REPRODUCE" }), RO), null);
  assert.equal(primaryAction(ord({ status: "IN_PRODUCTION", mode: "REPRODUCE" }), { create: true, update: false }), null);
});

test("every offered status primary is a legal backend transition", () => {
  for (const st of ["IN_PRODUCTION", "RESERVED", "IN_REPAIR", "READY_TO_SHIP", "DELIVERED"]) {
    const a = primaryAction(ord({ status: st }), ALL);
    assert.ok(LEGACY_TRANSITIONS[st].includes(a.to), st);
  }
});

test("cancel / undo: undo returns to the interrupted stage, else OPEN; cancel only from live stages", () => {
  assert.equal(undoTarget({ preCancelStatus: "RESERVED" }), "RESERVED");
  assert.equal(undoTarget({ preCancelStatus: "" }), "OPEN");
  assert.equal(undoTarget({ preCancelStatus: "CLOSED" }), "OPEN");
  assert.deepEqual(primaryAction(ord({ status: "CANCELLED", preCancelStatus: "IN_REPAIR" }), ALL), { kind: "undo-cancel", to: "IN_REPAIR" });
  for (const st of ["OPEN", "IN_PRODUCTION", "RESERVED", "IN_REPAIR"]) assert.equal(canCancel({ status: st }, ALL), true, st);
  for (const st of ["READY_TO_SHIP", "DELIVERED", "CLOSED", "CANCELLED"]) assert.equal(canCancel({ status: st }, ALL), false, st);
  assert.equal(canCancel({ status: "OPEN" }, RO), false);
});

test("cascade warnings by mode; closing/delivering never touches the parent case", () => {
  assert.match(confirmCopy("CANCEL", { no: "S", mode: "REPRODUCE" }, "SC-1").text, /production orders are cancelled/);
  assert.match(confirmCopy("CANCEL", { no: "S", mode: "STOCK_SWAP" }, "SC-1").text, /back to stock/);
  assert.match(confirmCopy("CANCEL", { no: "S", mode: "REPAIR" }, "SC-1").text, /No production or stock/);
  assert.match(confirmCopy("DELIVERED", { no: "S", mode: "REPAIR" }, "SC-1").text, /SC-1 is not closed automatically/);
  assert.match(confirmCopy("UNDO", { no: "S", mode: "STOCK_SWAP", preCancelStatus: "RESERVED" }, "").text, /Reserved.*reserved again only if/);
});

test("log return allowed except cancelled/closed; needs create permission", () => {
  assert.equal(canLogReturn({ status: "DELIVERED" }, ALL), true);
  assert.equal(canLogReturn({ status: "CLOSED" }, ALL), false);
  assert.equal(canLogReturn({ status: "CANCELLED" }, ALL), false);
  assert.equal(canLogReturn({ status: "OPEN" }, { create: false, update: true }), false);
  assert.equal(firstReturnStartsRepair(ord({ mode: "REPAIR", status: "OPEN" })), true);
  assert.equal(firstReturnStartsRepair(ord({ mode: "REPRODUCE", status: "OPEN" })), false);
});

test("stock swap is offered but blocked; scrap is listed but blocked", () => {
  assert.equal(MODE_OPTIONS.find((m) => m.mode === "STOCK_SWAP").blocked, true);
  assert.equal(MODE_OPTIONS.find((m) => m.mode === "REPRODUCE").blocked, false);
  assert.equal(MODE_OPTIONS.find((m) => m.mode === "REPAIR").needsApproval, false);
  assert.deepEqual(returnActions({ condition: "PENDING_DECISION" }, "IN_REPAIR", ALL), [{ action: "mark-repaired", blocked: false }, { action: "scrap", blocked: true }]);
  assert.deepEqual(returnActions({ condition: "REPAIRABLE" }, "IN_REPAIR", ALL), []);
  assert.deepEqual(returnActions({ condition: "SCRAPPED" }, "IN_REPAIR", ALL), []);
  assert.deepEqual(returnActions({ condition: "PENDING_DECISION" }, "OPEN", RO), []);
});

test("repaired is not a condition: PUT body keeps REPAIRABLE and sets repaired_*", () => {
  const b = markRepairedBody({ id: "u1", name: "Ann" }, "2026-11-09T00:00:00.000Z");
  assert.deepEqual(b, { condition: "REPAIRABLE", repairedAt: "2026-11-09T00:00:00.000Z", repairedBy: "u1", repairedByName: "Ann" });
  assert.notEqual(b.condition, "REPAIRED");
});

test("log-return body matches the desktop POST fields and always logs PENDING_DECISION", () => {
  const lines = ord().lines;
  const b = logReturnBody({ lineId: "l1", notes: "dented" }, lines, { id: "u1", name: "Ann" });
  assert.deepEqual(b, { serviceOrderLineId: "l1", productId: "p1", productCode: "SF-1", condition: "PENDING_DECISION", notes: "dented", receivedBy: "u1", receivedByName: "Ann" });
  const free = logReturnBody({ lineId: "l2", notes: "" }, lines, null);
  assert.equal(free.productId, null);
  assert.equal(free.notes, null);
  assert.equal(logReturnBody({ lineId: "", notes: "" }, lines, null).serviceOrderLineId, null);
});

test("409s are told apart by message, not status alone", () => {
  assert.equal(classifyConflict(409, "A 1-to-1 exchange needs approval. An approval request has been filed for this case and nothing was created."), "approval");
  assert.equal(classifyConflict(409, "This 1-to-1 exchange is waiting for approval. Nothing was created."), "approval");
  assert.equal(classifyConflict(409, "Cannot transition from CLOSED to OPEN. Allowed next states: (none)"), "transition");
  assert.equal(classifyConflict(409, "Mode is already set to REPAIR. Cancel and re-open if you need to change it."), "transition");
  assert.equal(classifyConflict(409, "Only 1 unit left in batch fgb-1 (remaining stock 1)."), "stock");
  assert.equal(classifyConflict(403, "Forbidden"), "forbidden");
  assert.equal(classifyConflict(400, "approval"), "other");
  assert.equal(approvalStateFromMessage("The exchange for this case was rejected. Nothing was created."), "REJECTED");
  assert.equal(approvalStateFromMessage("This 1-to-1 exchange is waiting for approval."), "PENDING");
  assert.equal(approvalStateFromMessage("Cannot transition"), null);
});
