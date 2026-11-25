// AI Connector quick answers (src/api/lib/mcp-quick.ts) and the one-check-per-lookup cache (mcp-inner.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deptRevenue,
  myToday,
  normalisePeriod,
  pctChange,
  pickFields,
  rm,
  sameDaysPrevMonth,
  summariseProduction,
  summariseSales,
  validRange,
} from "../src/api/lib/mcp-quick.ts";
import { recallVerified, rememberVerified } from "../src/api/lib/mcp-inner.ts";

test("money and percent helpers", () => {
  assert.equal(rm(56394474), 563944.74);
  assert.equal(rm(null), 0);
  assert.equal(pctChange(110, 100), 10);
  assert.equal(pctChange(5, 0), null);
});

test("periods, ranges and the same days last month", () => {
  assert.equal(normalisePeriod("2026-q4", "2026-11-25"), "2026-Q4");
  assert.equal(normalisePeriod("junk", "2026-11-25"), "2026-11");
  assert.equal(myToday(new Date("2026-11-25T17:00:00Z")), "2026-11-26"); // Malaysia is UTC+8
  assert.deepEqual(sameDaysPrevMonth("2026-11-01", "2026-11-25"), { from: "2026-10-01", to: "2026-10-25" });
  assert.deepEqual(sameDaysPrevMonth("2026-03-01", "2026-03-31"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(sameDaysPrevMonth("2026-01-05", "2026-01-10"), { from: "2025-12-05", to: "2025-12-10" });
  assert.equal(validRange("2026-11-25", "2026-11-01"), null);
  assert.equal(validRange("2026-11-01", "bad"), null);
  assert.deepEqual(validRange("2026-11-01", "2026-11-25"), { from: "2026-11-01", to: "2026-11-25" });
});

test("sales summary reads the Dashboard overview into a small answer", () => {
  const ov = {
    salesThisMonthSen: 56394474,
    deliveredThisMonthSen: 48850859,
    invoicesThisMonthSen: 45871809,
    aovCompany: { bedframeUnits: 436, sofaSets: 168, bedframeAvgSen: 53412, sofaAvgSen: 195338 },
    aovByCustomer: [
      { customerName: "B", totalSen: 100, bedframeUnits: 1, sofaSets: 0 },
      { customerName: "A", totalSen: 36462000, bedframeUnits: 342, sofaSets: 83 },
    ],
    topSellers: { BEDFRAME: [{ productCode: "1013-(Q)", productName: "JAGER", qtySold: 73, valueSen: 2198200 }], SOFA: [{ model: "5531", setsSold: 25, valueSen: 4699449 }] },
    weeklyRevenue: [
      { week: "2026-11-01", salesOrderSen: 0, invoiceSen: 0 },
      { week: "2026-11-02", salesOrderSen: 5363950, invoiceSen: 1903250 },
    ],
    monthlyRevenue: [
      { month: "2026-10", salesOrderSen: 58629106, invoiceSen: 46529913 },
      { month: "2026-11", salesOrderSen: 56394474, invoiceSen: 45871809 },
    ],
  };
  const s = summariseSales(ov, "2026-11");
  assert.equal(s.salesOrdersRm, 563944.74);
  assert.deepEqual(s.previousMonth, { month: "2026-10", salesOrdersRm: 586291.06, changePct: -3.8 });
  assert.equal(s.byCustomer[0].customer, "A");
  assert.deepEqual(s.daily, [{ date: "2026-11-02", salesOrdersRm: 53639.5, invoicedRm: 19032.5 }]);
  assert.equal(s.topSofaModels[0].sets, 25);
  assert.ok(JSON.stringify(s).length < 3000);
});

test("department revenue groups DEPT|CATEGORY keys", () => {
  assert.deepEqual(deptRevenue({ "UPHOLSTERY|SOFA": 1000, "UPHOLSTERY|BEDFRAME": 500, "FAB_CUT|SOFA": 200 }), [
    { dept: "Upholstery", rm: 15, byCategoryRm: { SOFA: 10, BEDFRAME: 5 } },
    { dept: "Fabric Cutting", rm: 2, byCategoryRm: { SOFA: 2 } },
  ]);
});

test("production summary rolls rows up and compares the same days last month", () => {
  const cur = {
    success: true,
    data: {
      SOFA: 300, BEDFRAME: 700, ACCESSORY: 0, totalSen: 1000,
      byDeptCategory: { "UPHOLSTERY|BEDFRAME": 700 },
      rows: [
        { date: "2026-11-02", productCode: "P1", productName: "Bed", qty: 1, totalPriceSen: 700 },
        { date: "2026-11-03", productCode: "S1", productName: "Sofa", qty: 1, totalPriceSen: 300 },
      ],
    },
  };
  const prev = { success: true, data: { totalSen: 800 } };
  const ov = { production: { backlogDays: 16.5, activeJobs: { bedframeUnits: 283, sofaSets: 147 }, completedLast7: [{ date: "2026-11-02", bedframeUnits: 18, sofaSets: 7 }, { date: "2026-12-01", bedframeUnits: 99, sofaSets: 9 }], capacityDays: [{ date: "2026-11-02", workers: 29, outsourceMinutes: 2185, minutes: 21040 }], backlogByDept: [{ dept: "Foam Cutting", backlogDays: 23.1 }] } };
  const p = summariseProduction({ from: "2026-11-01", to: "2026-11-25" }, cur, { from: "2026-10-01", to: "2026-10-25" }, prev, ov);
  assert.equal(p.productionRevenueRm, 10);
  assert.equal(p.sameDaysLastMonth?.changePct, 25);
  assert.deepEqual(p.daily, [{ date: "2026-11-02", rm: 7 }, { date: "2026-11-03", rm: 3 }]);
  assert.equal(p.topProducts[0].product, "P1 Bed");
  assert.deepEqual(p.unitsCompleted, { bedframeUnits: 18, sofaSets: 7 }); // the December row is outside the range
  assert.equal(p.workforce?.avgWorkersPerDay, 29);
  assert.equal(p.backlogNow?.slowestDepartments[0].dept, "Foam Cutting");
});

test("pickFields keeps only the named keys, at any depth", () => {
  const v = { success: true, data: { rows: [{ soNo: "SO-1", customerName: "A", junk: 1 }] } };
  assert.deepEqual(pickFields(v, ["soNo", "customerName"]), { data: { rows: [{ soNo: "SO-1", customerName: "A" }] } });
  assert.equal(pickFields(v, []), v);
});

test("a verified token is reused briefly, then forgotten", () => {
  rememberVerified("hkmcp_x", { userId: "u1" }, 1_000);
  assert.deepEqual(recallVerified("hkmcp_x", 5_000), { userId: "u1" });
  assert.equal(recallVerified("hkmcp_x", 20_000), null);
  assert.equal(recallVerified("hkmcp_never", 1_000), null);
});
