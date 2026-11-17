// m-employees-payroll.test.mjs — HK-0125 Phase 6a: Employees → Payroll, the LIST. Sample values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cards,
  currentMonth,
  deptOptions,
  deductionOk,
  filterCount,
  labelOfMonth,
  matches,
  monthsOfYear,
  parseDeduction,
  parseMonth,
  payView,
  payslipRows,
  statusTone,
  statutorySheet,
  stripCells,
  totalPayOf,
  totalPaySheet,
  totalsOf,
  wantEstimate,
  workerCells,
} from "../src/pages/m/screens/employees/payroll-model.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, "");

const TODAY = "2026-11-17";
const P = (o = {}) => ({
  id: "p1", employeeId: "w1", employeeName: "Ann Lee", employeeNo: "EMP-001", departmentCode: "UPH", period: "2026-10",
  basicSalary: 260000, workingDays: 26, absentDays: 0, absenceDeductionSen: 0, shortHourDeductionSen: 0, totalOT: 10000,
  grossPay: 270000, epfEmployee: 29700, epfEmployer: 35100, socsoEmployee: 725, socsoEmployer: 2535, eisEmployee: 390, eisEmployer: 390,
  pcb: 5000, pcbStatus: "COMPUTED", netPay: 234185, status: "APPROVED", advanceDeductionSen: 0, penaltyDeductionSen: 0, ...o,
});
const ann = P();
const bob = P({ id: "p2", employeeId: "w2", employeeName: "Bob Tan", employeeNo: "EMP-002", departmentCode: "FRM", grossPay: 200000, basicSalary: 200000, totalOT: 0, epfEmployee: 22000, epfEmployer: 26000, socsoEmployee: 725, socsoEmployer: 2535, eisEmployee: 390, eisEmployer: 390, pcb: 0, pcbStatus: "UNKNOWN", netPay: -5000, status: "DRAFT", advanceDeductionSen: 90000 });

test("Total Pay = Gross + employer EPF / SOCSO / EIS; a worker card's Total Pay is the same sum", () => {
  assert.equal(totalPayOf(ann), 270000 + 35100 + 2535 + 390);
  const t = totalsOf([ann, bob]);
  assert.equal(t.totalPay, totalPayOf(ann) + totalPayOf(bob));
  assert.equal(t.gross, 470000);
  assert.equal(t.net, 234185 - 5000);
  assert.equal(t.count, 2);
});

test("Statutory (all) = EPF + SOCSO + EIS (employee + employer) + PCB; incomplete PCB is flagged, never hidden", () => {
  const t = totalsOf([ann, bob]);
  const expected = [ann, bob].reduce((s, p) => s + p.epfEmployee + p.epfEmployer + p.socsoEmployee + p.socsoEmployer + p.eisEmployee + p.eisEmployer + p.pcb, 0);
  assert.equal(t.statutory, expected);
  assert.equal(t.pcbComplete, false, "Bob's PCB was never worked out (UNKNOWN)");
  assert.equal(totalsOf([ann]).pcbComplete, true);
  assert.equal(totalsOf([P({ pcb: 0, pcbStatus: "ZERO_PROVEN" })]).pcbComplete, true, "a proven zero is a figure");
  assert.equal(totalsOf([P({ pcb: 0, pcbStatus: null })]).pcbComplete, false, "a payslip from before PCB existed has no figure");
  assert.equal(totalsOf([P({ pcb: 0, pcbStatus: "DISABLED" })]).pcbComplete, false);
  const stat = cards(t).find((c) => c.key === "stat");
  assert.equal(stat.sub, "PCB not computed yet");
  assert.equal(stat.subFg, "#9A3A2D");
  assert.equal(cards(totalsOf([ann])).find((c) => c.key === "stat").sub, "");
  const sheet = statutorySheet(t);
  assert.deepEqual(sheet.rows.map((r) => r.k), ["EPF (EE + ER)", "SOCSO (EE + ER)", "EIS (EE + ER)", "PCB"]);
  assert.equal(sheet.rows[3].v, "Not computed");
  assert.equal(statutorySheet(totalsOf([ann])).rows[3].v, "RM 50.00");
});

test("the four cards, in the HTML's order; only Total Pay and Statutory open a sheet; Net Pay stays negative and red", () => {
  const c = cards(totalsOf([ann, bob]));
  assert.deepEqual(c.map((x) => x.l), ["Total Pay", "Gross Pay", "Net Pay", "Statutory (all)"]);
  assert.deepEqual(c.map((x) => x.tap), [true, false, false, true]);
  assert.equal(c[2].fg, "#1F1D1B", "the month's net is positive");
  const neg = cards(totalsOf([bob]));
  assert.equal(neg[2].v, "RM -50.00");
  assert.equal(neg[2].fg, "#9A3A2D");
  const sheet = totalPaySheet(totalsOf([ann, bob]));
  assert.deepEqual(sheet.rows.map((r) => r.k), ["Gross Pay", "Employer EPF", "Employer SOCSO", "Employer EIS"]);
  assert.equal(sheet.note, "RM 900.00 of this already paid as advances");
  assert.equal(totalPaySheet(totalsOf([ann])).note, "");
});

test("worker card cells: Basic, Days (the payslip's own working days), OT Amt, Gross, Net Pay (red when negative), Total Pay", () => {
  const cells = workerCells(bob);
  assert.deepEqual(cells.map((c) => c.k), ["Basic (RM)", "Days", "OT Amt", "Gross", "Net Pay", "Total Pay"]);
  assert.equal(cells[1].v, "26");
  assert.deepEqual([cells[4].v, cells[4].fg], ["RM -50.00", "#9A3A2D"], "negative Net Pay is preserved");
  assert.equal(workerCells(ann)[4].fg, "#1F1D1B");
  assert.equal(workerCells(ann)[5].v, "RM 3,080.25");
});

test("the status is the one the API returns, with the HTML colours", () => {
  assert.deepEqual(statusTone("DRAFT"), { label: "DRAFT", bg: "#F3F4F6", fg: "#374151" });
  assert.deepEqual(statusTone("approved"), { label: "APPROVED", bg: "#E0EDF0", fg: "#3E6570" });
  assert.deepEqual(statusTone("PAID"), { label: "PAID", bg: "#EEF3E4", fg: "#4F7C3A" });
  assert.equal(statusTone("VOID").label, "VOID", "an unknown status is shown as returned");
});

// ---- the month ---------------------------------------------------------------------------------------------------------------------

test("the Payroll month is its own: current Malaysia month by default; a future or malformed month falls back", () => {
  assert.equal(currentMonth(TODAY), "2026-11");
  assert.equal(parseMonth(null, TODAY), "2026-11");
  assert.equal(parseMonth("2026-10", TODAY), "2026-10");
  assert.equal(parseMonth("2026-12", TODAY), "2026-11", "future months are not selectable");
  assert.equal(parseMonth("2019-12", TODAY), "2026-11");
  assert.equal(parseMonth("2026-13", TODAY), "2026-11");
  assert.equal(parseMonth("garbage", TODAY), "2026-11");
  assert.equal(labelOfMonth("2026-10"), "October 2026");
  const months = monthsOfYear(2026, TODAY);
  assert.equal(months.length, 12);
  assert.deepEqual(months.filter((m) => m.disabled).map((m) => m.month), [12], "only months after the current one are disabled");
  assert.equal(monthsOfYear(2027, TODAY).every((m) => m.disabled), true);
  assert.equal(monthsOfYear(2025, TODAY).some((m) => m.disabled), false);
});

test("Estimate: ONLY the current Malaysia month, ONLY after the stored request succeeded with zero records; a failed request is an error", () => {
  const ok = (rows) => ({ rows, loading: false, error: false });
  const none = { rows: null, loading: false, error: false };
  // stored has records → stored, never an estimate
  assert.equal(payView("2026-11", TODAY, ok([ann]), none).kind, "stored");
  assert.equal(wantEstimate("2026-11", TODAY, ok([ann])), false);
  // current month, stored empty → request the estimate
  assert.equal(wantEstimate("2026-11", TODAY, ok([])), true);
  assert.equal(payView("2026-11", TODAY, ok([]), none).kind, "loading", "estimate not back yet");
  assert.deepEqual(payView("2026-11", TODAY, ok([]), ok([ann])).kind, "estimate");
  assert.equal(payView("2026-11", TODAY, ok([]), ok([])).kind, "empty", "a month with no estimate either is empty");
  // the stored request FAILED: an error, and no estimate is requested
  const failed = { rows: null, loading: false, error: true };
  assert.deepEqual(payView("2026-11", TODAY, failed, none), { kind: "error", what: "payslips" });
  assert.equal(wantEstimate("2026-11", TODAY, failed), false);
  // the estimate request failed
  assert.deepEqual(payView("2026-11", TODAY, ok([]), failed), { kind: "error", what: "estimate" });
  // a past month with nothing stored is simply empty; a future / other month never asks for an estimate
  assert.equal(payView("2026-10", TODAY, ok([]), none).kind, "empty");
  assert.equal(wantEstimate("2026-10", TODAY, ok([])), false);
  assert.equal(wantEstimate("2026-12", TODAY, ok([])), false);
  // while the stored request is still loading nothing is decided
  assert.equal(payView("2026-11", TODAY, { rows: null, loading: true, error: false }, none).kind, "loading");
  assert.equal(wantEstimate("2026-11", TODAY, { rows: [], loading: true, error: false }), false);
  assert.equal(payslipRows({ success: false }), null, "a degraded body is not an empty list");
  assert.deepEqual(payslipRows({ data: [] }), []);
});

// ---- search, filters, the total strip ------------------------------------------------------------------------------------------------

const many = [
  ann, bob,
  ...Array.from({ length: 6 }, (_, i) => P({ id: "x" + i, employeeId: "x" + i, employeeName: "Worker " + i, employeeNo: "EMP-0" + (10 + i), departmentCode: i % 2 ? "FRM" : "UPH", status: i < 3 ? "PAID" : "DRAFT", absenceDeductionSen: i === 4 ? 8000 : 0, shortHourDeductionSen: i === 5 ? 1200 : 0, penaltyDeductionSen: i === 1 ? 5000 : 0, grossPay: 100000 })),
];
const F = (o = {}) => ({ q: "", st: "all", dept: "all", ded: "all", ...o });

test("search by name or employee number; status, department and deduction filters combine", () => {
  assert.deepEqual(many.filter((p) => matches(p, F({ q: "ann" }))).map((p) => p.id), ["p1"]);
  assert.deepEqual(many.filter((p) => matches(p, F({ q: "emp-002" }))).map((p) => p.id), ["p2"]);
  assert.equal(many.filter((p) => matches(p, F({ st: "DRAFT" }))).length, 4, "Bob + three drafts");
  assert.equal(many.filter((p) => matches(p, F({ dept: "FRM" }))).length, 4);
  assert.deepEqual(many.filter((p) => matches(p, F({ ded: "abs" }))).map((p) => p.id), ["x4"]);
  assert.deepEqual(many.filter((p) => matches(p, F({ ded: "late" }))).map((p) => p.id), ["x5"]);
  assert.deepEqual(many.filter((p) => matches(p, F({ ded: "adv" }))).map((p) => p.id), ["p2"]);
  assert.deepEqual(many.filter((p) => matches(p, F({ ded: "pen" }))).map((p) => p.id), ["x1"]);
  assert.deepEqual(many.filter((p) => matches(p, F({ st: "DRAFT", dept: "FRM", ded: "late" }))).map((p) => p.id), ["x5"]);
  assert.deepEqual(many.filter((p) => matches(p, F({ st: "DRAFT", dept: "UPH", ded: "late" }))).map((p) => p.id), [], "all three conditions must hold");
  assert.equal(deductionOk(ann, "all"), true);
  assert.equal(parseDeduction("abs"), "abs");
  assert.equal(parseDeduction("x"), "all");
  assert.equal(filterCount(F({ q: "ann" })), 0, "the search is not a filter chip");
  assert.equal(filterCount(F({ st: "PAID", dept: "UPH", ded: "abs" })), 3);
});

test("the TOTAL strip and the worker count follow the search and filters across ALL matches, not just the first five; the four cards do not", () => {
  const monthTotals = totalsOf(many);
  const list = many.filter((p) => matches(p, F({ st: "DRAFT" })));
  assert.equal(list.length, 4);
  const strip = totalsOf(list);
  assert.equal(strip.count, 4);
  assert.equal(strip.gross, list.reduce((s, p) => s + p.grossPay, 0));
  assert.notEqual(strip.gross, monthTotals.gross, "the strip is the filtered subset");
  assert.equal(cards(monthTotals)[1].v, cards(totalsOf(many))[1].v, "the cards are the whole month");
  // more than five matches: every one is in the strip
  const all = many.filter((p) => matches(p, F()));
  assert.equal(all.length, 8);
  assert.equal(totalsOf(all).count, 8);
  assert.deepEqual(stripCells(totalsOf(all)).map((c) => c.k), ["Basic", "OT Amt", "Gross", "Statutory", "Net Pay", "Total Pay"]);
  assert.deepEqual(deptOptions(many, (c) => ({ UPH: "Upholstery", FRM: "Framing" })[c]).map((d) => d.name), ["Framing", "Upholstery"]);
});

// ---- wiring ------------------------------------------------------------------------------------------------------------------------------

test("wiring: existing endpoints and gate, the estimate request rule, the HTML's states and controls, read-only, the worker card opens its payslip", () => {
  const hook = strip(src("use-payroll.ts"));
  assert.match(hook, /hasPermission\("payslips", "read"\)/);
  assert.match(hook, /\/api\/payslips\?period=\$\{month\}/);
  assert.match(hook, /wantEstimate\(month, today, storedReq\) \? `\/api\/payslips\/projected\?period=\$\{month\}`/, "the estimate is requested only by the model's rule");
  assert.match(hook, /\/api\/departments/);
  const ui = strip(src("PayrollSection.tsx"));
  assert.match(ui, /parseMonth\(params\.get\("pm"\), today\)/, "its own month, not the shared period");
  assert.ok(!/useEmployeesPeriod/.test(ui), "Payroll does not use the shared period");
  assert.match(ui, /Payroll month: \$\{label\}\. Change/);
  assert.match(ui, /Search name or employee no\./);
  assert.match(ui, /aria-label="Filter workers"/);
  assert.match(ui, /Show all \$\{list\.length\} workers/);
  assert.match(ui, /No workers match these filters\./);
  assert.match(ui, /Reset filters/);
  assert.match(ui, /No payslip records for \$\{label\}\./);
  assert.match(ui, /Payslips are generated on desktop\./);
  assert.match(ui, /Couldn't load payslips for \$\{label\}\./);
  assert.match(ui, /Couldn't load the estimate for \$\{label\}\./);
  assert.match(ui, /data\.view\.kind === "estimate" \?/);
  assert.match(ui, /No access to Payroll/);
  assert.match(ui, /Needs payslips:read\./);
  assert.ok(ui.includes("onClick={() => (p.id ? openPayslip(p.id) : undefined)}"), "a worker card opens its payslip (6b)");
  const sheets = strip(src("PayrollSheets.tsx"));
  assert.match(sheets, /Show \{n\} worker\{n === 1 \? "" : "s"\}/);
  assert.match(sheets, /Payroll month/);
  assert.ok(!/method:|mutateJson|fetch\(/.test(ui + hook + sheets), "read-only");
  const route = strip(src("EmployeesRoute.tsx"));
  assert.match(route, /section === "payroll" \? <PayrollSection \/> : null/);
  assert.match(route, /\.\.\.PAY_PARAMS/);
});
