// m-employees-working-hours.test.mjs — HK-0125 Phase 2: Working Hours rows / filters / grouping and the view-only
// Time Adjustment Requests rules. Pure logic with worked examples; the wiring checks read the source text.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyFilters,
  buildRows,
  dayTag,
  deptOptions,
  groupByDate,
  limitGroups,
  windowFor,
} from "../src/pages/m/screens/employees/working-hours-model.ts";
import {
  REQUEST_CAP,
  approvedMin,
  approvedTitle,
  historyCount,
  isCapped,
  matchesQuery,
  pendingBadge,
  approvedSub,
  pendingSub,
  rejectedSub,
  requestedMin,
  rowsOf,
} from "../src/pages/m/screens/employees/time-adjustments-model.ts";
import { dayHeading, fmtHours, fmtMin, shortDate } from "../src/pages/m/screens/employees/employees-format.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");

const workers = [
  { id: "w1", name: "Ann Lee", empNo: "EMP-0001", workingHoursPerDay: 9 },
  { id: "w2", name: "Bob Tan", empNo: "EMP-0002", workingHoursPerDay: 8 },
];
const depts = [
  { code: "UPH", name: "Upholstery" },
  { code: "FRM", name: "Framing" },
];
const E = (workerId, date, departmentCode, hours, category = "", notes = "") => ({ workerId, date, departmentCode, hours, category, notes });
const entries = [
  E("w1", "2026-11-11", "UPH", 5, "SOFA", "sofa set"),
  E("w1", "2026-11-11", "FRM", 4.5, "BEDFRAME"),
  E("w2", "2026-11-11", "UPH", 8),
  E("w1", "2026-11-10", "UPH", 7),
  E("ghost", "2026-11-10", "UPH", 9),
];
const punches = [
  { employeeId: "w1", date: "2026-11-11", clockIn: "07:55", clockOut: "17:30", employeeName: "Ann Lee" },
  { employeeId: "ghost", date: "2026-11-10", clockIn: "08:00", clockOut: null, employeeName: "Gone Worker" },
];

test("formatting helpers", () => {
  assert.equal(shortDate("2026-11-11"), "11 Nov 2026");
  assert.equal(dayHeading("2026-11-11"), "Wed 11 Nov 2026");
  assert.equal(dayHeading("2026-11-10"), "Tue 10 Nov 2026");
  assert.equal(fmtHours(9), "9");
  assert.equal(fmtHours(4.5), "4.5");
  assert.equal(fmtHours(4.255), "4.26");
  assert.equal(fmtMin(51), "51 min");
  assert.equal(fmtMin(60), "1h");
  assert.equal(fmtMin(80), "1h 20min");
});

test("a card's hours are the worker's FULL-DAY total across departments, with every segment listed", () => {
  const rows = buildRows(entries, punches, workers, depts);
  const ann = rows.find((r) => r.workerId === "w1" && r.date === "2026-11-11");
  assert.equal(ann.total, 9.5);
  assert.equal(ann.segs.length, 2);
  assert.deepEqual(ann.segs.map((s) => [s.deptName, s.category, s.hours]), [["Upholstery", "SOFA", 5], ["Framing", "BEDFRAME", 4.5]]);
  assert.equal(ann.punchIn, "07:55");
  assert.equal(ann.punchOut, "17:30");
  assert.equal(ann.empNo, "EMP-0001");
});

test("tag compares the day with the worker's own standard hours (default 9)", () => {
  assert.deepEqual(dayTag(9.5, 9), { label: "9.5 h · OT", tone: "ot" });
  assert.deepEqual(dayTag(7, 9), { label: "7 h · short", tone: "short" });
  assert.deepEqual(dayTag(9, 9), { label: "9 h · full day", tone: "full" });
  assert.deepEqual(dayTag(8, 8), { label: "8 h · full day", tone: "full" }); // Bob's standard day is 8
  assert.deepEqual(dayTag(9, 0), { label: "9 h · full day", tone: "full" }); // 0 / missing → 9
  const rows = buildRows(entries, punches, workers, depts);
  assert.equal(rows.find((r) => r.workerId === "w2").tag.tone, "full");
});

test("names fall back to the punch name, then the id; no punch shows null times", () => {
  const rows = buildRows(entries, punches, workers, depts);
  const ghost = rows.find((r) => r.workerId === "ghost");
  assert.equal(ghost.name, "Gone Worker");
  assert.equal(ghost.punchOut, null);
  const bare = buildRows([E("zzz", "2026-11-01", "UPH", 1)], [], [], []);
  assert.equal(bare[0].name, "zzz");
  assert.equal(bare[0].punchIn, null);
  assert.equal(bare[0].segs[0].deptName, "UPH"); // unknown department → its code
});

test("rows are newest date first, then by name", () => {
  const rows = buildRows(entries, punches, workers, depts);
  assert.deepEqual(rows.map((r) => `${r.date} ${r.name}`), [
    "2026-11-11 Ann Lee",
    "2026-11-11 Bob Tan",
    "2026-11-10 Ann Lee",
    "2026-11-10 Gone Worker",
  ]);
});

test("filters: name or employee number, one work date, department", () => {
  const rows = buildRows(entries, punches, workers, depts);
  const F = (o) => ({ q: "", date: "", dept: "", ...o });
  assert.equal(applyFilters(rows, F({})).length, 4);
  assert.equal(applyFilters(rows, F({ q: "ann" })).length, 2);
  assert.equal(applyFilters(rows, F({ q: "EMP-0002" })).length, 1);
  assert.equal(applyFilters(rows, F({ date: "2026-11-10" })).length, 2);
  assert.equal(applyFilters(rows, F({ dept: "FRM" })).length, 1);
  assert.equal(applyFilters(rows, F({ dept: "FRM", q: "bob" })).length, 0);
});

test("a department filter keeps the whole day's total (it never re-totals)", () => {
  const rows = buildRows(entries, punches, workers, depts);
  const [ann] = applyFilters(rows, { q: "", date: "2026-11-11", dept: "FRM" });
  assert.equal(ann.total, 9.5);
  assert.equal(ann.segs.length, 2);
});

test("department chip counts follow the OTHER filters", () => {
  const rows = buildRows(entries, punches, workers, depts);
  const all = deptOptions(rows, { q: "", date: "", dept: "" });
  assert.deepEqual(all.map((o) => [o.code, o.count]), [["", 4], ["FRM", 1], ["UPH", 4]]);
  const day = deptOptions(rows, { q: "", date: "2026-11-11", dept: "FRM" });
  assert.deepEqual(day.map((o) => [o.code, o.count]), [["", 2], ["FRM", 1], ["UPH", 2]]); // own dept filter is skipped
});

test("groups by date with worker count and the sum of full-day hours; limit counts rows across groups", () => {
  const rows = buildRows(entries, punches, workers, depts);
  const groups = groupByDate(rows);
  assert.equal(groups.length, 2);
  assert.deepEqual([groups[0].date, groups[0].workers, groups[0].hours], ["2026-11-11", 2, 17.5]);
  assert.equal(groups[0].title, "Wed 11 Nov 2026");
  const lim = limitGroups(groups, 3);
  assert.deepEqual(lim.map((g) => g.rows.length), [2, 1]);
  assert.equal(limitGroups(groups, 0).length, 0);
});

test("default window is the whole current Malaysia month; a picked date loads its own month", () => {
  assert.deepEqual(windowFor("", "2026-11-16"), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(windowFor("2026-10-05", "2026-11-16"), { from: "2026-10-01", to: "2026-10-31" });
});

// ---- Time Adjustment Requests ---------------------------------------------------------------------------------------
const R = (o) => ({ id: "r", workerId: "w1", workerName: "Ann Lee", date: "2026-11-10", departmentCode: "UPH", hours: 1, note: "", status: "PENDING", kind: "NONPROD", approvedHours: null, ...o });

test("pending badge comes from the list itself: none → no badge, 200 → '200+'", () => {
  assert.equal(pendingBadge([]), null);
  assert.equal(pendingBadge(null), null);
  assert.equal(pendingBadge([R({})]), "1");
  assert.equal(pendingBadge(Array.from({ length: 199 }, () => R({}))), "199");
  assert.equal(pendingBadge(Array.from({ length: REQUEST_CAP }, () => R({}))), "200+");
});

test("a 200-row response is 'Showing latest 200', never an exact total", () => {
  const capped = Array.from({ length: REQUEST_CAP }, () => R({}));
  assert.equal(isCapped(capped), true);
  assert.equal(historyCount(capped, "approved"), "Showing latest 200 approved");
  assert.equal(historyCount([R({}), R({})], "approved"), "2 approved");
  assert.equal(isCapped(capped.slice(1)), false);
});

test("minutes: requested vs approved (partial approvals read approvedHours)", () => {
  assert.equal(requestedMin(R({ hours: 1.5 })), 90);
  assert.equal(approvedMin(R({ hours: 1, approvedHours: null })), 60);
  assert.equal(approvedMin(R({ hours: 1, approvedHours: 0.75 })), 45);
  assert.equal(approvedTitle(R({ hours: 1, approvedHours: 0.75 })), "45 min (of 1h)");
  assert.equal(approvedTitle(R({ hours: 1, approvedHours: 1 })), "1h");
});

test("every request shows its WORK date first, written as the HTML writes it", () => {
  assert.equal(pendingSub(R({ kind: "ADD_PROD", jobCardId: "PO-2610-217", note: "Extra 1 set" })), "2026-11-10 · Job: PO-2610-217 — Extra 1 set");
  assert.equal(pendingSub(R({})), "2026-11-10");
  assert.equal(approvedSub(R({ kind: "ADD_PROD", jobCardId: "PO-9" }), "Upholstery"), "2026-11-10 · Upholstery · Job: PO-9");
  assert.equal(rejectedSub(R({ note: "1052 6ft 1set" })), "2026-11-10 — 1052 6ft 1set");
});

test("history search matches name, date, department, note, job and reason", () => {
  const r = R({ workerName: "Khin Maung", note: "left drawer", jobCardId: "PO-9", rejectReason: "wrong date" });
  assert.equal(matchesQuery(r, ""), true);
  assert.equal(matchesQuery(r, "khin"), true);
  assert.equal(matchesQuery(r, "10 nov"), true);
  assert.equal(matchesQuery(r, "WRONG DATE"), true);
  assert.equal(matchesQuery(r, "zzz"), false);
  assert.deepEqual(rowsOf({ data: [1, 2] }), [1, 2]);
  assert.deepEqual(rowsOf(null), []);
});

// ---- wiring ---------------------------------------------------------------------------------------------------------
test("writes are limited to Approve / Reject of pending requests: Daily Working Hours, Attendance and Remove stay read-only", () => {
  for (const f of ["WorkingHoursSection.tsx", "HoursCard.tsx", "HoursPage.tsx", "AttendanceSection.tsx", "AttendanceDetail.tsx", "PunchPhotoViewer.tsx"]) {
    const s = src(f);
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)["']|mutateJson|adjustment-actions/i.test(s), `${f} makes no write`);
    assert.ok(!/>\s*(Approve|Reject|Edit|Delete|Remove)\s*</.test(s), `${f} has no action button`);
  }
  const card = src("AdjustmentRequests.tsx");
  assert.ok(!/mutateJson|method:/.test(card), "the card calls the actions module, never fetch directly");
  assert.ok(!/\/remove/.test(card + src("adjustment-actions.ts") + src("adjustment-calls.ts")), "Remove on approved rows is not built");
  const calls = src("adjustment-calls.ts");
  assert.match(calls, /nonprod-requests/);
  assert.match(calls, /\/approve/);
  assert.match(calls, /\/reject/);
  assert.ok(!/working-hour-entries"|working-hour-entries`|working-hour-entries\/\$/.test(calls.replace(/nonprod-requests/g, "")), "no entry PUT / POST / DELETE");
});

test("the request list never reads the Working Hours date filter", () => {
  const s = src("AdjustmentRequests.tsx");
  assert.ok(!/wdate|dateFilter|filters\.date/.test(s), "AdjustmentRequests takes no date");
  const hook = src("use-time-adjustments.ts");
  assert.match(hook, /nonprod-requests\?status=/);
  assert.match(hook, /useList\("PENDING"/);
  assert.ok(!/from=|to=|date=/.test(hook), "request URLs carry no date");
});

test("the pending badge and the card share one list (the shell fetches it once and passes it down)", () => {
  const route = src("EmployeesRoute.tsx");
  assert.match(route, /usePendingAdjustments\(/);
  assert.match(route, /pendingBadge\(adj\.rows\)/);
  assert.match(route, /<WorkingHoursSection[^>]*pending=\{adj\}/);
});

// ---- Phase 2 review fixes: compact list + read-only detail card, working date button ----------------------------------
test("the Working Hours card follows the HTML: the department table sits inline under the punch times, read-only", () => {
  const code = (t) => t.replace(/^\s*\/\/.*$/gm, "");
  const list = code(src("WorkingHoursSection.tsx") + src("HoursCard.tsx"));
  for (const col of ["Department", "Category", "Hours", "Notes:", "Punch in / out"]) assert.ok(list.includes(col), `card has ${col}`);
  assert.ok(!/HoursDetail|role="button"/.test(list), "no tap-to-open detail on a Working Hours card");
  assert.ok(!/ChevronRight/.test(code(src("HoursCard.tsx"))), "the card itself has no chevron (it is not tappable)");
  assert.ok(!/>\s*(Edit|Delete)\s*</.test(list), "no Edit / Delete buttons");
  assert.ok(!/Pencil|Trash/.test(list));
});

test("both calendar controls are real buttons that call showPicker() (an invisible input alone does nothing on desktop Chromium)", () => {
  const btn = src("DatePickButton.tsx");
  assert.match(btn, /<button[\s\S]*onClick=\{open\}/);
  assert.match(btn, /el\.showPicker\(\)/);
  assert.match(btn, /el\.focus\(\);\s*el\.click\(\)/, "fallback when showPicker throws");
  assert.match(btn, /"showPicker" in HTMLInputElement\.prototype/, "overlay fallback for browsers without showPicker");
  for (const f of ["WorkingHoursSection.tsx", "AttendanceSection.tsx"]) {
    const s = src(f);
    assert.match(s, /<DatePickButton/, `${f} uses it`);
    assert.ok(!/type="date"/.test(s), `${f} has no bare date input`);
  }
});

test("the work date input is bounded: not after today (Malaysia), not before 2020-01-01", () => {
  const s = src("WorkingHoursSection.tsx");
  assert.match(s, /min=\{MIN_DATE\}/);
  assert.match(s, /max=\{today\}/);
  assert.match(s, /todayYmdMYForReads\(\)/);
});

test("Daily working hours is the HTML card without extras: no period line, no per-date totals, no day-total captions", () => {
  const code = (t) => t.replace(/^\s*\/\/.*$/gm, "");
  const list = code(src("WorkingHoursSection.tsx") + src("HoursCard.tsx"));
  assert.ok(!/day totals, all departments|all days/.test(list), "no period line under the title");
  assert.ok(!/workers\} \{|g\.workers|g\.hours/.test(list), "no worker / hour totals beside the date heading");
  assert.ok(!/day total/.test(list.replace(/Split the day/g, "")), "no 'X h of Y h day total' caption");
  assert.match(list, /Split the day’s hours across the departments/, "the HTML's own hint on split days stays");
});

test("approved adjustments carry the same blue 'Extra production time' pill as pending ones", () => {
  const s = src("AdjustmentRequests.tsx");
  assert.match(s, /\{approved \? \(\s*<div[^>]*>\s*<KindPill r=\{r\} \/>/, "the approved row renders KindPill");
  assert.match(s, /r\.kind === "ADD_PROD" \? TONE\.teal : TONE\.grey/);
});

// ---- Approve / Reject ---------------------------------------------------------------------------------------------------
import {
  REFRESH_PREFIXES,
  approveBody,
  approveConfirm,
  clampMinutes,
  outcomeOf,
  recordedHours,
} from "../src/pages/m/screens/employees/adjustment-actions.ts";

test("minutes: whole numbers from 1 to the requested minutes (the server refuses 0 and more than requested)", () => {
  assert.equal(clampMinutes("51", 51), 51);
  assert.equal(clampMinutes("80", 51), 51);
  assert.equal(clampMinutes("0", 51), 1);
  assert.equal(clampMinutes("", 51), 1);
  assert.equal(clampMinutes("abc", 51), 1);
  assert.equal(clampMinutes("30.7", 51), 30);
  assert.equal(clampMinutes(-5, 51), 1);
});

test("full approval sends no body; partial sends approvedHours (rounded by the server to 2 decimals)", () => {
  assert.equal(approveBody(51, 51), undefined);
  assert.equal(approveBody(60, 51), undefined);
  assert.deepEqual(approveBody(30, 51), { approvedHours: 0.5 });
  assert.equal(recordedHours(50), 0.83);
  assert.equal(recordedHours(51), 0.85);
  assert.equal(recordedHours(60), 1);
});

test("the confirmation explains the REAL effect per kind", () => {
  const np = R({ kind: "NONPROD", hours: 51 / 60, workerName: "KHIN MAUNG LIN", date: "2026-11-10" });
  const ap = R({ kind: "ADD_PROD", hours: 80 / 60, workerName: "ZAW MOE TUN", date: "2026-11-10" });
  const a = approveConfirm(np, "Warehousing", 51);
  assert.match(a, /^Approve 51 of 51 min for KHIN MAUNG LIN \(Warehousing, 10 Nov 2026\)\?/);
  assert.match(a, /records 51 min under Warehousing on 10 Nov 2026/);
  assert.match(a, /takes the same time off their production-department hours/);
  assert.match(a, /efficiency goes up/);
  assert.ok(!/will not be counted/.test(a), "full approval has no leftover");
  const b = approveConfirm(ap, "Framing", 60);
  assert.match(b, /20 min will not be counted\./);
  assert.match(b, /credits 1h of extra production time to their efficiency/);
  assert.match(b, /does not add a working-hours row or change the day's hours/);
  assert.ok(!/records .* under/.test(b), "extra production time writes no hours row");
  assert.match(approveConfirm(np, "Warehousing", 50), /stored as 0\.83 h/, "rounding is disclosed");
});

test("outcomes: ok and 'someone already decided' (409) both refresh the lists; other errors do not", () => {
  assert.deepEqual(outcomeOf({ ok: true, status: 200 }, "done"), { kind: "ok", message: "done" });
  const dup = outcomeOf({ ok: false, status: 409, error: "Request already APPROVED" }, "done");
  assert.equal(dup.kind, "already");
  assert.match(dup.message, /already decided/);
  const bad = outcomeOf({ ok: false, status: 400, error: "Approved hours must be greater than 0." }, "done");
  assert.deepEqual(bad, { kind: "error", message: "Approved hours must be greater than 0." });
  assert.equal(outcomeOf({ ok: false, status: 0 }, "done").message, "Could not update the request.");
  assert.match(src("adjustment-calls.ts"), /if \(out\.kind !== "error"\) refreshAfterDecision\(\)/);
  for (const p of ["/api/working-hour-entries", "/api/department-performance", "/api/job-cards", "/api/reports/efficiency"]) assert.ok(REFRESH_PREFIXES.includes(p), p);
});

test("Reject needs a reason; Approve / Reject appear only with attendance:update", () => {
  assert.match(src("adjustment-calls.ts"), /if \(!why\) return \{ kind: "error", message: "Enter a reason to reject\." \}/);
  const card = src("AdjustmentRequests.tsx");
  assert.match(card, /hasPermission\("attendance", "update"\)/);
  assert.match(card, /\{canDecide \? \(/, "input + buttons are gated");
  assert.match(card, /Enter a reason to reject\./);
  assert.match(card, /The worker sees this reason\./);
  assert.match(card, /min of \{req\} requested/);
});

test("Daily working hours: first 5 rows, then 'View all N' opens a full page (not an inline expansion); the cards cannot widen past the screen", () => {
  const sec = src("WorkingHoursSection.tsx");
  assert.match(sec, /limitGroups\(groups, PREVIEW_ROWS\)/);
  assert.match(sec, /View all \{filtered\.length\}/);
  assert.match(sec, /setPageOpen\(true\)/);
  assert.match(sec, /<HoursPage rows=\{filtered\}/);
  assert.ok(!/showAll|Show fewer|Show all/.test(sec), "no inline Show all / Show fewer any more");
  const page = src("HoursPage.tsx");
  assert.match(page, /position: "fixed", inset: 0, zIndex: 70/);
  assert.match(page, /const PAGE = 30/);
  assert.match(page, /Load \{PAGE\} more/);
  assert.match(page, /NEWEST FIRST/);
  assert.match(page, /aria-label="Back"/);
  assert.match(page, /<HoursCard key=\{r\.key\} r=\{r\} \/>/, "the same card as the list");
  // the clipping bug: grid items default to min-width:auto, so a long nowrap note widened the whole card; every grid here is
  // a single shrinkable column and every item may shrink
  for (const f of ["WorkingHoursSection.tsx", "HoursPage.tsx"]) {
    const s = src(f);
    assert.ok(!/display: "grid", gap:/.test(s), `${f}: a grid without a shrinkable column`);
    assert.match(s, /gridTemplateColumns: "minmax\(0, 1fr\)"/);
  }
  assert.match(src("HoursCard.tsx"), /\.\.\.INNER, minWidth: 0/);
});
