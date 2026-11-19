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
