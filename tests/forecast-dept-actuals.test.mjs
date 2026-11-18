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
