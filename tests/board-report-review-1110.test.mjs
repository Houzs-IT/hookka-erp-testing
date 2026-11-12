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

test("second pass: income page chart fills the gap; labour lists non-production; materials has a total", () => {
  const f = readFileSync("src/pages/board-report/pages-finance.tsx", "utf8");
  assert.match(f, /Revenue, gross profit and net profit by month/);
  assert.match(f, /const incomeTrend = r\.trend\.ok \?/);
  // Owner 2026-11-13: payroll by home department, the non-production time split
  // OUT of direct labour on its own rows, every column filled; All labour = payroll.
  assert.match(f, /const direct = payroll - npTotal;/);
  assert.match(f, /<td>Less: time in non-production departments<\/td><td><Money v=\{-npTotal\} \/>/);
  assert.match(f, /<td>Direct labour \(production\)<\/td><td><Money v=\{direct\} \/>/);
  assert.match(f, /<td>All labour \(payroll\)<\/td><td><Money v=\{payroll\} \/>/);
  assert.match(f, /<Tile label="Direct labour" value=\{<>RM \{rm\(direct\)\}<\/>\}/);
  assert.doesNotMatch(f, /d\.total \+ \(d\.nonProdTotal/);
  assert.match(f, /const np = d\.nonProd \?\? \[\];/, "a report kept before this change has no nonProd");
  assert.match(f, /label="Forecast \(production\)"/);
  assert.match(f, /\{\/\* Total row \(owner review 2026-11-10\)\. \*\/\}/);
  const lib = readFileSync("src/lib/board-report.ts", "utf8");
  assert.match(lib, /x\.nonProd && x\.dept\.toUpperCase\(\) !== "PRODUCTION_SHORTFALL"/);
});

test("customers split the order value into bedframe and sofa (owner 2026-11-13)", async () => {
  const src = readFileSync("src/lib/board-report.ts", "utf8");
  assert.match(src, /bedframeTotal: r\.bedframeUnits > 0 \? Math\.round\(r\.bedframeAvgSen \* r\.bedframeUnits\) : null/);
  assert.match(src, /sofaTotal: r\.sofaSets > 0 \? Math\.round\(r\.sofaAvgSen \* r\.sofaSets\) : null/);
  const page = readFileSync("src/pages/board-report/pages-business.tsx", "utf8");
  assert.match(page, /<th>Bedframe, RM<\/th>/);
  assert.match(page, /<th>Sofa, RM<\/th>/);
});
