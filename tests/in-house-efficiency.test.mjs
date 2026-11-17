// Owner 2026-11-17: factory and department efficiency count only people who
// logged production hours that day. Outsource is paid by piece and logs none.
import test from "node:test";
import assert from "node:assert/strict";
import { buildPerfDays, poolEfficiencyPct } from "../src/api/lib/workforce-perf.ts";

const card = (id, pic1Id, date, estMinutes) => ({ id, departmentCode: "FAB_SEW", pic1Id, pic2Id: null, completedDate: date, estMinutes, actualMinutes: null, wipQty: 1 });

const { perfDays } = buildPerfDays({
  productionDepts: new Set(["FAB_SEW"]),
  whe: [
    { workerId: "ali", date: "2026-11-03", departmentCode: "FAB_SEW", hours: 10 },
    { workerId: "bala", date: "2026-11-03", departmentCode: "FAB_SEW", hours: 10 },
  ],
  jobCards: [
    card("a", "ali", "2026-11-03", 600),
    card("b", "bala", "2026-11-03", 600),
    card("c", "outsource-chau", "2026-11-03", 240),
    card("d", null, "2026-11-03", 90),
    card("e", "ali", "2026-11-04", 300),
  ],
  approvedExtraTime: [],
});

test("outsource and cards with no PIC are left out of the day's earned minutes", () => {
  const day = perfDays.find((d) => d.date === "2026-11-03");
  assert.equal(day.productionMinutes, 1200);
  assert.equal(day.workers.find((w) => w.workerId === "outsource-chau").productionMinutes, 240);
});

test("work finished on a day with no logged hours does not count", () => {
  const day = perfDays.find((d) => d.date === "2026-11-04");
  assert.equal(day.productionMinutes, 0);
});

test("factory efficiency is in-house earned over in-house hours", () => {
  const pool = poolEfficiencyPct(perfDays, null, (d) => d.startsWith("2026-11"));
  assert.equal(pool.pct, 100);
});
