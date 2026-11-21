// Owner 2026-11-20: a "Skipped steps" chip on Production Tracking lists the
// orders where, following the WIP flow, a later step is done while an earlier
// one is still open (「下个步骤好了 上个步骤还没好 就是跳流程了」).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const s = readFileSync("src/pages/production/index.tsx", "utf8");
const memo = s.slice(s.indexOf("const skippedPoIds = useMemo("), s.indexOf("const skippedCount = skippedPoIds.size;"));

test("the rule follows the WIP flow: within a chain, and at the merge points", () => {
  assert.match(memo, /chain\(x\) === chain\(d\) && RANK\[x\.departmentCode\] < RANK\[d\.departmentCode\]/);
  assert.match(memo, /done\.some\(\(j\) => j\.departmentCode === "PACKING"\)/);
  assert.match(memo, /!isBedframe &&\s*\n\s*done\.some\(\(d\) => d\.departmentCode === "UPHOLSTERY"\)/);
  assert.match(memo, /if \(o\.status === "CANCELLED"\) continue;/);
});

test("the chip filters the grid, date-independent, and clears with Clear all / an overdue chip", () => {
  assert.match(s, /Skipped steps \{skippedCount\}/);
  assert.match(s, /if \(skippedOnly && !skippedPoIds\.has\(o\.id\)\) return false;/);
  assert.match(s, /if \(!overduePoIdSet && !skippedOnly && !q\) \{/);
  assert.match(s, /setOverduePanelMode\(null\);\s*\n\s*setSkippedOnly\(false\);/);
  assert.match(s, /if \(next\) setSkippedOnly\(false\);\s*\n\s*setOverduePanelMode\(next\);/);
});
