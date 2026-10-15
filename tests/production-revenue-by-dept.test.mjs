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

test("query: per department, org filter and date window INSIDE the aggregation, no raw cast", async () => {
  let sql = "";
  let bound;
  const rows = [{ date: "2026-10-01", dept: "FRAMING", orders: 1, unpricedOrders: 0, revenueSen: 9 }];
  const db = {
    prepare: (q) => ((sql = q), { bind: (...v) => ((bound = v), { all: async () => ({ results: rows }) }) }),
  };
  assert.deepEqual(await productionRevenueByDeptDay(db, "hookka", "2026-01-01"), rows);
  // org (CTE), window, org (outer)
  assert.deepEqual(bound, ["hookka", "2026-01-01", "hookka"]);
  const cte = sql.slice(sql.indexOf("per_po AS"), sql.indexOf("priced AS"));
  assert.match(cte, /JOIN production_orders pof ON pof\.id = jc\.production_order_id/);
  assert.match(cte, /pof\.org_id = \?/, "org filter must be inside the job_cards aggregation");
  assert.match(cte, />= \?/, "date window inside the aggregation");
  assert.match(cte, /GROUP BY jc\.production_order_id, jc\.department_code/);
  assert.match(sql, /GROUP BY day, dept/);
  assert.match(sql, /SUM\(CASE WHEN jc\.status IN \('COMPLETED','TRANSFERRED'\)[\s\S]*?\) = COUNT\(\*\)/);
  assert.doesNotMatch(sql, /department_code = 'UPHOLSTERY'/);
  // completed_date is free text: no ::date cast that one bad value can abort.
  assert.doesNotMatch(sql, /::date/);
  assert.match(sql, /unit_completed_at ~ '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}'/);
});

test("query: default window is ~400 days back, as an ISO day", async () => {
  let bound;
  const db = { prepare: () => ({ bind: (...v) => ((bound = v), { all: async () => ({ results: [] }) }) }) };
  await productionRevenueByDeptDay(db, "hookka");
  assert.match(bound[1], /^\d{4}-\d{2}-\d{2}$/);
  const days = (Date.now() - Date.parse(bound[1])) / 86_400_000;
  assert.ok(days >= 399 && days <= 402, String(days));
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
