import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Owner 2026-11-18 「我的这个labor也要像rawmaterial这样show出来exact的」: the
// department rows under a salary account on the Forecast P&L show each
// department's actual — the same gross the P&L injects on that account.
const api = readFileSync("src/api/routes/accounting.ts", "utf8");
const ed = readFileSync("src/pages/accounting/monthly-pl-forecast-editor.tsx", "utf8");

test("the P&L injection and the dept actuals share one per-department source", () => {
  const inj = api.slice(api.indexOf("async function labourInjectionLines("), api.indexOf("async function labourDeptAggFor("));
  assert.match(inj, /await labourDeptAggFor\(db, orgId, ym\)/);
  assert.match(inj, /labourDebitLines\(byDept, map\)/);
  const r = api.slice(api.indexOf('app.get("/forecast/dept-actuals"'));
  assert.match(r, /requirePermission\(c, "accounting", "read"\)/);
  assert.match(r, /labourInjectMonths\(/);
  assert.match(r, /await labourDeptAggFor\(db, orgId, ym\)/);
  // Gross only: employer EPF / SOCSO / EIS post to their own accounts.
  assert.match(r, /d\.grossSen/);
  assert.doesNotMatch(r.slice(0, r.indexOf("});")), /costSen/);
});

test("department rows show their actual and a remainder row makes them add up", () => {
  assert.match(ed, /\/api\/accounting\/forecast\/dept-actuals\?from=/);
  assert.match(ed, /\}, deptActualCell\(d\.name\)\),/);
  assert.match(ed, /"Other \(no department payroll\)"/);
  assert.match(ed, /acctRow\?\.values\[j\] \?\? 0\) - depts\.reduce/);
});

// Owner 2026-11-18 「non production 没有看到？」: the clocked share of each
// worker's pay moves from his home department to R&D / repair / maintenance.
import { reallocateNonProdGross } from "../src/lib/salary-dept.ts";
const NP = new Set(["R_AND_D", "REPAIR"]);

test("a worker's non-production hours move that share of his pay — the total stays", () => {
  const out = reallocateNonProdGross(
    { FAB_SEW: 300000, FRAMING: 200000 },
    [{ workerId: "a", dept: "FAB_SEW", grossSen: 200000 }, { workerId: "b", dept: "FAB_SEW", grossSen: 100000 }, { workerId: "c", dept: "FRAMING", grossSen: 200000 }],
    [{ workerId: "a", dept: "FAB_SEW", hours: 150 }, { workerId: "a", dept: "R_AND_D", hours: 50 }, { workerId: "c", dept: "REPAIR", hours: 10 }, { workerId: "c", dept: "FRAMING", hours: 190 }],
    NP,
  );
  assert.deepEqual(out, { FAB_SEW: 250000, FRAMING: 190000, R_AND_D: 50000, REPAIR: 10000 });
  assert.equal(Object.values(out).reduce((a, v) => a + v, 0), 500000);
});

test("the month still running: the share scales to the department's labour to date", () => {
  const out = reallocateNonProdGross(
    { FAB_SEW: 150000 },
    [{ workerId: "a", dept: "FAB_SEW", grossSen: 200000 }, { workerId: "b", dept: "FAB_SEW", grossSen: 100000 }],
    [{ workerId: "a", dept: "FAB_SEW", hours: 30 }, { workerId: "a", dept: "R_AND_D", hours: 10 }],
    NP,
  );
  assert.deepEqual(out, { FAB_SEW: 125000, R_AND_D: 25000 });
});

test("no non-production departments, or no hours → unchanged", () => {
  const base = { FAB_SEW: 1000 };
  assert.deepEqual(reallocateNonProdGross(base, [{ workerId: "a", dept: "FAB_SEW", grossSen: 1000 }], [{ workerId: "a", dept: "R_AND_D", hours: 1 }], new Set()), base);
  assert.deepEqual(reallocateNonProdGross(base, [{ workerId: "a", dept: "FAB_SEW", grossSen: 1000 }], [], NP), base);
});
