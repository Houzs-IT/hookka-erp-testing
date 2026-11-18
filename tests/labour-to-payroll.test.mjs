// Owner 2026-11-06: 「全部 costing 都是 generate from payroll」. The dashboard's
// per-day labour must add up to payroll, not to logged hours.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keepDaysWithin, scaleLabourToPayroll, sumLabourMonths, wholeMonthsAround } from "../src/lib/labour-to-payroll.ts";

const split = { directSen: 900, nonProductionSen: 100, outsourceSen: 50, warehousingSen: 60, shortfallSen: 0, overheadSen: 40, underRecordedSen: 0 };
const month = (workers, totalSen = 0) => ({ ym: "2026-10", finished: true, totalSen, asOf: "", split, payroll: { slips: 2, approved: 2, draft: 0 }, byDept: [], workers });
const w = (id, costSen) => ({ id, costSen, directSen: costSen, nonProductionSen: 0 });

test("a worker's days add up to their payroll cost, in the shape of their hours", () => {
  const days = new Map([["a|2026-10-01", 100], ["a|2026-10-02", 300]]);
  const depts = new Map([["a|2026-10-01|FAB_SEW", 100], ["a|2026-10-02|FAB_SEW", 200], ["a|2026-10-02|REPAIR", 100]]);
  const r = scaleLabourToPayroll(days, depts, [month([w("a", 800)])], () => "FAB_SEW");
  assert.equal(r.byWorkerDay.get("a|2026-10-01"), 200);
  assert.equal(r.byWorkerDay.get("a|2026-10-02"), 600);
  assert.equal([...r.byWorkerDayDept.values()].reduce((a, v) => a + v, 0), 800);
});

test("paid with no hours (outsource piece wages) spreads over the month under the home department", () => {
  const days = new Map([["a|2026-10-01", 100], ["a|2026-10-02", 100]]);
  const r = scaleLabourToPayroll(days, new Map(), [month([w("a", 200), w("osc", 1000)])], () => "FAB_SEW");
  assert.equal(r.byWorkerDay.get("osc|2026-10-01"), 500);
  assert.equal(r.byWorkerDayDept.get("osc|2026-10-02|FAB_SEW"), 500);
  assert.equal([...r.byWorkerDay.values()].reduce((a, v) => a + v, 0), 1200);
});

test("hours with no payslip in a finished month cost nothing; a month with no figures stays as logged", () => {
  const days = new Map([["ghost|2026-10-01", 100], ["a|2026-09-30", 70]]);
  const r = scaleLabourToPayroll(days, new Map(), [month([w("a", 500)])], () => null);
  assert.equal(r.byWorkerDay.get("ghost|2026-10-01"), 0);
  assert.equal(r.byWorkerDay.get("a|2026-09-30"), 70);
});

test("months add up", () => {
  const t = sumLabourMonths([month([], 1000), month([], 1000)]);
  assert.deepEqual([t.totalSen, t.directSen, t.nonProductionSen, t.outsourceSen], [2000, 1800, 200, 100]);
});

test("a short range keeps its share of the month, not the whole month (BUG-2026-11-11-503)", () => {
  const days = new Map(Array.from({ length: 30 }, (_, i) => [`a|2026-10-${String(i + 1).padStart(2, "0")}`, 100]));
  const { from, to } = wholeMonthsAround("2026-10-28", "2026-11-03");
  assert.deepEqual([from, to], ["2026-10-01", "2026-11-30"]);
  const scaled = scaleLabourToPayroll(days, new Map(), [month([w("a", 6000)])], () => "FAB_SEW");
  const kept = keepDaysWithin(scaled.byWorkerDay, "2026-10-28", "2026-11-03");
  assert.deepEqual([...kept.keys()], ["a|2026-10-28", "a|2026-10-29", "a|2026-10-30"]);
  assert.equal([...kept.values()].reduce((a, v) => a + v, 0), 600);
});

test("keepDaysWithin reads the date from worker-day and worker-day-department keys", () => {
  const kept = keepDaysWithin(new Map([["a|2026-10-27|UPH", 5], ["a|2026-10-28|UPH", 7]]), "2026-10-28", "2026-10-31");
  assert.deepEqual([...kept.entries()], [["a|2026-10-28|UPH", 7]]);
});

test("the dashboard hook reads whole months of hours before it scales", () => {
  const source = readFileSync("src/pages/dashboards/use-labour-cost.ts", "utf8");
  assert.match(source, /wholeMonthsAround\(from, to\)/);
  assert.match(source, /working-hour-entries\?from=\$\{hoursRange\.from\}&to=\$\{hoursRange\.to\}/);
  assert.match(source, /keepDaysWithin\(scaled\.byWorkerDay, from, to\)/);
});

test("the card's months cut to the days shown: one day of October costs that day, not the month", async () => {
  const { labourMonthsWithin } = await import("../src/lib/labour-to-payroll.ts");
  const october = { ...month([w("a", 800), w("b", 200)], 1000), byDept: [{ departmentCode: "FAB_SEW", workers: 2, costSen: 1000, outsourceSen: 0 }], split: { ...split, nonProductionLines: [{ departmentCode: "REPAIR", sen: 100 }] } };
  const oneDay = new Map([["a|2026-10-31", 40], ["b|2026-10-31", 10]]);
  const [cut] = labourMonthsWithin([october], oneDay);
  assert.equal(cut.totalSen, 50);
  assert.deepEqual(cut.workers.map((x) => x.costSen), [40, 10]);
  assert.equal(cut.split.directSen, 45);
  assert.equal(cut.split.nonProductionLines[0].sen, 5);
  assert.equal(cut.byDept[0].costSen, 50);
  assert.equal(sumLabourMonths([cut]).totalSen, 50);
});

test("a whole month comes back unchanged", async () => {
  const { labourMonthsWithin } = await import("../src/lib/labour-to-payroll.ts");
  const october = month([w("a", 800), w("b", 200)], 1000);
  const wholeMonth = new Map([["a|2026-10-01", 300], ["a|2026-10-02", 500], ["b|2026-10-01", 200]]);
  const [cut] = labourMonthsWithin([october], wholeMonth);
  assert.equal(cut.totalSen, 1000);
  assert.equal(cut.split.directSen, 900);
});

test("Day view: the card's months are cut to the picked day even though the hook loaded the whole month", async () => {
  const { labourMonthsWithin } = await import("../src/lib/labour-to-payroll.ts");
  const october = month([w("a", 800), w("b", 200)], 1000);
  const wholeMonthLoaded = new Map([["a|2026-10-30", 400], ["a|2026-10-31", 400], ["b|2026-10-30", 150], ["b|2026-10-31", 50]]);
  const [cut] = labourMonthsWithin([october], keepDaysWithin(wholeMonthLoaded, "2026-10-31", "2026-10-31"));
  assert.equal(cut.totalSen, 450);
  assert.deepEqual(cut.workers.map((x) => x.costSen), [400, 50]);
});

test("the dashboard's Labour cost card follows the picked day, not the month around it (BUG-2026-11-18-533)", () => {
  const source = readFileSync("src/pages/dashboards/EmployeesDashboard.tsx", "utf8");
  assert.match(source, /labourMonthsWithin\(labourMonths, keepDaysWithin\(costByWorkerDay, focus\.from, focus\.to\)\)/);
  assert.match(source, /periodTotals = useMemo\(\(\) => sumWindow\(\(d\) => inFocus\(period, d\), costByWorkerDay\)/);
});
