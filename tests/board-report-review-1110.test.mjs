import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deptName } from "../src/pages/board-report/format.ts";

// Owner review 2026-11-10 of the generated report against the design.
const fin = readFileSync("src/pages/board-report/pages-finance.tsx", "utf8");
const biz = readFileSync("src/pages/board-report/pages-business.tsx", "utf8");

test("cover carries a letterhead", () => {
  assert.match(fin, /className="brp-letterhead"/);
  assert.match(fin, /src="\/hookka-logo\.png"/);
});

test("labour shows department names, not codes", () => {
  assert.equal(deptName("FAB_SEW"), "Fabric Sewing");
  assert.equal(deptName("R_AND_D"), "R&D");
  assert.equal(deptName("NEW_DEPT"), "NEW_DEPT");
  assert.match(fin, /<td>\{deptName\(x\.dept\)\}<\/td>/);
});

test("cash flow stops at the report month and drops empty months before the books opened", () => {
  assert.match(fin, /const upTo = d\.months\.filter\(\(x\) => x\.ym <= r\.month\);/);
  assert.match(fin, /shown\.slice\(-8\)/);
  assert.doesNotMatch(fin, /d\.months\.slice\(-8\)/);
});

test("customers get a donut; operations ranks are lists; best revenue month starred", () => {
  assert.match(biz, /<Donut items=\{d\.rows\.slice\(0, 6\)/);
  assert.match(biz, /className="brp-rank"/);
  assert.match(fin, /s\.kind === "actual" && s\.sales === best/);
});

test("notes list only the last three months' losses", () => {
  assert.match(readFileSync("src/lib/board-report.ts", "utf8"), /closedMonths\(rows, month\)\.slice\(-3\)/);
});
