// m-employees-menu.test.mjs — HK-0125: the Employees "..." menus, step 1 (owner-approved 2026-11-16).
// Pure logic with worked examples; the wiring checks read the source text. Sample values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EFFICIENCY_REPORT_URL, menuItems, menuTitle } from "../src/pages/m/screens/employees/employees-menu.ts";
import { buildWorkingHoursPrint, dmy, printPeriod } from "../src/pages/m/screens/employees/working-hours-print.ts";
import { buildRows } from "../src/pages/m/screens/employees/working-hours-model.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const all = { canWorkersRead: true, canPrintWorkingHours: true };
const none = { canWorkersRead: false, canPrintWorkingHours: false };
const labels = (section, ready) => menuItems(section, ready).map((i) => i.label);

test("Overview menu: the Daily Efficiency Report ONLY (Departments, Public holidays, Pay rules are desktop-only)", () => {
  assert.deepEqual(labels("overview", all), ["Daily Efficiency Report"]);
  assert.deepEqual(menuItems("overview", all).map((i) => i.icon), ["FileText"]);
});

test("Working Hours menu: Print only (when there is something to print); no Copy actions yet", () => {
  assert.deepEqual(labels("working-hours", all), ["Print"]);
  assert.equal(menuItems("working-hours", all)[0].icon, "Printer");
  assert.deepEqual(labels("working-hours", { ...all, canPrintWorkingHours: false }), []);
  assert.ok(!labels("working-hours", all).some((l) => /copy/i.test(l)), "Copy yesterday / Copy from another date are held for review");
});

test("Attendance and every other section have NO menu items (so no button): Attendance Print is held", () => {
  for (const s of ["attendance", "labor-cost", "efficiency", "department-labor", "employee-performance", "department-performance", "payroll"]) {
    assert.deepEqual(labels(s, all), [], s);
  }
});

test("the report needs workers:read; Employee Master is never offered (desktop only)", () => {
  assert.deepEqual(labels("overview", none), []);
  for (const s of ["overview", "working-hours", "attendance", "payroll"]) {
    assert.ok(!labels(s, all).includes("Employee Master") && !labels(s, none).includes("Employee Master"), s);
  }
  const route = src("EmployeesRoute.tsx");
  assert.match(route, /items\.length === 0 \? undefined/, "no items -> no ... button");
  assert.ok(!/employee-master/.test(route + src("employees-sections.ts") + src("employees-menu.ts")), "no Employee Master route or action");
  for (const gone of ["MenuPages", "menu-pages-model", "departments", "holidays", "pay-rules"]) assert.ok(!route.includes(gone), `${gone} is not on the phone`);
});

test("sheet title: 'Employees' on Overview, the section's own name elsewhere", () => {
  assert.equal(menuTitle("overview", "Overview"), "Employees");
  assert.equal(menuTitle("working-hours", "Working Hours"), "Working Hours");
  assert.equal(menuTitle("attendance", "Attendance"), "Attendance");
});

test("Daily Efficiency Report opens the existing report with NO date, so the server uses the previous working day", () => {
  assert.equal(EFFICIENCY_REPORT_URL, "/api/reports/efficiency");
  assert.ok(!/date=/.test(EFFICIENCY_REPORT_URL));
  const route = src("EmployeesRoute.tsx");
  assert.match(route, /window\.open\(EFFICIENCY_REPORT_URL, "_blank", "noopener"\)/);
  assert.ok(!/fetch\(|mutateJson/.test(route.replace(/^\s*\/\/.*$/gm, "")), "opening the report writes and fetches nothing from the menu");
});

// ---- Working Hours Print -----------------------------------------------------------------------------------------------
const workers = [
  { id: "w1", name: "Ann Lee", empNo: "EMP-1", workingHoursPerDay: 9 },
  { id: "w2", name: "Bob Tan", empNo: "EMP-2", workingHoursPerDay: 9 },
];
const depts = [{ code: "UPH", name: "Upholstery" }, { code: "FRM", name: "Framing" }];
const E = (workerId, date, departmentCode, hours, category = "", notes = "") => ({ workerId, date, departmentCode, hours, category, notes });
const entries = [
  E("w1", "2026-11-11", "UPH", 5, "SOFA", "set 1"),
  E("w1", "2026-11-11", "FRM", 4.5, "BEDFRAME"),
  E("w2", "2026-11-11", "FRM", 8, "BEDFRAME"),
  E("w1", "2026-11-10", "UPH", 7.25, "SOFA"),
  ...Array.from({ length: 20 }, (_, i) => E("w2", `2026-11-${String(1 + (i % 9)).padStart(2, "0")}`, "UPH", 1, "SOFA", "bulk " + i)),
];
const rows = buildRows(entries, [], workers, depts);
const win = { from: "2026-11-01", to: "2026-11-30" };
const deptName = (c) => depts.find((d) => d.code === c)?.name ?? c;
const F = (o = {}) => ({ q: "", date: "", dept: "", ...o });

test("Print includes EVERY matching entry, far more than the first five cards", () => {
  assert.ok(rows.length > 5);
  const spec = buildWorkingHoursPrint({ rows, filters: F(), window: win, deptName });
  assert.equal(spec.entries, entries.length);
  assert.equal(spec.rows.length, entries.length);
  assert.deepEqual(spec.cards, [
    { label: "Total Hours", value: "44.8h" }, // 5 + 4.5 + 8 + 7.25 + 20
    { label: "Workers", value: "2" },
    { label: "Entries", value: String(entries.length) },
  ]);
  assert.equal(spec.title, "Working Hours");
  assert.equal(spec.orientation, "portrait");
});

test("columns and cells follow desktop: Date only when several days can print; one row per ENTRY", () => {
  const multi = buildWorkingHoursPrint({ rows, filters: F(), window: win, deptName });
  assert.deepEqual(multi.columns.map((c) => c.header), ["Date", "Employee", "Department", "Category", "Hours", "Notes"]);
  assert.equal(multi.columns[4].align, "right");
  const day = buildWorkingHoursPrint({ rows, filters: F({ date: "2026-11-11" }), window: win, deptName });
  assert.deepEqual(day.columns.map((c) => c.header), ["Employee", "Department", "Category", "Hours", "Notes"]);
  assert.deepEqual(day.rows[0], ["Ann Lee", "Upholstery", "SOFA", "5.0h", "set 1"]);
  assert.equal(day.entries, 3);
  assert.deepEqual(day.rows[1].slice(0, 2), ["Ann Lee", "Framing"]);
  assert.equal(day.rows[2][3], "8.0h");
  assert.equal(multi.rows[0][0], "11/11/2026", "newest day first, dd/mm/yyyy like desktop");
});

test("filters: the picked date, the employee search and the department each narrow what prints", () => {
  assert.equal(buildWorkingHoursPrint({ rows, filters: F({ date: "2026-11-10" }), window: win, deptName }).entries, 1);
  assert.equal(buildWorkingHoursPrint({ rows, filters: F({ q: "ann" }), window: win, deptName }).entries, 3);
  assert.equal(buildWorkingHoursPrint({ rows, filters: F({ q: "EMP-1" }), window: win, deptName }).entries, 3, "employee number works too");
  // a department filter prints that department's ENTRIES only (desktop filters per entry), never the day's other segments
  const frm = buildWorkingHoursPrint({ rows, filters: F({ dept: "FRM" }), window: win, deptName });
  assert.equal(frm.entries, 2);
  assert.ok(frm.rows.every((r) => r[2] === "Framing"));
  assert.equal(frm.cards[0].value, "12.5h");
  const combo = buildWorkingHoursPrint({ rows, filters: F({ q: "bob", dept: "UPH", date: "2026-11-03" }), window: win, deptName });
  assert.ok(combo.entries >= 1 && combo.rows.every((r) => r[0] === "Bob Tan" && r[1] === "Upholstery"));
});

test("the filter line names the period and the active filters", () => {
  assert.equal(dmy("2026-11-05"), "05/11/2026");
  assert.equal(printPeriod(F(), win), "01/11/2026 – 30/11/2026");
  assert.equal(printPeriod(F({ date: "2026-11-11" }), win), "11/11/2026");
  assert.equal(buildWorkingHoursPrint({ rows, filters: F(), window: win, deptName }).filterSummary, "01/11/2026 – 30/11/2026");
  assert.equal(
    buildWorkingHoursPrint({ rows, filters: F({ date: "2026-11-11", dept: "FRM", q: " ann " }), window: win, deptName }).filterSummary,
    '11/11/2026 · Department: Framing · Search: "ann"',
  );
});

test("Print is wired through the shell's menu bridge using the shared print engine; it registers only with entries to print", () => {
  const sec = src("WorkingHoursSection.tsx");
  assert.match(sec, /from "@\/lib\/print-report"/);
  assert.match(sec, /bridge\.setPrint\(\(\) =>/);
  assert.match(sec, /return \(\) => bridge\.setPrint\(null\)/);
  assert.match(sec, /const printable = filtered\.length > 0/);
  const route = src("EmployeesRoute.tsx");
  assert.match(route, /canPrintWorkingHours: section === "working-hours" && whPrint !== null/);
  assert.match(route, /whPrint\?\.\(\)/);
});

test("the menu changes nothing", () => {
  for (const f of ["MenuSheet.tsx", "employees-menu.ts", "working-hours-print.ts"]) {
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)["']|mutateJson/.test(src(f)), `${f} makes no write`);
  }
});

test("the sheet matches the HTML: a 32px icon tile, a 13.5px label, no chevron, 52px rows", () => {
  const ui = src("MenuSheet.tsx").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/ChevronRight/.test(ui));
  assert.match(ui, /minHeight: 52/);
  assert.match(ui, /width: 32, height: 32/);
  assert.match(ui, /fontSize: 13\.5, fontWeight: 600/);
  assert.match(ui, /borderRadius: 9/);
});
