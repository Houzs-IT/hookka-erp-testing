// Helper / 杂工 screens, batch 2a (owner 2026-11-11). Production Hours keep
// helpers; production efficiency (the main figure) leaves them out; "Overall"
// is everyone and shows only where helpers clocked time; a helper's own row
// shows "—" and is never ranked or flagged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const imp = (p) => import(pathToFileURL(resolve(process.cwd(), p)).href);
const perf = await imp("src/api/lib/workforce-perf.ts");
const shared = await imp("src/pages/dashboards/dashboard-shared-lib.ts");
const floor = await imp("src/pages/dashboards/floor-live-lib.ts");
const floorSrv = await imp("src/api/lib/floor-live.ts");
// CRLF → LF: on a Windows checkout the sources have CRLF line ends and the
// multi-line patterns below would never match (same fix as #1317's tests).
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// One day in Upholstery: producer P1 8h earning 7.5h; helper H1 8h earning 0.
const whe = [
  { workerId: "P1", date: "2026-11-02", hours: 8, departmentCode: "UPHOLSTERY" },
  { workerId: "H1", date: "2026-11-02", hours: 8, departmentCode: "UPHOLSTERY" },
];
const jobCards = [{ id: "J1", departmentCode: "UPHOLSTERY", completedDate: "2026-11-02", estMinutes: 450, actualMinutes: null, wipQty: 1, pic1Id: "P1", pic2Id: null }];

test("perf engine: hours keep the helper, production efficiency leaves them out, Overall includes them", () => {
  const { perfDays } = perf.buildPerfDays({ whe, jobCards, pics: [], approvedExtraTime: [], productionDepts: new Set(["UPHOLSTERY"]), helperIds: new Set(["H1"]) });
  const d = perfDays[0];
  assert.equal(d.workingMinutes, 960, "Production Hours include the helper");
  assert.equal(d.helperWorkingMinutes, 480);
  assert.equal(d.workers.find((w) => w.workerId === "H1").isHelper, true);
  const r = perf.poolEfficiencyPct(perfDays, null, () => true);
  assert.equal(Math.round(r.pct * 10) / 10, 93.8, "production efficiency = 450 / 480");
  assert.equal(Math.round(r.overallPct * 10) / 10, 46.9, "overall = 450 / 960");
  assert.equal(r.helperWorkingMinutes, 480);
  assert.deepEqual(perf.workerEfficiencyPcts(perfDays, () => true, () => true, 0).map((x) => x.workerId), ["P1"], "helpers are not ranked");
});

test("perf engine: no helpers → identical to before", () => {
  const { perfDays } = perf.buildPerfDays({ whe, jobCards, pics: [], approvedExtraTime: [], productionDepts: new Set(["UPHOLSTERY"]) });
  const r = perf.poolEfficiencyPct(perfDays, null, () => true);
  assert.equal(r.pct, r.overallPct);
  assert.equal(r.helperWorkingMinutes, 0);
});

test("dashboard lib: efficiencyPair / prodEffOfDay", () => {
  const day = { date: "2026-11-02", workingMinutes: 960, productionMinutes: 450, helperWorkingMinutes: 480, helperProductionMinutes: 0 };
  assert.equal(Math.round(shared.prodEffOfDay(day) * 10) / 10, 93.8);
  const p = shared.efficiencyPair([day]);
  assert.equal(Math.round(p.overallPct * 10) / 10, 46.9);
  assert.equal(p.helperMinutes, 480);
});

test("Floor Live: helper row has no efficiency, is never an issue; card shows production eff + Overall", () => {
  const out = floorSrv.buildFloorLive({
    nowMin: 600,
    departments: [{ code: "UPHOLSTERY", name: "Upholstery", isProduction: true, sequence: 8 }],
    workers: [{ id: "P1", name: "Aung", departmentCode: "UPHOLSTERY" }, { id: "H1", name: "Kyaw", departmentCode: "UPHOLSTERY" }],
    attendance: [{ employeeId: "P1", clockIn: "08:00", clockOut: null }, { employeeId: "H1", clockIn: "08:00", clockOut: null }],
    scans: [],
    perf: new Map([["P1", { workingMinutes: 120, productionMinutes: 120 }], ["H1", { workingMinutes: 120, productionMinutes: 0, isHelper: true }]]),
    done: new Map(),
  });
  const h = out.workers.find((w) => w.id === "H1");
  assert.equal(h.effPct, null);
  assert.equal(h.isHelper, true);
  assert.equal(floor.isIssue(h), false);
  const lay = floor.floorLiveLayout(out);
  const card = lay.production.find((c) => c.code === "UPHOLSTERY");
  assert.equal(card.effPct, 100, "production efficiency leaves the helper out");
  assert.equal(card.overallPct, 50);
  assert.equal(card.helperMinutes, 120);
  assert.equal(lay.totals.effPct, 100);
});

test("every caller hands the helper ids to the perf engine", () => {
  assert.match(read("src/api/routes/dashboard-prototype.ts"), /helperIds,\n  \}\);/);
  assert.match(read("src/api/routes/dashboard-prototype.ts"), /isHelper: helperIds\.has\(w\.id\),/);
  assert.match(read("src/api/lib/kpi-metrics.ts"), /helperIds: await helperWorkerIds\(db\),/);
  assert.match(read("src/api/lib/floor-live-data.ts"), /productionDepts, helperIds \}\);/);
});

test("screens: Overall line + Helper tag wired where efficiency is shown", () => {
  assert.match(read("src/pages/dashboards/EmployeesView.tsx"), /label="Production Efficiency"/);
  assert.match(read("src/pages/dashboards/EmployeesView.tsx"), /<HelperOverallLine overallPct=\{effPair\.overallPct\}/);
  assert.match(read("src/pages/dashboards/EmployeesInsights.tsx"), /Helpers · not ranked/);
  assert.match(read("src/pages/dashboards/DepartmentsView.tsx"), /<HelperOverallLine/);
  assert.match(read("src/pages/dashboards/ProductionDailyPanels.tsx"), /<HelperOverallLine/);
  assert.match(read("src/pages/dashboards/EmployeesDashboard.tsx"), /const ranked = rows\.filter\(\(r\) => r\.work >= MIN_RANK_MIN && !outsourced\.has\(r\.id\) && !r\.isHelper\);/);
  assert.match(read("src/pages/dashboards/use-problem-tiles.ts"), /filter\(\(w\) => !w\.isHelper\)/);
  assert.match(read("src/pages/m/screens/dashboard/emp-lib.ts"), /!outsourced\.has\(r\.id\) && !r\.isHelper\);/);
  assert.match(read("src/pages/dashboards/FloorLiveView.tsx"), /\{p\.isHelper && <HelperTag/);
});
