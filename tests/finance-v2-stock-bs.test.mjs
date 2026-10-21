// ---------------------------------------------------------------------------
// finance-v2-stock-bs.test.mjs — Stock Summary and the Balance Sheet in the v2
// look (plan 2026-10-16-finance-v2-reports Task 8). Same data calls and
// figures. Stock Summary gains TOTAL STOCK (raw materials + WIP + finished
// goods, each the server's figure) and still has no ✓ off the tautological
// `balanced` flag (BUG-2026-08-13-093) — the design's "Every group balances ✓"
// is not drawn. The Balance Sheet takes the design's arrangement (owner
// 2026-10-17 「可以」: Fixed Assets; Current Assets less Current Liabilities;
// Financed By) from the same sections, with the toolbar, the check strip on
// the two sides and the frame.
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
  assert.match(stock, /<WipDetailCard month=\{month\} reloadKey=\{0\} \/>/, "the WIP card stays under the summary (by production order since item 12 — tests/wip-by-production-order.test.mjs)");
});

test("Balance Sheet: the design's arrangement (owner 2026-10-17) from the same call and sections", () => {
  assert.match(bs, /`\/api\/accounting\/pl\?period=\$\{period\}\$\{orgIdParam\(company\)\}`/);
  // Fixed Assets; Current Assets less Current Liabilities = Net Current Assets;
  // the left total; Financed By: Equity and Non-Current Liabilities; the right total.
  const order = [
    'renderBSSection("FA", "Fixed Assets (Net)"', "CURRENT ASSETS LESS CURRENT LIABILITIES",
    'renderBSSection("CA", "Current Assets"', 'renderBSSection("CL", "Less: Current Liabilities"',
    "Net Current Assets", "FIXED ASSETS + CURRENT ASSETS − CURRENT LIABILITIES", "FINANCED BY",
    'renderBSSection("EQ", "Equity"', 'renderBSSection("LL", "Non-Current Liabilities"', "TOTAL EQUITY + NON-CURRENT LIABILITIES",
  ];
  const body = bs.slice(bs.indexOf("<tbody>"));
  let at = -1;
  for (const o of order) {
    const i = body.indexOf(o, at + 1);
    assert.ok(i > at, `${o} in order`);
    at = i;
  }
  assert.doesNotMatch(body, /TOTAL ASSETS<|Total Liabilities</, "Total Assets / Total Liabilities are gone");
  assert.match(bs, /const netCurrent = totalCurrentAssets - totalCurrentLiab;\n\s*const leftTotal = totalFixedAssets \+ netCurrent;\n\s*const rightTotal = totalEquity \+ totalLongTermLiab;\n\s*const sheetDiff = leftTotal - rightTotal;/);
  assert.match(bs, /if \(src\) void moveTo\(src, section\);/, "drag to reclassify kept");
});

test("Balance Sheet: toolbar with L1–L5, the check strip on the two sides, the frame", () => {
  const bar = bs.slice(bs.indexOf("<FinanceTitleActions>"), bs.indexOf("</FinanceTitleActions>"));
  for (const c of ["<PeriodStepper", "<EditLayoutToggle", "<DownloadMenu", "levels={[1, 2, 3, 4, 5]}"]) assert.ok(bar.includes(c), c);
  assert.match(bs, /<CheckStrip ok=\{sheetDiff === 0\} label=\{sheetDiff === 0 \? "Balanced ✓" : checkLabel\(sheetDiff\)\}>/);
  assert.match(bs, /Fixed Assets \+ Current Assets − Current Liabilities <b className="tabular-nums">\{fmtAmt\(leftTotal\)\}<\/b>/);
  assert.match(bs, /Total Equity \+ Non-Current Liabilities <b className="tabular-nums">\{fmtAmt\(rightTotal\)\}<\/b>/);
  assert.match(bs, /title=\{`Balance Sheet \$\{asAtLabel\}`\}/);
  assert.match(bs, /company=\{COMPANY\.HOOKKA\.name\}/);
  assert.match(bs, /<YearCloseCard \/>/, "the Year-End Close card stays");
  // L1 totals only; L5 opens every account's ledger lines (a click folds one) — L3 / L4 are the
  // parent accounts folded / open since 2026-10-21 (tests/bs-groups.test.mjs).
  assert.match(bs, /if \(level < 2 && !edit\) \{/);
  assert.match(bs, /const drilled = canDrill && \(level >= 5 \? !bsDrillOpen\.has\(drillKey\) : bsDrillOpen\.has\(drillKey\)\);/);
});
