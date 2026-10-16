// ---------------------------------------------------------------------------
// finance-v2-stock-bs.test.mjs — Stock Summary and the Balance Sheet in the v2
// look (plan 2026-10-16-finance-v2-reports Task 8). Same data calls and
// figures. Stock Summary gains TOTAL STOCK (raw materials + WIP + finished
// goods, each the server's figure) and still has no ✓ off the tautological
// `balanced` flag (BUG-2026-08-13-093) — the design's "Every group balances ✓"
// is not drawn. The Balance Sheet keeps its sections and order (the new layout
// waits for the owner, 2026-10-16) and gets the toolbar, the check strip and
// the frame.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const body = (name) => { const a = ui.indexOf(`function ${name}() {`); return ui.slice(a, ui.indexOf("\n}\n", a)); };
const stock = body("StockSummaryTab");
const bs = body("BalanceSheetTab");

test("Stock Summary: same calls; TOTAL STOCK from the server's three figures; no ✓ verdict", () => {
  assert.match(stock, /fetch\(`\/api\/accounting\/stock-summary\?period=\$\{month\}`\)/);
  assert.match(stock, /fetch\(`\/api\/accounting\/cost-by-line\?period=\$\{month\}`\)/);
  assert.match(stock, /const stockOpening = data \? data\.totals\.openingSen \+ data\.wip\.openingSen \+ data\.fg\.openingSen : 0;/);
  assert.match(stock, /const stockClosing = data \? data\.totals\.closingSen \+ data\.wip\.closingSen \+ data\.fg\.closingSen : 0;/);
  assert.match(stock, /<td>TOTAL STOCK<\/td>/);
  assert.doesNotMatch(stock, /balances ✓|r\.balanced/, "no verification that cannot fail (BUG-2026-08-13-093)");
  assert.doesNotMatch(stock, /<CheckStrip/);
});

test("Stock Summary: month stepper and download on the title row, the frame", () => {
  const bar = stock.slice(stock.indexOf("<FinanceTitleActions>"), stock.indexOf("</FinanceTitleActions>"));
  assert.match(bar, /<PeriodStepper value=\{month\} options=\{monthOpts\}/);
  assert.match(bar, /\{data && <DownloadMenu items=\{downloads\} \/>\}/);
  assert.match(stock, /<ReportFrame\n\s*company=\{COMPANY\.HOOKKA\.name\}/);
  assert.match(stock, /<WipDetailCard month=\{month\} reloadKey=\{0\} \/>/, "the WIP card is unchanged");
});

test("Balance Sheet: same call, same sections in the same order, drag-to-reclassify kept", () => {
  assert.match(bs, /`\/api\/accounting\/pl\?period=\$\{period\}\$\{orgIdParam\(company\)\}`/);
  const order = ["\"Current Assets\"", "\"Fixed Assets (Net)\"", "TOTAL ASSETS", "\"Current Liabilities\"", "\"Long-Term Liabilities\"", "Total Liabilities", "\"Equity\"", "TOTAL LIABILITIES + EQUITY"];
  let at = -1;
  for (const o of order) {
    const i = bs.indexOf(o, at + 1);
    assert.ok(i > at, `${o} in order`);
    at = i;
  }
  assert.match(bs, /if \(src\) void moveTo\(src, section\);/);
});

test("Balance Sheet: toolbar, the check strip on the sheet's own totals, the frame", () => {
  const bar = bs.slice(bs.indexOf("<FinanceTitleActions>"), bs.indexOf("</FinanceTitleActions>"));
  for (const c of ["<PeriodStepper", "<EditLayoutToggle", "<DownloadMenu"]) assert.ok(bar.includes(c), c);
  assert.match(bs, /const sheetDiff = totalAssets - totalLiabEquity;/);
  assert.match(bs, /<CheckStrip ok=\{sheetDiff === 0\} label=\{sheetDiff === 0 \? "Balanced ✓" : checkLabel\(sheetDiff\)\}>/);
  assert.match(bs, /title=\{`Balance Sheet \$\{asAtLabel\}`\}/);
  assert.match(bs, /<YearCloseCard \/>/, "the Year-End Close card stays");
});
