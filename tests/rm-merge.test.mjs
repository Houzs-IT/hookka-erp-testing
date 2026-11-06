import test from "node:test";
import assert from "node:assert/strict";
import { planRmMerge, retiredCode, rmMergeKey } from "../src/lib/rm-merge.ts";

const row = (id, itemCode, extra = {}) => ({ id, itemCode, description: "FABRIC", itemGroup: "S.M-FABR", createdAt: null, ...extra });

test("spellings of one code fold together", () => {
  for (const [a, b] of [["HOK-BO315-21", "BO315-21"], ["FABRIC HR805-90", "HR805-90"], ["ORION-1", "ORION-01"], ["RICH 2239-02", "RICH2239-02"], ["TARONI - NAVY BLUE", "TARONI-NAVY BLUE"]]) {
    assert.equal(rmMergeKey(a), rmMergeKey(b), a);
  }
});

test("different colours stay different", () => {
  assert.notEqual(rmMergeKey("PC151-01"), rmMergeKey("PC151-02"));
  assert.notEqual(rmMergeKey("PC151-1"), rmMergeKey("PC151-11"));
});

test("the code people use most is kept", () => {
  const usage = new Map([["BO315-21", 40], ["HOK-BO315-21", 1]]);
  const p = planRmMerge([row("a", "HOK-BO315-21"), row("b", "BO315-21")], usage, new Map());
  assert.equal(p.groups[0].keep.id, "b");
  assert.deepEqual(p.groups[0].losers.map((r) => r.id), ["a"]);
});

test("for one code on two rows, the row with stock is kept and takes the better name", () => {
  const rows = [row("new", "PC151-01", { description: "COMFY IVORY SAND", createdAt: "2026-07-02" }), row("old", "PC151-01")];
  const p = planRmMerge(rows, new Map([["PC151-01", 90]]), new Map([["old", 17776]]));
  assert.equal(p.groups[0].keep.id, "old");
  assert.equal(p.groups[0].description, "COMFY IVORY SAND");
});

test("rows in different item groups are not merged", () => {
  const p = planRmMerge([row("a", "X-1", { itemGroup: "B.M-FABR" }), row("b", "X-1")], new Map(), new Map());
  assert.equal(p.groups.length, 0);
  assert.equal(p.skippedMixedGroup.length, 1);
});

test("a lone row is left alone", () => {
  assert.equal(planRmMerge([row("a", "X-1")], new Map(), new Map()).groups.length, 0);
});

test("a retired row sharing the kept code gets its own code, a different spelling keeps its own", () => {
  assert.equal(retiredCode({ id: "rm-fb86e5c3", itemCode: "PC151-01" }, "PC151-01"), "PC151-01~MERGED~86e5c3");
  assert.equal(retiredCode({ id: "x", itemCode: "HOK-BO315-21" }, "BO315-21"), "HOK-BO315-21");
});
