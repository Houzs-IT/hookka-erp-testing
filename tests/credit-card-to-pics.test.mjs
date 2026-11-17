import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { creditCardToPics } from "../src/lib/job-card-minutes.ts";

const credit = (perUnit, card) => Object.fromEntries(creditCardToPics(perUnit, card));

test("a solo card gives the whole card to PIC 1", () => {
  assert.deepEqual(credit(30, { departmentCode: "FAB_SEW", wipQty: 4, pic1Id: "ali", pic2Id: null }), { ali: 120 });
});

test("two PIC slots share the card half each, whoever scanned the pieces", () => {
  assert.deepEqual(credit(126, { departmentCode: "FAB_CUT", wipQty: 4, pic1Id: "ei", pic2Id: "thi" }), { ei: 63, thi: 63 });
});

test("an empty PIC 1 with a filled PIC 2 gives PIC 2 the whole card", () => {
  assert.deepEqual(credit(10, { departmentCode: "FOAM", wipQty: 2, pic1Id: "", pic2Id: "bala" }), { bala: 20 });
});

test("a card with no PIC credits nobody", () => {
  assert.deepEqual(credit(10, { departmentCode: "FOAM", wipQty: 2, pic1Id: null, pic2Id: null }), {});
});

test("the payslip SQL halves a card only when both slots are filled", () => {
  const src = readFileSync("src/api/lib/efficiency-allowance.ts", "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /WHEN pic2Id IS NOT NULL AND pic2Id != ''\n\s+THEN \(\$\{JC_TOTAL_MIN\}\) \/ 2\.0/);
  assert.match(src, /WHEN pic1Id IS NOT NULL AND pic1Id != ''\n\s+THEN \(\$\{JC_TOTAL_MIN\}\) \/ 2\.0/);
});

test("no screen splits a card by piece scans any more", () => {
  const files = [
    "src/api/lib/workforce-perf.ts",
    "src/api/lib/efficiency-report.ts",
    "src/api/routes/department-performance.ts",
    "src/api/routes/worker.ts",
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /\/ Math\.max\(1, picCount\)/, `${file} still divides by a piece's PIC count`);
    assert.doesNotMatch(src, /\/ workerIds\.size/, `${file} still divides by distinct workers`);
  }
});

test("the dashboard engine credits a two-slot card half each", async () => {
  const { buildPerfDays } = await import("../src/api/lib/workforce-perf.ts");
  const { perfDays } = buildPerfDays({
    productionDepts: new Set(["FAB_CUT"]),
    whe: [],
    jobCards: [
      { id: "c1", departmentCode: "FAB_CUT", pic1Id: "ei", pic2Id: "thi", completedDate: "2026-10-15", estMinutes: 126, actualMinutes: 126, wipQty: 4 },
    ],
    approvedExtraTime: [],
  });
  const minutes = Object.fromEntries(perfDays[0].workers.map((w) => [w.workerId, w.productionMinutes]));
  assert.deepEqual(minutes, { ei: 63, thi: 63 });
  assert.equal(perfDays[0].productionMinutes, 126);
});

test("an odd card's halves are kept, so a month of them sums to the payslip", async () => {
  const { buildPerfDays } = await import("../src/api/lib/workforce-perf.ts");
  const card = (id) => ({ id, departmentCode: "WOOD_CUT", pic1Id: "ye", pic2Id: "chit", completedDate: "2026-10-15", estMinutes: 113, actualMinutes: 113, wipQty: 1 });
  const { perfDays } = buildPerfDays({ productionDepts: new Set(["WOOD_CUT"]), whe: [], jobCards: [card("a"), card("b")], approvedExtraTime: [] });
  const minutes = Object.fromEntries(perfDays[0].workers.map((w) => [w.workerId, w.productionMinutes]));
  assert.deepEqual(minutes, { ye: 113, chit: 113 });
});

test("hours display rounds a half minute", async () => {
  const { formatHours } = await import("../src/lib/utils.ts");
  assert.equal(formatHours(56.5), "0h 57m");
  assert.equal(formatHours(120), "2h");
});
