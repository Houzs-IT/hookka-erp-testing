// The dashboard's Overdue cases by stage board (owner 2026-11-04).
import test from "node:test";
import assert from "node:assert/strict";
import { STAGE_TARGET_DAYS, buildSlaRows } from "../src/api/lib/dashboard-service-sla.ts";

const NOW = Date.parse("2026-11-04T00:00:00Z");
const base = { caseNo: "SC", customerName: "C", investigatingAt: null, issue: "x" };

test("an open case with a service order sits at Service Order, overdue past that stage's target", () => {
  const cases = [{ ...base, id: "a", status: "IN_PROGRESS", createdAt: "2026-10-01T00:00:00Z" }];
  const orders = [{ caseId: "a", id: "so1", status: "CONFIRMED", createdAt: "2026-10-20T00:00:00Z", isSv: true }];
  const [r] = buildSlaRows(cases, orders, [], [], NOW);
  assert.equal(r.stage, "Service Order");
  assert.equal(r.target, STAGE_TARGET_DAYS["Service Order"]);
  assert.equal(r.inStage, 15);
  assert.equal(r.overdue, 5);
  assert.equal(r.age, 34);
});

test("delivery orders move the stage on, and only the case's own orders count", () => {
  const cases = [{ ...base, id: "a", status: "IN_PROGRESS", createdAt: "2026-10-01T00:00:00Z" }];
  const orders = [{ caseId: "a", id: "so1", status: "CONFIRMED", createdAt: "2026-10-02T00:00:00Z", isSv: true }];
  const dos = [{ salesOrderId: "so1", status: "DRAFT", createdAt: "2026-11-03T00:00:00Z" }, { salesOrderId: "other", status: "DELIVERED", deliveredAt: "2026-10-05T00:00:00Z" }];
  const [r] = buildSlaRows(cases, orders, dos, [], NOW);
  assert.equal(r.stage, "Delivery arranged");
  assert.equal(r.overdue, 0);
});

test("most overdue first", () => {
  const cases = [
    { ...base, id: "fresh", status: "OPEN", createdAt: "2026-11-03T12:00:00Z" },
    { ...base, id: "old", status: "OPEN", createdAt: "2026-10-20T00:00:00Z" },
  ];
  assert.deepEqual(buildSlaRows(cases, [], [], [], NOW).map((r) => r.id), ["old", "fresh"]);
});
