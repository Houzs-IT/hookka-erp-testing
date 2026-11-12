// Floor Live › each department's completed count (owner 2026-11-12).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { bestDays, shapeDeptCompleted } from "../src/api/lib/dept-completed.ts";
import { behindPace, deptCompletedDays, deptCompletedFor, paceDue } from "../src/pages/dashboards/floor-live-lib.ts";

const read = (p) => readFileSync(p, "utf8");

test("best day per department: the highest day, earliest on a tie", () => {
  const best = bestDays([
    { dept: "UPHOLSTERY", date: "2026-11-11", bedframeUnits: 25, sofaSets: 9 },
    { dept: "UPHOLSTERY", date: "2026-11-04", bedframeUnits: 16, sofaSets: 9 },
    { dept: "UPHOLSTERY", date: "2026-11-12", bedframeUnits: 28, sofaSets: 4 },
    { dept: "FIBRE", date: "2026-11-03", bedframeUnits: 0, sofaSets: 41 },
  ], "2026-11-12");
  assert.deepEqual(best.get("UPHOLSTERY"), { bed: { n: 28, date: "2026-11-12" }, sofa: { n: 9, date: "2026-11-04" } });
  assert.deepEqual(best.get("FIBRE").bed, { n: 0, date: null });
});

test("the period count sits next to the best day; a department with only history still shows", () => {
  const range = new Map([["UPHOLSTERY", { bedframeUnits: 28, sofaSets: 4 }]]);
  const rows = shapeDeptCompleted(range, [
    { dept: "UPHOLSTERY", date: "2026-11-10", bedframeUnits: 23, sofaSets: 9 },
    { dept: "FOAM_CUTTING", date: "2026-11-03", bedframeUnits: 0, sofaSets: 23 },
  ], "2026-11-12");
  const by = Object.fromEntries(rows.map((r) => [r.dept, r]));
  assert.equal(by.UPHOLSTERY.bedframeUnits, 28);
  assert.equal(by.UPHOLSTERY.bestBedframe.n, 23);
  assert.deepEqual([by.FOAM_CUTTING.sofaSets, by.FOAM_CUTTING.bestSofa.n], [0, 23]);
});

test("best day: last 30 days only, a day above 3x the usual (median) left out", () => {
  const d = (date, bed) => ({ dept: "PACKING", date, bedframeUnits: bed, sofaSets: 0 });
  const best = bestDays([
    d("2026-05-05", 256), // bulk back-entry, long ago
    d("2026-10-13", 40), // 31 days before 11-12: outside the window
    d("2026-11-02", 16), d("2026-11-03", 22), d("2026-11-04", 20), d("2026-11-05", 15),
    d("2026-11-06", 14), d("2026-11-07", 90), // 90 > 3 x median 18 → left out
    d("2026-11-11", 30),
  ], "2026-11-12");
  assert.deepEqual(best.get("PACKING").bed, { n: 30, date: "2026-11-11" });
});

test("SQL: per-department last card, outsourced work dropped, cancelled orders kept, units vs sets", () => {
  const s = read("src/api/lib/dept-completed.ts");
  assert.match(s, /GROUP BY jc\.productionOrderId, jc\.departmentCode/);
  assert.match(s, /COALESCE\(w\.isOutsource, FALSE\) = TRUE THEN 1 ELSE 0 END\) = 0/, "outsourced (PO, dept) drops");
  assert.doesNotMatch(s, /po\.status/, "a cancelled order's finished work stays counted");
  assert.match(s, /SUM\(CASE WHEN po\.itemCategory = 'BEDFRAME' THEN po\.quantity ELSE 0 END\)/);
  assert.match(s, /const ORDER_KEY = `COALESCE\(po\.salesOrderId, po\.consignmentOrderId, po\.id\)`/);
  assert.match(s, /COUNT\(DISTINCT CASE WHEN po\.itemCategory = 'SOFA' THEN \$\{ORDER_KEY\} END\)/);
  assert.doesNotMatch(s, /\b(INSERT|UPDATE|DELETE|ALTER)\b/);
  const r = read("src/api/routes/floor-live.ts");
  assert.match(r, /app\.get\("\/completed"/);
  assert.match(r, /requireReadOrDashboardTab\(c, "production-orders", "operations"\)/);
});

test("pace: best day spread over 08:00–17:00; behind it = red", () => {
  assert.equal(paceDue(20, 7 * 60), 0, "before 08:00 nothing is due");
  assert.equal(paceDue(18, 13 * 60), 10, "5 of 9 hours gone: 18 × 5/9 = 10");
  assert.equal(paceDue(20, 18 * 60), 20, "after 17:00 the whole best day is due");
  assert.equal(behindPace(9, 18, 13 * 60), true, "9 at 13:00 against 10 due");
  assert.equal(behindPace(10, 18, 13 * 60), false);
  assert.equal(behindPace(0, 0, 13 * 60), false, "no best day yet: never red");
});

test("drill: the department's month, newest first, average over finished days with completions", () => {
  const data = {
    success: true, from: "2026-11-12", to: "2026-11-12",
    departments: [{ dept: "UPHOLSTERY", bedframeUnits: 28, sofaSets: 4, bestBedframe: { n: 28, date: "2026-11-12" }, bestSofa: { n: 9, date: "2026-11-04" } }],
    days: [
      { dept: "UPHOLSTERY", date: "2026-11-10", bedframeUnits: 22, sofaSets: 9 },
      { dept: "UPHOLSTERY", date: "2026-11-12", bedframeUnits: 28, sofaSets: 4 },
      { dept: "UPHOLSTERY", date: "2026-11-11", bedframeUnits: 26, sofaSets: 9 },
      { dept: "PACKING", date: "2026-11-11", bedframeUnits: 30, sofaSets: 6 },
    ],
  };
  const r = deptCompletedDays(data, "UPHOLSTERY", "2026-11-12");
  assert.deepEqual(r.days.map((d) => d.date), ["2026-11-12", "2026-11-11", "2026-11-10"]);
  assert.deepEqual([r.bedTotal, r.sofaTotal, r.bedAvg, r.sofaAvg], [76, 22, 24, 9]);
  assert.equal(deptCompletedFor(data, "FIBRE"), null);
  assert.equal(deptCompletedFor({ success: false }, "UPHOLSTERY"), null);
});

test("wiring: each production card carries the strip; no heading on the dashboard", () => {
  const v = read("src/pages/dashboards/FloorLiveView.tsx");
  assert.match(v, /<DeptCompletedStrip code=\{d\.code\} name=\{d\.name\} data=\{completed\.data\} showBest live=\{!pastDay\}/);
  assert.match(v, /floor-live\/completed\?from=\$\{day\}&to=\$\{day\}/);
  assert.doesNotMatch(v, /"Completed today"/);
});
