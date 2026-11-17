// m-employees-menu.test.mjs — HK-0125: the Employees "..." menus (owner-approved 2026-11-16 / 2026-11-17).
// Pure logic with worked examples; the wiring checks read the source text. Sample values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { efficiencyReportUrl, menuItems, menuTitle, SECTION_MENU } from "../src/pages/m/screens/employees/employees-menu.ts";
import { buildWorkingHoursPrint, dmy, printPeriod } from "../src/pages/m/screens/employees/working-hours-print.ts";
import { buildRows } from "../src/pages/m/screens/employees/working-hours-model.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const run = () => undefined;
const reg = (...actions) => Object.fromEntries(actions.map((a) => [a, { run }]));
const labels = (section, registry) => menuItems(section, registry).map((i) => i.label);
const EVERY = reg("copy-yesterday", "copy-from", "print", "settle-month", "qr-poster", "efficiency-a4", "export-csv", "calc-guide");

test("each section's menu follows the HTML's order and wording (desktop-checked, owner 2026-11-17)", () => {
  assert.deepEqual(labels("working-hours", EVERY), ["Copy yesterday", "Copy from another date", "Print"]);
  assert.deepEqual(labels("labor-cost", EVERY), ["Settle month", "Print report"]);
  assert.deepEqual(labels("efficiency", EVERY), ["Print report"]);
  assert.deepEqual(labels("department-labor", EVERY), ["Print report", "Department QR poster"]);
  assert.deepEqual(labels("employee-performance", EVERY), ["Print Report"]);
  assert.deepEqual(labels("department-performance", EVERY), ["Print Report", "Daily Efficiency (A4)"]);
  assert.deepEqual(labels("payroll", EVERY), ["Export CSV", "Print Report", "Calculation Guide"]);
});

test("Overview and Attendance have NO menu, whatever a section registers (so no button)", () => {
  assert.deepEqual(menuItems("overview", EVERY), []);
  assert.deepEqual(menuItems("attendance", EVERY), []);
  assert.ok(!("overview" in SECTION_MENU) && !("attendance" in SECTION_MENU));
  assert.ok(!labels("labor-cost", EVERY).some((l) => /regenerate/i.test(l)), "the standalone Regenerate payslips item is not offered");
});

test("only the items a section has REGISTERED show; an unregistered item and a foreign action are dropped", () => {
  assert.deepEqual(labels("working-hours", reg("print")), ["Print"]);
  assert.deepEqual(labels("working-hours", reg("copy-from")), ["Copy from another date"]);
  assert.deepEqual(menuItems("working-hours", {}), []);
  assert.deepEqual(labels("efficiency", reg("settle-month", "qr-poster")), [], "an action that is not this section's never shows");
});

test("a busy item shows greyed with its note and cannot be picked", () => {
  const items = menuItems("payroll", { "export-csv": { run, busy: true, note: "Preparing…" }, print: { run } });
  assert.deepEqual(items.map((i) => [i.label, !!i.busy, i.note ?? ""]), [["Export CSV", true, "Preparing…"], ["Print Report", false, ""]]);
  const ui = src("MenuSheet.tsx");
  assert.match(ui, /onClick=\{\(\) => \(it\.busy \? undefined : onPick\(it\.action\)\)\}/);
  assert.match(ui, /disabled=\{it\.busy\}/);
});

test("Employee Master is never offered (desktop only); no items -> no button", () => {
  for (const s of Object.keys(SECTION_MENU)) assert.ok(!labels(s, EVERY).includes("Employee Master"), s);
  const route = src("EmployeesRoute.tsx");
  assert.match(route, /items\.length === 0 \? undefined/, "no items -> no ... button");
  assert.ok(!/employee-master/.test(route + src("employees-sections.ts") + src("employees-menu.ts")), "no Employee Master route or action");
});

test("sheet title: 'Employees' on Overview, the section's own name elsewhere", () => {
  assert.equal(menuTitle("overview", "Overview"), "Employees");
  assert.equal(menuTitle("working-hours", "Working Hours"), "Working Hours");
  assert.equal(menuTitle("attendance", "Attendance"), "Attendance");
});

test("Daily Efficiency (A4) opens the existing report for the selected To date, all departments (desktop's URL), needing workers:read", () => {
  assert.equal(efficiencyReportUrl("2026-11-13"), "/api/reports/efficiency?date=2026-11-13");
  const sec = src("DepartmentPerformanceSection.tsx");
  assert.match(sec, /window\.open\(efficiencyReportUrl\(range\.to\), "_blank", "noopener"\)/);
  assert.match(sec, /if \(!bridge \|\| !data\.allowed\) return;/, "workers:read gates it");
  assert.ok(!/fetch\(|mutateJson/.test(src("EmployeesRoute.tsx").replace(/^\s*\/\/.*$/gm, "")), "the shell fetches and writes nothing from the menu");
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

test("Print is wired through the shell's menu registry using the shared print engine; it registers only with entries to print", () => {
  const sec = src("WorkingHoursSection.tsx");
  assert.match(sec, /from "@\/lib\/print-report"/);
  assert.match(sec, /bridge\.set\(\{/);
  assert.match(sec, /return \(\) => bridge\.set\(null\)/);
  assert.match(sec, /const printable = filtered\.length > 0/);
  const route = src("EmployeesRoute.tsx");
  assert.match(route, /const items = menuItems\(section, registry\)/);
  assert.match(route, /registry\[a\]\?\.run\(\)/);
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

test("Department Performance fetches the full per-worker report ONLY when Print Report is tapped (not on the list, not when the menu opens)", () => {
  const sec = src("DepartmentPerformanceSection.tsx").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/useMenuOpen/.test(sec), "opening the menu is not a trigger");
  assert.match(sec, /useDepartmentPerformance\(range, dept, cat, day, wantKey === scopeKey\)/);
  assert.match(sec, /const \[wantKey, setWantKey\] = useState<string \| null>\(null\)/, "nothing is wanted until a tap");
  const run = sec.slice(sec.indexOf("run: () => {"), sec.indexOf('"efficiency-a4"'));
  assert.match(run, /window\.open\("", "_blank"\)/, "the tap opens the print window itself");
  assert.match(run, /setWantKey\(scopeKey\)/, "the tap starts the fetch");
  assert.match(src("use-department-performance.ts"), /allowed && wantFull \? fullUrl\(/, "no request without wantFull");
});
