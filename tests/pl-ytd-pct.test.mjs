// ---------------------------------------------------------------------------
// pl-ytd-pct.test.mjs — BUG-2026-10-16-305: on the P&L statement the FY-to-date
// column's "% Sales" divided by the PERIOD's net sales (one month), so Net
// Sales YTD read e.g. 241.8% and every YTD % was inflated by YTD ÷ month. Each
// column's % is of its own net sales: the API sends the FY-to-date figure and
// the page divides the YTD column by it, on screen and in the download.
// Made-up figures only (the repo is public).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { fmtPctOfSales } from "../src/lib/finance-reports.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const api = read("src/api/routes/accounting.ts");
const st = ui.slice(ui.indexOf("function PLStatementTab("), ui.indexOf("// =============== TAB: OTHER DEBTORS / CREDITORS (Phase 1, 2026-06)"));

test("the API sends the FY-to-date net sales beside the period's", () => {
  assert.match(api, /netSalesSen: p\.netSalesSen,\n[\s\S]{0,200}ytdNetSalesSen: y\.netSalesSen,\n\s*rows: buildPnlRows\(p, y, editable\),/);
});

test("every YTD % on screen divides by the FY-to-date net sales; the period's by the period's", () => {
  assert.match(st, /const ytdNet = data\?\.ytdNetSalesSen \|\| 0;/);
  assert.match(st, /const pctYtd = \(v: number \| undefined\) => fmtPctOfSales\(v, ytdNet\);/);
  assert.doesNotMatch(st, /pct\(row\.ytdSen\)/, "a YTD cell divides by the period's net sales again");
  assert.equal((st.match(/pctYtd\(row\.ytdSen\)/g) ?? []).length, 4, "total lines, results, folded groups, lines");
  assert.equal((st.match(/[^Y]pct\(row\.periodSen\)/g) ?? []).length, 4);
});

test("the download's YTD % too", () => {
  assert.match(st, /r\.ytdSen === undefined \|\| !\(ytdNet > 0\) \? "" : `\$\{\(\(r\.ytdSen \/ ytdNet\) \* 100\)\.toFixed\(1\)\}%`,/);
  assert.doesNotMatch(st, /r\.ytdSen \/ net\b/);
});

test("the arithmetic: net sales to date read 100%, a profit its share of the year's sales", () => {
  const ytdSales = 600000_00, monthSales = 250000_00, ytdProfit = 90000_00;
  assert.equal(fmtPctOfSales(ytdSales, ytdSales), "100.0%");
  assert.equal(fmtPctOfSales(ytdProfit, ytdSales), "15.0%");
  assert.equal(fmtPctOfSales(ytdSales, monthSales), "240.0%", "the bug: a year over one month");
});
