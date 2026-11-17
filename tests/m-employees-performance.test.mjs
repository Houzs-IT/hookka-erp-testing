// m-employees-performance.test.mjs — HK-0125 Phase 4, step 2: Employees → Employee Performance. Sample values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activeChip,
  backToEfficiency,
  breakdownRows,
  breakdownStats,
  sumCredited,
  epChips,
  extraProduction,
  filterBreakdown,
  pickerWorkers,
  resolveWorker,
  statusTone,
  toEmployeePerformance,
  totalOtMinutes,
} from "../src/pages/m/screens/employees/employee-performance-model.ts";
import { buildEfficiencyRows, statCells } from "../src/pages/m/screens/employees/efficiency-model.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, "");

// ---- tap → same worker, same range, search kept; Back restores them ---------------------------------------------------------
test("a ranking tap opens the worker with the SAME range and the search carried along", () => {
  const prev = new URLSearchParams("section=efficiency&from=2026-10-01&to=2026-10-31&eq=hafiz");
  const next = toEmployeePerformance(prev, "w-5");
  assert.equal(next.get("section"), "employee-performance");
  assert.equal(next.get("worker"), "w-5");
  assert.equal(next.get("ref"), "efficiency");
  assert.equal(next.get("from"), "2026-10-01");
  assert.equal(next.get("to"), "2026-10-31");
  assert.equal(next.get("eq"), "hafiz");
  assert.equal(prev.get("section"), "efficiency", "the old params are not mutated");
});

test("Back returns to the ranking with the date range and the search it was left with", () => {
  const there = toEmployeePerformance(new URLSearchParams("section=efficiency&from=2026-11-01&to=2026-11-10&eq=ann"), "w-1");
  const back = backToEfficiency(there);
  assert.equal(back.get("section"), "efficiency");
  assert.equal(back.get("worker"), null);
  assert.equal(back.get("ref"), null);
  assert.equal(back.get("from"), "2026-11-01");
  assert.equal(back.get("to"), "2026-11-10");
  assert.equal(back.get("eq"), "ann");
  // a range changed on the Employee Performance screen follows you back (the period is shared)
  there.set("from", "2026-11-05");
  assert.equal(backToEfficiency(there).get("from"), "2026-11-05");
});

test("the wiring: the ranking pushes a history entry, the back link only shows when arriving from the ranking", () => {
  const eff = strip(src("EfficiencySection.tsx"));
  assert.match(eff, /toEmployeePerformance\(prev, r\.workerId\)\)\}/);
  assert.ok(!/toEmployeePerformance[^\n]*replace/.test(eff), "a pushed entry, so the hardware Back works too");
  assert.match(eff, /Tap a worker for Employee Performance\./);
  const ep = strip(src("EmployeePerformanceSection.tsx"));
  assert.match(ep, /params\.get\("ref"\) === "efficiency"/);
  assert.match(ep, /backToEfficiency\(prev\)/);
  assert.match(ep, /fromRanking \? \(/);
  const route = strip(src("EmployeesRoute.tsx"));
  assert.match(route, /section === "employee-performance" \? <EmployeePerformanceSection \/> : null/);
  assert.match(route, /\.\.\.EP_PARAMS/, "the worker param does not follow you to another section");
});

// ---- period chips -----------------------------------------------------------------------------------------------------------
test("chips: Today · 7d · 30d (inclusive, ending today) · This month · Last month", () => {
  const c = Object.fromEntries(epChips("2026-11-13").map((x) => [x.key, x.range]));
  assert.deepEqual(c.today, { from: "2026-11-13", to: "2026-11-13" });
  assert.deepEqual(c["7d"], { from: "2026-11-07", to: "2026-11-13" });
  assert.deepEqual(c["30d"], { from: "2026-10-15", to: "2026-11-13" });
  assert.deepEqual(c.month, { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(c.last, { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(epChips("2027-01-05").find((x) => x.key === "last").range, { from: "2026-12-01", to: "2026-12-31" }, "January → December of last year");
  assert.equal(activeChip({ from: "2026-11-07", to: "2026-11-13" }, "2026-11-13"), "7d");
  assert.equal(activeChip({ from: "2026-11-02", to: "2026-11-13" }, "2026-11-13"), null, "a custom range lights no chip");
});

// ---- the picker -------------------------------------------------------------------------------------------------------------
const W = (id, empNo, name, status = "ACTIVE") => ({ id, empNo, name, status });
const roster = [W("c", "EMP-003", "Cat"), W("a", "EMP-001", "Ann"), W("r", "EMP-009", "Resigned Rex", "RESIGNED"), W("t", "TEST-01", "Test Account"), W("b", "EMP-002", "Bob")];

test("picker: active, non-test workers by employee number; a selected inactive worker stays reachable", () => {
  assert.deepEqual(pickerWorkers(roster, "").map((w) => w.id), ["a", "b", "c"]);
  assert.deepEqual(pickerWorkers(roster, "r").map((w) => w.id), ["a", "b", "c", "r"], "tapped from the ranking, so still listed");
  assert.deepEqual(pickerWorkers(roster, "t").map((w) => w.id), ["a", "b", "c", "t"]);
});

test("worker: the one asked for (any status), else the first available; none → null", () => {
  assert.equal(resolveWorker("r", roster).id, "r");
  assert.equal(resolveWorker(null, roster).id, "a");
  assert.equal(resolveWorker("no-such-id", roster).id, "a");
  assert.equal(resolveWorker(null, [W("x", "EMP-1", "X", "RESIGNED")]), null);
  assert.equal(resolveWorker(null, []), null);
});

// ---- efficiency matches the ranking ------------------------------------------------------------------------------------------
test("the efficiency on this screen is the ranking's own: same function, same inputs, same text, same colour source", () => {
  const depts = [{ code: "UPH", name: "Upholstery", isProduction: true }];
  const workers = [W("a", "EMP-001", "Ann"), W("b", "EMP-002", "Bob")];
  // earned = job cards 600 + approved extra 120 = 720, already ONE figure from the job-cards summary
  const rows = buildEfficiencyRows({ workers, hours: [{ workerId: "a", byDept: { UPH: 20 }, daysWithEntries: 4, totalHours: 20 }, { workerId: "b", byDept: { UPH: 10 }, daysWithEntries: 2, totalHours: 10 }], earned: [{ workerId: "a", productionMinutes: 720 }, { workerId: "b", productionMinutes: 300 }], depts });
  const ann = rows.find((r) => r.workerId === "a");
  assert.equal(statCells(ann)[4].v, "60.0%");
  const ep = strip(src("EmployeePerformanceSection.tsx"));
  assert.match(ep, /buildEfficiencyRows\(\{ workers: base\.workers\.rows, hours: base\.hours\.rows, earned: earnedMissing \? null : base\.earned\.rows/);
  assert.match(ep, /const effText = row \? statCells\(row\)\[4\]\.v : "—"/);
  assert.match(ep, /efficiencyTone\(row\?\.eff \?\? null\)/);
  assert.ok(!/\* 100|\/ 60|productionMinutes|nonprod-requests/i.test(ep.replace(/fmtHM\(row\.prodHours \* 60\)|fmtHM\(row\.nonProdHours \* 60\)/g, "")), "no second efficiency formula on this screen");
  assert.match(strip(src("use-employee-performance.ts")), /useEmployeeExtras\(base: EfficiencyData/, "reuses the ranking's data, not its own copy");
});

const sumCreditedOf = (cards) => sumCredited(breakdownRows(cards, () => ""));
// ---- Daily Breakdown ---------------------------------------------------------------------------------------------------------
const JC = (o) => ({ id: "j" + Math.random(), productCode: "5530-1A", wipLabel: "5530 Right Arm", wipQty: 1, departmentCode: "UPH", completedDate: "2026-11-04", productionTimeMinutes: 60, status: "COMPLETED", hasBothPics: false, ...o });
const deptName = (c) => ({ UPH: "Upholstery" })[c] ?? c;

test("credited time: the worker's half of a shared job, the whole of a solo one; real Completed / Transferred status", () => {
  const rows = breakdownRows([
    JC({ id: "1", productionTimeMinutes: 90 }),
    JC({ id: "2", productionTimeMinutes: 90, hasBothPics: true, status: "TRANSFERRED", completedDate: "2026-11-05" }),
    JC({ id: "3", completedDate: null }),
  ], deptName);
  assert.equal(rows.length, 2, "a card without a completion date is not listed (desktop's rule)");
  assert.deepEqual(rows.map((r) => [r.key, r.creditedMin, r.totalMin, r.shared, r.statusLabel]), [["2", 45, 90, true, "Transferred"], ["1", 90, 90, false, "Completed"]]);
  assert.deepEqual(rows.map((r) => r.date), ["2026-11-05", "2026-11-04"], "newest first");
});

test("card cells follow desktop: ONE date, then Date · Department / Qty · Total JC Time (the FULL duration)", () => {
  const [solo] = breakdownRows([JC({ wipQty: 2, productionTimeMinutes: 150 })], deptName);
  const cells = breakdownStats(solo);
  assert.deepEqual(cells.map((c) => c.k), ["Date", "Department", "Qty", "Total JC Time"]);
  assert.equal(cells[0].v, "2026-11-04", "completedDate is the only date the job-card response has");
  assert.equal(cells[1].v, "Upholstery");
  assert.equal(cells[2].v, "2");
  assert.deepEqual([cells[3].kind, cells[3].minutes], ["minutes", 150]);
  assert.ok(!cells.some((c) => c.k === "Completion Date"), "no duplicate date");
});

test("a shared job keeps the FULL duration and the worker's half apart: Total JC Time 90 min, Credited time 45 min with a ½", () => {
  const [shared] = breakdownRows([JC({ productionTimeMinutes: 90, hasBothPics: true })], deptName);
  const cells = breakdownStats(shared);
  assert.deepEqual(cells.map((c) => c.k), ["Date", "Department", "Qty", "Total JC Time", "Credited time"]);
  assert.equal(cells[3].minutes, 90, "Total JC Time is the whole card");
  assert.deepEqual([cells[4].kind, cells[4].minutes], ["credited", 45], "Credited time is this worker's half");
  const card = strip(src("BreakdownCard.tsx"));
  assert.match(card, /½/);
  assert.match(card, /gridTemplateColumns: "repeat\(2, minmax\(0, 1fr\)\)"/, "two columns");
  assert.ok(!card.includes("Completion Date"));
  // the sum used for efficiency is still the credited half (unchanged)
  assert.equal(sumCreditedOf([JC({ productionTimeMinutes: 90, hasBothPics: true }), JC({ productionTimeMinutes: 60 })]), 105);
});

test("the JC tag is inline after the title (it follows the last word when the title wraps); the status pill stays top-right", () => {
  const card = strip(src("BreakdownCard.tsx"));
  const title = card.slice(card.indexOf("{head}"), card.indexOf("{r.secondary ?"));
  assert.match(title, /JC<\/span>/, "the JC tag is inside the title element, after the title text");
  assert.match(card, /whiteSpace: "nowrap" \}\}>\s*\{tail\}/, "the last word and the tag are one unbreakable unit, so the tag is never alone on a line");
  assert.match(card, /verticalAlign: "middle"/);
  assert.match(card, /alignItems: "flex-start"/);
  assert.match(card, /alignSelf: "flex-start"/);
});

test("product line: the label first, the product code underneath only when it differs; search by product / code / department", () => {
  const rows = breakdownRows([JC({ id: "1" }), JC({ id: "2", wipLabel: "", productCode: "HB-5001-Q", departmentCode: "FRM" }), JC({ id: "3", wipLabel: "SAME", productCode: "SAME" })], deptName);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual([by["1"].primary, by["1"].secondary], ["5530 Right Arm", "5530-1A"]);
  assert.deepEqual([by["2"].primary, by["2"].secondary], ["HB-5001-Q", ""]);
  assert.equal(by["3"].secondary, "");
  assert.deepEqual(filterBreakdown(rows, "upholstery").map((r) => r.key).sort(), ["1", "3"]);
  assert.deepEqual(filterBreakdown(rows, "hb-5001").map((r) => r.key), ["2"]);
  assert.equal(filterBreakdown(rows, "  ").length, 3);
  assert.equal(filterBreakdown(rows, "zzz").length, 0);
});

// ---- Extra Production Time: separate, shown only when verified ---------------------------------------------------------------
const range = { from: "2026-11-01", to: "2026-11-30" };
const cardsA = [JC({ id: "1", productionTimeMinutes: 600 }), JC({ id: "2", productionTimeMinutes: 200, hasBothPics: true })]; // credited 600 + 100 = 700
const claim = (o) => ({ workerId: "a", kind: "ADD_PROD", status: "APPROVED", date: "2026-11-10", hours: 3, approvedHours: 2, ...o });

test("extra time is shown when the approved claims agree with what the summary leaves after the job cards", () => {
  // summary 820 = job cards 700 + approved extra 120 (2 h approved of 3 h asked)
  const r = extraProduction({ workerId: "a", range, claims: [claim({})], cards: cardsA, summaryMin: 820 });
  assert.deepEqual(r, { state: "ok", minutes: 120 });
  // other workers, other kinds, rejected / pending and out-of-range claims are ignored
  const noise = [claim({ workerId: "z" }), claim({ kind: "NONPROD" }), claim({ status: "REJECTED" }), claim({ status: "PENDING" }), claim({ date: "2026-12-01" })];
  assert.deepEqual(extraProduction({ workerId: "a", range, claims: [claim({}), ...noise], cards: cardsA, summaryMin: 820 }), { state: "ok", minutes: 120 });
  // a legacy claim with no approved hours counts its hours
  assert.deepEqual(extraProduction({ workerId: "a", range, claims: [claim({ approvedHours: null, hours: 1.5 })], cards: cardsA, summaryMin: 790 }), { state: "ok", minutes: 90 });
  // none claimed and none missing: verified zero
  assert.deepEqual(extraProduction({ workerId: "a", range, claims: [], cards: cardsA, summaryMin: 700 }), { state: "ok", minutes: 0 });
});

test("extra time reads '—' (unverified) whenever the data is incomplete or disagrees", () => {
  const ok = { workerId: "a", range, claims: [claim({})], cards: cardsA, summaryMin: 820 };
  assert.equal(extraProduction({ ...ok, claims: null }).state, "unverified", "claims not loaded / no permission");
  assert.equal(extraProduction({ ...ok, cards: null }).state, "unverified");
  assert.equal(extraProduction({ ...ok, summaryMin: null }).state, "unverified");
  assert.equal(extraProduction({ ...ok, summaryMin: 900 }).state, "unverified", "the summary has minutes the claims do not explain");
  assert.equal(extraProduction({ ...ok, summaryMin: 700 }).state, "unverified", "claims say 120 but the summary has none of it");
  assert.equal(extraProduction({ ...ok, claims: Array.from({ length: 200 }, () => claim({ workerId: "z" })) }).state, "unverified", "a full (capped) claims list may be missing rows");
  assert.equal(extraProduction({ ...ok, cards: Array.from({ length: 5000 }, (_, i) => JC({ id: "c" + i, productionTimeMinutes: 0 })) }).state, "unverified", "a capped job-card list");
  assert.equal(extraProduction({ ...ok, summaryMin: 820.9 }).state, "ok", "within a minute of rounding");
});

test("the extra tile never feeds efficiency; its data is only used for that tile", () => {
  const model = strip(src("employee-performance-model.ts"));
  assert.ok(!/efficiency-model|buildEfficiencyRows/.test(model), "the extra-time rules do not touch the efficiency calculation");
  const ep = strip(src("EmployeePerformanceSection.tsx"));
  assert.match(ep, /extra\.state === "ok" && extra\.minutes > 0/);
  assert.ok(!/extra\.minutes[^\n]*(row|eff)/.test(ep.replace(/\{ l: "Extra Production Time"[^\n]*\n/, "")), "efficiency does not read the extra amount");
  const effOnly = strip(src("EfficiencySection.tsx") + src("use-efficiency.ts") + src("efficiency-model.ts"));
  assert.ok(!/nonprod-requests|ADD_PROD|approvedHours/.test(effOnly), "the ranking's code has no claims path at all");
  assert.match(strip(src("use-employee-performance.ts")), /nonprod-requests\?status=APPROVED/);
});

// ---- Total OT, info, permissions, read-only -------------------------------------------------------------------------------------
test("Total OT sums the worker's overtime minutes; the status pill", () => {
  assert.equal(totalOtMinutes([{ employeeId: "a", overtimeMinutes: 30 }, { employeeId: "a", overtimeMinutes: "45" }, { employeeId: "b", overtimeMinutes: 99 }, { employeeId: "a", overtimeMinutes: null }], "a"), 75);
  assert.deepEqual(statusTone("ACTIVE"), { label: "Active", bg: "#EEF3E4", fg: "#3D6229" });
  assert.equal(statusTone("RESIGNED").label, "Resigned");
  assert.equal(statusTone(undefined).label, "—");
});

test("permissions and read-only: existing endpoints and gates, no write", () => {
  const hook = strip(src("use-employee-performance.ts"));
  assert.match(hook, /\/api\/job-cards\?picId=\$\{id\}&from=\$\{from\}&to=\$\{to\}/);
  assert.match(hook, /base\.canWorkers && base\.canEarned && !!workerId/, "job cards need production-orders:read (the summary's gate)");
  assert.match(hook, /useCanReadAttendance\(\)/, "OT and the claims list need attendance:read");
  assert.match(hook, /\/api\/attendance\?employeeId=/);
  const all = strip(["EmployeePerformanceSection.tsx", "BreakdownPage.tsx", "BreakdownCard.tsx", "WorkerPickerSheet.tsx", "use-employee-performance.ts"].map(src).join("\n"));
  assert.ok(!/method:|mutateJson|fetch\(/.test(all), "read-only");
  const ep = strip(src("EmployeePerformanceSection.tsx"));
  assert.match(ep, /Employee Performance needs access to employee records\./);
  assert.match(ep, /Job cards need access to production orders\./);
  assert.match(ep, /View all \{cards\.length\} items ›/);
});
