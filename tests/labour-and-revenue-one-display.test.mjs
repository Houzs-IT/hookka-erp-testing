// Owner 2026-11-20: 「要跟dashboard的才对」 / 「revenue rounding 的方式也应该一样 全套系统都是」.
// (1) Employees › Labor Cost prints the dashboard's payroll-basis labour per
//     department (use-labour-cost → labour-to-payroll), not the logged-hours value.
// (2) Revenue shows to the sen everywhere — no whole-ringgit rounding, which
//     printed 27,642 on one screen and 27,641 on another.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");

test("Employees Labor Cost uses the dashboard's payroll-basis labour", () => {
  const s = read("src/pages/employees.tsx");
  assert.match(s, /import \{ useLabourCost \} from "@\/pages\/dashboards\/use-labour-cost"/);
  assert.match(s, /const paidLabour = useLabourCost\(from, to, hasPerm\("payroll", "read"\)\)/);
  assert.match(s, /<p className="text-xs text-\[#6B7280\]">Production Labor Cost<\/p>/);
  assert.match(s, /\{formatCurrency\(r\.paidSen\)\}/);
  assert.doesNotMatch(s, /Production Hours Value/);
});

test("revenue figures are never rounded to whole ringgit", () => {
  for (const p of [
    "src/pages/dashboards/EmployeesDashboard.tsx",
    "src/pages/dashboards/DeptCompletedStrip.tsx",
    "src/pages/m/screens/dashboard/FloorLiveCompleted.tsx",
    "src/pages/m/screens/dashboard/emp-model.ts",
    "src/pages/m/screens/dashboard/HomeSalesA.tsx",
  ]) {
    const s = read(p);
    assert.doesNotMatch(s, /Math\.round\([^)]*\/ ?100\) ?\* ?100/, `${p}: whole-RM rounding`);
    assert.doesNotMatch(s, /Math\.round\(\(?[^)]*\)? ?\/ ?100\)\.toLocaleString/, `${p}: whole-RM toLocaleString`);
  }
});

test("revenue charts carry exact ringgit, so their tooltips print to the sen (owner 2026-11-20)", () => {
  for (const p of [
    "src/pages/dashboard-b/index.tsx",
    "src/pages/dashboards/DailyProductionRevenueCard.tsx",
    "src/pages/dashboards/CostingPanel.tsx",
    "src/pages/dashboards/ProductionDailyPanels.tsx",
    "src/pages/dashboards/dashboard-sales-lib.ts",
  ]) {
    const s = read(p);
    assert.doesNotMatch(s, /Math\.round\([^)]*(?:[Rr]evenue|production|[Ss]en)[^)]*\/ ?100\)/, `${p}: revenue rounded to whole ringgit`);
  }
});
