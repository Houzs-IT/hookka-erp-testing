// m-employees-efficiency.test.mjs — HK-0125 Phase 4, step 1: Employees → Efficiency Overview (ranking). Sample values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildEfficiencyRows,
  efficiencyTone,
  filterEfficiencyRows,
  fmtHM,
  rankTone,
  statCells,
  whyNoEfficiency,
} from "../src/pages/m/screens/employees/efficiency-model.ts";

const src = (p) => readFileSync(new URL(`../src/pages/m/screens/employees/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, "");

const depts = [
  { code: "UPH", name: "Upholstery", isProduction: true, sequence: 2 },
  { code: "FRM", name: "Framing", isProduction: true, sequence: 1 },
  { code: "WH", name: "Warehousing", isProduction: false, sequence: 9 },
];
const W = (id, empNo, name, extra = {}) => ({ id, empNo, name, ...extra });
const H = (workerId, byDept, days = 4) => ({ workerId, byDept, daysWithEntries: days, totalHours: Object.values(byDept).reduce((a, b) => a + b, 0) });
const E = (workerId, productionMinutes) => ({ workerId, productionMinutes });

const workers = [W("a", "EMP-001", "Ann"), W("b", "EMP-002", "Bob"), W("c", "EMP-003", "Cat"), W("d", "EMP-004", "Dan"), W("e", "EMP-005", "Eve")];

test("worked example: Earned time ÷ production-department hours; non-production hours are not in the denominator", () => {
  // 40 h in Upholstery + 4 h Warehousing; earned 2688 min = 44h48m → 2688 / (40*60) = 112.0%
  const [r] = buildEfficiencyRows({ workers, hours: [H("a", { UPH: 40, WH: 4 })], earned: [E("a", 2688)], depts });
  assert.equal(r.prodHours, 40);
  assert.equal(r.nonProdHours, 4);
  assert.equal(r.totalHours, 44);
  assert.ok(Math.abs(r.eff - 112) < 1e-9);
  assert.deepEqual(statCells(r).map((c) => [c.k, c.v]), [
    ["Total", "44.0h (4d)"],
    ["Earned time", "44h 48m"],
    ["Hours worked", "40h"],
    ["Non-Prod Hrs", "4h"],
    ["Efficiency %", "112.0%"],
    ["Days", "4"],
  ]);
  assert.deepEqual(r.chips.map((c) => [c.label, c.hours, c.production]), [["Upholstery", 40, true], ["Warehousing", 4, false]]);
});

test("sorted by highest efficiency; ties (at the one decimal shown) go by employee number; ranks are 1..n", () => {
  const rows = buildEfficiencyRows({
    workers,
    hours: [H("a", { UPH: 10 }), H("b", { UPH: 10 }), H("c", { UPH: 10 }), H("d", { UPH: 10 })],
    // b and c both show 88.0% (88.04 vs 87.96 raw); d is higher; a is lower
    earned: [E("a", 400), E("b", 528.24), E("c", 527.76), E("d", 540)],
    depts,
  });
  assert.deepEqual(rows.map((r) => r.workerId), ["d", "b", "c", "a"]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4]);
  assert.equal(statCells(rows[1])[4].v, "88.0%");
  assert.equal(statCells(rows[2])[4].v, "88.0%");
});

test("an exact tie goes to the lower employee number, whatever order the server sent", () => {
  const rows = buildEfficiencyRows({ workers, hours: [H("b", { UPH: 10 }), H("a", { UPH: 10 })], earned: [E("b", 300), E("a", 300)], depts });
  assert.deepEqual(rows.map((r) => r.workerId), ["a", "b"]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2]);
});

test("searching keeps every rank where it was", () => {
  const rows = buildEfficiencyRows({
    workers,
    hours: [H("a", { UPH: 10 }), H("b", { UPH: 10 }), H("c", { UPH: 10 })],
    earned: [E("a", 300), E("b", 500), E("c", 400)],
    depts,
  });
  assert.deepEqual(rows.map((r) => [r.name, r.rank]), [["Bob", 1], ["Cat", 2], ["Ann", 3]]);
  const found = filterEfficiencyRows(rows, "ann");
  assert.deepEqual(found.map((r) => [r.name, r.rank]), [["Ann", 3]], "Ann is still #3, not #1");
  assert.deepEqual(filterEfficiencyRows(rows, "emp-002").map((r) => r.name), ["Bob"], "employee number works too");
  assert.deepEqual(filterEfficiencyRows(rows, "  ").length, 3);
  assert.deepEqual(filterEfficiencyRows(rows, "zzz"), []);
});

test("no valid personal efficiency → last, '—', NO rank (helper, no entry days, only non-production hours)", () => {
  const rows = buildEfficiencyRows({
    workers: [...workers, W("h", "EMP-009", "Helper Hal", { isHelper: true }), W("n", "EMP-000", "Nina")],
    hours: [
      H("a", { UPH: 10 }),
      H("h", { UPH: 10 }), // a helper has hours and earned time but no personal efficiency
      H("c", { WH: 8 }), // all hours non-production
      H("n", {}, 0), // no entry days
    ],
    earned: [E("a", 300), E("h", 900), E("c", 100), E("n", 50)],
    depts,
  });
  assert.deepEqual(rows.map((r) => r.workerId), ["a", "n", "c", "h"], "ranked first, then the rest by employee number (EMP-000, EMP-003, EMP-009)");
  assert.deepEqual(rows.map((r) => r.rank), [1, null, null, null]);
  const bad = rows.slice(1);
  for (const r of bad) {
    assert.equal(r.eff, null);
    assert.equal(statCells(r)[4].v, "—");
    assert.notEqual(whyNoEfficiency(r), "");
  }
  assert.deepEqual(bad.map((r) => r.reason), ["no-entries", "no-production-hours", "helper"]);
  // `is_helper` (the raw column) counts too
  assert.equal(buildEfficiencyRows({ workers: [W("a", "EMP-001", "Ann", { is_helper: true })], hours: [H("a", { UPH: 5 })], earned: [E("a", 100)], depts })[0].rank, null);
  // on staging nobody carries the flag: the figures are exactly the old ones
  assert.equal(buildEfficiencyRows({ workers: [W("a", "EMP-001", "Ann")], hours: [H("a", { UPH: 5 })], earned: [E("a", 150)], depts })[0].rank, 1);
});

test("approved extra production time is counted ONCE: Earned time is the single job-cards summary figure", () => {
  // The server's summary row already contains the extra time (job-card minutes 600 + approved extra 120 = 720).
  const rows = buildEfficiencyRows({ workers, hours: [H("a", { UPH: 20 })], earned: [E("a", 720)], depts });
  assert.equal(rows[0].earnedMin, 720);
  assert.ok(Math.abs(rows[0].eff - 60) < 1e-9);
  // a repeated id replaces, never accumulates
  assert.equal(buildEfficiencyRows({ workers, hours: [H("a", { UPH: 20 })], earned: [E("a", 720), E("a", 720)], depts })[0].earnedMin, 720);
  // the screen never reads the claims list nor adds extra time itself
  const code = strip(src("EfficiencySection.tsx") + src("use-efficiency.ts") + src("efficiency-model.ts"));
  assert.ok(!/nonprod-requests|ADD_PROD|approvedHours|extraProd/i.test(code), "no second credit path");
  assert.match(src("use-efficiency.ts"), /\/api\/job-cards\/summary\?from=/);
});

test("desktop's union: a worker with only job-card credit appears (no entry days → '—'); hours with no credit read 0.0%", () => {
  const rows = buildEfficiencyRows({ workers, hours: [H("b", { UPH: 10 })], earned: [E("c", 200)], depts });
  assert.deepEqual(rows.map((r) => [r.workerId, r.rank, r.eff]), [["b", 1, 0], ["c", null, null]]);
  assert.equal(statCells(rows[0])[4].v, "0.0%");
  assert.equal(statCells(rows[0])[1].v, "—", "no earned time reads '—' (HTML)");
  // a worker id with no worker record is still listed (as on desktop), named by its id
  assert.equal(buildEfficiencyRows({ workers: [], hours: [H("zz", { UPH: 1 })], earned: [], depts })[0].name, "zz");
});

test("earned time unavailable (no permission / failed): no efficiency and no ranks, never a made-up zero", () => {
  const rows = buildEfficiencyRows({ workers, hours: [H("a", { UPH: 10 }), H("b", { UPH: 9 })], earned: null, depts });
  assert.deepEqual(rows.map((r) => [r.workerId, r.rank, r.eff, r.earnedMin]), [["a", null, null, null], ["b", null, null, null]]);
  assert.equal(statCells(rows[0])[1].v, "—");
  assert.equal(statCells(rows[0])[4].v, "—");
});

test("department chips: production first by sequence, then non-production; unknown codes are non-production", () => {
  const [r] = buildEfficiencyRows({ workers, hours: [H("a", { WH: 2, UPH: 5, FRM: 3, XYZ: 1 })], earned: [E("a", 100)], depts });
  assert.deepEqual(r.chips.map((c) => c.label), ["Framing", "Upholstery", "Warehousing", "XYZ"]);
  assert.equal(r.nonProdHours, 3);
});

test("time and tone formatting", () => {
  assert.equal(fmtHM(59.6), "1h");
  assert.equal(fmtHM(330), "5h 30m");
  assert.equal(fmtHM(45), "45m");
  assert.equal(fmtHM(0), "0m");
  assert.equal(efficiencyTone(85).fg, "#3D6229");
  assert.equal(efficiencyTone(84.96).fg, "#3D6229", "84.96 shows as 85.0%, so it is green");
  assert.equal(efficiencyTone(84.9).fg, "#85600F");
  assert.equal(efficiencyTone(70).fg, "#85600F");
  assert.equal(efficiencyTone(69.9).fg, "#9A3A2D");
  assert.equal(efficiencyTone(null).fg, "#9A9082");
  assert.deepEqual([1, 2, 3, 4].map((n) => rankTone(n).bg), ["#C9A961", "#B8BCC4", "#C08A5B", "#F4EFE6"]);
});

test("the screen follows the HTML: shared period, search, 40px date button, top 5 + Show all, no badge without a rank", () => {
  const ui = strip(src("EfficiencySection.tsx"));
  assert.match(ui, /useEmployeesPeriod\(\)/, "the shared period (URL from / to)");
  assert.match(ui, /<PeriodSheet/);
  assert.match(ui, /Search employee name or no\./);
  assert.match(ui, /width: 40,\s*height: 40,\s*borderRadius: 12/, "the HTML's 40px rounded-square date button");
  assert.match(ui, /EFF_PREVIEW/);
  assert.match(ui, /Show all \$\{/);
  assert.match(ui, /Show less/);
  assert.match(ui, /r\.rank !== null/, "a badge only when ranked");
  assert.match(ui, /No employees match/);
  const hook = strip(src("use-efficiency.ts"));
  assert.match(hook, /\/api\/working-hour-entries\/summary\?from=/);
  assert.match(hook, /hasPermission\("production-orders", "read"\)/, "job-cards summary needs production-orders:read, like the server");
  assert.ok(!/method:|mutateJson|fetch\(/.test(hook + ui), "read-only");
});

test("the shell mounts the section and the old one-day note and generic list are gone for Efficiency", () => {
  const route = strip(src("EmployeesRoute.tsx"));
  assert.match(route, /section === "efficiency" \? <EfficiencySection \/> : null/);
  assert.ok(!/EfficiencyPeriodNote/.test(route));
  assert.match(route, /section === "overview" \|\| section === "working-hours" \|\| section === "attendance" \|\| section === "efficiency" \|\| section === "employee-performance" \|\| section === "department-labor"/);
  assert.match(route, /EFF_PARAMS/, "the search clears when you change section");
});
