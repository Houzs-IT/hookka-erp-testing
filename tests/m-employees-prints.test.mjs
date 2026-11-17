// m-employees-prints.test.mjs — HK-0125: the printable reports behind the Employees "..." menus, and the Payroll CSV. Each builder mirrors
// the desktop Employees page's handlePrint / exportCSV for the same tab. Sample values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  departmentLaborPrint,
  departmentPerformancePrint,
  efficiencyPrint,
  employeePerformancePrint,
  laborCostPrint,
  printEffColor,
  rangeLabel,
} from "../src/pages/m/screens/employees/menu-prints.ts";
import { CSV_HEADERS, csvFileName, payrollCsv, payrollPrint } from "../src/pages/m/screens/employees/payroll-prints.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, "");
const range = { from: "2026-11-01", to: "2026-11-13" };
const headers = (doc, i = 0) => doc.sections[i].columns.map((c) => c.header);
const txt = (c) => (typeof c === "object" ? c.text : String(c));

// ---- Efficiency Overview ------------------------------------------------------------------------------------------------------------

const eff = (o) => ({ workerId: "w", name: "Ann Lee", empNo: "EMP-001", totalHours: 40, days: 5, prodHours: 38, nonProdHours: 2, earnedMin: 2280, eff: 100, rank: 1, reason: null, chips: [], ...o });

test("Efficiency print: desktop's title, columns, cards and colours (green from 100, amber from 60, red below)", () => {
  const rows = [eff({}), eff({ workerId: "w2", name: "Bob", empNo: "EMP-002", eff: 50, earnedMin: 1000, rank: 2 }), eff({ workerId: "w3", name: "Cy", empNo: "", eff: null, earnedMin: null, rank: null, totalHours: 0, days: 0, prodHours: 0, nonProdHours: 0 })];
  const d = efficiencyPrint(rows, range);
  assert.equal(d.title, "Efficiency Overview");
  assert.equal(d.filterSummary, "01/11/2026 – 13/11/2026");
  assert.deepEqual(headers(d), ["Employee", "Total", "Production Time", "Prod Hrs", "Non-Prod Hrs", "Efficiency %", "Days"]);
  assert.deepEqual(d.cards.map((c) => c.label), ["Workers", "Present", "Total Working Hours", "Avg Efficiency"]);
  assert.deepEqual(d.cards.map((c) => c.value), ["3", "2 / 3", "80.0h", "75.0%"]);
  assert.equal(txt(d.sections[0].rows[0][0]), "EMP-001 — Ann Lee");
  assert.equal(d.sections[0].rows[0][1], "40.0h (5d)");
  assert.equal(d.sections[0].rows[0][2], "38h");
  assert.equal(d.sections[0].rows[0][5].color, "#15803D");
  assert.equal(d.sections[0].rows[1][5].color, "#9A3A2D");
  assert.equal(d.sections[0].rows[2][5], "—", "no valid personal efficiency -> a dash");
  assert.equal(d.sections[0].rows[2][1], "—");
  assert.equal(d.sections[0].rows[2][0], "Cy", "no employee number -> just the name");
  assert.equal(printEffColor(60), "#9C6F1E");
  assert.equal(rangeLabel("2026-11-13", "2026-11-13"), "13/11/2026");
});

// ---- Department Labor ------------------------------------------------------------------------------------------------------------------

const dl = (o) => ({ deptCode: "UPH", deptName: "Upholstery", isProduction: true, totalHours: 100, workerIds: ["a", "b"], costSen: 500000, laborSen: 450000, underSen: 50000, sofaSen: 300000, bedframeSen: 150000, accessorySen: 0, catTotalSen: 450000, ...o });

test("Department Labor print: the payroll split columns only in payroll mode; 'Estimated Labor Cost' otherwise; money withheld when unavailable", () => {
  const rows = [dl({}), dl({ deptCode: "WH", deptName: "Warehousing", isProduction: false, totalHours: 0, workerIds: [], costSen: 0, laborSen: 0, underSen: 0, sofaSen: 0, bedframeSen: 0, catTotalSen: 0 })];
  const pay = departmentLaborPrint({ rows, mode: "payroll", range, category: "" });
  assert.equal(pay.orientation, "landscape");
  assert.equal(pay.filterSummary, "01/11/2026 – 13/11/2026 · All categories");
  assert.deepEqual(headers(pay), ["Department", "Total Hours", "Workers", "Sofa", "Bedframe", "Accessory", "Category Total", "Labor (incl. EPF)", "Under-recorded", "Total"]);
  assert.equal(pay.sections[0].rows[0][0], "Upholstery (Prod)");
  assert.equal(pay.sections[0].rows[1][0], "Warehousing (Non-prod)");
  assert.equal(pay.sections[0].rows[1][1], "—");
  assert.equal(pay.sections[0].rows[0][5], "—", "a zero category prints a dash");
  const est = departmentLaborPrint({ rows, mode: "estimate", range, category: "SOFA" });
  assert.equal(headers(est).at(-1), "Estimated Labor Cost");
  assert.ok(!headers(est).includes("Labor (incl. EPF)"));
  assert.match(est.filterSummary, /Sofa$/);
  const off = departmentLaborPrint({ rows, mode: "unavailable", range, category: "" });
  assert.deepEqual(headers(off), ["Department", "Total Hours", "Workers"]);
});

// ---- Employee Performance -------------------------------------------------------------------------------------------------------------

test("Employee Performance print: the six desktop cards in order and the Daily Breakdown rows (Total JC Time, COMPLETED in green)", () => {
  const tiles = ["38h", "2h", "—", "95.0%", "5", "1h 30m"].map((v) => ({ v }));
  const rowsIn = [
    { key: "a", primary: "Sofa 3S", secondary: "", date: "2026-11-10", completedDate: "2026-11-10", dept: "UPH", deptName: "Upholstery", qty: 2, creditedMin: 60, totalMin: 120, shared: true, status: "COMPLETED", statusLabel: "Completed" },
    { key: "b", primary: "Bed K", secondary: "", date: "2026-11-09", completedDate: "", dept: "FRM", deptName: "Framing", qty: null, creditedMin: 30, totalMin: 30, shared: false, status: "OTHER", statusLabel: "WAITING_UPHOLSTERY" },
  ];
  const d = employeePerformancePrint({ workerLabel: "EMP-001 — Ann Lee", range, tiles, effPct: 95, rows: rowsIn });
  assert.equal(d.title, "Employee Performance");
  assert.equal(d.subtitle, "EMP-001 — Ann Lee");
  assert.deepEqual(d.cards.map((c) => c.label), ["Production Hrs", "Non-Production Hrs", "Extra Production Time", "Efficiency", "Days Present", "Total OT"]);
  assert.deepEqual(d.cards.map((c) => c.value), ["38h", "2h", "—", "95.0%", "5", "1h 30m"]);
  assert.equal(d.cards[3].color, "#9C6F1E");
  assert.deepEqual(headers(d), ["Date", "Product / Item", "Completion Date", "Department", "Qty", "Total JC Time", "Status"]);
  assert.deepEqual(d.sections[0].rows[0].slice(0, 6), ["10/11/2026", "Sofa 3S", "10/11/2026", "UPH", 2, "2h"]);
  assert.deepEqual(d.sections[0].rows[0][6], { text: "COMPLETED", color: "#15803D", bold: true });
  assert.equal(d.sections[0].rows[1][2], "—");
  assert.equal(d.sections[0].rows[1][4], "—");
});

// ---- Department Performance -------------------------------------------------------------------------------------------------------------

test("Department Performance print: this tab's filters, every day bold with its workers indented beneath, colours at 80 / 60", () => {
  const daily = [
    { date: "2026-11-10", workingMinutes: 600, productionMinutes: 540, efficiencyPct: 90, workers: [{ workerId: "w1", workerName: "Ann", workingMinutes: 300, productionMinutes: 150, efficiencyPct: 50 }, { workerId: "w2", workerName: "Bob", workingMinutes: 0, productionMinutes: 0, efficiencyPct: 0 }] },
  ];
  const d = departmentPerformancePrint({ totals: { workingMinutes: 600, productionMinutes: 540, efficiencyPct: 90, workerCount: 2 }, daily, range, deptLabel: "Upholstery", category: "SOFA" });
  assert.equal(d.filterSummary, "01/11/2026 – 13/11/2026 · Upholstery · Sofa");
  assert.deepEqual(d.cards.map((c) => c.label), ["Workers", "Total Working Hrs", "Total Production Hrs", "Avg Efficiency"]);
  assert.equal(d.cards[3].color, "#4F7C3A");
  assert.deepEqual(headers(d), ["Date / Worker", "Working Hrs", "Production Hrs", "Efficiency %"]);
  const rows = d.sections[0].rows;
  assert.deepEqual(rows[0][0], { text: "10/11/2026", bold: true });
  assert.equal(rows[1][0].text, "    ↳ Ann");
  assert.equal(rows[1][3].color, "#9A3A2D");
  assert.equal(rows[2][3].text, "—", "no working minutes -> a dash, not 0%");
  assert.equal(departmentPerformancePrint({ totals: null, daily: [], range, deptLabel: "", category: "" }).filterSummary.endsWith("All departments · All categories"), true);
});

// ---- Labor Cost ------------------------------------------------------------------------------------------------------------------------

const lc = (o) => ({ id: "x", deptCode: "UPH", deptName: "Upholstery", category: "SOFA", hours: 100, costSen: 300000, revenueSen: 1000000, isProduction: true, isShortfall: false, isWarehousing: false, ...o });
const lcResult = (mode = "ok") => ({ mode, production: [lc({}), lc({ category: "BEDFRAME", costSen: 400000, revenueSen: 1000000 })], overhead: [lc({ isProduction: false, isWarehousing: true, costSen: 20000 }), lc({ isProduction: false, isShortfall: true, costSen: 10000 })], productionSen: 700000, overheadSen: 30000 });

test("Labor Cost print: revenue columns print ONLY with revenue-figures:read (the printout never carries what the screen withholds)", () => {
  const withRev = laborCostPrint({ result: lcResult(), range, category: "", canSeeRevenue: true });
  const noRev = laborCostPrint({ result: lcResult(), range, category: "", canSeeRevenue: false });
  assert.equal(withRev.title, "Labor Cost vs Revenue");
  assert.deepEqual(headers(withRev), ["Department", "Category", "Hours", "Labor Cost", "Category Revenue", "Cost / Revenue"]);
  assert.deepEqual(headers(noRev), ["Department", "Category", "Hours", "Labor Cost", "Cost / Revenue"]);
  assert.ok(!JSON.stringify(noRev).includes("10,000.00"), "no revenue figure anywhere in the document");
  assert.ok(JSON.stringify(withRev).includes("10,000.00"));
  assert.equal(withRev.sections[0].rows[0][1], "Sofa");
  assert.deepEqual(withRev.sections[0].rows[0].at(-1), { text: "30.0%", color: "#15803D", bold: true });
  assert.deepEqual(withRev.sections[0].rows[1].at(-1), { text: "40.0%", color: "#9A3A2D", bold: true }, "35% and over is red");
  assert.deepEqual(withRev.cards.map((c) => c.label), ["Production Labor Cost", "Borrowed (Warehousing)", "Shortfall", "Overhead (not in Production Labor Cost)"]);
  assert.deepEqual(withRev.cards.map((c) => c.value.replace(/\s/g, " ")), ["RM 7,000.00", "RM 200.00", "RM 100.00", "RM 300.00"]);
  const off = laborCostPrint({ result: lcResult("unavailable"), range, category: "SOFA", canSeeRevenue: false });
  assert.equal(off.sections[0].rows[0][3], "Unavailable");
  assert.match(off.filterSummary, /Sofa$/);
});

// ---- Payroll print + CSV ----------------------------------------------------------------------------------------------------------------

const slip = (o = {}) => ({
  id: "p1", employeeId: "w1", employeeName: "Ann Lee", employeeNo: "EMP-001", departmentCode: "UPH_FAB", period: "2026-10", basicSalary: 260000, workingDays: 26, absentDays: 2,
  absenceDeductionSen: 20000, shortHourDeductionSen: 3200, totalOT: 10000, grossPay: 245000, epfEmployee: 29700, epfEmployer: 35100, socsoEmployee: 725, socsoEmployer: 2535, eisEmployee: 390, eisEmployer: 390,
  pcb: 5000, pcbStatus: "COMPUTED", netPay: 190000, status: "APPROVED", advanceDeductionSen: 30000, penaltyDeductionSen: 5000, hourlyRate: 1000, otWeekdayHours: 4, otSundayHours: 0, otPHHours: 0, otWeekdayAmount: 6000,
  otSundayAmount: 0, otPHAmount: 0, allowances: 0, totalDeductions: 35815, bankAccount: "MBB 1", absentDates: ["2026-10-14", "2026-10-15"], otDays: [{ date: "2026-10-06", hours: 4 }], lateDays: [{ date: "2026-10-09", hours: 0.5 }], ...o,
});
const bob = slip({ id: "p2", employeeId: "w2", employeeName: 'Bob, "B" Tan', employeeNo: "EMP-002", pcbStatus: "UNKNOWN", pcb: 0, advanceDeductionSen: 0, penaltyDeductionSen: 0, absentDays: 0, absenceDeductionSen: 0, shortHourDeductionSen: 0, lateDays: [], absentDates: [], otDays: [] });

test("Payroll print: desktop's 22 columns without the RM prefix, cards for advances / penalties only when present, PCB total flagged when incomplete", () => {
  const d = payrollPrint([slip(), bob], "October 2026", false);
  assert.equal(d.title, "Payroll");
  assert.equal(d.subtitle, "All amounts in RM");
  assert.equal(d.dense, true);
  assert.equal(d.orientation, "landscape");
  assert.equal(d.filterSummary, "October 2026");
  assert.equal(headers(d).length, 22);
  assert.deepEqual(headers(d).slice(0, 7), ["Employee", "Dept", "Basic", "Days", "Absent", "Absence", "Late/Short"]);
  assert.equal(headers(d).at(-1), "Status");
  const r = d.sections[0].rows[0];
  assert.equal(r[2], "2,600.00", "no 'RM ' prefix");
  assert.equal(r[1], "UPH FAB");
  assert.equal(r[4], "2d");
  assert.equal(r[5], "−200.00");
  assert.equal(r[6], "−32.00 (1d)");
  assert.equal(r[17], "50.00");
  assert.equal(d.sections[0].rows[1][17], "-", "an uncomputed PCB prints a dash");
  assert.deepEqual(r[20], { text: "1,900.00", bold: true });
  assert.deepEqual(d.cards.map((c) => c.label), ["Still To Pay Out", "Advances Already Paid", "Worker Penalties", "Total EPF (EE+ER)", "Total SOCSO", "Total EIS", "Total PCB"]);
  assert.equal(d.cards.at(-1).value, "— not computed");
  const calm = payrollPrint([bob], "October 2026", true);
  assert.deepEqual(calm.cards.map((c) => c.label), ["Still To Pay Out", "Total EPF (EE+ER)", "Total SOCSO", "Total EIS", "Total PCB"]);
  assert.equal(calm.filterSummary, "October 2026 · Estimate (month in progress)");
});

const parseCsvLine = (line) => {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
};

test("Payroll CSV: desktop's columns in desktop's order; advance dates and penalty references from the two lists; PCB blank when never computed; quoted cells", () => {
  assert.equal(csvFileName("2026-10"), "payroll-2026-10.csv");
  const csv = payrollCsv([slip(), bob], [{ workerId: "w1", date: "2026-10-12", amountSen: 30000 }], [{ workerId: "w1", penaltyNo: "PEN-1", poNo: "PO-9", amountSen: 5000 }]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], CSV_HEADERS.join(","));
  const H = (name) => CSV_HEADERS.indexOf(name);
  const a = parseCsvLine(lines[1]);
  const b = parseCsvLine(lines[2]);
  assert.equal(a.length, CSV_HEADERS.length, "every row has one cell per header");
  assert.equal(b.length, CSV_HEADERS.length, "a quoted comma does not split the row");
  assert.equal(b[H("Employee Name")], 'Bob, "B" Tan');
  assert.equal(a[H("Basic Salary")], "2600.00");
  assert.equal(a[H("Absence Formula")], "2600.00 / 26 days x 2 = 200.00");
  assert.equal(a[H("Absent Dates")], "2026-10-14 2026-10-15");
  assert.equal(a[H("Late/Short Formula")], "0.5h x 64.00/h = 32.00");
  assert.equal(a[H("Late/Short Days")], "2026-10-09 0.5h");
  assert.equal(a[H("OT Days")], "2026-10-06 4h");
  assert.equal(a[H("Basic Earned")], "2480.00".replace("2480.00", ((260000 - 20000 - 3200 - Math.max(0, 260000 - 20000 - 3200 - (245000 - 10000))) / 100).toFixed(2)));
  assert.equal(a[H("PCB")], "50.00");
  assert.equal(b[H("PCB")], "", "never computed -> blank, not 0.00");
  assert.equal(a[H("Advance Taken")], "300.00");
  assert.equal(a[H("Advance Dates")], "2026-10-12 300.00");
  assert.equal(a[H("Worker Penalty")], "50.00");
  assert.equal(a[H("Penalty Refs")], "PEN-1 (PO-9) 50.00");
  assert.equal(a[H("Net Pay")], "1900.00");
  assert.equal(a[H("Bank Account")], "MBB 1");
  assert.equal(b[H("Advance Taken")], "");
  assert.ok(!/NaN|undefined/.test(csv));
  // a role without the two lists still exports: just the reference cells are blank, the amounts stay
  const bare = parseCsvLine(payrollCsv([slip()], [], []).split("\n")[1]);
  assert.equal(bare[H("Advance Taken")], "300.00");
  assert.equal(bare[H("Advance Dates")], "");
  assert.equal(bare[H("Penalty Refs")], "");
});

// ---- wiring -----------------------------------------------------------------------------------------------------------------------------

test("sections register their menu actions through the bridge, each gated by what the section already requires", () => {
  const dlSec = strip(src("DepartmentLaborSection.tsx"));
  assert.match(dlSec, /window\.open\("", "_blank"\)/, "the QR poster window is opened inside the tap");
  assert.match(dlSec, /printDeptQrPoster\(window\.open/);
  assert.match(dlSec, /if \(!bridge \|\| !data\.allowed\) return/);
  const lcSec = strip(src("LaborCostSection.tsx"));
  assert.match(lcSec, /canSeeRevenue: data\.canRevenue/);
  assert.match(lcSec, /hasPermission\("payslips", "update"\)/);
  assert.match(lcSec, /hasPermission\("payslips", "create"\)/);
  assert.match(strip(src("EmployeePerformanceSection.tsx")), /const printable = !!worker && cards !== null/);
  assert.match(strip(src("EfficiencySection.tsx")), /efficiencyPrint\(found, range\)/);
  const pay = strip(src("PayrollSection.tsx"));
  for (const k of ['"export-csv"', "print:", '"calc-guide"']) assert.ok(pay.includes(k), k);
  assert.match(pay, /hasPermission\("worker-penalties", "read"\)/, "penalty references only where the right exists");
});

test("the desktop poster and guide live in shared files and the desktop page uses them (one format, no copy to drift)", () => {
  const desktop = readFileSync(new URL("../src/pages/employees.tsx", import.meta.url), "utf8");
  assert.match(desktop, /from "@\/lib\/dept-qr-poster"/);
  assert.match(desktop, /from "@\/lib\/calc-guide"/);
  assert.ok(!/Department QR Codes - Hookka/.test(desktop), "the poster HTML is no longer in the desktop page");
  const poster = readFileSync(new URL("../src/lib/dept-qr-poster.ts", import.meta.url), "utf8");
  assert.match(poster, /Department QR Codes - Hookka/);
  assert.match(poster, /const w = win \?\? window\.open\("", "_blank"\)/);
  assert.match(poster, /one card per full A4 page|One card per FULL A4 page/i);
  const guide = readFileSync(new URL("../src/lib/calc-guide.ts", import.meta.url), "utf8");
  assert.match(guide, /Salary Calculation Guide/);
});

test("printing and exporting write nothing", () => {
  for (const f of ["menu-prints.ts", "run-print.ts", "payroll-prints.ts"]) {
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)["']|mutateJson/.test(strip(src(f))), `${f} makes no write`);
  }
});
