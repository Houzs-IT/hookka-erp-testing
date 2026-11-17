// m-employees-payslip.test.mjs — HK-0125 Phase 6b: the Payroll payslip detail page. Sample values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  advanceChips,
  dayGroups,
  daysWorked,
  head,
  hourlyFormula,
  otLines,
  partMonthSen,
  pcbNote,
  penaltyChips,
  periodEnd,
  statutoryRows,
  summaryRows,
  verifiedMultiplier,
} from "../src/pages/m/screens/employees/payslip-detail-model.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, "");

const P = (o = {}) => ({
  id: "p1", employeeId: "w1", employeeName: "Ann Lee", employeeNo: "EMP-001", departmentCode: "UPH", period: "2026-10", status: "APPROVED",
  basicSalary: 260000, workingDays: 26, absentDays: 0, absenceDeductionSen: 0, shortHourDeductionSen: 0, hourlyRate: 1000,
  otWeekdayHours: 4, otWeekdayAmount: 6000, otSundayHours: 3, otSundayAmount: 6000, otPHHours: 0, otPHAmount: 0, totalOT: 12000, allowances: 0,
  grossPay: 272000, epfEmployee: 29920, epfEmployer: 35360, socsoEmployee: 725, socsoEmployer: 2535, eisEmployee: 390, eisEmployer: 390,
  pcb: 5000, pcbStatus: "COMPUTED", totalDeductions: 36035, netPay: 235965, bankAccount: "MBB 1234567890", ...o,
});

test("an OT multiplier is shown ONLY when hours × rate × multiplier reproduces the server's amount to the sen", () => {
  assert.equal(verifiedMultiplier(4, 944, 5664), 1.5, "9.44 × 1.5 × 4 = 56.64");
  assert.equal(verifiedMultiplier(3, 1000, 6000), 2);
  assert.equal(verifiedMultiplier(2, 1000, 6000), 3);
  assert.equal(verifiedMultiplier(4, 944, 5600), null, "5,600 is not 944 × 4 × any clean multiplier");
  assert.equal(verifiedMultiplier(4, 1000, 5480), null, "an amount that only roughly fits is not verified");
  assert.equal(verifiedMultiplier(0, 1000, 6000), null, "stored hours rounded away: unverified");
  assert.equal(verifiedMultiplier(4, 0, 6000), null);
  assert.equal(verifiedMultiplier(4, 1000, 0), null);
  assert.equal(verifiedMultiplier(1, 1000, 100), null, "below 1× is not an OT multiplier");
});

test("OT lines: the multiplier appears per line only when verified; otherwise hours and the hourly rate", () => {
  const lines = otLines(P({ otWeekdayHours: 4, otWeekdayAmount: 6000, otSundayHours: 3, otSundayAmount: 6100, otPHHours: 0, otPHAmount: 700 }));
  assert.deepEqual(lines.map((l) => l.key), ["Weekday OT", "Sunday OT", "PH OT"]);
  assert.equal(lines[0].text, "4 hrs × RM 10.00 × 1.5");
  assert.equal(lines[0].amount, "RM 60.00");
  assert.equal(lines[1].text, "3 hrs · RM 10.00/hr", "6,100 does not reproduce from 3 × 1,000: no multiplier is shown");
  assert.equal(lines[2].text, "under 1 hr · RM 10.00/hr", "hours stored as 0 but an amount exists");
  assert.equal(otLines(P({ otWeekdayHours: 0, otWeekdayAmount: 0 }))[0].text, "0 hrs · RM 10.00/hr");
});

test("the hourly-rate formula is shown only when it reproduces the server's rate", () => {
  const ctx = { versions: [], hoursPerDay: 9 };
  assert.equal(hourlyFormula(P(), ctx), "RM 2,600.00 ÷ (26 × 10)", "default pay rules: hour divisor = 9 h + 1 h lunch");
  assert.equal(hourlyFormula(P({ hourlyRate: 1100 }), ctx), null, "the server's rate differs: no formula");
  assert.equal(hourlyFormula(P(), { versions: null, hoursPerDay: 9 }), null, "pay rules not readable");
  assert.equal(hourlyFormula(P(), { versions: [], hoursPerDay: 9, dailyPaid: true }), null);
  assert.equal(hourlyFormula(P({ workingDays: 0 }), ctx), null);
  assert.equal(periodEnd("2026-02"), "2026-02-28");
  assert.equal(periodEnd("2026-10"), "2026-10-31");
});

test("Pay Summary uses the server's amounts, in the HTML's order; absent lines are left out", () => {
  const plain = summaryRows(P());
  assert.deepEqual(plain.map((r) => r.k), ["Days worked", "Basic Salary", "Total OT", "Gross Pay", "Less: Deductions", "Net Pay", "Bank Account"]);
  assert.equal(plain[0].v, "26 of 26");
  assert.equal(plain[3].v, "RM 2,720.00");
  assert.equal(plain[4].v, "(RM 360.35)");
  assert.equal(plain[5].v, "RM 2,359.65");
  assert.equal(plain[6].v, "MBB 1234567890");
  const full = summaryRows(P({ absentDays: 2, absenceDeductionSen: 20000, shortHourDeductionSen: 3200, allowances: 5000, advanceDeductionSen: 50000, penaltyDeductionSen: 5000, grossPay: 252000, totalOT: 12000, basicSalary: 260000, netPay: -1234 }));
  assert.deepEqual(full.map((r) => r.k), ["Days worked", "Basic Salary", "Less: Absence (2d)", "Less: Late / short hours", "Less: Part-month", "Total OT", "Allowances", "Gross Pay", "Less: Deductions", "Less: Salary advance already taken", "Less: Worker penalty", "Net Pay", "Bank Account"].filter((k) => k !== "Less: Part-month" || partMonthSen(P({ absentDays: 2, absenceDeductionSen: 20000, shortHourDeductionSen: 3200, allowances: 5000, grossPay: 252000, totalOT: 12000 })) > 1));
  assert.equal(full.find((r) => r.k === "Days worked").v, "24 of 26");
  const net = full.find((r) => r.k === "Net Pay");
  assert.deepEqual([net.v, net.vc], ["RM -12.34", "#9A3A2D"], "a negative Net Pay is preserved and red");
  assert.equal(daysWorked(P({ absentDays: 30 })), 0, "never negative");
});

test("part-month is desktop's derived legacy line (> 1 sen only)", () => {
  assert.equal(partMonthSen(P({ grossPay: 272000, totalOT: 12000, basicSalary: 260000 })), 0);
  assert.equal(partMonthSen(P({ grossPay: 200000, totalOT: 12000, basicSalary: 260000 })), 72000);
  assert.ok(summaryRows(P({ grossPay: 200000 })).some((r) => r.k === "Less: Part-month"));
  assert.ok(!summaryRows(P()).some((r) => r.k === "Less: Part-month"));
});

test("Piece wages show only when the API provides a figure", () => {
  assert.ok(!summaryRows(P()).some((r) => r.k === "Piece wages"), "absent (staging)");
  assert.ok(!summaryRows(P({ pieceWagesSen: null })).some((r) => r.k === "Piece wages"));
  assert.ok(!summaryRows(P({ pieceWagesSen: 0 })).some((r) => r.k === "Piece wages"));
  const row = summaryRows(P({ pieceWagesSen: 123456 })).find((r) => r.k === "Piece wages");
  assert.equal(row.v, "RM 1,234.56");
});

test("statutory: employee in red, employer in teal; an uncomputed PCB reads '—' with desktop's note", () => {
  const rows = statutoryRows(P());
  assert.deepEqual(rows.map((r) => r.k), ["EPF Employee", "EPF Employer", "SOCSO Employee", "SOCSO Employer", "EIS Employee", "EIS Employer", "PCB (Tax)"]);
  assert.deepEqual([rows[0].vc, rows[1].vc], ["#9A3A2D", "#3E6570"]);
  assert.equal(rows[6].v, "RM 50.00");
  assert.equal(pcbNote(P()), "");
  const none = P({ pcb: 0, pcbStatus: "UNKNOWN" });
  assert.equal(statutoryRows(none)[6].v, "—");
  assert.match(pcbNote(none), /could not be computed/);
  assert.equal(statutoryRows(P({ pcb: 0, pcbStatus: "ZERO_PROVEN" }))[6].v, "RM 0.00", "a proven zero is a figure");
});

test("Day Detail: absent days, overtime days, late / short days; an empty group says so", () => {
  const g = dayGroups(P({ absentDates: ["2026-10-04", "2026-10-11"], otDays: [{ date: "2026-10-06", hours: 2 }], lateDays: [] }));
  assert.deepEqual(g.map((x) => x.k), ["Absent", "Overtime", "Late / short"]);
  assert.deepEqual(g[0].items, ["4 Oct", "11 Oct"]);
  assert.deepEqual(g[1].items, ["6 Oct · 2h"]);
  assert.deepEqual(g[2].items, []);
  assert.equal(g[2].none, "No late or short days");
  assert.deepEqual(dayGroups(P()).map((x) => x.items.length), [0, 0, 0], "fields absent on an older response are simply empty");
});

test("advance chips and penalty chips (desktop's rules)", () => {
  assert.deepEqual(advanceChips([{ workerId: "w1", date: "2026-10-12", amountSen: 50000 }, { workerId: "w2", date: "2026-10-13", amountSen: 1 }], "w1"), ["Advance 12 Oct · RM 500.00"]);
  const pens = [
    { penaltyNo: "PEN-2610-004", poNo: "PO-2610-217", status: "APPROVED", lines: [{ workerId: "w1", amountSen: 5000, payrollPeriod: "2026-10" }, { workerId: "w1", amountSen: 999, payrollPeriod: "2026-09" }] },
    { penaltyNo: "PEN-2610-005", poNo: "", status: "POSTED", lines: [{ workerId: "w1", amountSen: 2500, payrollPeriod: "2026-10" }] },
    { penaltyNo: "PEN-2610-006", poNo: "PO-1", status: "DRAFT", lines: [{ workerId: "w1", amountSen: 7000, payrollPeriod: "2026-10" }] },
    { penaltyNo: "PEN-2610-007", poNo: "PO-2", status: "APPROVED", lines: [{ workerId: "w2", amountSen: 1000, payrollPeriod: "2026-10" }] },
  ];
  assert.deepEqual(penaltyChips(pens, "w1", "2026-10"), ["PEN-2610-004 · PO-2610-217 · RM 50.00", "PEN-2610-005 · RM 25.00"]);
});

test("header and top card: name, 'EMP - dept · month', Net Pay (red when negative), Total Pay", () => {
  const h = head(P(), "October 2026");
  assert.equal(h.name, "Ann Lee");
  assert.equal(h.sub, "EMP-001 - UPH · October 2026");
  assert.equal(h.net, "RM 2,359.65");
  assert.equal(h.total, "RM 3,102.85");
  assert.equal(head(P({ netPay: -100 }), "x").netFg, "#9A3A2D");
});

test("wiring: a card pushes the payslip into the URL so Back keeps the month, search and filters; read-only; no Print; extras gated", () => {
  const list = strip(src("PayrollSection.tsx"));
  assert.match(list, /p\.set\("pay", id\);\s*return p;\s*\}\);/, "opening pushes a history entry (no replace)");
  assert.match(list, /window\.history\.state\?\.idx \?\? 0\) > 0\) navigate\(-1\)/, "Back returns to the previous entry, the list as it was");
  assert.match(list, /p\.delete\("pay"\)/, "with no earlier entry Back just removes the payslip");
  assert.match(list, /payId && open \? <PayslipPage/);
  assert.match(strip(src("payroll-model.ts")), /PAY_PARAMS = \["pm", "pq", "pst", "pdp", "pdd", "pay"\]/, "the payslip is dropped when you leave the tab");
  const page = strip(src("PayslipPage.tsx"));
  assert.ok(!/Print/i.test(page), "no Print action");
  assert.match(page, /Net Pay/);
  assert.match(page, /OT Calculation/);
  assert.match(page, /Statutory Deductions/);
  assert.match(page, /Pay Summary/);
  assert.match(page, /Day Detail/);
  const hook = strip(src("use-payslip-detail.ts"));
  assert.match(hook, /Number\(row\.advanceDeductionSen\) > 0 && hasPermission\("payslips", "read"\)/, "advance dates only with the permission and only when there is an advance");
  assert.match(hook, /Number\(row\.penaltyDeductionSen\) > 0 && hasPermission\("worker-penalties", "read"\)/, "penalty references only with worker-penalties:read");
  assert.match(hook, /hasPermission\("workers", "read"\)/, "the formula check needs the worker's hours per day");
  assert.ok(!/method:|mutateJson|fetch\(/.test(page + hook + strip(src("payslip-detail-model.ts"))), "read-only");
});

test("the existing payslip route from Employee Detail is untouched and nothing here links to it", () => {
  const modules = readFileSync(new URL("../src/pages/m/config/modules.ts", import.meta.url), "utf8");
  assert.match(modules, /export const payslipsConfig: ModuleConfig = \{/);
  assert.match(modules, /url: \(id\) => `\/api\/payslips\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(modules, /href: pid \? `\/m\/payslips\/\$\{encodeURIComponent\(pid\)\}` : undefined/, "Employee Detail still links /m/payslips/:id");
  const mine = ["PayrollSection.tsx", "PayslipPage.tsx", "use-payslip-detail.ts", "payslip-detail-model.ts"].map((f) => strip(src(f))).join("\n");
  assert.ok(!/\/m\/payslips/.test(mine), "the in-Employees page does not use (or replace) that route");
});
