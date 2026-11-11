// m-home-employees.test.mjs — the /m Home Employees view. The maths in emp-lib.ts is a copy of the desktop's
// (EmployeesDashboard / NonProdHoursCard / AttendanceLogCard keep it inside component bodies, so it cannot be imported).
// These are PARITY tests: fixed fixtures whose expected numbers are worked out by hand from the desktop's formulas, so a
// drift in either copy shows here. They are unit tests over pure logic and over the source; NOT authenticated API runs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  eff, ratio, effColor, hrs, pct, buildWindow, rosterOf, presenceOn, sumWindow, headlineOf, workerRows, rankSplit, deptRowsOf, deptTotalOf, foldProgressive,
  npData, npChartPoints, mainChartPoints, lateMin, labourStateOf, dayLog, monthLog, loggedUnder, mainAxis, axisLabelIdx, shiftDay, dLab, dShort, deptWorkers, costCentreName,
} from "../src/pages/m/screens/dashboard/emp-lib.ts";
import { DASHBOARD_VIEWS, effectivePeriod, viewAllowsDay } from "../src/pages/m/screens/dashboard/home-lib.ts";
import { AMBER, GREEN, MUTED, RED } from "../src/pages/dashboards/dashboard-shared-lib.ts";

const read = (p) => readFileSync(new URL(`../src/pages/m/screens/dashboard/${p}`, import.meta.url), "utf8");
const EMP_FILES = ["EmpView.tsx", "HomeEmpA.tsx", "HomeEmpB.tsx", "HomeEmpSheets.tsx", "emp-lib.ts", "emp-data.ts", "emp-model.ts", "emp-rows.ts", "emp-ui.tsx"];

// ---- fixture -----------------------------------------------------------------------------------------------------------
const W = (id, name, dept, extra = {}) => ({ id, name, dept, empNo: id.toUpperCase(), role: null, countsToHeadcount: true, ...extra });
const workers = [
  W("a", "Ann", "UPHOLSTERY"), W("b", "Bob", "PACKING"), W("c", "Cy Outsourced", "UPHOLSTERY", { empNo: "OSC-9" }),
  W("d", "Dee Viewer", "PACKING"), W("e", "Eve", "UPHOLSTERY", { countsToHeadcount: false }),
];
const att = (id, date, clockIn, clockOut = "17:00") => ({ employeeId: id, employeeName: workers.find((w) => w.id === id).name, dept: "X", date, clockIn, clockOut, workingMinutes: 0, productionMinutes: 0, overtimeMinutes: 0, efficiencyPct: null });
const attendance = [
  att("a", "2026-10-01", "07:55"), att("b", "2026-10-01", "08:30"), att("c", "2026-10-01", "07:50"),
  att("a", "2026-10-02", "07:58"), att("b", "2026-10-02", "07:59"), att("c", "2026-10-02", "07:50"),
  att("a", "2026-10-05", "09:00"),
];
const dw = (workerId, workingMinutes, productionMinutes, allDeptMinutes) => ({ workerId, workingMinutes, productionMinutes, allDeptMinutes });
const byDay = [
  { date: "2026-10-01", workingMinutes: 1080, productionMinutes: 1000, workers: [dw("a", 480, 500, 540), dw("b", 480, 400, 480), dw("c", 120, 100, 120)] },
  { date: "2026-10-02", workingMinutes: 960, productionMinutes: 1000, workers: [dw("a", 480, 480, 480), dw("b", 480, 480, 600)] },
  { date: "2026-10-04", workingMinutes: 0, productionMinutes: 0, workers: [] }, // a Sunday with nothing
  { date: "2026-10-05", workingMinutes: 480, productionMinutes: 520, workers: [dw("a", 480, 430, 480)] },
];
const slice = { workers, attendance, performance: { byDay } };
const monthly = { mode: "monthly", month: "2026-10" };

// ---- efficiency band (decision 1: configured target x 0.85, desktop colours) ---------------------------------------------
test("efficiency band: green at target, amber from 85% of the configured target, red below, muted when empty", () => {
  assert.equal(effColor(100, 100), GREEN);
  assert.equal(effColor(99.9, 100), AMBER);
  assert.equal(effColor(85, 100), AMBER);
  assert.equal(effColor(84.9, 100), RED);
  assert.equal(effColor(null, 100), MUTED);
  // a different configured target moves the band with it (80 -> amber from 68)
  assert.equal(effColor(80, 80), GREEN);
  assert.equal(effColor(68, 80), AMBER);
  assert.equal(effColor(67.9, 80), RED);
  assert.equal(AMBER, "#9C6F1E", "the verified desktop amber");
});

test("formatting: hours, percent, ratios", () => {
  assert.equal(eff(50, 100), 50);
  assert.equal(eff(1, 0), null);
  assert.equal(ratio(1, 0), null);
  assert.equal(hrs(90), "1.5 h");
  assert.equal(pct(null), "—");
  assert.equal(pct(99.94), "99.9%");
  assert.equal(shiftDay("2026-10-01", -1), "2026-09-30");
  assert.equal(dLab("2026-10-29"), "Thu 29 Oct");
  assert.equal(dShort("2026-10-29"), "29 Oct");
});

// ---- roster, outsourced, presence ----------------------------------------------------------------------------------------
test("roster = headcount, not outsourced, has ever clocked; outsourced and view-only logins are never absent", () => {
  const { roster, outsourced } = rosterOf(slice);
  assert.deepEqual(roster.map((w) => w.id), ["a", "b"]);
  assert.deepEqual([...outsourced], ["c"]);
  const p = presenceOn(slice, roster, "2026-10-05");
  assert.equal(p.present, 1);
  assert.deepEqual(p.absent.map((w) => w.id), ["b"]);
});

// ---- window --------------------------------------------------------------------------------------------------------------
test("window: Day picks that day, 7 days ends on the anchor, Whole period is every day; anchor = picked day else latest with hours", () => {
  const days = byDay;
  const whole = buildWindow(days, monthly, "period");
  assert.equal(whole.anchor, "2026-10-05");
  assert.equal(whole.winDates.size, 4);
  const d7 = buildWindow(days, monthly, "7d");
  assert.deepEqual([...d7.winDates].sort(), ["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05"]);
  const latest = buildWindow(days, monthly, "day");
  assert.deepEqual([...latest.winDates], ["2026-10-05"]);
  const picked = buildWindow(days, { ...monthly, day: "2026-10-02" }, "period");
  assert.equal(picked.dayMode, true);
  assert.equal(picked.effWin, "day", "a page Day overrides the window switch");
  assert.deepEqual([...picked.winDates], ["2026-10-02"]);
  assert.equal(picked.label, "Fri 2 Oct");
});

// ---- headline ------------------------------------------------------------------------------------------------------------
test("headline: FTE = worker-days / working days with outsourced excluded; outsourced cost and hours stay in the totals", () => {
  const cost = new Map([["a|2026-10-01", 10000], ["b|2026-10-01", 8000], ["c|2026-10-01", 3000], ["a|2026-10-02", 10000], ["b|2026-10-02", 8000]]);
  const rev = new Map([["2026-10-01", { total: 50000 }], ["2026-10-02", { total: 30000 }]]);
  const t = sumWindow(byDay, () => true, cost, new Set(["c"]), rev);
  assert.equal(t.workerDays, 5, "a,b on the 1st and 2nd; c is outsourced; the 5th adds a");
  assert.equal(t.workingDays, 3);
  assert.equal(t.sen, 39000, "outsourced cost still counted");
  assert.equal(t.work, 1080 + 960 + 0 + 480);
  assert.equal(t.revenue, 80000);
  const h = headlineOf({ totals: t, prev: null, costByDept: new Map(), winDates: new Set(byDay.map((d) => d.date)), revenueKnown: true });
  assert.equal(h.winSalary, 39000, "no per-department cost loaded -> the day total");
  assert.ok(Math.abs(h.fte - 5 / 3) < 1e-9);
  assert.ok(Math.abs(h.labourPct - (39000 / 80000) * 100) < 1e-9);
  assert.ok(Math.abs(h.revPerFte - 80000 / (5 / 3)) < 1e-9);
  const dept = new Map([["a|2026-10-01|UPHOLSTERY", 5000], ["a|2026-10-02|UPHOLSTERY", 7000]]);
  assert.equal(headlineOf({ totals: t, prev: null, costByDept: dept, winDates: new Set(["2026-10-01"]), revenueKnown: true }).winSalary, 5000, "the per-department total narrows to the window");
  assert.equal(headlineOf({ totals: t, prev: null, costByDept: new Map(), winDates: new Set(), revenueKnown: false }).revPerFte, null, "no revenue answer is not zero revenue");
});

test("headline: last-month comparison is per worker-day and only against a month with revenue", () => {
  const cur = { work: 0, prod: 0, sen: 100, workerDays: 10, workingDays: 5, fte: 2, revenue: 2000 };
  const prev = { work: 0, prod: 0, sen: 600, workerDays: 20, workingDays: 10, fte: 2, revenue: 3000 };
  const h = headlineOf({ totals: cur, prev, costByDept: new Map(), winDates: new Set(), revenueKnown: true });
  assert.equal(h.revPerDay, 200);
  assert.equal(h.prevRevPerDay, 150);
  assert.ok(Math.abs(h.revChange - 33.333333) < 1e-4);
  assert.equal(h.prevLabourPct, 20);
  assert.equal(headlineOf({ totals: cur, prev: { ...prev, revenue: 0 }, costByDept: new Map(), winDates: new Set(), revenueKnown: true }).prevRevPerDay, null);
});

// ---- ranking -------------------------------------------------------------------------------------------------------------
test("ranking: 60-minute floor, outsourced never ranked, halves split with ceil, department filter touches rows only", () => {
  const wb = new Map(workers.map((w) => [w.id, w]));
  const all = new Set(byDay.map((d) => d.date));
  const rows = workerRows(byDay, all, wb, "ALL", new Map());
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c"], "sorted by efficiency: 97.9, 91.7, 83.3");
  const s = rankSplit(rows, new Set(["c"]));
  assert.equal(s.ranked.length, 2);
  assert.equal(s.half, 1);
  assert.equal(s.upper.length, 1);
  assert.equal(s.lower.length, 1);
  assert.deepEqual(s.outsourcedRows.map((r) => r.id), ["c"]);
  assert.equal(rankSplit([{ id: "z", name: "Z", dept: "X", work: 59, prod: 59, cost: 0, daysWorked: 1, byDay: [] }], new Set()).unranked.length, 1);
  assert.deepEqual(workerRows(byDay, all, wb, "PACKING", new Map()).map((r) => r.id), ["b"]);
});

// ---- department efficiency -----------------------------------------------------------------------------------------------
test("department table: production departments first by efficiency, cost centres after, UNLINKED row, hours split by logged department", () => {
  const wb = new Map(workers.map((w) => [w.id, w]));
  const winDates = new Set(["2026-10-01"]);
  const entries = [
    { workerId: "a", date: "2026-10-01", hours: 6, departmentCode: "UPHOLSTERY" }, { workerId: "a", date: "2026-10-01", hours: 2, departmentCode: "PACKING" },
    { workerId: "b", date: "2026-10-01", hours: 8, departmentCode: "WAREHOUSING" },
  ];
  const costByDept = new Map([["a|2026-10-01|UPHOLSTERY", 600], ["a|2026-10-01|PACKING", 200], ["b|2026-10-01|WAREHOUSING", 800]]);
  const prog = foldProgressive({ "UPHOLSTERY|BEDFRAME": 70000, "UPHOLSTERY|SOFA": 30000, "PACKING|ACCESSORY": 5000 });
  const rows = deptRowsOf({ days: byDay, winDates, workerById: wb, costByWorkerDay: new Map(), costByDept, hourEntries: entries, progByDept: prog, outsourced: new Set(["c"]) });
  const up = rows.find((r) => r.dept === "UPHOLSTERY");
  const pk = rows.find((r) => r.dept === "PACKING");
  assert.equal(up.work, 480 * 0.75 + 120, "a's 480 clocked minutes split 6h : 2h; outsourced c's 120 stay in the hours");
  assert.equal(pk.work, 480 * 0.25 + 480, "b logged only a cost centre, so b falls back to the home department");
  assert.equal(up.bf, 70000);
  assert.equal(up.sofa, 30000);
  assert.equal(pk.sofa, 5000, "ACCESSORY folds into the Sofa column, as on the desktop");
  assert.equal(up.cost, 600);
  assert.ok(up.people.has("a") && !up.people.has("c"), "outsourced workers are not counted as people");
  assert.ok(rows.some((r) => r.dept === "WAREHOUSING") && rows.findIndex((r) => r.dept === "WAREHOUSING") > rows.findIndex((r) => r.dept === "UPHOLSTERY"), "a cost centre comes after the production departments");
  const t = deptTotalOf(rows);
  assert.equal(t.bf, 70000);
  assert.equal(costCentreName("R_AND_D"), "R&D");
  // the day totals carry production nobody earned -> its own row
  const unl = deptRowsOf({ days: [{ date: "2026-10-09", workingMinutes: 60, productionMinutes: 90, workers: [dw("a", 60, 60)] }], winDates: new Set(["2026-10-09"]), workerById: wb, costByWorkerDay: new Map(), costByDept: new Map(), hourEntries: [], progByDept: new Map(), outsourced: new Set() });
  assert.equal(unl.find((r) => r.dept === "UNLINKED").prod, 30);
  const { list, hoursHere } = deptWorkers(workerRows(byDay, winDates, wb, "ALL", new Map()), entries, winDates, "WAREHOUSING");
  assert.deepEqual(list.map((r) => r.id), ["b"]);
  assert.equal(hoursHere.get("b"), 8);
});

// ---- non-production ------------------------------------------------------------------------------------------------------
test("non-production = all-department clocked minus production-department minutes; logged-under reads non-floor entries only", () => {
  const wb = new Map(workers.map((w) => [w.id, w]));
  const n = npData(byDay, new Set(byDay.map((d) => d.date)), wb);
  assert.equal(n.total, 60 + 120);
  assert.deepEqual(n.people.map((p) => p.id), ["b", "a"]);
  assert.equal(n.people[0].days, 1);
  assert.equal(n.clocked, 540 + 480 + 120 + 480 + 600 + 480);
  const pts = npChartPoints(byDay);
  assert.equal(pts.find((p) => p.date === "2026-10-02").hours, 2);
  assert.ok(!pts.some((p) => p.date === "2026-10-04"), "an idle Sunday is left out");
  const entries = [{ workerId: "b", date: "2026-10-02", hours: 2, departmentCode: "R_AND_D" }, { workerId: "b", date: "2026-10-02", hours: 6, departmentCode: "PACKING" }];
  assert.equal(loggedUnder(entries, new Set(["2026-10-02"]), "b"), "R&D 2.0h");
});

test("main chart drops an idle Sunday and keeps minutes; axis ticks follow the approved design", () => {
  const pts = mainChartPoints(byDay, new Map([["a|2026-10-01", 123]]));
  assert.deepEqual(pts.map((p) => p.date), ["2026-10-01", "2026-10-02", "2026-10-05"]);
  assert.equal(pts[0].cost, 123);
  assert.equal(pts[0].eff, (1000 / 1080) * 100);
  assert.deepEqual(mainAxis(pts).pTicks, [0, 35, 70, 105, 130]);
  assert.deepEqual(mainAxis([{ date: "d", workingMin: 60, productionMin: 60, eff: 160, cost: 0 }]).pTicks.at(-1), 160, "an efficiency above 130% widens the axis instead of clipping");
  assert.equal(axisLabelIdx(3).size, 3);
  assert.ok(axisLabelIdx(30).size <= 8);
});

// ---- attendance ----------------------------------------------------------------------------------------------------------
test("late minutes count from the 08:00 shift start", () => {
  assert.equal(lateMin("08:30"), 30);
  assert.equal(lateMin("07:55"), 0);
  assert.equal(lateMin("2026-10-01T09:05:00"), 65);
  assert.equal(lateMin(null), 0);
});

test("day log: not in first, late second, on time last; outsourced records are listed but never absent", () => {
  const l = dayLog(slice, "2026-10-01");
  assert.equal(l.absent, 0);
  assert.equal(l.late, 1);
  assert.equal(l.groups.late[0].d, "08:30 · 30m late");
  assert.deepEqual(l.rows.map((r) => r.name), ["Bob", "Ann", "Cy Outsourced"]);
  const l5 = dayLog(slice, "2026-10-05");
  assert.equal(l5.absent, 1);
  assert.equal(l5.rows[0].name, "Bob");
  assert.equal(l5.rows[0].absent, true);
  assert.equal(l5.late, 1, "Ann clocked in at 09:00");
});

test("month log: a day before a person's first clock-in is not an absence; most absent first", () => {
  const joiner = { ...slice, attendance: [...attendance, att("b", "2026-10-05", "07:50")] };
  const ml = monthLog(joiner, "2026-10");
  assert.equal(ml.workDays, 3);
  const bob = ml.rows.find((r) => r.id === "b");
  assert.equal(bob.notIn, 0);
  assert.equal(monthLog(slice, "2026-10").rows.find((r) => r.id === "b").notIn, 1);
  assert.equal(monthLog(slice, "2026-10").rows[0].id, "b");
  assert.ok(!ml.rows.some((r) => r.id === "c"), "outsourced workers are not listed");
});

// ---- salary state: every non-answer has its own name, a fallback is never "ready" -------------------------------------------
const L = (o) => labourStateOf({ canSalary: true, failureStatuses: [], ready: true, wkRows: 5, heRows: 40, inputsReady: true, ...o });
test("salary state: a settled empty answer is NONE (not zero), a failed input is ERROR, a missing permission is DENIED", () => {
  assert.equal(L({}), "ready");
  assert.equal(L({ canSalary: false }), "denied");
  assert.equal(L({ heRows: 0, ready: false }), "none", "no hour entries is not RM 0.00");
  assert.equal(L({ wkRows: 0, ready: false }), "none", "no workers is not RM 0.00");
  assert.equal(L({ failureStatuses: [500] }), "error");
  assert.equal(L({ failureStatuses: [0] }), "error", "a network failure has status 0 and is still a failure");
  assert.equal(L({ failureStatuses: [500, 403] }), "denied", "a 403 on any input is a permission, said as such");
  assert.equal(L({ ready: false }), "loading");
});

test("salary state: a figure computed while an input is still unanswered (pay rules / holidays / rates fall back) is never READY", () => {
  assert.equal(L({ inputsReady: false }), "loading", "useLabourCost already holds a number built on default pay rules, but it is not shown as actual");
  assert.equal(L({ inputsReady: false, ready: false }), "loading");
  assert.equal(L({ inputsReady: false, failureStatuses: [503] }), "error", "a failed pay-rules request ends the wait with an error, not a fallback figure");
  assert.equal(L({ heRows: null, wkRows: null, ready: false }), "loading", "nothing answered yet");
});

test("Employees reads every input of the salary and gives a failure its own wording", () => {
  const d = read("emp-data.ts");
  for (const u of ["/api/pay-rules", "/api/kv-config/public_holidays", "/api/workers/salary/effective", "/api/workers", "/api/working-hour-entries"]) assert.ok(d.includes(u), `${u} is read`);
  assert.match(d, /inputsReady: !!rules\.data && !!hol\.data && rates\.ready/);
  const m = read("emp-model.ts");
  assert.match(m, /labourState === "none" \? "empty"/);
  assert.match(m, /No hour entries logged for this window/);
  assert.match(m, /Could not load \$\{money\.labourWhy/);
  const a = read("HomeEmpA.tsx");
  assert.match(a, /m\.salaryNote \?\?/);
  const h = read("HomeDashboard.tsx");
  assert.match(h, /Could not load the Employees dashboard\./);
  assert.doesNotMatch(h.slice(h.indexOf("onPeople ? (")), /list of months/ , "Employees no longer borrows the Sales / Operations wording");
});

// ---- shell + gating (source guards) --------------------------------------------------------------------------------------
test("Employees is built and is a Day view on the same period rule as Operations", () => {
  assert.equal(DASHBOARD_VIEWS.find((v) => v.key === "people").built, true);
  assert.equal(viewAllowsDay("people"), true);
  const day = { mode: "monthly", month: "2026-10", day: "2026-10-23" };
  assert.equal(effectivePeriod("people", day).day, "2026-10-23");
  assert.equal(effectivePeriod("sales", day).day, undefined, "Sales still reads the month");
  assert.equal(effectivePeriod("people", { mode: "ytd", month: "2026-10", day: "2026-10-23" }).day, undefined);
});

test("HomeDashboard mounts Employees beside Sales and Operations without touching either path", () => {
  const src = read("HomeDashboard.tsx");
  assert.match(src, /<EmpView access=\{peopleAccess\}/);
  assert.match(src, /<OpsView access=\{opsAccess\}/);
  assert.match(src, /<SalesView /);
  assert.match(src, /peopleView = dashboardTabs \? tabHas\("people"\) : hasPermission\("workers", "read"\)/);
  assert.match(src, /key === "absent" && onPeople/);
});

test("salary needs payroll AND its server-gated inputs; revenue and department output each carry their own No access", () => {
  const d = read("emp-data.ts");
  assert.match(d, /canSalary = access\.payroll && access\.workers && access\.payslips/);
  assert.match(d, /revenueFigures/);
  const m = read("emp-model.ts");
  assert.match(m, /"No access"/);
  for (const k of ["salaryText", "revText", "outText"]) assert.match(m, new RegExp(`const ${k} =`));
  const cards = read("HomeEmpA.tsx") + read("emp-rows.ts");
  assert.match(cards, /m\.revText\(/);
  assert.match(cards, /m\.outText\(/);
});

test("no prototype sample value, timer-driven state or desktop edit ships in the Employees files", () => {
  for (const f of EMP_FILES) {
    const s = read(f);
    assert.doesNotMatch(s, /Ahmad Faiz|Kelvin Ng|TEST Account|setTimeout|Math\.sin\(/, `${f}: no invented data or timers`);
  }
});
