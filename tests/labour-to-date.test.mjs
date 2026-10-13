// ---------------------------------------------------------------------------
// labour-to-date.test.mjs — the running month's labour TO DATE on the P&L and
// the finance dashboard (owner 2026-10-12 「任何的 payroll 还没 confirm 都拿这个
// 新卡显示的数据可以吗？就算我的 pnl, dashboard 这些」→「做」).
//
// The figure is the Labor Cost page's "Labor Cost incl. EPF & Allowances" card
// for a month still running, split by each worker's home department and by
// EPF / SOCSO / EIS. A finished month keeps its payslips; a recorded month
// keeps the ledger.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const td = await import(pathToFileURL(resolve(process.cwd(), "src/lib/labour-to-date.ts")).href);
const pr = await import(pathToFileURL(resolve(process.cwd(), "src/lib/pay-rules.ts")).href);

const API = readFileSync(resolve(process.cwd(), "src/api/routes/accounting.ts"), "utf8").replace(/\r\n/g, "\n");
const PROJ = readFileSync(resolve(process.cwd(), "src/api/lib/labour-projection.ts"), "utf8").replace(/\r\n/g, "\n");

const worker = (id, dept, basic, extra = {}) => [id, {
  id, departmentCode: dept, basicSalarySen: basic, effectiveSalarySen: basic,
  workingHoursPerDay: 9, workingDaysPerMonth: 26, otMultiplier: 1.5, payMode: null, dailyRateSen: null, ...extra,
}];
const slip = (id, employeeId, dept, extra = {}) => ({
  id, employeeId, departmentCode: dept, basicSalarySen: 0, absentDays: 0, absenceDeductionSen: 0,
  otWeekdayHours: 0, otSundayHours: 0, otPhHours: 0, totalOtSen: 0, allowancesSen: 0, grossPaySen: 0,
  epfEmployerSen: 0, socsoEmployerSen: 0, eisEmployerSen: 0, ...extra,
});
const FACTORY = new Set(["FAB_SEW", "UPHOLSTERY", "REPAIR"]);

test("October 2026: logged hours at cost + allowances & statutory pro-rated + office pro-rated whole, trued to the card", () => {
  // October 2026 has 27 working days (Mon–Sat, no holidays). Logged Thu 1st
  // (9 h) and Fri 2nd (10 h, 1 h OT at 1.5×) → 2 of 27 days logged.
  const out = td.computeLabourToDate({
    ym: "2026-10",
    entries: [
      { workerId: "a", date: "2026-10-01", hours: 9, departmentCode: "FAB_SEW", category: "SOFA" },
      { workerId: "a", date: "2026-10-02", hours: 10, departmentCode: "FAB_SEW", category: "sofa" },
    ],
    workers: new Map([worker("a", "FAB_SEW", 260000), worker("b", "OFFICE", 300000)]),
    payslips: [
      slip("pa", "a", "FAB_SEW", { basicSalarySen: 260000, allowancesSen: 15000, grossPaySen: 275000, epfEmployerSen: 3380 }),
      slip("pb", "b", "OFFICE", { basicSalarySen: 300000, grossPaySen: 300000, epfEmployerSen: 39000 }),
    ],
    deductions: [], holidays: [], payRuleVersions: [], factoryDeptCodes: FACTORY,
  });
  // Logged: 9 × 260000/27/9 + (9 × 260000/27/9 + 1 × 260000/26/9 × 1.5) = 20925.93 → one bucket → 20926.
  // Pro-rated: (15000 + 3380 + 300000 + 39000) × 2/27 = 26472.59 → 26473.
  assert.equal(out.totalSen, 20926 + 26473);
  assert.equal(out.asOf, "2026-10-02");
  assert.equal(out.loggedDays, 2);
  assert.equal(out.monthDays, 27);
  // Home-department split, EPF on its own line; the 1 sen of rounding sits on the biggest line.
  assert.deepEqual(out.byDept, [
    { departmentCode: "FAB_SEW", workers: 1, nonStatutorySen: 22037, epfSen: 250, socsoSen: 0, eisSen: 0 },
    { departmentCode: "OFFICE", workers: 1, nonStatutorySen: 22223, epfSen: 2889, socsoSen: 0, eisSen: 0 },
  ]);
  const sum = out.byDept.reduce((s, d) => s + d.nonStatutorySen + d.epfSen + d.socsoSen + d.eisSen, 0);
  assert.equal(sum, out.totalSen);
});

test("the pay-vs-cost bridges already in a payslip: absent days, OT, docked hours", () => {
  const S = 205000;
  const versions = [];
  const cfg = pr.resolvePayRulesAsOf(versions, "2026-10-31");
  const dockDay = pr.payrollDayRateSen(S, { workingDaysPerMonth: 26, calendarDays: 31, workingDaysInMonth: 27 }, cfg);
  const dockSen = Math.round(2 * pr.payrollHourRateSen(dockDay, 9, cfg));
  const out = td.computeLabourToDate({
    ym: "2026-10",
    entries: [{ workerId: "u", date: "2026-10-01", hours: 9, departmentCode: "UPHOLSTERY", category: "SOFA" }],
    workers: new Map([worker("u", "UPHOLSTERY", S)]),
    payslips: [slip("pu", "u", "UPHOLSTERY", {
      basicSalarySen: S, grossPaySen: S, absentDays: 2, absenceDeductionSen: Math.round((2 * S) / 26),
      otWeekdayHours: 6, totalOtSen: 7529,
    })],
    deductions: [{ workerId: "u", hours: 2 }],
    holidays: [], payRuleVersions: versions, factoryDeptCodes: FACTORY,
  });
  const logged = Math.round((9 * S) / 27 / 9);
  const absence = Math.round((2 * S) / 27) - Math.round((2 * S) / 26);
  const ot = 7529 - Math.round(6 * 1.5 * (S / 26 / 9));
  const dock = Math.max(0, Math.round((2 * S) / 27 / 9) - dockSen);
  assert.equal(out.totalSen, logged + absence + ot + dock);
  assert.ok(absence < 0, "a 27-working-day month docks an absent day above its cost");
});

test("a daily-paid person costs the day rate split across the day's entries; hours with no payslip stay on the worker's department", () => {
  const out = td.computeLabourToDate({
    ym: "2026-10",
    entries: [
      { workerId: "d", date: "2026-10-05", hours: 4, departmentCode: "UPHOLSTERY", category: "SOFA" },
      { workerId: "d", date: "2026-10-05", hours: 4, departmentCode: "REPAIR", category: "" },
    ],
    workers: new Map([worker("d", "UPHOLSTERY", 0, { payMode: "DAILY", dailyRateSen: 12000 })]),
    payslips: [], deductions: [], holidays: [], payRuleVersions: [], factoryDeptCodes: FACTORY,
  });
  assert.equal(out.totalSen, 12000);
  assert.deepEqual(out.byDept, [{ departmentCode: "UPHOLSTERY", workers: 1, nonStatutorySen: 12000, epfSen: 0, socsoSen: 0, eisSen: 0 }]);
  assert.equal(out.byWorker.get("d"), 12000);
});

test("nothing logged in the month yet → nothing to carry", () => {
  assert.equal(td.computeLabourToDate({
    ym: "2026-10", entries: [{ workerId: "a", date: "2026-09-30", hours: 9, departmentCode: "FAB_SEW", category: "SOFA" }],
    workers: new Map(), payslips: [], deductions: [], holidays: [], payRuleVersions: [], factoryDeptCodes: FACTORY,
  }), null);
});

test("the running month is decided on Malaysia time, like the Labor Cost page", () => {
  assert.equal(td.runningMonthYm(Date.UTC(2026, 9, 31, 15, 59)), "2026-10"); // 23:59 MYT, 31 Oct
  assert.equal(td.runningMonthYm(Date.UTC(2026, 9, 31, 16, 0)), "2026-11"); // 00:00 MYT, 1 Nov
});

test("the P&L's report-layer labour carries labour to date for the running month only", () => {
  const fn = API.slice(API.indexOf("async function labourInjectionLines("), API.indexOf("async function labourInjectionLines(") + 3500);
  assert.match(fn, /if \(ym === runningMonthYm\(\)\) \{/);
  assert.match(fn, /const td = await loadLabourToDate\(db, orgId, ym\);/);
  assert.match(fn, /grossSen: d\.nonStatutorySen,/);
  assert.match(fn, /labourDebitLines\(tdByDept, tdMap\)/);
  // Unreadable → the whole-month figures, as before.
  assert.match(fn, /catch \{ \/\* unreadable → the whole-month figures below, as before \*\/ \}/);
});

test("the dashboard's salary stacks for the running month are labour to date too", () => {
  assert.match(API, /toDateRun = await loadLabourToDate\(db, orgIdDash, runYmDash\)/);
  assert.match(API, /salByMonth\.set\(\n\s*runYmDash,/);
  assert.match(API, /for \(const \[wid, sen\] of toDateRun\.byWorker\) costByYmWorker\.set\(`\$\{runYmDash\}::\$\{wid\}`, sen\);/);
  assert.match(API, /const DASH_PAYLOAD_V = "v(1[6-9]|[2-9]\d)";/); // v16 or later
  assert.match(API, /"departments",\n\s*"pay_rule_versions",/);
});

test("the projection's per-department figure is the sum of its per-worker payslips", () => {
  assert.match(PROJ, /export async function projectedPayslipsForMonth\(/);
  assert.match(PROJ, /for \(const p of await projectedPayslipsForMonth\(db, period\)\) \{/);
  assert.match(PROJ, /grossPaySen: labor\.payroll\.grossSen \+ allowances,/);
});
