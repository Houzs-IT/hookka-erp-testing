// BUG-2026-11-11-501: one efficiency rule on every screen. Approved extra time
// counts, a day with no keyed hours is skipped, the daily email divides by
// production-department hours, and both pages use the same two labels.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPerfDays, poolEfficiencyPct } from "../src/api/lib/workforce-perf.ts";
import { sumWindow, workerRows } from "../src/pages/m/screens/dashboard/emp-lib.ts";
import { collectEfficiencyData } from "../src/api/lib/efficiency-report.ts";

const { perfDays } = buildPerfDays({
  productionDepts: new Set(["UPHOLSTERY"]),
  whe: [
    { workerId: "w1", date: "2026-11-03", departmentCode: "UPHOLSTERY", hours: 8 },
    { workerId: "w2", date: "2026-11-03", departmentCode: "UPHOLSTERY", hours: 8 },
    { workerId: "w1", date: "2026-11-05", departmentCode: "R_AND_D", hours: 8 },
  ],
  jobCards: [
    { id: "j1", departmentCode: "UPHOLSTERY", pic1Id: "w1", pic2Id: null, completedDate: "2026-11-03", estMinutes: 60, actualMinutes: null, wipQty: 6 },
    { id: "j2", departmentCode: "UPHOLSTERY", pic1Id: "w2", pic2Id: null, completedDate: "2026-11-04", estMinutes: 60, actualMinutes: null, wipQty: 4 },
  ],
  pics: [],
  approvedExtraTime: [{ workerId: "w2", date: "2026-11-03", hours: 2 }],
});
const inNovember = (date) => date.startsWith("2026-11");

test("approved extra time counts as earned minutes for the day and the worker", () => {
  const day = perfDays.find((d) => d.date === "2026-11-03");
  assert.equal(day.productionMinutes, 360 + 120);
  assert.equal(day.workers.find((w) => w.workerId === "w2").productionMinutes, 120);
});

test("dashboard Employees tile equals the KPI: a day with no keyed hours is skipped", () => {
  const kpi = poolEfficiencyPct(perfDays, null, inNovember);
  const tile = sumWindow(perfDays, inNovember, new Map(), new Set(), null);
  assert.equal(kpi.productionMinutes, 480);
  assert.equal(tile.prod, kpi.productionMinutes);
  assert.equal(tile.work, kpi.workingMinutes);
});

test("worker rows drop earned minutes of an unkeyed day but keep every day of cost", () => {
  const workerById = new Map([["w1", { id: "w1", name: "Ali", dept: "UPHOLSTERY" }], ["w2", { id: "w2", name: "Bala", dept: "UPHOLSTERY" }]]);
  const cost = new Map([["w1|2026-11-03", 10000], ["w1|2026-11-05", 5000]]);
  const window = new Set(perfDays.map((d) => d.date));
  const rows = workerRows(perfDays, window, workerById, "ALL", cost);
  assert.equal(rows.find((r) => r.id === "w1").cost, 15000);
  assert.equal(rows.find((r) => r.id === "w2").prod, 120);
});

test("the desktop Employees tab uses the same earned-minutes rule as the phone", () => {
  const source = readFileSync("src/pages/dashboards/EmployeesDashboard.tsx", "utf8");
  assert.equal(source.split("const earnedMinutes = hasKeyedHours(d) ? x.productionMinutes : 0;").length - 1, 2);
});

const rowsFor = (sql) => {
  if (sql.includes("FROM departments")) {
    return [
      { id: "d1", code: "UPHOLSTERY", name: "Upholstery", shortName: "UPH", isProduction: 1 },
      { id: "d2", code: "R_AND_D", name: "R&D", shortName: "R&D", isProduction: 0 },
      { id: "d3", code: "WAREHOUSING", name: "Warehousing", shortName: "WH", isProduction: 0 },
    ];
  }
  if (sql.includes("FROM workers")) {
    return [
      { id: "w1", empNo: "E1", name: "Ali", departmentCode: "UPHOLSTERY", status: "ACTIVE" },
      { id: "w3", empNo: "E3", name: "Chen", departmentCode: "WAREHOUSING", status: "ACTIVE" },
    ];
  }
  if (sql.includes("FROM working_hour_entries")) {
    return [
      { workerId: "w1", date: "2026-11-10", departmentCode: "UPHOLSTERY", category: null, hours: 4 },
      { workerId: "w1", date: "2026-11-10", departmentCode: "R_AND_D", category: null, hours: 4 },
      { workerId: "w3", date: "2026-11-10", departmentCode: "WAREHOUSING", category: null, hours: 8 },
    ];
  }
  if (sql.includes("FROM worker_nonprod_requests")) return [{ workerId: "w1", date: "2026-11-10", hours: 1 }];
  if (sql.includes("FROM job_cards")) {
    return [{ id: "j1", productionOrderId: "p1", departmentCode: "UPHOLSTERY", pic1Id: "w1", pic2Id: null, completedDate: "2026-11-10", estMinutes: 30, actualMinutes: null, wipQty: 4 }];
  }
  return [];
};
const stubDb = { prepare: (sql) => ({ bind: () => ({ all: async () => ({ results: rowsFor(sql) }) }) }) };

test("daily email: production-department hours only, extra time counted", async () => {
  const report = await collectEfficiencyData(stubDb, "2026-11-10");
  const ali = report.workers.find((w) => w.workerId === "w1");
  assert.equal(ali.workingMinutes, 480);
  assert.equal(ali.productionWorkingMinutes, 240);
  assert.equal(ali.productionMinutes, 180);
  assert.equal(ali.efficiencyPct, 75);
  const chen = report.workers.find((w) => w.workerId === "w3");
  assert.equal(chen.status, "PRESENT");
  assert.equal(chen.productionWorkingMinutes, 0);
  assert.equal(report.totals.efficiencyPct, 75);
});

const LABEL_FILES = [
  "src/pages/employees.tsx",
  "src/pages/dashboards/EmployeesInsights.tsx",
  "src/pages/dashboards/AttendanceLogCard.tsx",
  "src/pages/dashboards/ProductionDailyPanels.tsx",
  "src/pages/dashboards/DashboardWidgets.tsx",
  "src/pages/dashboards/EmployeesDashboard.tsx",
  "src/pages/m/screens/dashboard/HomeEmpSheets.tsx",
  "src/pages/m/screens/dashboard/HomeOpsP.tsx",
];
const OLD_LABELS = /"Production [Tt]ime"|"Prod hours"|"Prod Hrs"|>Production hrs<|>Working hrs<|"Total (Production|Working) Hrs"|>Total (Production|Working) Hrs<|Production time per day/;

test("hours keyed and minutes earned carry one pair of names on both pages", () => {
  for (const file of LABEL_FILES) {
    const code = readFileSync(file, "utf8").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    const hit = code.match(OLD_LABELS);
    assert.equal(hit?.[0] ?? null, null, file);
  }
});
