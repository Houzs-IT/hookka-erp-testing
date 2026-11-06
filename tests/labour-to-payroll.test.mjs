// Owner 2026-11-06: 「全部 costing 都是 generate from payroll」. The dashboard's
// per-day labour must add up to payroll, not to logged hours.
import test from "node:test";
import assert from "node:assert/strict";
import { scaleLabourToPayroll, sumLabourMonths } from "../src/lib/labour-to-payroll.ts";

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
