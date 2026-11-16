// m-employees-overview.test.mjs — HK-0125 Phase 3: the Employees Overview (month-to-date cards + Needs action).
// Pure logic with worked examples; the wiring checks read the source text. Sample values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activeRoster,
  buildCards,
  countLoggedHours,
  countWorkers,
  efficiencyTone,
  monthToDate,
  needsAction,
  offsitePeek,
  offsiteRecords,
  overviewLabel,
  pendingPeek,
  shortDay,
} from "../src/pages/m/screens/employees/overview-model.ts";
import { ATT_FENCE, locCounts, filterByLoc } from "../src/pages/m/screens/employees/attendance-location.ts";
import { attendanceLink, attendanceUrl, parseAttendanceParams, punchRows } from "../src/pages/m/screens/employees/attendance-model.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const TODAY = "2026-11-16";

test("period: the real Malaysia month, 1st .. today (month to date), labelled as the HTML does", () => {
  assert.deepEqual(monthToDate(TODAY), { from: "2026-11-01", to: "2026-11-16" });
  assert.deepEqual(monthToDate("2026-12-01"), { from: "2026-12-01", to: "2026-12-01" });
  assert.equal(overviewLabel(TODAY), "November 2026 · Month to date");
  assert.equal(overviewLabel("2027-01-09"), "January 2027 · Month to date");
  assert.ok(!/2026-11|new Date\(\)|Date\.now/.test(src("overview-model.ts").replace(/^\s*\/\/.*$/gm, "")), "no hard-coded date or clock in the model");
});

test("Total Workers: ACTIVE and not a TEST account (desktop's rule)", () => {
  const ws = [{ status: "ACTIVE", empNo: "EMP-1" }, { status: "ACTIVE", empNo: "test-9" }, { status: "RESIGNED", empNo: "EMP-2" }, { status: "ACTIVE" }];
  assert.equal(countWorkers(ws), 2);
});

test("cards: labels, order, values and targets as in the HTML", () => {
  const workers = Array.from({ length: 36 }, (_, i) => ({ id: `w${i}`, status: "ACTIVE", empNo: `EMP-${i}` }));
  const hours = Array.from({ length: 33 }, (_, i) => ({ workerId: `w${i}`, totalHours: 8 }));
  const cards = buildCards({ workers, hours, totals: { workerCount: 99, workingMinutes: 33540, efficiencyPct: 131 } });
  assert.deepEqual(cards.map((c) => [c.label, c.value, c.target]), [
    ["TOTAL WORKERS", "36", "attendance"],
    ["WORKERS WITH LOGGED HOURS", "33/36", "working-hours"],
    ["WORKING HOURS", "559.0h", "working-hours"],
    ["AVG EFFICIENCY", "131.0%", "efficiency"],
  ]);
  assert.deepEqual(cards.map((c) => c.icon), ["Users", "UserCheck", "Clock", "Activity"]);
  assert.deepEqual(cards.map((c) => c.tone), ["ink", "green", "ink", "green"]);
});

test("efficiency colour: desktop thresholds (85 green, 70 amber, else red); no minutes -> 0%", () => {
  assert.equal(efficiencyTone(85), "green");
  assert.equal(efficiencyTone(84.9), "amber");
  assert.equal(efficiencyTone(70), "amber");
  assert.equal(efficiencyTone(69.9), "red");
  const w = [{ id: "w1", status: "ACTIVE", empNo: "E" }];
  assert.equal(buildCards({ workers: w, hours: [], totals: { workerCount: 0, workingMinutes: 0, efficiencyPct: 0 } })[3].value, "0%");
  assert.equal(buildCards({ workers: w, hours: [], totals: { workerCount: 1, workingMinutes: 60, efficiencyPct: 72.04 } })[3].value, "72.0%");
});

test("a figure whose source is missing reads '—', never a made-up zero", () => {
  const none = buildCards({ workers: null, totals: null, hours: null });
  assert.deepEqual(none.map((c) => c.value), ["—", "—", "—", "—"]);
  const onlyWorkers = buildCards({ workers: [{ id: "w1", status: "ACTIVE", empNo: "E" }], totals: null, hours: null });
  assert.deepEqual(onlyWorkers.map((c) => c.value), ["1", "—", "—", "—"]);
  const onlyTotals = buildCards({ workers: null, totals: { workerCount: 3, workingMinutes: 120, efficiencyPct: 100 }, hours: null });
  assert.deepEqual(onlyTotals.map((c) => c.value), ["—", "—", "2.0h", "100.0%"]);
  // "Workers with logged hours" needs BOTH the roster and the hours summary
  const w = [{ id: "w1", status: "ACTIVE", empNo: "E" }];
  assert.equal(buildCards({ workers: w, totals: null, hours: null })[1].value, "—", "hours summary unavailable");
  assert.equal(buildCards({ workers: null, totals: null, hours: [{ workerId: "w1", totalHours: 5 }] })[1].value, "—", "roster unavailable");
  assert.equal(buildCards({ workers: w, totals: null, hours: [{ workerId: "w1", totalHours: 5 }] })[1].value, "1/1");
  assert.equal(buildCards({ workers: w, totals: null, hours: [] })[1].value, "0/1", "loaded and genuinely nobody logged hours -> 0, not a dash");
});

// ---- Needs action ----------------------------------------------------------------------------------------------------
const F = ATT_FENCE;
const far = { clockOutLat: F.lat + 0.0123, clockOutLng: F.lng };
const at = { clockInLat: F.lat, clockInLng: F.lng };
const A = (id, date, name, extra = {}) => ({ id, employeeId: id, employeeName: name, date, clockIn: "07:52", clockOut: "17:30", ...extra });
const P = (id, date, name = "MA SAN PAY OO", extra = {}) => ({ id, workerId: "w", workerName: name, date, departmentCode: "FAB_SEW", hours: 51 / 60, note: "", status: "PENDING", kind: "ADD_PROD", ...extra });
const deptName = (c) => (c === "FAB_SEW" ? "Fab Sew" : c);
const ok = (rows) => ({ allowed: true, rows, loading: false, error: false });

test("Attendance exceptions count each attendance record ONCE, and equal the Off-site list for the same range", () => {
  const rows = [
    A("a1", "2026-11-04", "Lim Wei Jie", { ...at, ...far }),
    A("a1", "2026-11-04", "Lim Wei Jie", { ...at, ...far }), // the same record twice in the response
    A("a2", "2026-11-05", "Kumar Raj", { ...far, clockInLat: F.lat + 0.02, clockInLng: F.lng }),
    A("a3", "2026-11-05", "Tan Mei Ling", at),
    A("a4", "2026-11-06", "No Gps", { clockInLat: null, clockInLng: null }),
    { id: "a5", employeeId: "a5", employeeName: "No punch", date: "2026-11-06", clockIn: null, clockOut: null },
  ];
  const records = offsiteRecords(rows);
  assert.equal(records.length, 2);
  // The Attendance screen: punchRows -> filterByLoc("offsite") and its chip count (locCounts) — one function chain.
  const attendanceList = filterByLoc(punchRows(rows), "offsite");
  assert.equal(attendanceList.length, records.length);
  assert.equal(locCounts(punchRows(rows)).offsite, records.length);
  const n = needsAction(ok([]), ok(rows), deptName);
  assert.equal(n.rows.find((r) => r.key === "attendance").count, String(attendanceList.length));
});

test("the destination: Off-site chip, the same month-to-date range as the card", () => {
  const r = monthToDate(TODAY);
  const link = attendanceLink({ loc: "offsite", from: r.from, to: r.to });
  assert.equal(link, "/m/employees?section=attendance&loc=offsite&afrom=2026-11-01&ato=2026-11-16");
  const u = new URL(link, "http://x");
  const parsed = parseAttendanceParams((k) => u.searchParams.get(k), TODAY);
  assert.deepEqual(parsed.period, { kind: "range", from: r.from, to: r.to });
  assert.equal(parsed.loc, "offsite");
  // The card's request and the Attendance list's request are the same URL (one cached response).
  assert.equal(attendanceUrl({ kind: "range", from: r.from, to: r.to }), "/api/attendance?from=2026-11-01&to=2026-11-16");
  const hook = src("use-overview.ts");
  assert.match(hook, /attendanceUrl\(\{ kind: "range", from: range\.from, to: range\.to \}\)/);
  assert.match(src("OverviewSection.tsx"), /attendanceLink\(\{ loc: "offsite", from: range\.from, to: range\.to \}\)/);
});

test("peeks follow the HTML: pending = name, department, 'd Mon · N min'; exception = name, 'Off-site · dist', 'd Mon · hh:mm'", () => {
  assert.equal(shortDay("2026-11-04"), "4 Nov");
  assert.deepEqual(pendingPeek([P("p1", "2026-11-11"), P("p2", "2026-11-10")], deptName), { a: "MA SAN PAY OO", b: "Fab Sew", c: "11 Nov · 51 min" });
  assert.equal(pendingPeek([], deptName), null);
  const recs = offsiteRecords([
    A("old", "2026-11-03", "Earlier", { ...far, ...at }),
    A("new", "2026-11-04", "Lim Wei Jie", { clockInLat: F.lat + 0.0123, clockInLng: F.lng, clockIn: "07:52" }),
  ]);
  assert.deepEqual(offsitePeek(recs), { a: "Lim Wei Jie", b: "Off-site · 1.4 km", c: "4 Nov · 07:52" });
  // the time shown is the punch that is off-site: an out-punch away -> the clock-out time
  assert.equal(offsitePeek(offsiteRecords([A("x", "2026-11-05", "Out only", { ...at, ...far, clockOut: "17:41" })])).c, "5 Nov · 17:41");
});

test("the pending count is the shell's list (same as the tab badge), '200+' at the server cap", () => {
  const many = Array.from({ length: 200 }, (_, i) => P("p" + i, "2026-11-11"));
  assert.equal(needsAction(ok(many), ok([]), deptName).rows[0].count, "200+");
  assert.equal(needsAction(ok([P("a", "2026-11-11"), P("b", "2026-11-10")]), ok([]), deptName).rows[0].count, "2");
  const route = src("EmployeesRoute.tsx");
  assert.match(route, /const adj = usePendingAdjustments\(\)/);
  assert.match(route, /pendingBadge\(adj\.rows\)/);
  assert.match(route, /<OverviewSection pending=\{adj\}/, "the Overview reads the shell's list, not a second fetch");
  assert.ok(!/nonprod-requests/.test(src("use-overview.ts") + src("OverviewSection.tsx")), "Overview makes no request of its own for the pending list");
});

test("'No pending actions' only when BOTH lists are accessible, loaded without error, and empty", () => {
  assert.equal(needsAction(ok([]), ok([]), deptName).calm, true);
  // not loaded yet
  assert.equal(needsAction({ allowed: true, rows: null, loading: true, error: false }, ok([]), deptName).calm, false);
  assert.equal(needsAction(ok([]), { allowed: true, rows: null, loading: true, error: false }, deptName).calm, false);
  assert.equal(needsAction({ allowed: true, rows: null, loading: true, error: false }, ok([]), deptName).loading, true);
  // a request failed -> a load error, never calm (also when stale rows exist)
  const failed = needsAction({ allowed: true, rows: null, loading: false, error: true }, ok([]), deptName);
  assert.equal(failed.calm, false);
  assert.deepEqual(failed.errors, ["Couldn't load pending time adjustments."]);
  const attFailed = needsAction(ok([]), { allowed: true, rows: [], loading: false, error: true }, deptName);
  assert.equal(attFailed.calm, false);
  assert.deepEqual(attFailed.errors, ["Couldn't load attendance exceptions."]);
  // a list the role may not read is not "empty"
  assert.equal(needsAction({ allowed: false, rows: null, loading: false, error: false }, ok([]), deptName).calm, false);
  assert.equal(needsAction(ok([]), { allowed: false, rows: null, loading: false, error: false }, deptName).calm, false);
  // rows present -> not calm
  assert.equal(needsAction(ok([P("a", "2026-11-11")]), ok([]), deptName).calm, false);
});

test("permissions: a role without attendance:read sees no Needs action at all; the rows hide only what the role may not read", () => {
  const denied = { allowed: false, rows: null, loading: false, error: false };
  const none = needsAction(denied, denied, deptName);
  assert.equal(none.hidden, true);
  assert.equal(none.calm, false);
  assert.equal(needsAction(ok([P("a", "2026-11-11")]), denied, deptName).hidden, false);
  const hook = src("use-overview.ts");
  assert.match(hook, /hasPermission\("workers", "read"\)/);
  assert.match(hook, /useCanReadAttendance\(\)/);
  assert.match(hook, /canWorkers \? "\/api\/workers" : null/, "no workers:read -> nothing requested");
});

test("Overview is the default Employees tab; the placeholder is gone; every section tab still resolves", () => {
  const s = src("employees-sections.ts");
  assert.match(s, /DEFAULT_SECTION: EmployeesSectionKey = "overview"/);
  const route = src("EmployeesRoute.tsx");
  assert.ok(!/OverviewPlaceholder|Overview is coming soon/.test(route));
  assert.match(route, /<OverviewSection pending=\{adj\} onGo=\{go\} \/>/);
});

test("card taps go where the HTML says; Avg Efficiency still opens the existing Efficiency Overview, with its period stated", () => {
  const ui = src("OverviewSection.tsx");
  assert.match(ui, /onTap=\{\(\) => onGo\(c\.target\)\}/);
  assert.match(ui, /key === "pending" \? onGo\("working-hours"\)/);
  const cards = buildCards({ workers: [], hours: [], totals: { workerCount: 0, workingMinutes: 0, efficiencyPct: 0 } });
  assert.equal(cards[0].target, "attendance");
  assert.equal(cards[3].target, "efficiency");
  const route = src("EmployeesRoute.tsx");
  assert.match(route, /section === "efficiency" \? <EfficiencyPeriodNote \/>/);
  assert.match(route, /\/api\/reports\/efficiency\.json/);
  assert.match(route, /not month to date/);
});

test("the Overview writes nothing", () => {
  for (const f of ["OverviewSection.tsx", "use-overview.ts", "overview-model.ts"]) {
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)["']|mutateJson/.test(src(f)), `${f} makes no write`);
  }
});

// ---- WORKERS WITH LOGGED HOURS: one roster for both numbers (owner-approved Option A) ------------------------------------
const R = (id, status = "ACTIVE", empNo = `EMP-${id}`) => ({ id, status, empNo });

test("numerator and denominator are the SAME roster: active, non-test workers", () => {
  const workers = [R("a"), R("b"), R("c"), R("r", "RESIGNED"), R("i", "INACTIVE"), R("t", "ACTIVE", "TEST-01"), R("t2", "ACTIVE", "test-2")];
  assert.deepEqual(activeRoster(workers).map((w) => w.id), ["a", "b", "c"]);
  assert.equal(countWorkers(workers), 3);
  const hours = workers.map((w) => ({ workerId: w.id, totalHours: 8 }));
  // everyone logged hours, but only the roster counts, in the numerator as well as the denominator
  assert.equal(countLoggedHours(workers, hours), 3);
  assert.equal(buildCards({ workers, totals: null, hours })[1].value, "3/3");
});

test("excluded from the numerator: inactive workers, test accounts, ids with no worker record", () => {
  const workers = [R("a"), R("r", "RESIGNED"), R("t", "ACTIVE", "TEST-9")];
  const hours = [{ workerId: "a", totalHours: 8 }, { workerId: "r", totalHours: 40 }, { workerId: "t", totalHours: 12 }, { workerId: "ghost", totalHours: 9 }];
  assert.equal(countLoggedHours(workers, hours), 1);
  assert.equal(buildCards({ workers, totals: null, hours })[1].value, "1/1");
});

test("a worker whose only credit is a job card (or an approved extra-production claim) has no hours row and is NOT counted", () => {
  const workers = [R("a"), R("jc"), R("claim")];
  const hours = [{ workerId: "a", totalHours: 8 }]; // jc / claim appear only in the department-performance totals, never in the hours summary
  // the old figure (desktop's workerCount = union of hours + job cards + claims) would have said 3
  const cards = buildCards({ workers, hours, totals: { workerCount: 3, workingMinutes: 480, efficiencyPct: 90 } });
  assert.equal(cards[1].value, "1/3");
  const model = readFileSync(new URL("../src/pages/m/screens/employees/overview-model.ts", import.meta.url), "utf8");
  const body = model.slice(model.indexOf("export function buildCards"), model.indexOf("export function shortDay"));
  assert.ok(!/workerCount/.test(body), "the card no longer reads totals.workerCount");
});

test("positive hours only; each worker counted once across departments and rows; hours are added per worker", () => {
  const workers = [R("a"), R("b"), R("c"), R("d")];
  const hours = [
    { workerId: "a", totalHours: 5 },
    { workerId: "a", totalHours: 3 }, // second department row for the same worker
    { workerId: "b", totalHours: 0 }, // a row with zero hours
    { workerId: "c", totalHours: -2 }, // never positive
    { workerId: "d" }, // no hours field
  ];
  assert.equal(countLoggedHours(workers, hours), 1);
  // 4 and -4 cancel to 0 -> not positive in total
  assert.equal(countLoggedHours([R("x")], [{ workerId: "x", totalHours: 4 }, { workerId: "x", totalHours: -4 }]), 0);
  assert.equal(countLoggedHours([R("x")], [{ workerId: "x", totalHours: 0.25 }]), 1);
});

test("the numerator can never exceed the roster (the 40/39 case)", () => {
  const workers = Array.from({ length: 39 }, (_, i) => R("w" + i));
  const hours = Array.from({ length: 45 }, (_, i) => ({ workerId: "w" + i, totalHours: 8 })); // 6 ids are not in the roster
  assert.equal(countLoggedHours(workers, hours), 39);
  assert.equal(buildCards({ workers, totals: null, hours })[1].value, "39/39");
});

test("the hours summary is the existing endpoint for the SAME month-to-date range; a non-list body is 'unavailable'", () => {
  const hook = src("use-overview.ts");
  assert.match(hook, /\/api\/working-hour-entries\/summary\?from=\$\{range\.from\}&to=\$\{range\.to\}/);
  assert.match(hook, /canWorkers \? `\/api\/working-hour-entries\/summary/, "requested only when the roster can be read");
  assert.match(hook, /function listOrNull/);
  assert.match(hook, /hours: \{ rows: listOrNull<HoursRow>\(hoursRes\.data\)/);
  const ui = src("OverviewSection.tsx");
  assert.match(ui, /loggedSourcesOk = !data\.workers\.error && !data\.hours\.error/);
  assert.match(ui, /hours: loggedSourcesOk \? data\.hours\.rows : null/);
  assert.match(ui, /onGo\(c\.target\)/, "tap still goes to the card's target");
  assert.equal(buildCards({ workers: [], totals: null, hours: [] })[1].target, "working-hours");
  assert.equal(buildCards({ workers: [], totals: null, hours: [] })[1].label, "WORKERS WITH LOGGED HOURS");
});
