// sv-list-model.test.mjs — pure derivations behind the mobile SV Service Orders list.
// The status sets are pinned against src/lib/so-status.ts so the two can never drift apart.
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_SV_FILTERS,
  groupPosBySo,
  inChip,
  inTab,
  matchesSv,
  sortSv,
  svFilterCount,
  svProduction,
  toSvRow,
} from "../src/pages/m/screens/orders/sv-list-model.ts";
import { COMPLETED_STATUSES, OUTSTANDING_STATUSES, PENDING_DELIVERY_STATUSES } from "../src/lib/so-status.ts";
import { LEGACY_TRANSITIONS, svTone } from "../src/pages/m/screens/orders/order-model.ts";

const ALL = ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED", "ON_HOLD", "CANCELLED"];

test("chip buckets equal src/lib/so-status.ts", () => {
  for (const s of ALL) {
    assert.equal(inChip(s, "OUTSTANDING"), OUTSTANDING_STATUSES.has(s), `outstanding ${s}`);
    assert.equal(inChip(s, "PENDING_DELIVERY"), PENDING_DELIVERY_STATUSES.has(s), `pending ${s}`);
    assert.equal(inChip(s, "COMPLETED"), COMPLETED_STATUSES.has(s), `completed ${s}`);
    assert.equal(inChip(s, "ALL"), true);
  }
  assert.equal(inChip("ON_HOLD", "ON_HOLD"), true);
  assert.equal(inChip("CANCELLED", "CANCELLED"), true);
});

test("Confirmed tab = everything but DRAFT; Drafts tab = DRAFT only", () => {
  for (const s of ALL) {
    assert.equal(inTab(s, "drafts"), s === "DRAFT");
    assert.equal(inTab(s, "confirmed"), s !== "DRAFT");
  }
});

test("toSvRow reads dual-keyed fields and totals qty over lines", () => {
  const r = toSvRow({ id: "a", companySOId: "SV-2611-001", status: "in_production", customerName: "X", items: [{ quantity: 2 }, { qty: 3 }], total_sen: 1500, hookkaExpectedDD: "2026-11-18T00:00:00Z" });
  assert.equal(r.no, "SV-2611-001");
  assert.equal(r.status, "IN_PRODUCTION");
  assert.equal(r.qty, 5);
  assert.equal(r.lines, 2);
  assert.equal(r.totalSen, 1500);
  assert.equal(r.expectedDD, "2026-11-18");
});

test("production: Done only when every live PO is COMPLETED, never from a rounded 100%", () => {
  assert.equal(svProduction([]).kind, "none");
  assert.equal(svProduction([{ status: "COMPLETED" }, { status: "COMPLETED" }]).kind, "done");
  assert.equal(svProduction([{ status: "COMPLETED" }, { status: "CANCELLED" }]).kind, "done");
  const p = svProduction([{ status: "IN_PROGRESS", progress: 99.9, quantity: 1, currentDepartment: "Upholstery" }, { status: "COMPLETED", quantity: 1 }]);
  assert.equal(p.kind, "progress");
  assert.ok(p.pct <= 99, "a 100% rounding must not read as done");
  assert.equal(p.dept, "Upholstery");
});

test("production progress is quantity-weighted", () => {
  const p = svProduction([{ status: "IN_PROGRESS", progress: 100 - 1, quantity: 1 }, { status: "IN_PROGRESS", progress: 0, quantity: 3 }]);
  assert.equal(p.pct, 25);
});

test("search covers number, customer, PO, SO, reference and parent case; case filter works", () => {
  const r = toSvRow({ id: "a", companySOId: "SV-1", status: "CONFIRMED", customerName: "Desa Interior", customerPOId: "DI-8812", reference: "Seat covers" });
  assert.ok(matchesSv(r, "desa", EMPTY_SV_FILTERS, ""));
  assert.ok(matchesSv(r, "di-8812", EMPTY_SV_FILTERS, ""));
  assert.ok(matchesSv(r, "seat", EMPTY_SV_FILTERS, ""));
  assert.ok(matchesSv(r, "sc-2611", EMPTY_SV_FILTERS, "SC-2611-006"));
  assert.ok(!matchesSv(r, "zzz", EMPTY_SV_FILTERS, ""));
  assert.ok(!matchesSv(r, "", { ...EMPTY_SV_FILTERS, caseLink: "linked" }, "", "standalone"));
  assert.ok(matchesSv(r, "", { ...EMPTY_SV_FILTERS, caseLink: "linked" }, "", "linked"));
  assert.equal(svFilterCount({ sort: "expected", caseLink: "linked" }), 2);
});

test("sorting is stable and puts missing dates last", () => {
  const a = toSvRow({ id: "a", companySOId: "SV-1", status: "CONFIRMED", hookkaExpectedDD: "" });
  const b = toSvRow({ id: "b", companySOId: "SV-2", status: "CONFIRMED", hookkaExpectedDD: "2026-11-01" });
  assert.deepEqual(sortSv([a, b], "expected").map((r) => r.no), ["SV-2", "SV-1"]);
});

test("groupPosBySo groups by salesOrderId and skips orphans", () => {
  const m = groupPosBySo([{ salesOrderId: "x" }, { salesOrderId: "x" }, { salesOrderId: "" }]);
  assert.equal(m.get("x").length, 2);
  assert.equal(m.size, 1);
});

test("legacy transition table mirrors the backend STATUS_TRANSITIONS", () => {
  const src = readFileSyncSafe("src/api/routes/service-orders.ts");
  for (const [from, tos] of Object.entries(LEGACY_TRANSITIONS)) {
    const m = new RegExp(`${from}:\\s*\\[([^\\]]*)\\]`).exec(src.slice(src.indexOf("STATUS_TRANSITIONS: Record")));
    assert.ok(m, `backend has ${from}`);
    const backend = [...m[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
    assert.deepEqual([...tos].sort(), backend.sort(), `transitions from ${from}`);
  }
});

test("SV status tones exist for every status", () => {
  for (const s of ALL) assert.ok(svTone(s).bg && svTone(s).fg);
});

import { readFileSync } from "node:fs";
function readFileSyncSafe(p) {
  return readFileSync(p, "utf8");
}
