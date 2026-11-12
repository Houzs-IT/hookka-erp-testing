// Floor Live › each department's completed count (owner 2026-11-12).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { shapeDeptCompleted, usualDays } from "../src/api/lib/dept-completed.ts";
import { behindPace, deptCompletedDays, deptCompletedFor, paceDue } from "../src/pages/dashboards/floor-live-lib.ts";

const read = (p) => readFileSync(p, "utf8");

test("usual = average per plant working day over the last 12 working days; a quiet day counts 0", () => {
  const days = [];
  // 13 plant days in Nov (Sundays 1 / 8 have nothing); UPHOLSTERY works all, FIBRE only two.
  const dates = ["2026-10-31", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"];
  for (const d of dates) days.push({ dept: "UPHOLSTERY", date: d, bedframeUnits: d === "2026-10-31" ? 100 : 24, sofaSets: 6 });
  days.push({ dept: "FIBRE", date: "2026-11-03", bedframeUnits: 0, sofaSets: 41 });
  days.push({ dept: "FIBRE", date: "2026-11-05", bedframeUnits: 0, sofaSets: 7 });
  days.push({ dept: "PACKING", date: "2026-10-30", bedframeUnits: 20, sofaSets: 0 });
  days.push({ dept: "PACKING", date: "2026-10-29", bedframeUnits: 20, sofaSets: 0 });
  const u = usualDays(days, "2026-11-12");
  // window = the 12 plant days before 11-12: 10-29, 10-30, 10-31, 11-02 … 11-11 (today left out)
  assert.deepEqual(u.get("UPHOLSTERY"), { bed: 26.3, sofa: 5 });
  assert.deepEqual(u.get("FIBRE"), { bed: 0, sofa: 4 });
  assert.deepEqual(u.get("PACKING"), { bed: 3.3, sofa: 0 });
});

test("the period count sits next to the 12-day average; a department with only history still shows", () => {
  const range = new Map([["UPHOLSTERY", { bedframeUnits: 28, sofaSets: 4 }]]);
  const rows = shapeDeptCompleted(range, [
    { dept: "UPHOLSTERY", date: "2026-11-10", bedframeUnits: 23, sofaSets: 9 },
    { dept: "FOAM_CUTTING", date: "2026-11-03", bedframeUnits: 0, sofaSets: 23 },
  ], "2026-11-12");
  const by = Object.fromEntries(rows.map((r) => [r.dept, r]));
  assert.equal(by.UPHOLSTERY.bedframeUnits, 28);
  assert.equal(by.UPHOLSTERY.usualBedframe, 11.5);
  assert.deepEqual([by.FOAM_CUTTING.sofaSets, by.FOAM_CUTTING.usualSofa], [0, 11.5]);
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

test("pace: the 12-day average spread over 08:00–17:00; behind it = red", () => {
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
    departments: [{ dept: "UPHOLSTERY", bedframeUnits: 28, sofaSets: 4, usualBedframe: 24, usualSofa: 9 }],
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
  assert.match(v, /<DeptCompletedStrip code=\{d\.code\} name=\{d\.name\} data=\{completed\.data\} showUsual live=\{!pastDay\}/);
  assert.match(v, /floor-live\/completed\?from=\$\{day\}&to=\$\{day\}/);
  assert.doesNotMatch(v, /"Completed today"/);
});
