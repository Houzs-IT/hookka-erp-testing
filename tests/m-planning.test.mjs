// m-planning.test.mjs — the rules behind the PHONE Planning v2 screens
// (src/pages/m/lib/planning-*.ts). Capacity, Loading and Tracker are ports of
// desktop code (src/pages/planning/index.tsx), so each block asserts the phone
// answer on a hand-computed fixture AND that the desktop source still says the
// same thing. The schedule blocks pin the safe production-order matching.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  recentWorkingDays, upcomingWorkingDays, countWorkingDays, scopeRange, buildCapacity, buildLoading,
  dailyCapacityOf, pressureBand, loadingLevel, hoursLabel, ROLLING_WINDOW_DAYS, LOADING_PAST_DAYS, LOADING_FUTURE_DAYS,
} from "../src/pages/m/lib/planning-capacity.ts";
import {
  parseSchedule, SCHEDULE_DEPT_BY_CODE, SCHEDULE_DEPTS, jobsOnDay, groupByLane, summarize, buildOrderIndex, resolveJob,
  lineLabelOf, soOfLabel, scopeTokens, mondayOf, addDays, weekDays, isCustomerDdOverdue, commonValue, shortDate,
} from "../src/pages/m/lib/planning-schedule.ts";
import { targetState, isLate, segments, progressOf, filterTracker, matchesSearch, deptLabel } from "../src/pages/m/lib/planning-tracker.ts";
import { buildLeadView } from "../src/pages/m/lib/planning-leadtimes.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const DESKTOP = read("src/pages/planning/index.tsx");
const API_SCHEDULE = read("src/api/routes/planning-schedule.ts");

// Wed 2026-10-28, 10:00 local.
const NOW = new Date(2026, 9, 28, 10, 0, 0);
const none = new Set();

// ── Desktop still says what the port says ───────────────────────────────────
test("desktop constants and filters the port copies are unchanged", () => {
  assert.match(DESKTOP, /const ROLLING_WINDOW_DAYS = 14;/);
  assert.match(DESKTOP, /const LOADING_CHART_PAST_DAYS = 14;/);
  assert.match(DESKTOP, /const LOADING_CHART_FUTURE_DAYS = 21;/);
  assert.equal(ROLLING_WINDOW_DAYS, 14);
  assert.equal(LOADING_PAST_DAYS, 14);
  assert.equal(LOADING_FUTURE_DAYS, 21);
  // Working day = not Sunday, not a public holiday; recent window starts YESTERDAY.
  assert.match(DESKTOP, /cursor\.setDate\(cursor\.getDate\(\) - 1\); \/\/ exclude today/);
  assert.match(DESKTOP, /cursor\.getDay\(\) !== 0 && !holidays\.has\(iso\)/);
  // Rolling capacity = completed/transferred minutes in the window / 14.
  assert.match(DESKTOP, /Math\.round\(windowTotalMinutes \/ ROLLING_WINDOW_DAYS\)/);
  assert.match(DESKTOP, /jc\.status !== "COMPLETED" && jc\.status !== "TRANSFERRED"\) continue;\s+if \(!jc\.completedDate\) continue;/);
  // Scope load = active job cards due on/before the scope end, IN_PROGRESS / PENDING orders only.
  assert.match(DESKTOP, /jc\.dueDate && jc\.dueDate <= scopeTo/);
  assert.match(DESKTOP, /order\.status !== "IN_PROGRESS" && order\.status !== "PENDING"\) continue;/);
  // Pressure bands and loading levels.
  assert.match(DESKTOP, /if \(pct > 90\) return \{ bar: "bg-\[#9A3A2D\]"/);
  assert.match(DESKTOP, /if \(pct >= 70\) return \{ bar: "bg-\[#9C6F1E\]"/);
  assert.match(DESKTOP, /if \(utilization > 100\) level = "critical";\s+else if \(utilization > 90\) level = "high";\s+else if \(utilization > 70\) level = "medium";/);
  // Late = not completed and Target End before today (local midnight diff).
  assert.match(DESKTOP, /if \(diffDays < 0\) \{\s+return \{ label: `\$\{Math\.abs\(diffDays\)\}d overdue`/);
});

// ── Working days & scopes ───────────────────────────────────────────────────
test("recentWorkingDays ends yesterday, skips Sundays and holidays", () => {
  const d = recentWorkingDays(14, none, NOW);
  assert.equal(d.length, 14);
  assert.equal(d[d.length - 1], "2026-10-27");
  assert.ok(!d.includes("2026-10-25"), "Sunday skipped");
  assert.equal(d[0], "2026-10-12");
  const h = recentWorkingDays(14, new Set(["2026-10-27"]), NOW);
  assert.equal(h[h.length - 1], "2026-10-26");
  assert.ok(!h.includes("2026-10-27"));
});

test("upcomingWorkingDays starts today and skips Sunday", () => {
  const d = upcomingWorkingDays(5, none, NOW);
  assert.deepEqual(d, ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-02"]);
});

test("scopeRange: today / Mon-Sat week / calendar month, holidays removed from the count", () => {
  assert.deepEqual(scopeRange("today", none, NOW), { from: "2026-10-28", to: "2026-10-28", workingDays: 1, label: "Today" });
  const w = scopeRange("week", none, NOW);
  assert.equal(w.from, "2026-10-26");
  assert.equal(w.to, "2026-10-31");
  assert.equal(w.workingDays, 6);
  assert.equal(scopeRange("week", new Set(["2026-10-29"]), NOW).workingDays, 5);
  const m = scopeRange("month", none, NOW);
  assert.equal(m.from, "2026-10-01");
  assert.equal(m.to, "2026-10-31");
  assert.equal(m.workingDays, 27); // 31 days - 4 Sundays (4, 11, 18, 25)
  assert.equal(countWorkingDays(new Date(2026, 9, 26), new Date(2026, 9, 31), none), 6);
});

// ── Capacity fixture ────────────────────────────────────────────────────────
// FRAMING: 14 working days ending 2026-10-27. Completed minutes in the window:
//   2026-10-27: 840 (est 840, qty 1)  +  2026-10-20: 560 (actual 280 x qty 2)  => 1400 / 14 = 100 / day.
// Active: SOFA 2 cards (est 100 x qty 3 = 300 due 10-26 OVERDUE; est 200 due 10-28),
//         BEDFRAME 1 card (est 150 due 11-05). Order on hold is ignored.
const jc = (departmentCode, status, extra = {}) => ({ departmentCode, status, ...extra });
const ORDERS = [
  { id: "p1", poNo: "SO-1-01", itemCategory: "SOFA", status: "IN_PROGRESS", jobCards: [
    jc("FRAMING", "COMPLETED", { completedDate: "2026-10-27", estMinutes: 840, wipQty: 1 }),
    jc("FRAMING", "COMPLETED", { completedDate: "2026-10-20", estMinutes: 999, actualMinutes: 280, wipQty: 2 }),
    jc("FRAMING", "WAITING", { dueDate: "2026-10-26", estMinutes: 100, wipQty: 3 }),
    jc("FRAMING", "WAITING", { dueDate: "2026-10-28", estMinutes: 200, wipQty: 1 }),
    jc("FRAMING", "COMPLETED", { completedDate: "2026-09-01", estMinutes: 5000 }), // outside the window
  ] },
  { id: "p2", poNo: "SO-2-01", itemCategory: "BEDFRAME", status: "PENDING", jobCards: [
    jc("FRAMING", "WAITING", { dueDate: "2026-11-05", estMinutes: 150, wipQty: 1 }),
    jc("FRAMING", "TRANSFERRED", { completedDate: "2026-10-27", estMinutes: 1, wipQty: 1 }), // counts as done: +1 min
  ] },
  { id: "p3", poNo: "SO-3-01", itemCategory: "SOFA", status: "ON_HOLD", jobCards: [
    jc("FRAMING", "WAITING", { dueDate: "2026-10-01", estMinutes: 7777, wipQty: 1 }),
  ] },
  { id: "p4", poNo: "SO-4-01", itemCategory: "ACCESSORY", status: "IN_PROGRESS", jobCards: [
    jc("FRAMING", "WAITING", { dueDate: "2026-10-01", estMinutes: 4444, wipQty: 1 }), // not SOFA/BEDFRAME
  ] },
  { id: "p5", poNo: "SO-5-01", itemCategory: "SOFA", status: "IN_PROGRESS", jobCards: [
    jc("FAB_CUT", "WAITING", { dueDate: "2026-10-27", estMinutes: 90, wipQty: 6 }), // FAB_CUT: per-set total, NOT x wipQty
  ] },
];

test("dailyCapacityOf = completed + transferred minutes in the window / 14 (actual wins, x wipQty)", () => {
  // 840 + 280*2 + 1 = 1401 -> /14 = 100.07 -> 100
  assert.equal(dailyCapacityOf(ORDERS, "FRAMING", none, NOW), 100);
  assert.equal(dailyCapacityOf(ORDERS, "PACKING", none, NOW), 0);
});

test("buildCapacity: backlog, scope load, pressure and overdue for a department", () => {
  const today = buildCapacity(ORDERS, "today", none, NOW);
  const f = today.depts.find((d) => d.code === "FRAMING");
  assert.equal(f.dailyCapacity, 100);
  assert.equal(f.sofaBacklog, 100 * 3 + 200); // 500
  assert.equal(f.bfBacklog, 150);
  assert.equal(f.totalBacklog, 650);
  assert.equal(f.totalBacklogDays, 6.5);
  // Today scope: due <= 2026-10-28 => both sofa cards (overdue included) = 500; scope capacity 100 x 1.
  assert.equal(f.totalScopeLoad, 500);
  assert.equal(f.scopeCapacity, 100);
  assert.equal(f.totalScopeUtilization, 500);
  assert.equal(f.jobsInScope, 2);
  assert.equal(f.overdueCount, 1); // only the 10-26 card; hold + accessory ignored
  // Week scope: 6 working days -> capacity 600, load still 500 (11-05 is later).
  const week = buildCapacity(ORDERS, "week", none, NOW);
  const fw = week.depts.find((d) => d.code === "FRAMING");
  assert.equal(fw.scopeCapacity, 600);
  assert.equal(fw.totalScopeUtilization, Math.round((500 / 600) * 100));
  assert.equal(pressureBand(fw.totalScopeUtilization), "busy");
  // Month scope includes the 11-05 card? No: month ends 10-31.
  const month = buildCapacity(ORDERS, "month", none, NOW);
  assert.equal(month.depts.find((d) => d.code === "FRAMING").totalScopeLoad, 500);
  // FAB_CUT cards are per-set totals: 90, not 90 x 6.
  assert.equal(today.depts.find((d) => d.code === "FAB_CUT").sofaBacklog, 90);
});

test("buildCapacity totals and split", () => {
  const s = buildCapacity(ORDERS, "week", none, NOW);
  assert.equal(s.totalCapacity, 100); // only FRAMING has completions
  assert.equal(s.totalScopeCapacity, 600);
  assert.equal(s.totalScopeLoad, 500 + 90);
  assert.equal(s.sofaScopeUtilization, Math.round(((500 + 90) / 600) * 100));
  assert.equal(s.bfScopeUtilization, 0);
});

test("pressure bands and loading levels use the desktop thresholds", () => {
  assert.equal(pressureBand(91), "high");
  assert.equal(pressureBand(90), "busy");
  assert.equal(pressureBand(70), "busy");
  assert.equal(pressureBand(69), "normal");
  assert.equal(loadingLevel(101), "critical");
  assert.equal(loadingLevel(100), "high");
  assert.equal(loadingLevel(91), "high");
  assert.equal(loadingLevel(90), "medium");
  assert.equal(loadingLevel(71), "medium");
  assert.equal(loadingLevel(70), "low");
});

test("buildLoading: 14 past + 21 future working days, category share, job drilldown", () => {
  const all = buildLoading(ORDERS, "FRAMING", "ALL", none, NOW);
  assert.equal(all.past.length, 14);
  assert.equal(all.future.length, 21);
  assert.equal(all.future[0].date, "2026-10-28"); // today is the first PLAN day
  assert.equal(all.past[all.past.length - 1].date, "2026-10-27");
  assert.equal(all.dailyCapacityMinutes, 100);
  const last = all.past[all.past.length - 1];
  assert.equal(last.minutes, 841); // 840 completed + 1 transferred on 10-27
  assert.equal(last.utilization, 841);
  assert.equal(all.future[0].minutes, 200);
  assert.equal(all.future[0].jobs.length, 1);
  assert.equal(all.future[0].jobs[0].orderId, "p1");
  // The 10-26 overdue card is before today: not on a plan bar. 11-05 is inside the 21-day window.
  const nov5 = all.future.find((d) => d.date === "2026-11-05");
  assert.equal(nov5.minutes, 150);
  // Category share: past mix is sofa 840 + 560 = 1400, bedframe 1 => bedframe share 1/1401.
  const bf = buildLoading(ORDERS, "FRAMING", "BEDFRAME", none, NOW);
  assert.ok(Math.abs(bf.dailyCapacityMinutes - 100 * (1 / 1401)) < 1e-9);
  assert.equal(bf.future.find((d) => d.date === "2026-11-05").jobs.length, 1);
  assert.equal(bf.future[0].minutes, 0); // the sofa card is filtered out
  // No capacity -> no percentages (desktop guard), not a division blow-up.
  const none2 = buildLoading(ORDERS, "PACKING", "ALL", none, NOW);
  assert.equal(none2.dailyCapacityMinutes, 0);
  assert.ok(none2.future.every((d) => d.utilization === 0));
});

test("hoursLabel", () => {
  assert.equal(hoursLabel(0), "0h");
  assert.equal(hoursLabel(450), "7.5h");
  assert.equal(hoursLabel(660), "11h");
});

// ── Master Tracker ──────────────────────────────────────────────────────────
test("tracker: Late = not completed and Target End before today; labels follow the desktop", () => {
  assert.deepEqual(targetState({ status: "IN_PROGRESS", targetEndDate: "2026-10-27" }, NOW), { kind: "late", days: 1 });
  assert.deepEqual(targetState({ status: "IN_PROGRESS", targetEndDate: "2026-10-28" }, NOW), { kind: "left", days: 0 });
  assert.deepEqual(targetState({ status: "PENDING", targetEndDate: "2026-11-02" }, NOW), { kind: "left", days: 5 });
  assert.deepEqual(targetState({ status: "COMPLETED", targetEndDate: "2020-01-01" }, NOW), { kind: "done" });
  assert.deepEqual(targetState({ status: "PENDING", targetEndDate: "" }, NOW), { kind: "none" });
  assert.equal(isLate({ status: "IN_PROGRESS", targetEndDate: "2026-10-27", jobCards: [] }, NOW), true);
});

const T = (id, over) => ({ id, poNo: id, itemCategory: "SOFA", status: "IN_PROGRESS", targetEndDate: "2026-11-01", jobCards: [], customerName: "Acme", productName: "Aspen", ...over });
test("tracker: search, chips and Target End sort", () => {
  const list = [
    T("PO-3", { targetEndDate: "2026-11-09", itemCategory: "BEDFRAME", customerName: "Beta" }),
    T("PO-1", { targetEndDate: "2026-10-20" }),
    T("PO-2", { targetEndDate: "2026-10-30", salesOrderNo: "SO-77", productCode: "ASP-3S" }),
  ];
  assert.deepEqual(filterTracker(list, "", "ALL", NOW).map((o) => o.id), ["PO-1", "PO-2", "PO-3"]);
  assert.deepEqual(filterTracker(list, "", "BEDFRAME", NOW).map((o) => o.id), ["PO-3"]);
  assert.deepEqual(filterTracker(list, "", "LATE", NOW).map((o) => o.id), ["PO-1"]);
  assert.deepEqual(filterTracker(list, "so-77", "ALL", NOW).map((o) => o.id), ["PO-2"]);
  assert.deepEqual(filterTracker(list, "asp-3s", "ALL", NOW).map((o) => o.id), ["PO-2"]);
  assert.deepEqual(filterTracker(list, "beta", "ALL", NOW).map((o) => o.id), ["PO-3"]);
  assert.equal(matchesSearch(list[0], "   "), true);
});

test("tracker: department progress follows the desktop cell rules", () => {
  const o = T("PO-9", { currentDepartment: "WOOD_CUT", jobCards: [
    jc("FAB_CUT", "COMPLETED"), jc("FAB_SEW", "TRANSFERRED"), jc("WOOD_CUT", "IN_PROGRESS"), jc("PACKING", "WAITING"),
  ] });
  const s = Object.fromEntries(segments(o).map((x) => [x.code, x.state]));
  assert.equal(s.FAB_CUT, "done");
  assert.equal(s.FAB_SEW, "done");
  assert.equal(s.WOOD_CUT, "current");
  assert.equal(s.PACKING, "pending");
  assert.equal(s.FIBRE, "none");
  assert.deepEqual(progressOf(o), { done: 2, total: 4 });
  assert.equal(deptLabel(o), "Wood Cut");
  assert.equal(deptLabel({ ...o, status: "COMPLETED" }), "Done");
});

// ── Schedule parsing ────────────────────────────────────────────────────────
const SEP = (d, n = 15) => { const r = Array(n).fill(""); r[0] = `${d}  Tue   (Day 1)`; return r; };
const CUT_HEADER = Array(15).fill("h");
const CUT_ROW = (arrow, lane, cut, soPo, customer, label, fabric, sets, cdd) =>
  [arrow, lane, cut, "cfg", "Q", soPo, customer, label, fabric, sets, 2, cdd, "", "", "—"];

test("schedule: day = scheduler separator; rows before the first separator are Unscheduled", () => {
  const snap = { generatedAt: "x", department: "Fabric Cutting", sheets: { "Cut Calendar": [
    CUT_HEADER,
    CUT_ROW("", "Sofa", "B9", "SO-1-01", "Acme", "Seat", "VLV", 2, "2026-10-01"),
    SEP("2026-10-29"),
    CUT_ROW("", "Bedframe", "B1", "SO-2-03", "Beta", "Headboard", "KN", 1, "2026-12-01"),
    CUT_ROW("", "", "", "SO-2-04", "Beta", "Rail", "KN", 3, ""),
    SEP("2026-10-30"),
    CUT_ROW("", "Sofa", "C1", "SO-3-01", "Gamma", "Arm", "LN", 1, ""),
  ] } };
  const cfg = SCHEDULE_DEPT_BY_CODE.FAB_CUT;
  const jobs = parseSchedule(snap, cfg);
  assert.equal(jobs.length, 4);
  assert.equal(jobs[0].day, null);
  assert.equal(jobs[1].day, "2026-10-29");
  assert.equal(jobs[2].lane, "BEDFRAME", "lane carries to the next row of the same cut");
  assert.equal(jobs[2].groupKey, "B1");
  assert.equal(jobs[2].soKey, "SO-2");
  assert.equal(jobs[2].soPo, "SO-2-04");
  assert.equal(jobs[3].day, "2026-10-30");
  assert.equal(jobsOnDay(jobs, "UNSCHED").length, 1);
  assert.equal(jobsOnDay(jobs, "2026-10-29").length, 2);
  assert.equal(jobs[1].cdd, "2026-12-01");
  assert.equal(jobs[2].cdd, null);
  const lanes = groupByLane(jobsOnDay(jobs, "2026-10-29"));
  assert.deepEqual(lanes.map((g) => g.label), ["Bedframe"]);
  assert.equal(summarize(jobsOnDay(jobs, "2026-10-29"), cfg), "2 orders · 4 set");
});

test("schedule: SO-level departments carry SO / customer / lane from the first row of the unit", () => {
  const cfg = SCHEDULE_DEPT_BY_CODE.FRAMING;
  const row = (lane, so, models, label, pcs, mins, customer, cdd) => ["", lane, so, models, label, pcs, mins, 1, "-", "-", customer, cdd, "", ""];
  const snap = { sheets: { "Framing Calendar": [
    Array(14).fill("h"),
    SEP("2026-11-02", 14),
    row("Sofa", "SO-9", "Aspen", "Frame A", 2, 120, "Acme", "2026-11-20"),
    row("", "", "", "Frame B", 1, 60, "", "2026-11-20"),
  ] } };
  const jobs = parseSchedule(snap, cfg);
  assert.equal(jobs.length, 2);
  assert.deepEqual([jobs[1].soKey, jobs[1].lane, jobs[1].customer], ["SO-9", "SOFA", "Acme"]);
  assert.equal(summarize(jobs, cfg), "2 items · 3 pc · 180 min");
});

test("schedule: Foam Cutting and Fibre have no live endpoint and use the bundled empty snapshot", () => {
  for (const code of ["FOAM_CUTTING", "FIBRE"]) {
    const cfg = SCHEDULE_DEPT_BY_CODE[code];
    assert.equal(cfg.slug, null);
    assert.ok(cfg.staticSnapshot, "bundled snapshot present");
    assert.deepEqual(parseSchedule(cfg.staticSnapshot, cfg), []);
  }
  // The desktop pages call these URLs and fall back; the API still has no such slug.
  assert.ok(!/"foam-cutting"|\bfibre:/.test(API_SCHEDULE.slice(API_SCHEDULE.indexOf("DEPT_SLUGS"), API_SCHEDULE.indexOf("DEPT_SLUGS") + 400)));
  // Every other department maps to a slug the API knows.
  for (const d of SCHEDULE_DEPTS.filter((x) => x.slug)) {
    assert.ok(API_SCHEDULE.includes(`"${d.slug}"`) || API_SCHEDULE.includes(`${d.slug}:`), d.slug);
  }
});

test("schedule: sheet layouts match the engine rows (header counts)", () => {
  const CHAIN = read("src/api/lib/planning-chain.ts");
  assert.match(CHAIN, /"Sew Calendar": calRows/);
  assert.match(CHAIN, /"Wood Cut Calendar": calRows/);
  assert.match(CHAIN, /"Framing Calendar": calRows/);
  assert.match(CHAIN, /"Foam Calendar": calRows/);
  assert.match(CHAIN, /"Uph Calendar": calRows/);
  assert.match(CHAIN, /"Pack Calendar": calRows/);
  assert.match(CHAIN, /"Webbing Calendar": calRows/);
});

// ── Safe order matching ─────────────────────────────────────────────────────
const O = (id, so, lineNo, cat, jcs, extra = {}) => ({ id, poNo: `${so}-${String(lineNo).padStart(2, "0")}`, companySOId: so, lineNo, itemCategory: cat, status: "IN_PROGRESS", jobCards: jcs, customerName: "Acme", customerDeliveryDate: "2026-12-01", ...extra });

test("lineLabelOf mirrors the API's soPoOf", () => {
  assert.equal(lineLabelOf({ id: "a", poNo: "PO-5", companySOId: "SO-1", lineNo: 3 }), "SO-1-03");
  assert.equal(lineLabelOf({ id: "a", poNo: "PO-5", companySOId: "", lineNo: 3 }), "PO-5");
  assert.match(API_SCHEDULE, /const line = r\.lineNo != null \? `-\$\{String\(r\.lineNo\)\.padStart\(2, "0"\)\}` : "";/);
  assert.equal(soOfLabel("SO-2610-012-01"), "SO-2610-012");
});

test("resolveJob: per-line labels need exactly one order", () => {
  const orders = [O("a", "SO-1", 1, "SOFA", []), O("b", "SO-1", 2, "SOFA", [])];
  const idx = buildOrderIndex(orders);
  const job = (soPo) => ({ id: "j", dept: "FAB_CUT", day: null, lane: "SOFA", groupKey: "B1", soKey: soOfLabel(soPo), soPo, label: "Seat", model: "", customer: "", fabric: "", qty: 1, mins: null, cdd: null });
  assert.equal(resolveJob(job("SO-1-02"), idx).order.id, "b");
  assert.equal(resolveJob(job("SO-1-09"), idx).order, null);
  // Two orders claiming the same label -> ambiguous -> null.
  const dup = buildOrderIndex([O("a", "SO-1", 1, "SOFA", []), O("c", "SO-1", 1, "SOFA", [])]);
  assert.equal(resolveJob(job("SO-1-01"), dup).order, null);
});

test("resolveJob: SO-level rows open an order only when SO + lane + dept (+ WIP label) leave one", () => {
  const w = (label, due) => jc("FRAMING", "WAITING", { wipLabel: label, dueDate: due });
  const job = (label, lane = "SOFA") => ({ id: "j", dept: "FRAMING", day: "2026-11-02", lane, groupKey: "SO-9", soKey: "SO-9", soPo: "", label, model: "", customer: "", fabric: "", qty: 1, mins: 60, cdd: null });
  // One sofa order waiting in Framing -> unambiguous.
  let idx = buildOrderIndex([O("a", "SO-9", 1, "SOFA", [w("Frame A", "2026-10-30")]), O("b", "SO-9", 2, "BEDFRAME", [w("Frame A", "2026-10-30")])]);
  let r = resolveJob(job("Frame A"), idx);
  assert.equal(r.order.id, "a");
  assert.equal(r.jobCard.dueDate, "2026-10-30");
  assert.equal(resolveJob(job("Frame A", "BEDFRAME"), idx).order.id, "b");
  // Two sofa orders, different WIP labels -> the label settles it.
  idx = buildOrderIndex([O("a", "SO-9", 1, "SOFA", [w("Frame A", "2026-10-30")]), O("b", "SO-9", 2, "SOFA", [w("Frame B", "2026-10-31")])]);
  assert.equal(resolveJob(job("Frame B"), idx).order.id, "b");
  // Two sofa orders, same label -> ambiguous, never a guess.
  idx = buildOrderIndex([O("a", "SO-9", 1, "SOFA", [w("Frame A", "2026-10-30")]), O("b", "SO-9", 2, "SOFA", [w("Frame A", "2026-10-31")])]);
  r = resolveJob(job("Frame A"), idx);
  assert.equal(r.order, null);
  assert.equal(r.soOrders.length, 2, "SO-level facts stay available");
  // No order waiting in this department -> none.
  idx = buildOrderIndex([O("a", "SO-9", 1, "SOFA", [jc("PACKING", "WAITING")])]);
  assert.equal(resolveJob(job("Frame A"), idx).order, null);
  // Unknown SO -> none.
  assert.equal(resolveJob({ ...job("x"), soKey: "SO-0" }, idx).order, null);
});

test("resolveJob: dept due date only when the department job card is unambiguous", () => {
  const w = (label, due) => jc("FRAMING", "WAITING", { wipLabel: label, dueDate: due });
  const job = { id: "j", dept: "FRAMING", day: null, lane: "SOFA", groupKey: "SO-9", soKey: "SO-9", soPo: "", label: "", model: "", customer: "", fabric: "", qty: 1, mins: null, cdd: null };
  const same = buildOrderIndex([O("a", "SO-9", 1, "SOFA", [w("A", "2026-10-30"), w("B", "2026-10-30")])]);
  assert.equal(resolveJob(job, same).jobCard.dueDate, "2026-10-30");
  const diff = buildOrderIndex([O("a", "SO-9", 1, "SOFA", [w("A", "2026-10-30"), w("B", "2026-10-31")])]);
  assert.equal(resolveJob(job, diff).order.id, "a");
  assert.equal(resolveJob(job, diff).jobCard, null);
});

test("commonValue / scopeTokens / dates / customer DD overdue", () => {
  assert.equal(commonValue([{ customerDeliveryDate: "d1" }, { customerDeliveryDate: "d1" }], (o) => o.customerDeliveryDate), "d1");
  assert.equal(commonValue([{ customerDeliveryDate: "d1" }, { customerDeliveryDate: "d2" }], (o) => o.customerDeliveryDate), "");
  const jobs = [{ soKey: "SO-1", soPo: "" }, { soKey: "", soPo: "SO-2-03" }, { soKey: "SO-1", soPo: "" }];
  assert.deepEqual(scopeTokens(jobs), ["SO-1", "SO-2"]);
  assert.equal(mondayOf("2026-10-29"), "2026-10-26");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26", "Sunday belongs to the week before");
  assert.deepEqual(weekDays("2026-10-26"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  assert.equal(addDays("2026-10-31", 2), "2026-11-02");
  assert.equal(shortDate("2026-10-29"), "29 Oct");
  assert.equal(shortDate(""), "—");
  // Desktop isOverdueDate compares with the UTC date; mobile keeps that rule.
  assert.match(read("src/pages/planning/dept/_DepartmentSchedulePage.tsx"), /const todayISO = new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/);
  assert.equal(isCustomerDdOverdue("2026-10-01", new Date("2026-10-28T10:00:00Z")), true);
  assert.equal(isCustomerDdOverdue("2026-10-28", new Date("2026-10-28T10:00:00Z")), false);
  assert.equal(isCustomerDdOverdue("", new Date()), false);
});

// ── Lead times view ─────────────────────────────────────────────────────────
test("lead times: rows, total, buffer, pending and derived 'from -> to' (no actor in the API)", () => {
  const lead = { BEDFRAME: { FAB_CUT: 1, WOOD_CUT: 2, UPHOLSTERY: 2 }, SOFA: { FAB_SEW: 2 }, hookkaDDBuffer: { BEDFRAME: 2, SOFA: 1 }, autoScheduleEnabled: false };
  const hist = {
    leadTimes: [
      { id: "1", kind: "leadTime", category: "SOFA", deptCode: "FAB_SEW", days: 1, effectiveFrom: "2026-09-01", status: "Past" },
      { id: "2", kind: "leadTime", category: "SOFA", deptCode: "FAB_SEW", days: 2, effectiveFrom: "2026-10-01", status: "Active", notes: "Second line" },
      { id: "3", kind: "leadTime", category: "SOFA", deptCode: "FAB_SEW", days: 3, effectiveFrom: "2026-11-15", status: "Pending" },
    ],
    hookkaBuffer: [{ id: "4", kind: "hookkaBuffer", category: "BEDFRAME", days: 2, effectiveFrom: "2026-10-02", status: "Active" }],
  };
  const v = buildLeadView(lead, hist, "BEDFRAME");
  assert.equal(v.rows.length, 10);
  assert.equal(v.rows[0].dept, "Fabric Cutting");
  assert.equal(v.total, 5);
  assert.equal(v.buffer, 2);
  assert.equal(v.autoSchedule, false);
  assert.equal(v.pending.length, 1);
  assert.equal(v.pending[0].change, "2 days → 3 days");
  assert.equal(v.pending[0].title, "Fabric Sewing · Sofa");
  assert.deepEqual(v.history.map((h) => h.id), ["4", "2", "1"]);
  assert.equal(v.history.find((h) => h.id === "2").change, "1 day → 2 days");
  assert.equal(v.history.find((h) => h.id === "1").change, "1 day");
  assert.equal(v.history.find((h) => h.id === "4").title, "Hookka DD buffer · Bedframe");
  assert.equal(buildLeadView(null, null, "SOFA").rows[0].days, 0);
  // A pending row with NO earlier history changes from the live value in the lead-time map.
  const onlyPending = { leadTimes: [{ id: "9", kind: "leadTime", category: "SOFA", deptCode: "FAB_SEW", days: 1, effectiveFrom: "2026-12-01", status: "Pending" }], hookkaBuffer: [] };
  assert.equal(buildLeadView({ SOFA: { FAB_SEW: 2 } }, onlyPending, "SOFA").pending[0].change, "2 days → 1 day");
});

test("unmatched jobs stay in the list: matching only decides tappability, never visibility", () => {
  const cfg = SCHEDULE_DEPT_BY_CODE.FRAMING;
  const row = (lane, so, label) => ["", lane, so, "M", label, 1, 30, 1, "-", "-", "Acme", "2026-12-01", "", ""];
  const snap = { sheets: { "Framing Calendar": [Array(14).fill("h"), SEP("2026-11-02", 14), row("Sofa", "SO-1", "A"), row("Weird lane", "SO-2", "B"), row("Sofa", "SO-NOPE", "C")] } };
  const jobs = parseSchedule(snap, cfg);
  const day = jobsOnDay(jobs, "2026-11-02");
  assert.equal(day.length, 3);
  // Every job is rendered in some lane group, including the one with an unknown lane.
  assert.equal(groupByLane(day).reduce((n, g) => n + g.jobs.length, 0), 3);
  assert.ok(groupByLane(day).some((g) => g.label === "Other"));
  // With no orders loaded at all, nothing resolves — and nothing is dropped.
  const idx = buildOrderIndex([]);
  assert.ok(day.every((j) => resolveJob(j, idx).order === null));
  assert.equal(jobsOnDay(jobs, "2026-11-02").length, 3);
});
