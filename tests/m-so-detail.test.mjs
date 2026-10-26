// m-so-detail.test.mjs — the Sales Order detail
// (src/pages/m/screens/SalesOrderDetail.tsx + src/pages/m/lib/so-detail.ts).
// Rows mimic GET /api/sales-orders/:id and /api/audit-events output. The
// display rules must match desktop src/pages/sales/detail.tsx, and the PHONE
// rendering must stay read-only with no Paid / Balance / Payments (the wider
// layouts and their actions are covered by m-sales-detail-responsive.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  displaySoId, productionLabel, productionSummary, sortPOs, doLabel, deliverySummary, doFacts,
  overrideForLine, specChips, surcharges, soLineRef, statusBanner, statusEvents, auditEvents,
  auditChangedFields, auditActionLabel, fmtDate, OVERRIDE_NOTE_PREFIX,
} from "../src/pages/m/lib/so-detail.ts";

// EOL-agnostic (core.autocrlf checkouts are CRLF on disk).
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
// Code only: the file's header comment explains what was removed by name.
const PHONE = read("src/pages/m/screens/SalesOrderDetail.tsx").replace(/^\s*\/\/.*$/gm, "");
const SCREEN = read("src/pages/m/screens/SalesDetailScreen.tsx");
const DESKTOP = read("src/pages/sales/detail.tsx");

test("SO-ID display rule matches desktop: SOFA drops the -NN suffix, BF / ACC keep it", () => {
  assert.equal(displaySoId("SO-2610-012-03", "SOFA"), "SO-2610-012");
  assert.equal(displaySoId("SO-2610-012-03", "sofa"), "SO-2610-012");
  assert.equal(displaySoId("SO-2610-012-01", "BEDFRAME"), "SO-2610-012-01");
  assert.equal(displaySoId("SO-2610-012-05", "ACCESSORY"), "SO-2610-012-05");
  assert.match(DESKTOP, /po\.poNo\.replace\(\/-\\d\+\$\/, ""\)/);
});

test("production labels follow desktop productionLabel", () => {
  assert.equal(productionLabel({ status: "COMPLETED", completedDate: "2026-10-12" }, fmtDate), "Completed 12 Oct 2026");
  assert.equal(productionLabel({ status: "COMPLETED" }, fmtDate), "Completed");
  assert.equal(productionLabel({ status: "PENDING" }, fmtDate), "Not started");
  assert.equal(productionLabel({ status: "ON_HOLD" }, fmtDate), "On hold");
  assert.equal(productionLabel({ status: "CANCELLED" }, fmtDate), "Cancelled");
  assert.equal(productionLabel({ status: "IN_PROGRESS", currentDepartment: "FAB_SEW" }, fmtDate), "In production — Fab Sew");
  assert.equal(productionLabel({ status: "IN_PROGRESS" }, fmtDate), "In production");
});

test("production summary counts the real PO statuses, completed first", () => {
  const pos = [
    { status: "PENDING" }, { status: "COMPLETED" }, { status: "IN_PROGRESS" }, { status: "COMPLETED" },
  ];
  const s = productionSummary(pos);
  assert.equal(s.total, 4);
  assert.equal(s.completed, 2);
  assert.deepEqual(s.counts.map((c) => [c.status, c.count]), [["COMPLETED", 2], ["IN_PROGRESS", 1], ["PENDING", 1]]);
  assert.deepEqual(productionSummary([]), { total: 0, completed: 0, counts: [] });
  // Open POs come first in the expanded list.
  assert.deepEqual(sortPOs(pos).map((p) => p.status), ["IN_PROGRESS", "PENDING", "COMPLETED", "COMPLETED"]);
});

test("DO labels are desktop's DO_STATUS_LABEL; scheduledDate reads as Expected", () => {
  assert.equal(doLabel("DRAFT"), "Pending Dispatch");
  assert.equal(doLabel("LOADED"), "Dispatched");
  assert.equal(doLabel("IN_TRANSIT"), "In Transit");
  assert.equal(doLabel("SIGNED"), "Signed");
  assert.deepEqual(
    deliverySummary([{ status: "LOADED" }, { status: "DRAFT" }, { status: "LOADED" }]),
    [{ status: "LOADED", label: "Dispatched", count: 2 }, { status: "DRAFT", label: "Pending Dispatch", count: 1 }],
  );
  assert.deepEqual(doFacts({ driverName: "Rahim", scheduledDate: "2026-10-20" }, fmtDate), ["Driver Rahim", "Expected 20 Oct 2026"]);
  assert.deepEqual(doFacts({ dispatchedAt: "2026-10-15T08:00:00Z", deliveredAt: "2026-10-16" }, fmtDate), ["Delivered 16 Oct 2026"]);
  assert.match(DESKTOP, /LOADED: "Dispatched"/);
});

test("price override maps lineIndex === lineNo - 1 (desktop), newest wins", () => {
  const ov = [
    { lineIndex: 1, overridePrice: 330000, timestamp: "2026-10-04T10:00" },
    { lineIndex: 1, overridePrice: 320000, timestamp: "2026-10-05T10:00" },
    { lineIndex: 0, overridePrice: 100, timestamp: "2026-10-01" },
  ];
  assert.equal(overrideForLine(ov, 2).overridePrice, 320000);
  assert.equal(overrideForLine(ov, 1).overridePrice, 100);
  assert.equal(overrideForLine(ov, 3), null);
  assert.match(DESKTOP, /o\.lineIndex === item\.lineNo - 1/);
});

test("item specs: chips from real fields, surcharges as facts, SO line ref", () => {
  const it = {
    lineSuffix: "-04", gapInches: 0, divanHeightInches: 14, divanPriceSen: 60000, legHeightInches: 6, legPriceSen: 4000,
    specialOrder: "SEAT_DEPTH_PLUS", specialOrderPriceSen: 15000,
    customSpecials: [{ description: "Extra arm", surchargeSen: 5000 }, { description: "", surchargeSen: 100 }],
  };
  assert.deepEqual(specChips(it).map((c) => c.text), ['Divan 14"', 'Leg 6"', "SEAT DEPTH PLUS"]);
  assert.deepEqual(surcharges(it), [
    { label: 'Divan 14"', sen: 60000 }, { label: 'Leg 6"', sen: 4000 },
    { label: "Seat Depth Plus", sen: 15000 }, { label: "Extra arm", sen: 5000 },
  ]);
  assert.equal(soLineRef("SO-2610-012", it), "SO-2610-012-04");
  assert.equal(soLineRef("", it), "");
  assert.deepEqual(specChips({}), []);
  // No "PO line" label (the line ref is the SO's). Sales Order Detail v4 (2026-10-27) brings the
  // Base price row back, from the real basePriceSen, above the surcharges.
  assert.doesNotMatch(PHONE, /"PO line"/);
  assert.match(PHONE, /"SO line"/);
  assert.match(PHONE, /basePriceSen/);
});

test("hold / cancel banner uses the real fields", () => {
  const fmt = (x) => x.slice(0, 10);
  const hold = statusBanner({ status: "ON_HOLD", holdReason: "Waiting fabric", heldBy: "Nurul", heldAt: "2026-10-14T15:20" }, [], fmt);
  assert.deepEqual(hold, { tone: "warning", title: "Order on hold", text: "Waiting fabric", meta: "by Nurul · 2026-10-14" });
  assert.equal(statusBanner({ status: "ON_HOLD" }, [], fmt).text, "No hold reason recorded.");
  const hist = [
    { toStatus: "CANCELLED", changedBy: "A", timestamp: "2026-10-01T00:00", notes: "old" },
    { toStatus: "CANCELLED", changedBy: "B", timestamp: "2026-10-09T00:00", notes: "" },
  ];
  const c = statusBanner({ status: "CANCELLED" }, hist, fmt);
  assert.equal(c.tone, "danger");
  assert.equal(c.meta, "by B · 2026-10-09");
  assert.equal(statusBanner({ status: "IN_PRODUCTION" }, hist, fmt), null);
});

test("status history: newest first, override rows recognised by desktop's prefix", () => {
  assert.match(DESKTOP, new RegExp(`OVERRIDE_NOTE_PREFIX = "${OVERRIDE_NOTE_PREFIX}"`));
  const ev = statusEvents([
    { id: "a", fromStatus: "DRAFT", toStatus: "IN_PRODUCTION", timestamp: "2026-10-02T11:20", changedBy: "X", notes: "", autoActions: ["6 production orders created"] },
    { id: "b", fromStatus: "IN_PRODUCTION", toStatus: "IN_PRODUCTION", timestamp: "2026-10-05T09:00", changedBy: "Y", notes: `${OVERRIDE_NOTE_PREFIX}customer call` },
  ]);
  assert.deepEqual(ev.map((e) => e.key), ["b", "a"]);
  assert.equal(ev[0].override, true);
  assert.equal(ev[0].note, "customer call");
  assert.deepEqual(ev[1].autoActions, ["6 production orders created"]);
});

test("audit history reads actorUserName and never names balance / deposit fields", () => {
  const ev = auditEvents([
    { id: "1", action: "update", actorUserName: "Ahmad", ts: "2026-10-08T10:22:00Z",
      before: { hookkaExpectedDD: "2026-10-20", balanceSen: 1, depositSen: 2, updatedAt: "x" },
      after: { hookkaExpectedDD: "2026-10-23", balanceSen: 3, depositSen: 4, updatedAt: "y" } },
    { id: "2", action: "create", actorUserName: "Demo", ts: "2026-10-02T11:05:00Z", before: null, after: { status: "DRAFT" } },
  ]);
  assert.equal(ev[0].by, "Ahmad");
  assert.equal(ev[0].title, "Updated");
  assert.deepEqual(ev[0].fields, ["Hookka Expected DD"]);
  assert.deepEqual(ev[1].fields, []);
  assert.equal(auditActionLabel("confirm"), "Confirmed");
  assert.equal(auditActionLabel("cancel"), "Cancelled");
  assert.equal(auditActionLabel("void"), "Voided");
  assert.equal(auditActionLabel("STATUS_CHANGE"), "Status Change");
  assert.deepEqual(auditChangedFields({ totalSen: 1 }, { totalSen: 2 }), ["Total"]);
  assert.deepEqual(auditChangedFields({ someNewField: 1 }, { someNewField: 2 }), ["Some New Field"]);
  assert.match(read("src/api/routes/audit-events.ts"), /actorUserName: r\.actorUserName/);
});

test("the detail file itself never mutates: requests live in the shared actions hook", () => {
  // Rendering the PHONE markup has no actions / Paid / Balance / Payments: see
  // m-sales-detail-responsive.test.mjs (rendered, not just source).
  assert.doesNotMatch(PHONE, /mutateJson|editSalesOrderSpec|newDeliveryOrderSpec/);
  assert.doesNotMatch(PHONE, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(PHONE, /Confirm Order|Cancel Order|Undo Cancel|Issue Delivery Order|Edit Draft/);
  // No relationship map / lifecycle stepper; production orders are not links.
  assert.doesNotMatch(PHONE, /DocumentChainMap|\/m\/production\//);
  // Real routes only.
  assert.match(PHONE, /\/m\/delivery\/\$\{encodeURIComponent\(doId\)\}/);
  assert.match(PHONE, /\/m\/invoices\/\$\{encodeURIComponent\(invId\)\}/);
  // Hub is the API's hubName.
  assert.match(PHONE, /"hubName"/);
  assert.doesNotMatch(PHONE, /hubShortName/);
});

test("phone visual refinements (2026-10-16): no qty / line counters, honest missing values, borderless chips", () => {
  // Sales Order Detail v4 (2026-10-27) adds the "N lines · N qty" summary back beside "Order items".
  assert.ok(PHONE.includes("· {totalQty} qty"));
  assert.match(PHONE, /Qty \{num\(item, "quantity", "qty"\)\}/); // per-line qty stays
  assert.match(PHONE, /Not set/);
  assert.match(PHONE, /Not assigned/);
  // Phone uses its own borderless chip; the shared bordered StatusPill is not used here.
  assert.doesNotMatch(PHONE, /<StatusPill\b|StatusPill \}|, StatusPill,/);
  const chip = PHONE.match(/function StatusChip\([\s\S]*?\n\}\n/)?.[0] ?? "";
  assert.ok(chip, "StatusChip found");
  assert.doesNotMatch(chip, /\bborder(Color|Width|Style)?\s*:|outline|boxShadow/);
  assert.match(chip, /backgroundColor: tint\(style\.hex, 0\.14\)/);
  assert.match(chip, /titleCaseStatus\(label\)/);
});

test("one adaptive screen: the dispatcher always renders SalesOrderDetail; the legacy tablet screen is kept, unused", () => {
  assert.match(SCREEN, /export function SalesDetailScreen\(\) \{\s*return <SalesOrderDetail \/>;\s*\}/);
  assert.doesNotMatch(SCREEN, /phone \? <SalesDetail/);
  // Kept until parity is verified in a non-production environment.
  assert.match(SCREEN, /export function SalesDetailTablet\(\)/);
  assert.match(SCREEN, /Undo Cancel/);
  assert.match(SCREEN, /Confirm Order/);
  assert.match(SCREEN, /Issue Delivery Order/);
});
