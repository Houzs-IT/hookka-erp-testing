// HK-0092: Production Revenue per department. Same recognition rule as the
// upholstery line, once per department; byDay (upholstery) is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDailySlice } from "../src/api/lib/dashboard-daily-slice.ts";
import { deptRevenueRows } from "../src/pages/dashboards/ops-floor-lib.ts";
import { productionRevenueByDeptDay } from "../src/api/lib/production-revenue.ts";

test("slice: byDept is normalised + sorted; byDay stays upholstery-only", () => {
  const s = buildDailySlice(
    [],
    [],
    [{ date: "2026-10-02", orders: 1, unpricedOrders: 0, revenueSen: 500 }],
    undefined,
    [
      { date: "2026-10-02", dept: "UPHOLSTERY", orders: "1", unpricedOrders: "0", revenueSen: "500" },
      { date: "2026-10-01T00:00:00", dept: "FRAMING", orders: 2, unpricedOrders: 1, revenueSen: 1200.4 },
    ],
  );
  assert.deepEqual(s.revenue.byDay, [{ date: "2026-10-02", orders: 1, unpricedOrders: 0, revenueSen: 500 }]);
  assert.deepEqual(s.revenue.byDept, [
    { date: "2026-10-01", dept: "FRAMING", orders: 2, unpricedOrders: 1, revenueSen: 1200 },
    { date: "2026-10-02", dept: "UPHOLSTERY", orders: 1, unpricedOrders: 0, revenueSen: 500 },
  ]);
});

test("slice: byDept is null (not []) when the department load failed or was not given", () => {
  const rows = [{ date: "2026-10-02", orders: 1, unpricedOrders: 0, revenueSen: 500 }];
  assert.equal(buildDailySlice([], [], rows).revenue.byDept, null);
  assert.equal(buildDailySlice([], [], rows, undefined, null).revenue.byDept, null);
  assert.deepEqual(buildDailySlice([], [], rows, undefined, []).revenue.byDept, []);
});

test("query: groups by department, every department, scoped to the org", async () => {
  let sql = "";
  let bound;
  const rows = [{ date: "2026-10-01", dept: "FRAMING", orders: 1, unpricedOrders: 0, revenueSen: 9 }];
  const db = {
    prepare: (q) => ((sql = q), { bind: (...v) => ((bound = v), { all: async () => ({ results: rows }) }) }),
  };
  assert.deepEqual(await productionRevenueByDeptDay(db, "hookka"), rows);
  assert.deepEqual(bound, ["hookka"]);
  assert.match(sql, /GROUP BY production_order_id, department_code/);
  assert.match(sql, /GROUP BY day, dept/);
  // The gate is the upholstery rule with the department swapped in: a PO books
  // only when ALL of that department's cards are done.
  assert.match(sql, /SUM\(CASE WHEN status IN \('COMPLETED','TRANSFERRED'\)[\s\S]*?\) = COUNT\(\*\)/);
  assert.doesNotMatch(sql, /department_code = 'UPHOLSTERY'/);
});

test("dashboard feed passes the per-department rows to the slice", () => {
  const dash = readFileSync("src/api/routes/dashboard-prototype.ts", "utf8");
  assert.match(dash, /productionRevenueByDeptDay\(c\.var\.DB, orgId\)/);
  assert.match(dash, /deptRevSec\.error \? null : deptRevSec\.rows/);
});

test("deptRevenueRows: sums per department in floor order, zero rows kept, unknown code last", () => {
  const r = deptRevenueRows([
    { dept: "UPHOLSTERY", orders: 1, unpricedOrders: 0, revenueSen: 500 },
    { dept: "UPHOLSTERY", orders: 2, unpricedOrders: 1, revenueSen: 700 },
    { dept: "FAB_CUT", orders: 3, unpricedOrders: 0, revenueSen: 900 },
    { dept: "ZZ_NEW", orders: 1, unpricedOrders: 0, revenueSen: 1 },
  ]);
  assert.equal(r.length, 11);
  assert.equal(r[0].name, "Fabric Cutting");
  assert.equal(r[0].sen, 900);
  const uph = r.find((x) => x.code === "UPHOLSTERY");
  assert.deepEqual([uph.orders, uph.unpriced, uph.sen], [3, 1, 1200]);
  assert.equal(r.find((x) => x.code === "PACKING").sen, 0);
  assert.equal(r[10].code, "ZZ_NEW");
});
