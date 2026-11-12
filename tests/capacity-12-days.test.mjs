// Owner 2026-11-12: capacity averages over the last 12 working days (two weeks,
// Mon–Sat) everywhere, and a department's Sofa / Bedframe backlog is divided by
// that department's own Sofa / Bedframe output ("应该除以部门 sofa 的产能").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const read = (p) => readFileSync(p, "utf8");
const lib = await import(pathToFileURL(resolve(process.cwd(), "src/pages/dashboards/dashboard-widgets-lib.ts")).href);

test("every capacity window is 12 working days", () => {
  assert.match(read("src/api/routes/dashboard-overview.ts"), /const CAPACITY_WORKING_DAYS = 12;/);
  assert.match(read("src/api/lib/agent-learning.ts"), /export const ROLLING_WORKING_DAYS = 12;/);
  assert.match(read("src/api/lib/planning-adaptive-capacity.ts"), /export const CAPACITY_WINDOW_DAYS = 12;/);
});

test("server: per-category capacity and days; dept days = the slower category", () => {
  const s = read("src/api/routes/dashboard-overview.ts");
  assert.match(s, /const sofaCapMin = Math\.round\(windowSofa \/ CAPACITY_WORKING_DAYS\);/);
  assert.match(s, /const sofaDays = catDays\(sofaMin, sofaCapMin\);/);
  assert.match(s, /Math\.max\(sofaDays, bedframeDays\)/);
});

test("categoryDays: one category on its own capacity; both = max; stalled = null", () => {
  const d = { dept: "Upholstery", sofaMin: 600, bedframeMin: 300, totalMin: 900, dailyCapMin: 100, sofaCapMin: 60, bedframeCapMin: 40, sofaDays: 10, bedframeDays: 7.5, backlogDays: 10 };
  assert.equal(lib.categoryDays(d, true, false).showDays, 10);
  assert.equal(lib.categoryDays(d, false, true).showDays, 7.5);
  const both = lib.categoryDays(d, true, true);
  assert.equal(both.showDays, 10);
  assert.equal(Math.round((both.sofaDays + both.bedDays) * 10) / 10, 10, "bar segments add up to the shown days");
  assert.equal(lib.categoryDays({ ...d, bedframeDays: null }, true, true).showDays, null);
  assert.equal(lib.categoryDays({ dept: "x", sofaMin: 1, bedframeMin: 0, totalMin: 1, dailyCapMin: 1, backlogDays: 1 }, true, true), null, "older feed falls back");
});
