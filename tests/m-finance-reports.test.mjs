// ---------------------------------------------------------------------------
// m-finance-reports.test.mjs — Overview, P&L, Cash Flow and Balance Sheet on
// the phone (plan 2026-10-17-finance-v2-mobile Task 2). Each reads its desktop
// endpoint, one month at a time; headline figures are the server's own rows;
// a month the server has no column for says so. Made-up figures.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { plHeadline, bsSides, cfColumnIndex } from "../src/pages/m/screens/finance/m-finance-lib.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const dir = "src/pages/m/screens/finance/";

test("P&L headline: the statement's own Gross / Net Profit rows, % of net sales", () => {
  const rows = [
    { kind: "group", label: "SALES", periodSen: 500000 },
    { kind: "grandtotal", label: "GROSS PROFIT", periodSen: 150000 },
    { kind: "grandtotal", label: "NET PROFIT", periodSen: -20000 },
  ];
  const h = plHeadline(rows, 500000);
  assert.deepEqual(h.gross, { sen: 150000, pct: 30 });
  assert.deepEqual(h.net, { sen: -20000, pct: -4 });
  assert.equal(plHeadline(rows, 0).gross.pct, null, "no sales, no %");
  assert.deepEqual(plHeadline([], 1000), { gross: null, net: null });
});

test("Balance Sheet: the two sides in the desktop arrangement", () => {
  const s = bsSides([
    { category: "FIXED_ASSET", balance: 10000 },
    { category: "CURRENT_ASSET", balance: 50000 },
    { category: "CURRENT_ASSET", balance: 5000 },
    { category: "CURRENT_LIABILITY", balance: 20000 },
    { category: "EQUITY", balance: 40000 },
    { category: "LONG_TERM_LIABILITY", balance: 5000 },
  ]);
  assert.equal(s.netCurrent, 35000);
  assert.equal(s.left, 45000, "fixed + current − current liabilities");
  assert.equal(s.right, 45000, "equity + non-current liabilities");
  assert.equal(s.diff, 0);
  assert.equal(bsSides([{ category: "CURRENT_ASSET", balance: 100 }]).diff, 100);
});

test("Cash Flow: the month's own column or none — never another month's", () => {
  const cols = [{ key: "acc", accum: true }, { key: "2026-09" }, { key: "2026-10" }];
  assert.equal(cfColumnIndex(cols, "2026-10"), 2);
  assert.equal(cfColumnIndex(cols, "2026-08"), -1);
  assert.equal(cfColumnIndex(cols, "acc"), -1, "Accumulated is not a month");
});

test("each screen reads its desktop endpoint", () => {
  const pl = read(dir + "PlScreen.tsx");
  assert.match(pl, /useCachedJson<StmtResp>\(`\/api\/accounting\/pl-statement\?period=\$\{period\}&line=\$\{line\}`\)/);
  assert.match(pl, /const shown = foldStatementRows\(rows, folded\);/);
  assert.match(pl, /const head = plHeadline\(rows, net\);/);
  assert.match(pl, /company|COMPANY\.HOOKKA\.name/);
  const cf = read(dir + "CashFlowScreen.tsx");
  assert.match(cf, /`\/api\/accounting\/cashflow-statement\?period=\$\{period\}`/);
  assert.match(cf, /const ci = stmt \? cfColumnIndex\(stmt\.columns, period\) : -1;/);
  assert.match(cf, /No cash flow for \{label\}\./);
  const bs = read(dir + "BalanceSheetScreen.tsx");
  assert.match(bs, /`\/api\/accounting\/pl\?period=\$\{period\}`/);
  assert.match(bs, /const sides = bsSides\(entries\);/);
  assert.match(bs, /sides\.diff === 0 \? "Balanced ✓" : checkLabel\(sides\.diff\)/);
  for (const t of ["CURRENT ASSETS LESS CURRENT LIABILITIES", "FINANCED BY", "TOTAL EQUITY + NON-CURRENT LIABILITIES"]) assert.ok(bs.includes(t), t);
  const ov = read(dir + "OverviewScreen.tsx");
  assert.match(ov, /`\/api\/accounting\/overview-trend\?months=\$\{range\}`/);
  assert.match(ov, /rmPct: p \? shareOfSales\(p\.rm\.usedSen, p\.netSalesSen\) : null/, "the desktop's own share");
  assert.match(ov, /dlPct: p \? shareOfSales\(p\.labourSen, p\.netSalesSen\) : null/);
});

test("the menu now lists the four reports; failures and empty months are said in words", () => {
  const route = read(dir + "FinanceRoute.tsx");
  for (const k of ["overview", "pl", "cashflow", "bs"]) assert.match(route, new RegExp(`\\n  ${k}: \\(\\) => <`), k);
  for (const f of ["PlScreen.tsx", "CashFlowScreen.tsx", "BalanceSheetScreen.tsx", "OverviewScreen.tsx"]) {
    assert.match(read(dir + f), /<FinanceNote tone="error">/, `${f}: a failed read says so`);
  }
});
