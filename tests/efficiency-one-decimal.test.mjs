import test from "node:test";
import assert from "node:assert/strict";

import { projectPerformanceSummary } from "../src/api/routes/department-performance.ts";

test("per-worker efficiency in the summary view carries one decimal", () => {
  const summary = projectPerformanceSummary({
    range: { from: "2026-11-01", to: "2026-11-02" },
    departmentCode: null,
    category: null,
    totals: { workingMinutes: 900, productionMinutes: 761, efficiencyPct: 84.6, workerCount: 1 },
    daily: [
      { date: "2026-11-01", workingMinutes: 480, productionMinutes: 400, efficiencyPct: 83.3,
        workers: [{ workerId: "w1", workerName: "A", workingMinutes: 480, productionMinutes: 400 }] },
      { date: "2026-11-02", workingMinutes: 420, productionMinutes: 361, efficiencyPct: 86,
        workers: [{ workerId: "w1", workerName: "A", workingMinutes: 420, productionMinutes: 361 }] },
    ],
  });
  assert.equal(summary.workers[0].efficiencyPct, 84.6);
});
