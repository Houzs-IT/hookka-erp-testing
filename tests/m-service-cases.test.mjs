// ---------------------------------------------------------------------------
// m-service-cases.test.mjs — the pure model behind the mobile Service Cases
// list/detail (src/pages/m/screens/cases/case-model.ts + case-filters.ts).
// The stage / age maths is the desktop's (case-pipeline.ts); these tests pin
// that the mobile row builder feeds it the same way the desktop list does,
// that the CSV is the desktop's 11 columns, and that filters / sort / the
// "counts before search" rule behave as specified.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  /* native type-stripping on Node 22+ */
}

const url = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const model = await import(url("src/pages/m/screens/cases/case-model.ts"));
const filters = await import(url("src/pages/m/screens/cases/case-filters.ts"));
const { toRow, indexBy, daysOpenLabel, stageDaysLabel, ordersLabel, isAged, CASE_CSV_COLUMNS, ALLOWED_TRANSITIONS, categoryCodesForCase, deptForCase } = model;
const { matchesCase, sortCases, EMPTY_FILTERS, filterCount } = filters;

const NOW = Date.parse("2026-11-09T00:00:00.000Z");
const days = (n) => new Date(NOW - n * 86400000).toISOString();

function mk(over = {}) {
  return {
    id: "c1", caseNo: "SC-2611-001", sourceType: "SO", sourceId: "so1", sourceNo: "SO-2610-012",
    customerName: "Acme Sdn Bhd", status: "OPEN", createdAt: days(10), closedAt: "", investigatingAt: null,
    rootCauseCategory: null, rootCauses: [], rootCauseDetails: null, responsibleUnit: null, issueDescription: "",
    affectedProducts: [], orders: [], customerPO: "PO-1", ...over,
  };
}
const row = (over, dos = [], pos = []) => toRow(mk(over), indexBy(dos), indexBy(pos), NOW);

test("an OPEN case with no orders is at Opened; ages count from createdAt", () => {
  const r = row({});
  assert.equal(r.stageLabel, "Opened");
  assert.equal(r.stageIndex, 0);
  assert.equal(r.daysOpen, 10);
  assert.equal(r.stageDays, 10);
  assert.equal(daysOpenLabel(r), "10d");
  assert.ok(isAged(r), "open 10 days is aged (>= 7)");
});

test("IN_PROGRESS with no order is Investigating; a legacy order moves it to Service Order", () => {
  assert.equal(row({ status: "IN_PROGRESS" }).stageLabel, "Investigating");
  const r = row({ status: "IN_PROGRESS", orders: [{ id: "o1", serviceOrderNo: "SVC-1", status: "OPEN", mode: "REPAIR", isSv: false, createdAt: days(3) }] });
  assert.equal(r.stageLabel, "Service Order");
  assert.equal(r.ordersCount, 1);
  assert.equal(ordersLabel(r), "SVC-1");
});

test("an SV order that was DELIVERED reads Delivered; CANCELLED overrides it and has no ages", () => {
  const sv = { id: "sv1", serviceOrderNo: "SV-1", status: "DELIVERED", isSv: true, createdAt: days(5) };
  const delivered = row({ status: "IN_PROGRESS", orders: [sv] });
  assert.equal(delivered.stageLabel, "Delivered");
  const cancelled = row({ status: "CANCELLED", closedAt: days(1), orders: [sv] });
  assert.equal(cancelled.stageLabel, "Cancelled");
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.daysOpen, null);
  assert.equal(daysOpenLabel(cancelled), "—");
  assert.equal(stageDaysLabel(cancelled), "—");
  assert.ok(!isAged(cancelled));
});

test("production job-card completion moves an SV case to Repair in progress (pos matched by salesOrderId)", () => {
  const sv = { id: "sv1", serviceOrderNo: "SV-1", status: "CONFIRMED", isSv: true, createdAt: days(5) };
  const r = row({ status: "IN_PROGRESS", orders: [sv] }, [], [{ id: "p1", salesOrderId: "sv1", jobCards: [{ completedDate: days(2) }] }]);
  assert.equal(r.stageLabel, "Repair in progress");
});

test("CLOSED freezes ages at closedAt and is not 'aged'", () => {
  const r = row({ status: "CLOSED", createdAt: days(20), closedAt: days(5) });
  assert.equal(r.daysOpen, 15);
  assert.ok(!isAged(r));
  assert.equal(daysOpenLabel(r), "15d");
});

test("an open case under a day old reads 'today'", () => {
  assert.equal(daysOpenLabel(row({ createdAt: days(0) })), "today");
});

test("CSV has the desktop's 11 columns in order", () => {
  assert.deepEqual(
    CASE_CSV_COLUMNS.map((c) => c.header),
    ["Case No", "Customer", "Source", "Customer PO", "Category", "Department", "Stage", "Days Open", "Status Days", "Orders", "Created"],
  );
  const r = row({ status: "CANCELLED", closedAt: days(1) });
  const cells = Object.fromEntries(CASE_CSV_COLUMNS.map((c) => [c.header, c.accessor(r)]));
  assert.equal(cells["Days Open"], "", "cancelled → blank");
  assert.equal(cells["Status Days"], "", "cancelled → blank");
  assert.equal(cells["Stage"], "Cancelled");
  assert.equal(cells["Orders"], "none");
});

test("categories + department read from rootCauses / details like the desktop", () => {
  assert.deepEqual(categoryCodesForCase({ rootCauses: [{ category: "DESIGN" }, { category: "DESIGN" }, { category: "BOGUS" }, { category: "MATERIAL" }], rootCauseCategory: "OTHER" }), ["DESIGN", "MATERIAL"]);
  assert.deepEqual(categoryCodesForCase({ rootCauses: [], rootCauseCategory: "OTHER" }), ["OTHER"]);
  assert.equal(deptForCase({ designDeptName: " Upholstery " }), "Upholstery");
  assert.equal(deptForCase({ departmentName: "Packing", designDeptName: "x" }), "Packing");
  assert.equal(deptForCase(null), "");
});

test("search + filters + sort", () => {
  const a = row({ id: "a", caseNo: "SC-2611-001", customerName: "Acme", createdAt: days(2), rootCauses: [{ category: "DESIGN", details: { designDeptName: "Foam" } }], rootCauseDetails: { designDeptName: "Foam" } });
  const b = row({ id: "b", caseNo: "SC-2611-002", customerName: "Beta", sourceType: "EXTERNAL", sourceNo: "", externalRef: "WhatsApp", createdAt: days(40), status: "CLOSED", closedAt: days(30) });
  const c = row({ id: "c", caseNo: "SC-2611-003", customerName: "Gamma", createdAt: days(9) });
  const all = [a, b, c];
  const m = (q, f = EMPTY_FILTERS) => all.filter((r) => matchesCase(r, q, f, NOW)).map((r) => r.id);
  assert.deepEqual(m(""), ["a", "b", "c"]);
  assert.deepEqual(m("acme"), ["a"]);
  assert.deepEqual(m("whatsapp"), ["b"]);
  assert.deepEqual(m("external"), ["b"]);
  assert.deepEqual(m("foam"), ["a"], "department is searchable");
  assert.deepEqual(m("", { ...EMPTY_FILTERS, src: ["EXTERNAL"] }), ["b"]);
  assert.deepEqual(m("", { ...EMPTY_FILTERS, cats: ["DESIGN"] }), ["a"]);
  assert.deepEqual(m("", { ...EMPTY_FILTERS, depts: ["Foam"] }), ["a"]);
  assert.deepEqual(m("", { ...EMPTY_FILTERS, created: "30" }), ["a", "c"]);
  assert.deepEqual(m("", { ...EMPTY_FILTERS, aged: true }), ["c"], "aged = active and 7+ days (b is closed)");
  assert.deepEqual(sortCases(all, "created").map((r) => r.id), ["a", "c", "b"], "newest first");
  assert.deepEqual(sortCases(all, "daysOpen").map((r) => r.id), ["b", "c", "a"].sort((x, y) => all.find((r) => r.id === y).daysOpen - all.find((r) => r.id === x).daysOpen));
  assert.deepEqual(sortCases(all, "no").map((r) => r.id), ["c", "b", "a"], "case no descending");
  assert.equal(filterCount({ ...EMPTY_FILTERS, src: ["SO"], aged: true, sort: "stage" }), 3);
});

test("'This month' filter requires the same YEAR (prototype only compared the month)", () => {
  const sameMonthLastYear = row({ createdAt: new Date(Date.UTC(2025, 10, 5)).toISOString() });
  assert.ok(!matchesCase(sameMonthLastYear, "", { ...EMPTY_FILTERS, created: "month" }, NOW));
  const thisMonth = row({ createdAt: new Date(Date.UTC(2026, 10, 5)).toISOString() });
  assert.ok(matchesCase(thisMonth, "", { ...EMPTY_FILTERS, created: "month" }, NOW));
});

test("status transitions mirror the server: Closed is terminal, Cancel can be undone", () => {
  assert.deepEqual(ALLOWED_TRANSITIONS.CLOSED, []);
  assert.deepEqual(ALLOWED_TRANSITIONS.OPEN, ["IN_PROGRESS", "CLOSED", "CANCELLED"]);
  assert.deepEqual(ALLOWED_TRANSITIONS.IN_PROGRESS, ["CLOSED", "CANCELLED"]);
  assert.deepEqual(ALLOWED_TRANSITIONS.CANCELLED, ["OPEN", "IN_PROGRESS"]);
});

test("New SV service order opens the mobile SV form and never navigates to the desktop route", () => {
  const src = readFileSync(resolve(process.cwd(), "src/pages/m/screens/cases/CaseDetailScreen.tsx"), "utf8");
  assert.doesNotMatch(src, /\/service-order\/create/, "no navigation to the desktop SV create route");
  assert.match(src, /New SV service order/, "the action stays visible");
  assert.doesNotMatch(src, /isn’t available on phone or tablet yet/, "the stale unavailable sheet is gone");
  assert.match(src, /SV_NEW_PATH\}\?fromCase=/, "hands the case off to the mobile SV form");
  assert.match(src, /perms\.createSalesOrder/, "the sales-orders:create gate is kept");
  const hooks = readFileSync(resolve(process.cwd(), "src/pages/m/screens/cases/case-hooks.tsx"), "utf8");
  assert.match(hooks, /createSalesOrder: hasPermission\("sales-orders", "create"\)/);
  assert.doesNotMatch(src, /setPreferDesktop/, "desktop mode is never forced");
});
