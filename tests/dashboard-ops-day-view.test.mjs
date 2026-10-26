// dashboard-ops-day-view.test.mjs — Operations Day view (2026-10-19): Department
// Revenue reads the picked day's bucket, only for per-day data; Operations keeps
// a picked day while Sales / Service / Finance drop it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayBucketIndex } from "../src/pages/dashboard-b/revenue-split.ts";

const split = (granularity, buckets) => ({ granularity, revenue: buckets.map((bucket) => ({ bucket })) });

test("dayBucketIndex finds the picked day only in per-day data", () => {
  const month = split("day", ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.equal(dayBucketIndex(month, "2026-10-02"), 1);
  assert.equal(dayBucketIndex(month, "2026-10-09"), -1);
  assert.equal(dayBucketIndex(month, undefined), -1);
  assert.equal(dayBucketIndex(split("week", ["2026-10-02"]), "2026-10-02"), -1);
  assert.equal(dayBucketIndex(null, "2026-10-02"), -1);
});

test("Operations keeps a picked day; other tabs outside Employees drop it", () => {
  const src = readFileSync("src/pages/dashboards/dashboard-prototype.tsx", "utf8");
  assert.match(src, /const dayTab = tab === "people" \|\| tab === "operations";/);
  assert.match(src, /return p\.day && !dayTab \? \{ \.\.\.p, day: undefined \} : p;/);
  const ops = readFileSync("src/pages/dashboards/OperationsView.tsx", "utf8");
  assert.match(ops, /sections=\{\["dailyReport", "deptRevenue"\]\} onPeriodChange=\{onPeriodChange\}/);
});

test("the phone dashboard gives Operations the same Day view as the desktop", () => {
  for (const file of ["src/pages/m/screens/dashboard/DashboardScreen.tsx", "src/pages/m/screens/Home.tsx"]) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /const dayTab = tab === "people";/, file);
    const rules = src.match(/const dayTab = tab === "people" \|\| tab === "operations";/g) ?? [];
    const keeps = src.match(/rawPeriod\.day && !dayTab \? \{ \.\.\.rawPeriod, day: undefined \} : rawPeriod;/g) ?? [];
    assert.ok(rules.length > 0, file);
    assert.equal(keeps.length, rules.length, file);
    assert.match(src, /allowDay=\{dayTab\}/, file);
  }
});
