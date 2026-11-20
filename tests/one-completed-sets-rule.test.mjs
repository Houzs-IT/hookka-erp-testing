// Owner 2026-11-20 「active 和 completed set 全套系统都一样」 + 「床架就是1个sku算一个」.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(p, "utf8");

test("Department Revenue sets = Floor Live's counts (bedframe SKU × qty, sofa set on its last piece)", () => {
  const s = read("src/api/routes/dashboard-overview.ts");
  assert.match(s, /departments: withFloorLiveSets\(summarizeDeptRevenue\(deptRows, buckets, bucketOf\), setDays, from, to, buckets, bucketOf\)/);
  assert.match(s, /cached\(c, `dept-completed:byday:\$\{orgId\}`, 120, \(\) => loadDeptCompletedByDay\(db, orgId\)\)/);
});

test("Command Center + operations report count sofa sets by Floor Live's rule (owner 2026-11-20: 9 vs 7)", () => {
  const ov = readFileSync("src/api/routes/dashboard-overview.ts", "utf8");
  assert.match(ov, /loadUpholsterySofaSets\(/);
  assert.match(ov, /sofaSets: rangeSofaSets,/);
  // Active Jobs: one set per order, consignment included.
  assert.match(ov, /COUNT\(DISTINCT COALESCE\(po\.salesOrderId, po\.consignmentOrderId, po\.id\)\) AS "sos"/);
  const rep = readFileSync("src/api/lib/operations-report.ts", "utf8");
  assert.match(rep, /sofaSets: \(await loadUpholsterySofaSets\(db, orgId, p\.startYmd, p\.endYmd\)\)\.length/);
  const dc = readFileSync("src/api/lib/dept-completed.ts", "utf8");
  assert.match(dc, /ss\.departmentCode = 'UPHOLSTERY'/);
  assert.match(dc, /MAX\(po\.customerName\) AS customer_name/);
});
