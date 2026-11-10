import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFloorLive, piecesDoneByWorker } from "../src/api/lib/floor-live.ts";
import { floorLiveLayout, PRODUCTION_ORDER } from "../src/pages/dashboards/floor-live-lib.ts";

const DEPTS = [
  { code: "FAB_CUT", name: "Fabric Cutting", isProduction: 1, sequence: 1 },
  { code: "UPHOLSTERY", name: "Upholstery", isProduction: 1, sequence: 9 },
  { code: "WAREHOUSING", name: "Warehousing", isProduction: 0, sequence: 20 },
  { code: "R_AND_D", name: "R&D", isProduction: 0, sequence: 24 },
  { code: "PRODUCTION_SHORTFALL", name: "Production Shortfall", isProduction: 0, sequence: 23 },
];
const WORKERS = [
  { id: "w1", name: "ZAW LIN", departmentCode: "UPHOLSTERY" },
  { id: "w2", name: "THI THI AYE", departmentCode: "FAB_CUT" },
  { id: "w3", name: "KYAW OO", departmentCode: "UPHOLSTERY" },
];
const base = (over = {}) => ({
  nowMin: 10 * 60 + 45,
  departments: DEPTS,
  workers: WORKERS,
  attendance: [
    { employeeId: "w1", clockIn: "07:48", clockOut: null },
    { employeeId: "w2", clockIn: "07:33", clockOut: null },
    { employeeId: "w3", clockIn: "07:53", clockOut: null },
  ],
  scans: [],
  perf: new Map([["w1", { workingMinutes: 180, productionMinutes: 90 }], ["w2", { workingMinutes: 180, productionMinutes: 200 }]]),
  done: new Map([["w1", 3], ["w2", 9]]),
  ...over,
});

test("no scan = home department; production rows carry pieces and efficiency", () => {
  const { workers } = buildFloorLive(base());
  const w2 = workers.find((w) => w.id === "w2");
  assert.equal(w2.dept, "FAB_CUT");
  assert.equal(w2.scannedAt, null);
  assert.equal(w2.done, 9);
  assert.equal(w2.effPct, 111);
});

test("last scan decides where; non-production over an hour while punched in is red, with the scan time", () => {
  const { workers } = buildFloorLive(base({
    scans: [
      { workerId: "w1", departmentCode: "UPHOLSTERY", atMin: 8 * 60 },
      { workerId: "w1", departmentCode: "WAREHOUSING", atMin: 9 * 60 + 5 },
      { workerId: "w3", departmentCode: "R_AND_D", atMin: 10 * 60 + 20 },
    ],
  }));
  const w1 = workers.find((w) => w.id === "w1");
  assert.equal(w1.dept, "WAREHOUSING");
  assert.equal(w1.isProduction, false);
  assert.equal(w1.scannedAt, "09:05");
  assert.equal(w1.overHourNonProd, true);
  assert.equal(w1.effPct, 50, "non-production rows keep the day's efficiency");
  const w3 = workers.find((w) => w.id === "w3");
  assert.equal(w3.overHourNonProd, false, "25 minutes is not over an hour");
});

test("punched out is never red; Production Shortfall is hidden and falls back to home", () => {
  const out = buildFloorLive(base({
    attendance: [{ employeeId: "w1", clockIn: "07:48", clockOut: "10:00" }, { employeeId: "w3", clockIn: "07:53", clockOut: null }],
    scans: [
      { workerId: "w1", departmentCode: "WAREHOUSING", atMin: 8 * 60 },
      { workerId: "w3", departmentCode: "PRODUCTION_SHORTFALL", atMin: 8 * 60 },
    ],
  }));
  assert.equal(out.workers.find((w) => w.id === "w1").overHourNonProd, false);
  assert.equal(out.workers.find((w) => w.id === "w3").dept, "UPHOLSTERY");
  assert.ok(!out.departments.some((d) => d.code === "PRODUCTION_SHORTFALL"));
});

test("pieces: one per piece-PIC row, else the card's qty to each PIC", () => {
  const done = piecesDoneByWorker(
    [{ id: "j1", pic1Id: "a", pic2Id: null, wipQty: 4 }, { id: "j2", pic1Id: "a", pic2Id: "b", wipQty: 2 }],
    [{ jobCardId: "j2", pic1Id: "b", pic2Id: null }, { jobCardId: "j2", pic1Id: "a", pic2Id: "b" }],
  );
  assert.equal(done.get("a"), 5);
  assert.equal(done.get("b"), 2);
});

test("layout: owner's production order, every department shown, problems first, filters hide empty cards", () => {
  assert.deepEqual([...PRODUCTION_ORDER], ["FAB_CUT", "WOOD_CUT", "FOAM_CUTTING", "FIBRE", "FAB_SEW", "FRAMING", "FOAM", "UPHOLSTERY", "PACKING", "WEBBING"]);
  const data = buildFloorLive(base({ scans: [{ workerId: "w1", departmentCode: "WAREHOUSING", atMin: 9 * 60 }] }));
  const lay = floorLiveLayout(data);
  assert.deepEqual(lay.production.map((c) => c.code), ["FAB_CUT", "UPHOLSTERY"]);
  assert.deepEqual(lay.nonProduction.map((c) => c.code), ["WAREHOUSING", "R_AND_D"]);
  assert.equal(lay.nonProduction.find((c) => c.code === "R_AND_D").rows.length, 0);
  assert.equal(lay.totals.overHour, 1);
  const issues = floorLiveLayout(data, { issuesOnly: true });
  assert.ok(!issues.nonProduction.some((c) => c.code === "R_AND_D"));
  assert.equal(floorLiveLayout(data, { q: "zaw" }).nonProduction[0].rows[0].name, "ZAW LIN");
});

test("wired: route mounted, Operations sub-tab, 5-minute refresh, cards keep their own height", () => {
  assert.match(readFileSync("src/api/worker.ts", "utf8"), /app\.route\("\/api\/dashboard\/floor-live", floorLive\)/);
  assert.match(readFileSync("src/pages/dashboards/dashboard-shared-lib.ts", "utf8"), /\{ key: "floor", label: "Floor Live" \}/);
  const view = readFileSync("src/pages/dashboards/FloorLiveView.tsx", "utf8");
  assert.match(view, /REFRESH_MS = 5 \* 60 \* 1000/);
  assert.match(view, /items-start/);
  assert.match(view, /ROW_LIMIT = 6/);
});

test("owner 2026-11-10: red only for the non-production hour; production rows show last check-in", () => {
  const view = readFileSync("src/pages/dashboards/FloorLiveView.tsx", "utf8");
  assert.match(view, /const red = !production && p\.overHourNonProd;/);
  assert.doesNotMatch(view, /e > 110/);
  assert.match(view, /const lastIn = \(p: FloorLiveRow\) => p\.scannedAt \?\? p\.clockIn \?\? "—";/);
  assert.match(view, /Check-in · Done · Eff\./);
});

test("owner 2026-11-10: efficiency number is red only below 80%", () => {
  const view = readFileSync("src/pages/dashboards/FloorLiveView.tsx", "utf8");
  assert.match(view, /if \(e < 80\) return "text-\[#9A3A2D\]";/);
});
