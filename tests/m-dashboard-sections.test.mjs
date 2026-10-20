// ---------------------------------------------------------------------------
// m-dashboard-sections.test.mjs — the phone's Finance Dashboard gets the five
// sections it was missing (owner 2026-10-19, asked why the phone showed only
// two: 「要」): Production / Non-Production Salary, Cost Structure, Balance
// Sheet, Financial Ratios. The figures come from one module the desktop page
// uses too (src/lib/finance-dashboard-calc.ts), so the two can't drift.
// Made-up figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  pctOf, csCategories, csAmount, csLineProdRev, csLineSales, csForecastSales, csForecastAmt, salaryDeptSplit, salaryCardMonth,
} from "../src/lib/finance-dashboard-calc.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const row = (o = {}) => ({
  actual: { sales: 100000, labour: 20000 },
  forecast: { sales: 120000, labour: 18000 },
  costStructure: {
    salesSplit: { bedframe: 30000, sofa: 70000 },
    forecast: { FABRIC: 9000, FOAM: 4000 },
    categories: [
      { name: "FABRIC", line: "sofa", spend: 8000, purchase: 9000, closing: 1000 },
      { name: "FABRIC", line: "bedframe", spend: 2000, purchase: 2500, closing: 300 },
      { name: "FOAM", line: "shared", spend: 5000, purchase: 5200, closing: 700 },
      { name: "WOOD", line: "bedframe", spend: 0, purchase: 0, closing: 0 },
    ],
  },
  productionRevenue: { bedframe: 25000, sofa: 60000, accessory: 5000, total: 90000 },
  salaryByDept: [
    { dept: "SEWING", costSen: 9000, forecastSen: 8000 },
    { dept: "UPHOLSTERY", costSen: 7000, forecastSen: 0 },
    { dept: "WAREHOUSE", costSen: 3000, forecastSen: 2500, nonProd: true },
    { dept: "R&D", costSen: 0, forecastSen: 0, nonProd: true },
  ],
  ...o,
});

test("percentages: 2 dp of their own base; none when a side is missing or the base is 0", () => {
  assert.equal(pctOf(1234, 10000), 12.34);
  assert.equal(pctOf(1, 3), 33.33);
  assert.equal(pctOf(null, 100), null);
  assert.equal(pctOf(5, 0), null);
  assert.equal(pctOf(5, null), null);
});

test("cost structure: a material on both lines adds up; a shared one is split by the line's share of sales", () => {
  const r = row();
  assert.deepEqual(csCategories([r, row({ costStructure: { salesSplit: { bedframe: 1, sofa: 1 }, categories: [{ name: "GLUE", line: "shared", spend: 1, purchase: 1, closing: 1 }] } })]), ["FABRIC", "FOAM", "GLUE", "WOOD"]);
  assert.equal(csAmount(r, "FABRIC", "spend", "all"), 10000);
  assert.equal(csAmount(r, "FABRIC", "spend", "sofa"), 8000);
  assert.equal(csAmount(r, "FOAM", "spend", "sofa"), 3500, "70% of the shared 5,000");
  assert.equal(csAmount(r, "FOAM", "purchase", "bedframe"), 1560, "30% of the shared 5,200");
  assert.equal(csLineSales(r, "all"), 100000);
  assert.equal(csLineSales(r, "bedframe"), 30000);
  assert.equal(csLineSales({ actual: { sales: 555, labour: 0 }, forecast: null }, "sofa"), 555, "no split → the row's sales");
  assert.equal(csLineProdRev(r, "sofa"), 65000, "Sofa takes the accessories");
  assert.equal(csLineProdRev(r, "bedframe"), 25000);
  assert.equal(csLineProdRev({ ...r, productionRevenue: null }, "all"), null);
  assert.equal(csForecastSales(r, "all"), 120000);
  assert.equal(csForecastSales(r, "sofa"), 84000, "the plan pro-rated by the actual split");
  assert.equal(csForecastAmt(r, "FABRIC", "bedframe"), 2700);
  assert.equal(csForecastAmt(r, "WOOD", "all"), null, "no plan keyed");
});

test("salary: departments split by the master's flag; a card sums its own; no figure → the fallback, or nothing", () => {
  const rows = [row(), row({ salaryByDept: [{ dept: "SEWING", costSen: 1, nonProd: false }, { dept: "PACKING", costSen: 2 }] })];
  assert.deepEqual(salaryDeptSplit(rows), { prod: ["PACKING", "SEWING", "UPHOLSTERY"], non: ["R&D", "WAREHOUSE"] });
  const prod = salaryCardMonth(row(), ["SEWING", "UPHOLSTERY"], { amount: 20000, forecast: 18000 });
  assert.equal(prod.amount, 16000);
  assert.equal(prod.forecast, 8000, "a zero forecast reads as none");
  assert.deepEqual(prod.byDept, [{ dept: "SEWING", amount: 9000, forecast: 8000 }, { dept: "UPHOLSTERY", amount: 7000, forecast: null }]);
  const non = salaryCardMonth(row(), ["R&D", "WAREHOUSE"], null);
  assert.deepEqual([non.amount, non.forecast], [3000, 2500]);
  // A month with no department figure: production falls back to the P&L labour bucket; non-production shows none.
  const bare = row({ salaryByDept: [] });
  assert.deepEqual([salaryCardMonth(bare, ["SEWING"], { amount: 20000, forecast: 18000 }).amount, salaryCardMonth(bare, ["SEWING"], { amount: 20000, forecast: 18000 }).forecast], [20000, 18000]);
  assert.deepEqual([salaryCardMonth(bare, ["WAREHOUSE"], null).amount, salaryCardMonth(bare, ["WAREHOUSE"], null).forecast], [null, null]);
});

test("the desktop page now reads the same module (its own copies are gone)", () => {
  const ui = read("src/pages/finance-dashboard.tsx");
  assert.match(ui, /from "@\/lib\/finance-dashboard-calc";/);
  // Since 2026-10-20 the desktop reads only the periods it shows (dashPeriods).
  assert.match(ui, /const salDeptSplit = useMemo\(\(\) => salaryDeptSplit\(shownRows\), \[shownRows\]\);/);
  assert.match(ui, /const csCats = useMemo\(\(\) => csCategories\(shownRows\), \[shownRows\]\);/);
  assert.match(ui, /const csAmount = \(r: Row, cat: string\): number => csAmountOf\(r, cat, csMeasure, csLine\);/);
  assert.match(ui, /const csLineProdRev = \(r: Row\): number \| null => csLineProdRevOf\(r, csLine\);/);
  assert.match(ui, /const csLineSales = \(r: Row\): number => csLineSalesOf\(r, csLine\);/);
  assert.match(ui, /const csForecastSales = \(r: Row\): number \| null => csForecastSalesOf\(r, csLine\);/);
  assert.match(ui, /const csForecastAmt = \(r: Row, cat: string\): number \| null => csForecastAmtOf\(r, cat, csLine\);/);
  assert.doesNotMatch(ui, /const pctOf = /, "one pctOf");
});

test("the phone: the desktop's seven sections, in its order, with its rules for when a card shows", () => {
  const scr = read("src/pages/m/screens/finance/DashScreen.tsx");
  const order = ["Income Statement</span>", 'title="Production Salary"', 'title="Non-Production Salary"', "<CostStructureCard", "Cash Flow · {monthName}", "<BalanceSheetCard", "<RatiosCard"];
  const at = order.map((s) => scr.indexOf(s));
  assert.ok(at.every((i) => i > 0), "every section is there");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in the desktop order");
  assert.match(scr, /const showProdSalary = rows\.some\(\(r\) => \(r\.actual\?\.labour \?\? null\) !== null\);/, "the desktop's labourData.some(amount !== null)");
  assert.match(scr, /\{split\.non\.length > 0 && \(/);
  assert.match(scr, /const showCostStructure = csCategories\(rows\)\.length > 0;/);
  assert.match(scr, /depts=\{split\.prod\} fallbackLabour denominators test="dash-sal-prod"/);
  assert.match(scr, /depts=\{split\.non\} fallbackLabour=\{false\} denominators=\{false\} test="dash-sal-non"/);
});

test("the phone's cards: the month the Income Statement card shows, the desktop's own rules", () => {
  const sec = read("src/pages/m/screens/finance/DashSections.tsx");
  // Salary: the card total from the shared module; RM / head and RM / unit divide the P&L labour bucket (the desktop table's base).
  assert.match(sec, /salaryCardMonth\(r, depts, fallbackLabour \? \{ amount: r\.actual\?\.labour \?\? null, forecast: r\.forecast\?\.labour \?\? null \} : null\)/);
  assert.match(sec, /const labour = last\.actual\?\.labour \?\? null;/);
  assert.match(sec, /const per = \(base: number \| null\) => \(labour !== null && base !== null && base > 0 \? Math\.round\(labour \/ base\) : null\);/);
  // Cost structure: the desktop table's per-material and TOTAL rules; the plan is spend-side only.
  assert.match(sec, /const fc = measure === "spend" \? csForecastAmt\(last, cat, line\) : null;/);
  assert.match(sec, /pct: sales > 0 \? Math\.round\(\(amt \/ sales\) \* 10000\) \/ 100 : null,/);
  assert.match(sec, /fcPct: fc !== null && fcSales !== null && fcSales > 0 \? Math\.round\(\(fc \/ fcSales\) \* 10000\) \/ 100 : null,/);
  // Balance sheet: nothing before the opening date says so; ratios: the desktop's six.
  assert.match(sec, /Balances start at the opening date — nothing before it\./);
  for (const l of ["Gross margin", "Net margin", "Current ratio", "Quick ratio", "ROE", "ROA"]) assert.ok(sec.includes(`label: "${l}"`), l);
});
