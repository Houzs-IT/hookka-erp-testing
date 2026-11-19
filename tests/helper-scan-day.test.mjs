// Owner 2026-11-18 「当他们scan了 就代表那天不是helper了 … 有效率show 没有的话show -」:
// a helper keeps the Helper tick, but on a day he scanned he is a worker that day.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPerfDays } from "../src/api/lib/workforce-perf.ts";
import { summarizeFloorLive } from "../src/api/lib/floor-live.ts";
import { computeMonthlyEfficiencyByWorker } from "../src/api/lib/efficiency-allowance.ts";

const whe = (workerId, date, hours) => ({ workerId, date, departmentCode: "PACKING", hours, notes: "" });
const card = (id, pic1Id, date, mins) => ({ id, departmentCode: "PACKING", pic1Id, pic2Id: null, completedDate: date, estMinutes: mins, actualMinutes: mins, wipQty: 1 });

test("a helper is a helper only on a day he earned nothing", () => {
  const { perfDays } = buildPerfDays({
    whe: [whe("H", "2026-11-17", 8), whe("H", "2026-11-18", 8), whe("P", "2026-11-18", 8)],
    jobCards: [card("j1", "H", "2026-11-18", 240), card("j2", "P", "2026-11-18", 480)],
    approvedExtraTime: [],
    productionDepts: new Set(["PACKING"]),
    helperIds: new Set(["H"]),
  });
  const day = (d) => perfDays.find((x) => x.date === d);
  assert.equal(day("2026-11-17").workers.find((w) => w.workerId === "H").isHelper, true, "no scan → helper");
  assert.equal(day("2026-11-18").workers.find((w) => w.workerId === "H").isHelper, undefined, "scanned → a worker");
  assert.equal(day("2026-11-18").helperWorkingMinutes, 0, "his hours count in production efficiency that day");
});

test("Floor Live period: efficiency from his scan days; never scanned → '—'", () => {
  const w = (id, isHelper, workingMinutes, earnedMinutes) => ({ id, name: id, homeDept: "PACKING", dept: "PACKING", isProduction: true, clockIn: null, clockOut: null, scannedAt: null, done: 0, workingMinutes, earnedMinutes, effPct: null, nonProdMinutes: 0, overHourNonProd: false, ...(isHelper ? { isHelper: true } : {}) });
  const rows = summarizeFloorLive([
    { date: "2026-11-17", workers: [w("H", true, 480, 0), w("N", true, 480, 0)] },
    { date: "2026-11-18", workers: [w("H", false, 480, 240), w("N", true, 480, 0)] },
  ]);
  const H = rows.find((r) => r.id === "H");
  const N = rows.find((r) => r.id === "N");
  assert.equal(H.effPct, 50, "240 earned on the 480 minutes of his scan day");
  assert.equal(H.isHelper, undefined);
  assert.equal(N.effPct, null);
  assert.equal(N.isHelper, true);
});

test("efficiency allowance: a helper's scan days are his denominator", async () => {
  const db = {
    prepare(sql) {
      return { bind() { return { async all() {
        if (sql.includes("is_helper")) return { results: [{ helperId: "H" }] };
        if (sql.includes("FROM departments")) return { results: [{ code: "PACKING", isProduction: 1 }] };
        if (sql.includes("contrib_min")) return { results: [{ workerId: "H", productionMinutes: 240 }] };
        if (sql.includes("pic1Id IN")) return { results: [{ pic1Id: "H", pic2Id: null, completedDate: "2026-11-18" }] };
        if (sql.includes("working_hour_entries")) return { results: [whe("H", "2026-11-17", 8), whe("H", "2026-11-18", 8)] };
        return { results: [] };
      } }; } };
    },
  };
  const m = await computeMonthlyEfficiencyByWorker(db, "2026-11-01", "2026-11-30");
  const h = m.get("H");
  assert.equal(h.prodHours, 16, "Production Hours keep every hour");
  assert.equal(h.isHelper, false);
  assert.equal(h.pct, 50, "240 min on the 8 h of his scan day");
});

test("the day rule is used by every per-day view", () => {
  for (const [f, re] of [
    ["src/api/lib/efficiency-report.ts", /helpers\.has\(w\.id\) && productionMinutes <= 0/],
    ["src/api/routes/department-performance.ts", /helperIds\.has\(w\.workerId\) && w\.productionMinutes <= 0/],
    ["src/api/routes/worker.ts", /leaderHelpers\.has\(w\.workerId\) && w\.productionMinutes <= 0/],
    ["src/api/routes/worker.ts", /if \(!helperScanDays\.has\(h\.key\)\) h\.cell\.helperWorkingMinutes \+= h\.m;/],
    ["src/pages/dashboards/EmployeesDashboard.tsx", /if \(!x\.isHelper\) \{ r\.ew \+= x\.workingMinutes; r\.ep \+= earnedMinutes; \}/],
  ]) assert.match(readFileSync(f, "utf8"), re, f);
});

// Old Employees page (owner 2026-11-19 checklist item 8): the performance
// summary it reads still marked a flagged helper "—" for the whole range.
test("performance summary: a helper's efficiency is over the days they scanned; '—' only without one", async () => {
  const { projectPerformanceSummary } = await import("../src/api/routes/department-performance.ts");
  const day = (date, w) => ({ date, workingMinutes: 0, productionMinutes: 0, efficiencyPct: 0, workers: [w] });
  const scanned = projectPerformanceSummary({ daily: [
    day("2026-11-17", { workerId: "h1", workerName: "H", workingMinutes: 600, productionMinutes: 342, jobs: [] }),
    day("2026-11-18", { workerId: "h1", workerName: "H", workingMinutes: 600, productionMinutes: 0, isHelper: true, jobs: [] }),
  ] });
  const h = scanned.workers[0];
  assert.equal(h.efficiencyPct, 57, "342 earned on the 600 clocked on the scan day");
  assert.equal(h.isHelper, undefined);
  assert.equal(h.workerDayWorkingMinutes, 600);
  const none = projectPerformanceSummary({ daily: [day("2026-11-18", { workerId: "h2", workerName: "N", workingMinutes: 600, productionMinutes: 0, isHelper: true, jobs: [] })] });
  assert.equal(none.workers[0].isHelper, true);
  assert.equal(none.workers[0].efficiencyPct, 0);
});
