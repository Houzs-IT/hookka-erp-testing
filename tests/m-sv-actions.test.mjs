import test from "node:test";
import assert from "node:assert/strict";
import { svActionPlan, svEditLockMessage, SV_CANCEL_COPY } from "../src/pages/m/screens/orders/sv-actions.ts";

const all = { update: true, confirm: true, create: true, del: true, deliveryCreate: true, invoiceCreate: true, caseCreate: true };
const none = Object.fromEntries(Object.keys(all).map((k) => [k, false]));
const keys = (p) => p.menu.map((m) => m.key);

test("primary action by status", () => {
  const pk = (status) => svActionPlan({ status, perms: all }).primary?.key ?? null;
  assert.equal(pk("DRAFT"), "confirm");
  assert.equal(pk("READY_TO_SHIP"), "create-delivery");
  assert.equal(pk("DELIVERED"), "generate-invoice");
  assert.equal(pk("ON_HOLD"), "resume");
  assert.equal(pk("CANCELLED"), "undo-cancel");
  assert.equal(pk("IN_PRODUCTION"), null);
});

test("hold only CONFIRMED/IN_PRODUCTION; cancel only DRAFT/CONFIRMED/IN_PRODUCTION (desktop UI)", () => {
  for (const s of ["CONFIRMED", "IN_PRODUCTION"]) assert.ok(keys(svActionPlan({ status: s, perms: all })).includes("hold"));
  assert.ok(!keys(svActionPlan({ status: "DRAFT", perms: all })).includes("hold"));
  assert.ok(!keys(svActionPlan({ status: "READY_TO_SHIP", perms: all })).includes("cancel"));
  assert.ok(keys(svActionPlan({ status: "DRAFT", perms: all })).includes("cancel"));
});

test("production_started locks edit with the server wording; no override action exists", () => {
  const elig = { editable: false, reason: "production_started", startedDept: "Sewing", jcStatus: "IN_PROGRESS" };
  const p = svActionPlan({ status: "IN_PRODUCTION", perms: all, eligibility: elig });
  const edit = p.menu.find((m) => m.key === "edit");
  assert.equal(edit.lockedReason, "Cannot edit — Sewing has started production (job card status: IN_PROGRESS)");
  assert.ok(!keys(p).some((k) => /override/.test(k)));
  assert.equal(svEditLockMessage({ editable: true }), "");
});

test("read-only user sees no mutating controls", () => {
  const p = svActionPlan({ status: "DRAFT", perms: none });
  assert.equal(p.primary, null);
  assert.equal(p.viewOnly, true);
  assert.deepEqual(keys(p), ["files", "pdf"]);
});

test("delete draft needs sales-orders:delete and DRAFT; open case only after shipping", () => {
  assert.ok(keys(svActionPlan({ status: "DRAFT", perms: all })).includes("delete"));
  assert.ok(!keys(svActionPlan({ status: "CONFIRMED", perms: all })).includes("delete"));
  assert.ok(keys(svActionPlan({ status: "SHIPPED", perms: all })).includes("open-case"));
  assert.ok(!keys(svActionPlan({ status: "IN_PRODUCTION", perms: all })).includes("open-case"));
  assert.ok(!keys(svActionPlan({ status: "DRAFT", perms: { ...all, del: false } })).includes("delete"));
});

test("change customer / hub disabled with the exact lock message", () => {
  const p = svActionPlan({ status: "IN_PRODUCTION", perms: all, locks: { customer: "Customer locked: DO DO-1 already LOADED.", hub: "" } });
  const c = p.menu.find((m) => m.key === "change-customer");
  assert.equal(c.disabled, true);
  assert.equal(c.reason, "Customer locked: DO DO-1 already LOADED.");
  assert.ok(!p.menu.find((m) => m.key === "change-hub").disabled);
});

test("cancel copy never says cannot be easily undone", () => {
  assert.ok(!/easily undone/.test(SV_CANCEL_COPY));
});
