// labor-day-cost.test.mjs — one worker-day priced by the Labor Cost rule
// (src/lib/labor-day-cost.ts), shared by Employees › Labor Cost and the merged
// dashboard's Employees tab (owner 2026-10-17: 「看我们的 labor cost 计算方式」).
import test from "node:test";
import assert from "node:assert/strict";
import { workerDayEntryCostsSen, dayTypedOt, costByWorkerDaySen } from "../src/lib/labor-day-cost.ts";

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

test("costByWorkerDaySen groups entries per worker-day and uses that month's effective salary", () => {
  const workers = [{ id: "A", ...w }];
  const entries = [
    { workerId: "A", date: "2026-10-15", hours: 4 },
    { workerId: "A", date: "2026-10-15", hours: "5" },
    { workerId: "A", date: "2026-09-15", hours: 9 },
    { workerId: "GONE", date: "2026-10-15", hours: 9 },
  ];
  const m = costByWorkerDaySen({ workers, entries, effSalaryByMonth: { "2026-09": { A: 520000 } }, holidays: [], payRuleVersions: [] });
  assert.equal(m.size, 2); // an unknown worker is skipped
  // October: falls back to basic salary; 9h on a 9h day = one day's pay.
  const octDays = 27; // Mon–Sat in Oct 2026
  assert.equal(m.get("A|2026-10-15"), Math.round(260000 / octDays));
  // September: the effective salary for that month (double) is used.
  assert.ok(m.get("A|2026-09-15") > m.get("A|2026-10-15") * 1.8);
});

test("hours logged after the resignation date cost nothing (unpaid by design)", () => {
  const leaver = { ...w, resignedAt: "2026-09-30" };
  assert.deepEqual(workerDayEntryCostsSen({ ...base, worker: leaver, date: "2026-10-03", entryHours: [9] }), [0]);
  const [c] = workerDayEntryCostsSen({ ...base, worker: leaver, date: "2026-09-30", entryHours: [9] });
  assert.equal(Math.round(c), 10000); // the last day itself is still paid
});
