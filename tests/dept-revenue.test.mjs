// ---------------------------------------------------------------------------
// dept-revenue.test.mjs — /dashboard Department Revenue + Bedframe/Sofa split
// (src/api/lib/dept-revenue.ts, owner 2026-10-15).
//
// "正常来说，如果我一套沙发卖 2000，我有几个部门，在整个部门汇总里可能就会算到
//  18000。也就是每一个部门都会有相同的 revenue" — every department books the
// full order value, on the Production (UPHOLSTERY) rule.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  summarizeDeptRevenue,
  allocateDocsByCategory,
  productionByCategory,
  revenueBuckets,
  weekMonday,
  DEPT_REVENUE_ORDER,
} from "../src/api/lib/dept-revenue.ts";

const days = ["2026-10-01", "2026-10-02"];
const same = (d) => d;

test("a RM 2,000 sofa through 9 departments books RM 2,000 in EACH — RM 18,000 across them", () => {
  const sofaDepts = ["FAB_CUT", "FAB_SEW", "WOOD_CUT", "FOAM", "FIBRE", "FRAMING", "WEBBING", "UPHOLSTERY", "PACKING"];
  const rows = sofaDepts.map((deptCode) => ({ deptCode, date: "2026-10-01", category: "SOFA", totalSen: 200000 }));
  const out = summarizeDeptRevenue(rows, days, same);
  const booked = out.filter((d) => d.period.total > 0);
  assert.equal(booked.length, 9);
  for (const d of booked) {
    assert.equal(d.period.sofa, 200000);
    assert.equal(d.period.total, 200000);
  }
  assert.equal(out.reduce((s, d) => s + d.period.total, 0), 1800000);
  // A department the order never went through books nothing (here Foam Cutting).
  assert.equal(out.find((d) => d.code === "FOAM_CUTTING").period.total, 0);
});

test("every production department is listed in flow order, even at zero", () => {
  const out = summarizeDeptRevenue([], days, same);
  assert.deepEqual(out.map((d) => d.code), DEPT_REVENUE_ORDER.map((d) => d.code));
  assert.equal(out.find((d) => d.code === "FOAM").label, "Foam Bonding");
});

test("department rows bucket by day and split Bedframe / Sofa", () => {
  const rows = [
    { deptCode: "FAB_CUT", date: "2026-10-01", category: "BEDFRAME", totalSen: 50000 },
    { deptCode: "FAB_CUT", date: "2026-10-02", category: "SOFA", totalSen: 120000 },
  ];
  const fc = summarizeDeptRevenue(rows, days, same).find((d) => d.code === "FAB_CUT");
  assert.deepEqual([fc.period.bedframe, fc.period.sofa, fc.period.total], [50000, 120000, 170000]);
  assert.equal(fc.byBucket[0].bedframe, 50000);
  assert.equal(fc.byBucket[1].sofa, 120000);
});

test("an unknown department code that booked revenue is appended, not dropped", () => {
  const out = summarizeDeptRevenue([{ deptCode: "QC", date: "2026-10-01", category: "SOFA", totalSen: 1 }], days, same);
  assert.equal(out[out.length - 1].code, "QC");
});

test("the Production line by category is exactly the UPHOLSTERY department", () => {
  const rows = [
    { deptCode: "UPHOLSTERY", date: "2026-10-01", category: "SOFA", totalSen: 300 },
    { deptCode: "UPHOLSTERY", date: "2026-10-01", category: "ACCESSORY", totalSen: 7 },
    { deptCode: "PACKING", date: "2026-10-01", category: "SOFA", totalSen: 999 },
  ];
  const p = productionByCategory(rows, days, same);
  assert.deepEqual([p[0].sofa, p[0].accessory, p[0].total], [300, 7, 307]);
});

test("SO / invoice totals are allocated by line share and sum to the document total to the sen", () => {
  // One SO of 1,000.01 (header total incl. charges) with a bedframe line 300 and a sofa line 700.
  const lines = [
    { docId: "so1", day: "2026-10-01", docTotalSen: 100001, category: "BEDFRAME", lineSen: 30000 },
    { docId: "so1", day: "2026-10-01", docTotalSen: 100001, category: "SOFA", lineSen: 70000 },
  ];
  const [d1] = allocateDocsByCategory(lines, days, same);
  assert.equal(d1.bedframe, 30000);
  assert.equal(d1.sofa, 70001); // last bucket absorbs rounding
  assert.equal(d1.total, 100001);
  assert.equal(d1.bedframe + d1.sofa + d1.accessory + d1.unclassified, d1.total);
});

test("a document with no categorised / positive lines is Unclassified, never guessed as Bedframe", () => {
  const lines = [
    { docId: "inv1", day: "2026-10-02", docTotalSen: 5000, category: null, lineSen: 5000 },
    { docId: "inv2", day: "2026-10-02", docTotalSen: 800, category: null, lineSen: 0 },
  ];
  const [, d2] = allocateDocsByCategory(lines, days, same);
  assert.equal(d2.bedframe, 0);
  assert.equal(d2.unclassified, 5800);
  assert.equal(d2.total, 5800);
});

test("revenue buckets match the Revenue chart: days of a month, 12 Monday weeks for all-time", () => {
  const running = revenueBuckets("2026-10", "2026-10-15");
  assert.equal(running.from, "2026-10-01");
  assert.equal(running.to, "2026-10-15");
  assert.equal(running.buckets.length, 15);
  const past = revenueBuckets("2026-09", "2026-10-15");
  assert.equal(past.to, "2026-09-30");
  assert.equal(past.buckets.length, 30);
  const all = revenueBuckets("all", "2026-10-15"); // a Thursday
  assert.equal(all.buckets.length, 12);
  assert.equal(all.buckets[11], "2026-10-12");
  assert.equal(all.to, "2026-10-18");
  assert.equal(weekMonday("2026-10-18"), "2026-10-12"); // Sunday → previous Monday
  assert.equal(all.bucketOf("2026-10-14"), "2026-10-12");
});

test("the department SQL keeps the Production Revenue gate (all cards done, full value × qty)", () => {
  const src = readFileSync(resolve(process.cwd(), "src/api/lib/dept-revenue.ts"), "utf8");
  assert.match(src, /GROUP BY productionOrderId, departmentCode/);
  assert.match(src, /THEN 1 ELSE 0 END\) = COUNT\(\*\)/);
  assert.match(src, /soi\.unitPriceSen,\s*coi\.unitPriceSen,/);
  assert.match(src, /\* po\.quantity AS "totalSen"/);
  assert.match(src, /WHERE po\.orgId = \?/);
});
