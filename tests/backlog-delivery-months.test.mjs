// ---------------------------------------------------------------------------
// backlog-delivery-months.test.mjs — owner 2026-11-22: split Department
// Backlog / Plant Load / Total Backlog / Active Jobs by the customer delivery
// month, toggled from the legend like Sofa / Bedframe ("12 月份的 sofa").
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deliveryBucket, bucketLabel, sortBuckets } from "../src/lib/delivery-bucket.ts";
import {
  backlogMonthKeys,
  deptMonthSegments,
  filterDeptByMonths,
  filterJobs,
  shownBacklogMin,
} from "../src/pages/dashboards/backlog-months.ts";

test("deliveryBucket: before today = overdue, else the month; blank = none", () => {
  const today = "2026-11-22";
  assert.equal(deliveryBucket("2026-11-21", today), "overdue");
  assert.equal(deliveryBucket("2026-11-22", today), "2026-11");
  assert.equal(deliveryBucket("2026-12-05T00:00:00Z", today), "2026-12");
  assert.equal(deliveryBucket("", today), "none");
  assert.equal(deliveryBucket(null, today), "none");
  assert.equal(deliveryBucket("garbage", today), "none");
});

test("bucket labels and display order", () => {
  assert.equal(bucketLabel("overdue"), "Overdue");
  assert.equal(bucketLabel("2027-01"), "Jan 2027");
  assert.equal(bucketLabel("none"), "No delivery date");
  assert.deepEqual(sortBuckets(["2027-01", "none", "2026-12", "overdue", "2026-12"]), ["overdue", "2026-12", "2027-01", "none"]);
});

const dept = {
  dept: "Foam Bonding",
  sofaMin: 600,
  bedframeMin: 400,
  totalMin: 1000,
  dailyCapMin: 100,
  sofaCapMin: 60,
  bedframeCapMin: 40,
  sofaDays: 10,
  bedframeDays: 10,
  backlogDays: 10,
  byMonth: [
    { month: "overdue", sofaMin: 60, bedframeMin: 40 },
    { month: "2026-11", sofaMin: 240, bedframeMin: 160 },
    { month: "2026-12", sofaMin: 300, bedframeMin: 200 },
  ],
};

test("filterDeptByMonths: nothing hidden = unchanged; a hidden month leaves its minutes out and re-derives days", () => {
  assert.equal(filterDeptByMonths(dept, new Set()), dept);
  const onlyDec = filterDeptByMonths(dept, new Set(["overdue", "2026-11"]));
  assert.equal(onlyDec.sofaMin, 300);
  assert.equal(onlyDec.bedframeMin, 200);
  assert.equal(onlyDec.totalMin, 500);
  assert.equal(onlyDec.backlogDays, 5); // 500 ÷ 100
  assert.equal(onlyDec.sofaDays, 5); // 300 ÷ 60 — "December sofa"
  assert.equal(onlyDec.bedframeDays, 5);
});

test("filterDeptByMonths: no capacity = stalled (null), nothing queued = 0, old feed untouched", () => {
  const stalled = filterDeptByMonths({ ...dept, dailyCapMin: 0, sofaCapMin: 0 }, new Set(["2026-12"]));
  assert.equal(stalled.backlogDays, null);
  assert.equal(stalled.sofaDays, null);
  const none = filterDeptByMonths(dept, new Set(["overdue", "2026-11", "2026-12"]));
  assert.equal(none.sofaDays, 0);
  const old = { ...dept, byMonth: undefined };
  assert.equal(filterDeptByMonths(old, new Set(["2026-12"])), old);
});

test("deptMonthSegments: per visible month on the capacity the row uses", () => {
  const both = deptMonthSegments(dept, new Set(), true, true);
  assert.deepEqual(both.map((s) => [s.month, s.days]), [["overdue", 1], ["2026-11", 4], ["2026-12", 5]]);
  const sofaDec = deptMonthSegments(dept, new Set(["overdue", "2026-11"]), true, false);
  assert.deepEqual(sofaDec.map((s) => [s.month, s.days]), [["2026-12", 5]]); // 300 ÷ 60
  assert.deepEqual(deptMonthSegments({ ...dept, byMonth: undefined }, new Set(), true, true), []);
});

test("shownBacklogMin follows both the month and the category toggles", () => {
  assert.equal(shownBacklogMin([dept], new Set(), true, true), 1000);
  assert.equal(shownBacklogMin([dept], new Set(["overdue", "2026-11"]), true, false), 300);
});

test("filterJobs: one row per customer, months and categories applied", () => {
  const rows = [
    { customer: "A", month: "2026-11", bedframeUnits: 5, sofaSets: 0 },
    { customer: "A", month: "2026-12", bedframeUnits: 3, sofaSets: 2 },
    { customer: "B", month: "2026-12", bedframeUnits: 0, sofaSets: 4 },
  ];
  const all = filterJobs(rows, new Set(), true, true);
  assert.deepEqual([all.bedframeUnits, all.sofaSets], [8, 6]);
  assert.deepEqual(all.byCustomer.map((c) => c.customer), ["A", "B"]);
  const decSofa = filterJobs(rows, new Set(["2026-11"]), true, false);
  assert.deepEqual([decSofa.bedframeUnits, decSofa.sofaSets], [0, 6]);
  assert.deepEqual(decSofa.byCustomer, [{ customer: "B", bedframeUnits: 0, sofaSets: 4 }, { customer: "A", bedframeUnits: 0, sofaSets: 2 }]);
});

test("backlogMonthKeys merges departments and jobs", () => {
  assert.deepEqual(backlogMonthKeys([dept], [{ customer: "A", month: "none", bedframeUnits: 1, sofaSets: 0 }]), ["overdue", "2026-11", "2026-12", "none"]);
});

test("API: the backlog and Active Jobs queries read the customer delivery date (SO, else CO)", () => {
  const src = readFileSync(resolve(process.cwd(), "src/api/routes/dashboard-overview.ts"), "utf8");
  assert.ok((src.match(/COALESCE\(so\.customerDeliveryDate::text, co\.customerDeliveryDate::text/g) ?? []).length >= 2);
  assert.match(src, /LEFT JOIN consignment_orders co ON co\.id = po\.consignmentOrderId\s+WHERE jc\.orgId = \?/);
  assert.match(src, /GROUP BY po\.itemCategory, po\.customerName, 3/);
  assert.match(src, /byMonth: sortBuckets\(monthMin\.keys\(\)\)/);
  assert.match(src, /activeJobsByMonth: activeJobsByMonth as/);
});

test("overview cache: version bumped for the month split, and the all-time snapshot is reused only at the same version", () => {
  const src = readFileSync(resolve(process.cwd(), "src/api/routes/dashboard-overview.ts"), "utf8");
  assert.match(src, /const overviewV = "v3[1-9]"/);
  assert.match(src, /payloadVersion\?: string \} \| null\)\?\.payloadVersion === overviewV/);
  assert.match(src, /payloadVersion: overviewV,/);
});

test("toggles are one page-wide store, so separately mounted Backlog and Plant Load agree", async () => {
  const store = await import("../src/pages/dashboards/backlog-toggle-store.ts");
  const before = store.getBacklogToggles();
  store.toggleBacklogMonth("overdue");
  store.toggleBacklogCategory("Bedframe");
  const after = store.getBacklogToggles();
  assert.notEqual(after, before, "a new snapshot object so React re-renders");
  assert.ok(after.hiddenMonth.has("overdue"));
  assert.ok(after.hiddenCat.has("Bedframe"));
  store.toggleBacklogMonth("overdue");
  assert.equal(store.getBacklogToggles().hiddenMonth.has("overdue"), false);
  const page = readFileSync(resolve(process.cwd(), "src/pages/dashboard-b/index.tsx"), "utf8");
  assert.match(page, /const \{ hiddenCat: hiddenDept, hiddenMonth \} = useBacklogToggles\(\);/);
  assert.doesNotMatch(page, /useState<Set<string>>\(new Set\(\)\);\s*const toggleDept/);
});
