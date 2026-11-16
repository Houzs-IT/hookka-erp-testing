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

test("server: per-category capacity and days; both together stay total / total", () => {
  const s = read("src/api/routes/dashboard-overview.ts");
  assert.match(s, /const sofaCapMin = Math\.round\(windowSofa \/ CAPACITY_WORKING_DAYS\);/);
  assert.match(s, /const sofaDays = catDays\(sofaMin, sofaCapMin\);/);
  assert.doesNotMatch(s, /Math\.max\(sofaDays, bedframeDays\)/);
  assert.match(s, /dailyCapMin > 0 \? Math\.round\(\(totalMin \/ dailyCapMin\) \* 10\) \/ 10 : null;/);
});

test("categoryDays: one category on its own capacity; both shown = fall back to total / total", () => {
  const d = { dept: "Upholstery", sofaMin: 600, bedframeMin: 300, totalMin: 900, dailyCapMin: 100, sofaCapMin: 60, bedframeCapMin: 40, sofaDays: 10, bedframeDays: 7.5, backlogDays: 9 };
  assert.deepEqual(lib.categoryDays(d, true, false), { showDays: 10, sofaDays: 10, bedDays: 0 });
  assert.deepEqual(lib.categoryDays(d, false, true), { showDays: 7.5, sofaDays: 0, bedDays: 7.5 });
  assert.equal(lib.categoryDays(d, true, true), null);
  assert.equal(lib.categoryDays({ ...d, sofaDays: null }, true, false).showDays, null, "stalled sofa");
  assert.equal(lib.categoryDays({ dept: "x", sofaMin: 1, bedframeMin: 0, totalMin: 1, dailyCapMin: 1, backlogDays: 1 }, true, false), null, "older feed falls back");
  // Both shown: the existing row logic uses backlogDays (900 / 100 = 9).
  const [row] = lib.deptBacklogRows([d], true, true).rows ?? lib.deptBacklogRows([d], true, true);
  assert.equal(row.showDays, 9);
});
