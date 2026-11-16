// m-employees-shell.test.mjs — HK-0125 Phase 1: the mobile Employees shell and the shared Malaysia-date period rules.
// Pure date helpers get worked examples (today is always passed in, never read from the clock); the wiring (pill order,
// route registration, the generic list staying unchanged when `embedded` is off) is checked against the source text.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ERR_FROM_AFTER_TO,
  ERR_FUTURE,
  ERR_INVALID,
  isFutureMonth,
  isYmd,
  monthRange,
  parseRange,
  rangeLabel,
  thisMonthRange,
  validateRange,
  wholeMonthOf,
} from "../src/pages/m/screens/employees/employees-dates.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");
const TODAY = "2026-11-13";

test("isYmd accepts real dates only", () => {
  assert.equal(isYmd("2026-02-28"), true);
  assert.equal(isYmd("2028-02-29"), true);
  assert.equal(isYmd("2026-02-30"), false);
  assert.equal(isYmd("2026-13-01"), false);
  assert.equal(isYmd("26-11-13"), false);
  assert.equal(isYmd(null), false);
  assert.equal(isYmd(""), false);
});

test("monthRange covers the whole month, leap years included", () => {
  assert.deepEqual(monthRange(2026, 11), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(monthRange(2026, 12), { from: "2026-12-01", to: "2026-12-31" });
  assert.deepEqual(monthRange(2028, 2), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(monthRange(2026, 2), { from: "2026-02-01", to: "2026-02-28" });
});

test("a tab opens on the WHOLE current month (desktop rule), not month-to-date", () => {
  assert.deepEqual(thisMonthRange(TODAY), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(thisMonthRange("2026-12-31"), { from: "2026-12-01", to: "2026-12-31" });
});

test("wholeMonthOf recognises only an exact calendar month", () => {
  assert.deepEqual(wholeMonthOf({ from: "2026-10-01", to: "2026-10-31" }), { year: 2026, month: 10 });
  assert.equal(wholeMonthOf({ from: "2026-10-01", to: "2026-10-30" }), null);
  assert.equal(wholeMonthOf({ from: "2026-10-02", to: "2026-10-31" }), null);
  assert.equal(wholeMonthOf({ from: "2026-10-01", to: "2026-11-30" }), null);
});

test("future months are disabled from the real date; the current month is not", () => {
  assert.equal(isFutureMonth(2026, 11, TODAY), false);
  assert.equal(isFutureMonth(2026, 12, TODAY), true);
  assert.equal(isFutureMonth(2027, 1, TODAY), true);
  assert.equal(isFutureMonth(2026, 10, TODAY), false);
  // The same month flips at the Malaysia month boundary, driven only by the `today` argument.
  assert.equal(isFutureMonth(2026, 12, "2026-12-01"), false);
});

test("validateRange: error texts and what may be applied", () => {
  assert.equal(validateRange({ from: "2026-11-01", to: "2026-11-30" }, TODAY), null); // current month runs past today
  assert.equal(validateRange({ from: "2026-12-01", to: "2026-12-31" }, TODAY), ERR_FUTURE); // future month
  assert.equal(validateRange({ from: "2026-11-02", to: "2026-11-13" }, TODAY), null); // custom, ends today
  assert.equal(validateRange({ from: "2026-11-02", to: "2026-11-14" }, TODAY), ERR_FUTURE); // custom, ends tomorrow
  assert.equal(validateRange({ from: "2026-11-10", to: "2026-11-02" }, TODAY), ERR_FROM_AFTER_TO);
  assert.equal(ERR_FROM_AFTER_TO, "Choose a From date on or before the To date.");
  assert.equal(validateRange({ from: "", to: "2026-11-02" }, TODAY), ERR_INVALID);
  assert.equal(validateRange({ from: "2019-12-31", to: "2020-01-05" }, TODAY), ERR_INVALID); // before 2020-01-01
  assert.equal(validateRange({ from: "2020-01-01", to: "2020-01-01" }, TODAY), null);
});

test("parseRange falls back to the current month for missing, malformed or disallowed params", () => {
  const cur = { from: "2026-11-01", to: "2026-11-30" };
  assert.deepEqual(parseRange(null, null, TODAY), cur);
  assert.deepEqual(parseRange("nope", "2026-11-05", TODAY), cur);
  assert.deepEqual(parseRange("2026-12-01", "2026-12-31", TODAY), cur);
  assert.deepEqual(parseRange("2026-11-10", "2026-11-02", TODAY), cur);
  assert.deepEqual(parseRange("2026-10-01", "2026-10-31", TODAY), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(parseRange("2026-11-02", "2026-11-13", TODAY), { from: "2026-11-02", to: "2026-11-13" });
});

test("rangeLabel: whole month, single day, same-year and cross-year ranges", () => {
  assert.equal(rangeLabel({ from: "2026-11-01", to: "2026-11-30" }), "November 2026");
  assert.equal(rangeLabel({ from: "2026-11-05", to: "2026-11-05" }), "5 Nov 2026");
  assert.equal(rangeLabel({ from: "2026-11-02", to: "2026-11-13" }), "2 Nov – 13 Nov 2026");
  assert.equal(rangeLabel({ from: "2025-12-20", to: "2026-01-05" }), "20 Dec 2025 – 5 Jan 2026");
});

test("the date helpers hold no hard-coded date and never read the clock", () => {
  const dates = src("screens/employees/employees-dates.ts");
  assert.ok(!/\bnew Date\(\)|Date\.now\(|toISOString/.test(dates), "employees-dates.ts must take `today` as an argument");
  assert.ok(!/2026-11-13/.test(dates), "no sample 'today' in the helpers");
  const hook = src("screens/employees/use-employees-period.ts");
  assert.match(hook, /todayYmdMYForReads\(\)/, "the hook gets today from the Malaysia helper");
  const sheet = src("screens/employees/PeriodSheet.tsx");
  assert.ok(!/2026-11-13|new Date\(\)/.test(sheet), "the sheet takes `today` from its caller");
});

test("pill order matches Employees 3.dc.html and Employee Master is only in the menu", () => {
  const route = src("screens/employees/employees-sections.ts");
  const menu = src("screens/employees/EmployeesRoute.tsx");
  const labels = [...route.matchAll(/\{ key: "[a-z-]+", label: "([^"]+)", tab: /g)].map((m) => m[1]);
  assert.deepEqual(labels, [
    "Overview",
    "Working Hours",
    "Attendance",
    "Labor Cost",
    "Efficiency Overview",
    "Department Labor",
    "Employee Performance",
    "Department Performance",
    "Payroll",
  ]);
  assert.ok(!labels.includes("Employee Master"));
  assert.match(menu, /Employee Master<\/span>/, "reachable from the ⋯ menu");
});

test("every section but Overview maps to an existing data source tab", () => {
  const route = src("screens/employees/employees-sections.ts");
  const modules = src("config/modules.ts");
  const tabs = [...route.matchAll(/tab: "([a-z-]+)" \}/g)].map((m) => m[1]);
  assert.equal(tabs.length, 8);
  for (const t of [...tabs, "directory"]) {
    assert.match(modules, new RegExp(`key: "${t}", label:`), `employeesConfig has a sub-tab keyed "${t}"`);
  }
});

test("period state is NOT mounted on any section yet, and Payroll never uses it", () => {
  const route = src("screens/employees/EmployeesRoute.tsx");
  assert.ok(!/PeriodSheet|useEmployeesPeriod/.test(route), "no tab shows a picker until its data follows the period");
  const modules = src("config/modules.ts");
  assert.ok(!/useEmployeesPeriod/.test(modules));
});

test("Employees is registered as a bespoke L1 only; detail routes and other modules are untouched", () => {
  const layout = src("MobileLayout.tsx");
  assert.match(layout, /employees: EmployeesRoute,/);
  assert.ok(!/CUSTOM_L2[^}]*employees:/s.test(layout), "L2 detail stays the generic config-driven one");
  const cfg = src("config/modules.ts");
  assert.match(cfg, /\/m\/payslips\/\$\{encodeURIComponent\(vm\.id\)\}/);
  assert.match(cfg, /\/m\/employees\/\$\{encodeURIComponent\(vm\.id\)\}/);
});

test("generic list: `embedded` is opt-in and off by default, SubTabs offset defaults to 0", () => {
  const list = src("screens/ModuleListScreen.tsx");
  assert.match(list, /embedded = false,/);
  assert.match(list, /subTabsStickyOffset = 0,/);
  assert.match(list, /\{embedded \? null : \(\s*<MobileHeader/);
  assert.match(list, /salesTop \|\| \(embedded && allTabs\.length <= 1\) \? null/);
  const tabs = src("components/SubTabs.tsx");
  assert.match(tabs, /stickyOffset = 0/);
  assert.match(tabs, /stickyOffset \?/, "no offset → the original `top` value is used unchanged");
  // No other module opts in.
  const layout = src("MobileLayout.tsx");
  assert.ok(!/embedded/.test(layout));
});
