// Owner 2026-11-20 「全部部门都跟upholstery 一样 … employee那边 全部都要一样」:
// every department figure on the Employees side is Department Revenue.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(p, "utf8");

test("Labour Cost byDeptCategory is Department Revenue, not a minutes split", () => {
  const s = read("src/api/routes/working-hour-entries.ts");
  assert.match(s, /for \(const r of await loadDeptRevenue\(c\.var\.DB, getOrgId\(c\), from, to\)\)/);
  assert.doesNotMatch(s, /poTotalPriceSen \* jcMin\) \/ totalMin/, "the minute-weighted slice is gone");
});

test("Employees dashboard (desktop + phone) read the Department Revenue feed; totals = Upholstery", () => {
  const d = read("src/pages/dashboards/EmployeesDashboard.tsx");
  assert.match(d, /\/api\/dashboard\/floor-live\/completed\?from=/);
  assert.match(d, /const up = progByDept\.get\("UPHOLSTERY"\)/);
  assert.match(d, /Output · Accessory/);
  const m = read("src/pages/m/screens/dashboard/emp-data.ts");
  assert.match(m, /\/api\/dashboard\/floor-live\/completed\?from=/);
  const lib = read("src/pages/m/screens/dashboard/emp-lib.ts");
  assert.match(lib, /export function deptTotalOf\(rows: DeptRow\[\], progByDept\?/);
});
