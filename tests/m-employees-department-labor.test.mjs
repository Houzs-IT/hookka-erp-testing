// m-employees-department-labor.test.mjs — HK-0125 Phase 4, step 3: Employees → Department Labor. Sample values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NO_FILTERS,
  computeDepartmentLabor,
  costLabel,
  filterCount,
  footnote,
  isFullSingleMonth,
  isUnfiltered,
  monthIsFinished,
  payrollEligible,
  totalsOf,
  visibleRows,
} from "../src/pages/m/screens/employees/department-labor-model.ts";
import { resolvePayRulesAsOf } from "../src/lib/pay-rules.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, "");

// October 2026: the 1st is a Thursday, 4 Sundays (4, 11, 18, 25) → 27 Mon–Sat working days. 6 Oct = Tue, 7 Oct = Wed, 4 Oct = Sun, 10 Oct = Sat.
const OCT = { from: "2026-10-01", to: "2026-10-31" };
const DEPTS = [
  { code: "FRM", name: "Framing", isProduction: true, sequence: 2 },
  { code: "UPH", name: "Upholstery", isProduction: true, sequence: 1 },
  { code: "WH", name: "Warehousing", isProduction: false, sequence: 9 },
];
const W = (id, o = {}) => ({ id, status: "ACTIVE", departmentCode: "UPH", basicSalarySen: 260000, workingHoursPerDay: 9, workingDaysPerMonth: 26, otMultiplier: 1.5, ...o });
const E = (workerId, date, departmentCode, hours, category = "") => ({ workerId, date, departmentCode, hours, category });
const base = (o = {}) => ({
  entries: [], workers: [W("a")], depts: DEPTS, holidays: [], versions: [], effSalary: {}, payslips: null, docks: null,
  range: OCT, category: "", today: "2026-10-20", costDataOk: true, ...o,
});
const rowOf = (res, code) => res.rows.find((r) => r.deptCode === code);
const cfg = resolvePayRulesAsOf([], "2026-10-06");
const REG = 260000 / 27 / 9; // ÷ the month's 27 working days ÷ 9 h
const OTB = 260000 / 26 / 9; // OT base: ÷ 26 days ÷ 9 h

test("period rules: one whole month, over, no category → payroll-eligible (on the Malaysia date)", () => {
  assert.equal(isFullSingleMonth("2026-10-01", "2026-10-31"), true);
  assert.equal(isFullSingleMonth("2026-10-01", "2026-10-30"), false);
  assert.equal(isFullSingleMonth("2026-10-02", "2026-10-31"), false);
  assert.equal(isFullSingleMonth("2026-10-01", "2026-11-30"), false);
  assert.equal(monthIsFinished("2026-10", "2026-11-01"), true);
  assert.equal(monthIsFinished("2026-11", "2026-11-30"), false, "the current month is never finished");
  assert.equal(monthIsFinished("2026-12", "2026-11-17"), false);
  assert.equal(payrollEligible(OCT, "", "2026-11-17"), true);
  assert.equal(payrollEligible(OCT, "SOFA", "2026-11-17"), false);
  assert.equal(payrollEligible({ from: "2026-10-05", to: "2026-10-31" }, "", "2026-11-17"), false);
  assert.equal(payrollEligible({ from: "2026-11-01", to: "2026-11-30" }, "", "2026-11-17"), false);
});

test("desktop costing: weekday regular, weekday OT, Sunday and public-holiday OT (worked examples)", () => {
  const res = computeDepartmentLabor(base({
    holidays: ["2026-10-10"],
    entries: [
      E("a", "2026-10-06", "UPH", 9, "SOFA"), // 9 h on a weekday: all regular
      E("a", "2026-10-07", "UPH", 10, "SOFA"), // 10 h: 9 regular + 1 OT at 1.5
      E("a", "2026-10-04", "UPH", 8, "SOFA"), // Sunday: every hour OT at the Sunday multiplier
      E("a", "2026-10-10", "UPH", 5, "SOFA"), // public holiday (a Saturday): every hour at the holiday multiplier
    ],
  }));
  // the holiday takes a day off the month's working days: 27 → 26, so the regular rate is salary ÷ 26 ÷ 9
  const REGH = 260000 / 26 / 9;
  const expected = 9 * REGH + (9 * REGH + 1 * OTB * 1.5) + 8 * OTB * cfg.sundayOtMultiplier + 5 * OTB * cfg.holidayOtMultiplier;
  const uph = rowOf(res, "UPH");
  assert.equal(res.mode, "estimate");
  assert.equal(uph.totalHours, 32);
  assert.deepEqual(uph.workerIds, ["a"]);
  assert.equal(uph.costSen, Math.round(expected));
  assert.equal(uph.sofaSen, Math.round(expected), "every entry is SOFA, so the category column carries the whole cost");
  assert.equal(uph.catTotalSen, uph.sofaSen + uph.bedframeSen + uph.accessorySen);
});

test("OT is split across a day's entries by hours, so each department carries its share", () => {
  const res = computeDepartmentLabor(base({ entries: [E("a", "2026-10-07", "UPH", 6, "SOFA"), E("a", "2026-10-07", "FRM", 4, "BEDFRAME")] }));
  // 10 h day: 1 OT hour shared 60 / 40
  const otShare = 1 / 10;
  const cost = (h) => (h - h * otShare) * REG + h * otShare * OTB * 1.5;
  assert.equal(rowOf(res, "UPH").costSen, Math.round(cost(6)));
  assert.equal(rowOf(res, "FRM").costSen, Math.round(cost(4)));
  assert.equal(rowOf(res, "FRM").bedframeSen, Math.round(cost(4)));
});

test("a daily-paid worker costs the day rate split by hours; no-salary monthly workers and unknown ids are skipped", () => {
  const res = computeDepartmentLabor(base({
    workers: [W("d", { payMode: "DAILY", dailyRateSen: 8000, basicSalarySen: 0 }), W("n", { basicSalarySen: 0 })],
    entries: [E("d", "2026-10-06", "UPH", 6), E("d", "2026-10-06", "FRM", 2), E("n", "2026-10-06", "UPH", 8), E("ghost", "2026-10-06", "UPH", 8)],
  }));
  assert.equal(rowOf(res, "UPH").costSen, 6000);
  assert.equal(rowOf(res, "FRM").costSen, 2000);
  assert.equal(rowOf(res, "UPH").totalHours, 6, "the no-salary worker's and the unknown id's hours are not counted (desktop skips them)");
  assert.deepEqual(rowOf(res, "UPH").workerIds, ["d"]);
});

test("effective salary replaces basic salary for that worker; a missing one falls back", () => {
  const e = [E("a", "2026-10-06", "UPH", 9)];
  assert.equal(rowOf(computeDepartmentLabor(base({ entries: e, effSalary: { a: 300000 } })), "UPH").costSen, Math.round(9 * (300000 / 27 / 9)));
  assert.equal(rowOf(computeDepartmentLabor(base({ entries: e, effSalary: { zz: 1 } })), "UPH").costSen, Math.round(9 * REG));
});

test("category filter keeps that category AND the uncategorised (non-production) entries", () => {
  const entries = [E("a", "2026-10-06", "UPH", 3, "SOFA"), E("a", "2026-10-06", "FRM", 3, "BEDFRAME"), E("a", "2026-10-06", "WH", 3, "")];
  const res = computeDepartmentLabor(base({ entries, category: "SOFA" }));
  assert.equal(rowOf(res, "UPH").totalHours, 3);
  assert.equal(rowOf(res, "FRM").totalHours, 0, "a production department with nothing in the category has no hours");
  assert.equal(rowOf(res, "WH").totalHours, 3, "non-production hours always show through");
  const shown = visibleRows(res, { ...NO_FILTERS, category: "SOFA" }).map((r) => r.deptCode).sort();
  assert.deepEqual(shown, ["UPH", "WH"], "departments with no hours in the scope are hidden");
});

// ---- fully loaded ("Total", matches Payroll) vs Estimated vs unavailable ---------------------------------------------------------
const payslip = (employeeId, gross, o = {}) => ({ employeeId, departmentCode: "UPH", period: "2026-10", basicSalary: 260000, grossPay: gross, epfEmployer: 33000, socsoEmployer: 2000, eisEmployer: 400, absentDays: 0, absenceDeductionSen: 0, totalOT: 0, allowances: 0, ...o });
const loaded = (o = {}) => base({ today: "2026-11-17", entries: [E("a", "2026-10-06", "UPH", 9, "SOFA")], payslips: [payslip("a", 300000)], docks: [], ...o });

test("a finished month with payroll loaded is fully loaded: the total ties to payroll to the sen; the label is Total", () => {
  const res = computeDepartmentLabor(loaded({ workers: [W("a"), W("b", { departmentCode: "WH" })], payslips: [payslip("a", 300000), payslip("b", 150000, { departmentCode: "WH" })] }));
  assert.equal(res.mode, "payroll");
  assert.equal(costLabel(res.mode), "Total");
  const payroll = (300000 + 33000 + 2000 + 400) + (150000 + 33000 + 2000 + 400);
  assert.equal(res.rows.reduce((s, r) => s + r.costSen, 0), payroll, "Σ departments = Σ (gross + employer EPF / SOCSO / EIS)");
  // worker a logged 9 h = 9 * REG; the rest of their pay is under-recorded (no OT / absence / allowance bridges)
  const uph = rowOf(res, "UPH");
  assert.equal(uph.underSen, Math.round(300000 - 9 * REG));
  assert.equal(uph.laborSen, uph.costSen - uph.underSen);
  // worker b logged nothing, so all of their pay sits in Warehousing and the whole of it is under-recorded
  assert.equal(rowOf(res, "WH").costSen, 150000 + 33000 + 2000 + 400);
  assert.equal(rowOf(res, "WH").underSen, 150000);
});

test("a department with NO hours but a loaded cost stays on the list, so a payroll-tied total never loses it", () => {
  const res = computeDepartmentLabor(loaded({ workers: [W("a"), W("b", { departmentCode: "WH" })], payslips: [payslip("a", 300000), payslip("b", 150000, { departmentCode: "WH" })] }));
  const shown = visibleRows(res, NO_FILTERS);
  assert.ok(shown.some((r) => r.deptCode === "WH" && r.totalHours === 0));
  assert.equal(totalsOf(shown).costSen, res.rows.reduce((s, r) => s + r.costSen, 0));
  // in the ESTIMATE (no payroll), a department with no hours has no cost and is hidden
  const est = computeDepartmentLabor(base({ entries: [E("a", "2026-10-06", "UPH", 9)] }));
  assert.deepEqual(visibleRows(est, NO_FILTERS).map((r) => r.deptCode), ["UPH"]);
});

test("Estimated Labor Cost: a custom range, the current month, or a category filter — even when payroll loaded", () => {
  const entries = [E("a", "2026-10-06", "UPH", 9, "SOFA")];
  for (const o of [
    { range: { from: "2026-10-01", to: "2026-10-20" } },
    { range: { from: "2026-11-01", to: "2026-11-30" } },
    { category: "SOFA" },
  ]) {
    const res = computeDepartmentLabor(loaded({ entries, ...o }));
    assert.equal(res.mode, "estimate", JSON.stringify(o));
    assert.equal(costLabel(res.mode), "Estimated Labor Cost");
    assert.equal(rowOf(res, "UPH").underSen, 0, "no Under-recorded outside a fully-loaded month");
    assert.equal(footnote(res, NO_FILTERS), null);
  }
});

test("payroll data missing on an eligible month: still a valid ESTIMATE, flagged; never 'Matches Payroll'", () => {
  const res = computeDepartmentLabor(loaded({ payslips: null, docks: [] }));
  assert.equal(res.mode, "estimate");
  assert.equal(res.payrollMissing, true);
  assert.equal(footnote(res, NO_FILTERS), "payroll-missing");
  assert.equal(computeDepartmentLabor(loaded({ docks: null })).mode, "estimate", "deductions missing is also not fully loaded");
});

test("estimate data missing: cost is UNAVAILABLE (hours and workers still counted), never a guessed number", () => {
  const res = computeDepartmentLabor(loaded({ costDataOk: false }));
  assert.equal(res.mode, "unavailable");
  const uph = rowOf(res, "UPH");
  assert.equal(uph.totalHours, 9);
  assert.deepEqual(uph.workerIds, ["a"]);
  assert.deepEqual([uph.costSen, uph.sofaSen, uph.underSen], [0, 0, 0]);
  assert.equal(footnote(res, NO_FILTERS), null);
  assert.deepEqual(visibleRows(res, NO_FILTERS).map((r) => r.deptCode), ["UPH"]);
});

test("'Matches Payroll' only for the UNFILTERED completed month; a filtered fully-loaded view says so", () => {
  const res = computeDepartmentLabor(loaded());
  assert.equal(footnote(res, NO_FILTERS), "matches-payroll");
  for (const f of [{ ...NO_FILTERS, q: "uph" }, { ...NO_FILTERS, type: "prod" }, { ...NO_FILTERS, depts: ["UPH"] }]) {
    assert.equal(isUnfiltered(f), false);
    assert.equal(footnote(res, f), "filtered-payroll");
  }
  assert.equal(filterCount({ category: "SOFA", type: "prod", depts: ["UPH"], q: "x" }), 3);
  assert.equal(filterCount(NO_FILTERS), 0);
});

// ---- list, sorting, totals -------------------------------------------------------------------------------------------------------
test("sorted by cost highest first; the total strip covers EVERY matching department and counts each worker once", () => {
  const depts = Array.from({ length: 8 }, (_, i) => ({ code: "D" + i, name: "Dept " + i, isProduction: true, sequence: i }));
  const workers = Array.from({ length: 8 }, (_, i) => W("w" + i, { departmentCode: "D" + i }));
  // every worker works in their own department; w0 ALSO works in D1 (so D1 has two people and w0 is in two departments)
  const entries = [...workers.map((w, i) => E(w.id, "2026-10-06", "D" + i, 9 - i * 0.5)), E("w0", "2026-10-07", "D1", 2)];
  const res = computeDepartmentLabor(base({ depts, workers, entries }));
  const rows = visibleRows(res, NO_FILTERS);
  assert.equal(rows.length, 8, "more than five departments");
  assert.deepEqual(rows.map((r) => r.costSen), [...rows.map((r) => r.costSen)].sort((a, b) => b - a), "highest cost first");
  const t = totalsOf(rows);
  assert.equal(t.departments, 8);
  assert.equal(t.workers, 8, "w0 works in two departments but is counted once");
  assert.equal(rows.reduce((s, r) => s + r.workerIds.length, 0), 9, "the per-department counts add up to more");
  assert.equal(t.hours, entries.reduce((s, e) => s + e.hours, 0));
  // the strip follows the filters: only the matching departments
  const only = visibleRows(res, { ...NO_FILTERS, depts: ["D0", "D1"] });
  assert.equal(totalsOf(only).workers, 2);
  assert.equal(totalsOf(only).departments, 2);
  assert.equal(visibleRows(res, { ...NO_FILTERS, q: "dept 7" }).length, 1);
  assert.equal(visibleRows(res, { ...NO_FILTERS, type: "non" }).length, 0);
});

test("cost parked on a department that is not in the list is kept (a row of its own) so the total still ties", () => {
  const res = computeDepartmentLabor(loaded({ workers: [W("a"), W("x", { departmentCode: "" })], payslips: [payslip("a", 300000), payslip("x", 100000, { departmentCode: "" })] }));
  const un = res.rows.find((r) => r.deptCode === "UNASSIGNED");
  assert.ok(un && un.costSen > 0);
  assert.equal(un.isProduction, false);
});

// ---- wiring -----------------------------------------------------------------------------------------------------------------------
test("wiring: existing endpoints and gates, read-only, the shared period, the HTML's controls", () => {
  const hook = strip(src("use-department-labor.ts"));
  for (const url of ["/api/working-hour-entries?from=", "/api/kv-config/public_holidays", "/api/workers/salary/effective?period=", "/api/pay-rules", "/api/payslips?period=", "/api/payroll-hour-deductions?period=", "/api/departments", "/api/workers"]) {
    assert.ok(hook.includes(url), url);
  }
  assert.match(hook, /hasPermission\("payslips", "read"\)/);
  assert.match(hook, /hasPermission\("workers", "read"\)/);
  assert.match(hook, /payrollEligible\(/, "payslips and deductions are only requested for a completed month with no category");
  const ui = strip(src("DepartmentLaborSection.tsx"));
  assert.match(ui, /useEmployeesPeriod\(\)/);
  assert.match(ui, /Search department/);
  assert.match(ui, /width: 40,\s*height: 40,\s*borderRadius: 12/);
  assert.match(ui, /aria-label="Filter departments"/);
  assert.match(ui, /Show all \$\{/);
  assert.match(ui, /Fully loaded \(incl\. EPF\) — matches Payroll/);
  assert.match(ui, /Unavailable/);
  assert.ok(!/method:|mutateJson|fetch\(/.test(ui + hook), "read-only");
  const route = strip(src("EmployeesRoute.tsx"));
  assert.match(route, /section === "department-labor" \? <DepartmentLaborSection \/> : null/);
});
