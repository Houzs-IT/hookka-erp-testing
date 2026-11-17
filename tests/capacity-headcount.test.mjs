// Daily Capacity "Workers" = everyone who punched in that day, outsource out
// (owner 2026-11-17). Before: the PICs on cards completed that day.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { punchInHeadcountByDay, isOutsourceForHeadcount } from "../src/lib/capacity-headcount.ts";

const workers = [
  { id: "w1", empNo: "HK001", name: "Ali" },
  { id: "w2", empNo: "HK002", name: "Helper Siti" }, // helper — counts
  { id: "o1", empNo: "OSC01", name: "Budi" }, // OSC number — outsource
  { id: "o2", empNo: "HK090", name: "OUTSOURCE Team A" }, // OUTSOURCE name
  { id: "o3", empNo: "HK091", name: "Flagged", isOutsource: true }, // flag
];

test("counts distinct punched-in people per day, outsource left out", () => {
  const m = punchInHeadcountByDay(
    [
      { employeeId: "w1", date: "2026-11-12", clockIn: "08:01" },
      { employeeId: "w1", date: "2026-11-12", clockIn: "13:30" }, // same person twice
      { employeeId: "w2", date: "2026-11-12", clockIn: "07:58" },
      { employeeId: "o1", date: "2026-11-12", clockIn: "08:00" },
      { employeeId: "o2", date: "2026-11-12", clockIn: "08:00" },
      { employeeId: "o3", date: "2026-11-12", clockIn: "08:00" },
      { employeeId: "w1", date: "2026-11-13", clockIn: null }, // no punch-in
      { employeeId: "w2", date: "2026-11-13T00:00:00Z", clockIn: "08:00" },
      { employeeId: "gone", date: "2026-11-13", clockIn: "08:00" }, // deleted worker still came in
    ],
    workers,
  );
  assert.equal(m.get("2026-11-12"), 2);
  assert.equal(m.get("2026-11-13"), 2);
});

test("outsource rule: flag, OSC employee number or OUTSOURCE name", () => {
  assert.equal(isOutsourceForHeadcount(workers[0]), false);
  assert.equal(isOutsourceForHeadcount(workers[1]), false);
  for (const w of workers.slice(2)) assert.equal(isOutsourceForHeadcount(w), true, w.id);
  assert.equal(isOutsourceForHeadcount({ id: "x", isOutsource: 1 }), true);
  assert.equal(isOutsourceForHeadcount({ id: "x", isOutsource: false }), false);
});

test("the overview feed uses the punch-in count, keeps the PIC count, refreshes on attendance", () => {
  const src = readFileSync("src/api/routes/dashboard-overview.ts", "utf8");
  assert.match(src, /punchInHeadcountByDay\(punches, workers\)/);
  assert.match(src, /FROM attendance_records\s+WHERE org_id = \? AND clock_in IS NOT NULL/);
  assert.match(src, /workers: punchByDay \? \(punchByDay\.get\(date\) \?\? 0\) : picWorkers/);
  assert.match(src, /"kv_config",\n  "attendance_records",\n\] as const;/);
  const page = readFileSync("src/pages/dashboard-b/index.tsx", "utf8");
  assert.match(page, /everyone who punched in that day, helpers included, outsource excluded/);
});
