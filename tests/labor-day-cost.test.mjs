// labor-day-cost.test.mjs — one worker-day priced by the Labor Cost rule
// (src/lib/labor-day-cost.ts), shared by Employees › Labor Cost and the merged
// dashboard's Employees tab (owner 2026-10-17: 「看我们的 labor cost 计算方式」).
import test from "node:test";
import assert from "node:assert/strict";
import { workerDayEntryCostsSen, dayTypedOt } from "../src/lib/labor-day-cost.ts";

const w = { basicSalarySen: 260000, workingHoursPerDay: 9, workingDaysPerMonth: 26, otMultiplier: 1.5 };
const base = { worker: w, effSalarySen: 260000, actualWorkingDays: 26, holidays: [], payRuleVersions: [] };

test("a standard 9h weekday costs salary ÷ working days", () => {
  const [c] = workerDayEntryCostsSen({ ...base, date: "2026-10-15", entryHours: [9] });
  assert.equal(Math.round(c), 10000); // RM 2,600 ÷ 26 days
});

test("weekday OT above the standard day is split pro rata across entries", () => {
  const costs = workerDayEntryCostsSen({ ...base, date: "2026-10-15", entryHours: [5, 6] });
  const hourly = 260000 / 26 / 9;
  const total = 9 * hourly + 2 * hourly * 1.5;
  assert.equal(Math.round(costs[0] + costs[1]), Math.round(total));
  assert.equal(Math.round(costs[0] * 11), Math.round(total * 5)); // 5/11 of the day
});

test("a Sunday prices every hour as OT at the Sunday multiplier", () => {
  assert.equal(dayTypedOt("2026-10-11", [], 8, 9, 1.5, []).otHours, 8);
  const [c] = workerDayEntryCostsSen({ ...base, date: "2026-10-11", entryHours: [8] });
  const ot = dayTypedOt("2026-10-11", [], 8, 9, 1.5, []);
  assert.equal(Math.round(c), Math.round(8 * (260000 / 26 / 9) * ot.mult));
});

test("a monthly worker with no salary costs nothing; a per-day worker costs the day rate", () => {
  assert.deepEqual(workerDayEntryCostsSen({ ...base, worker: { ...w, basicSalarySen: 0 }, date: "2026-10-15", entryHours: [9] }), [0]);
  const daily = { ...w, basicSalarySen: 0, payMode: "DAILY", dailyRateSen: 8500 };
  const costs = workerDayEntryCostsSen({ ...base, worker: daily, date: "2026-10-15", entryHours: [4, 4] });
  assert.equal(Math.round(costs[0] + costs[1]), 8500);
});
