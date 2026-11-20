// Owner 2026-11-21: every count of employees follows the one employment rule
// (src/lib/employment.ts) — batch 2 of docs/plans/employee-lifecycle-one-rule.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(p, "utf8");

test("Employees page: TOTAL = employed in the range, PRESENT counted by the same rule server-side", () => {
  assert.match(read("src/pages/employees.tsx"), /employedDuring\(\s*\n?\s*\{ empNo: w\.empNo, status: w\.status, joinDate: w\.joinDate/);
  const dp = read("src/api/routes/department-performance.ts");
  assert.match(dp, /if \(employedDuring\(row, fromStr, toStr\)\) employedPresent\.add\(row\.id\);/);
  assert.match(dp, /workerCount: employedPresent\.size,/);
});

test("dashboard: a day counts the people employed THAT day; outsource is the flag", () => {
  const lib = read("src/pages/dashboards/dashboard-shared-lib.ts");
  assert.match(lib, /export function countsOn\(/);
  assert.match(lib, /export function countsDuring\(/);
  assert.match(lib, /if \(w\.isOutsource !== undefined && w\.isOutsource !== null\)/);
  assert.match(read("src/api/routes/dashboard-prototype.ts"), /countsToHeadcount: employedOn\(w, todayYmdMY\(\)\),\s*\n\s*joinDate: w\.joinDate \?\? null,/);
  assert.match(read("src/pages/dashboards/EmployeesDashboard.tsx"), /const onDay = roster\.filter\(\(w\) => countsOn\(w, anchor\)\);/);
  assert.match(read("src/pages/m/screens/dashboard/emp-lib.ts"), /const onDay = roster\.filter\(\(w\) => countsOn\(w, anchor\)\);/);
  assert.match(read("src/pages/dashboards/use-problem-tiles.ts"), /countsOn\(w, day\)/);
});

test("emails, Command Center history, Finance, accounting and Board Report use the rule", () => {
  assert.match(read("src/api/lib/efficiency-report.ts"), /WHERE \$\{employedOnSql\(""\)\}`,\s*\n\s*\)\s*\n\s*\.bind\(\.\.\.employedOnParams\(dateYmd\)\)/);
  assert.match(read("src/api/lib/employee-agent.ts"), /WHERE \$\{employedOnSql\("w"\)\} AND \(a\.id IS NULL OR a\.clockIn IS NULL\)/);
  assert.match(read("src/api/routes/dashboard-overview.ts"), /\.bind\(\.\.\.employedOnParams\(M\)\)/);
  assert.match(read("src/api/lib/dashboard-finance.ts"), /return workers\.filter\(\(w\) => employedOn\(w, end\)\)\.length;/);
  assert.match(read("src/api/routes/accounting.ts"), /employedDuring\(w, `\$\{ym\}-01`, `\$\{ym\}-31`\)/);
  assert.match(read("src/api/lib/operations-report.ts"), /\.bind\(\.\.\.employedDuringParams\(p\.startYmd, p\.endYmd\)\)/);
});
