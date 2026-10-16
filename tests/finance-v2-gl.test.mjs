// ---------------------------------------------------------------------------
// finance-v2-gl.test.mjs — the General Ledger in the v2 look (plan
// 2026-10-16-finance-v2-reports Task 4). Same three data calls (one-account
// inquiry, the grouped report, the flat listing) and the same URL hand-off from
// the drills; new: a v2 filter row with the Accounts multi-picker (By Code
// Range + Tick), Expand / Collapse All, a summary bar, account blocks in the
// v2 frame, credit balances in brackets, double-click a line to open its
// source, Excel / Print-PDF. The Sales / Purchase scope still opens the
// per-party ledger (owner). Rows stay pinned to GL_ROW_PX so the windowed
// listings keep their place.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const gl = ui.slice(ui.indexOf("function GeneralLedgerTab("), ui.indexOf("// =============== TAB: PAYMENT / EXPENSE (Phase 3.2)"));
const shell = read("src/components/finance/report-shell.tsx");
const picker = shell.slice(shell.indexOf("export function AccountMultiPicker("));
const css = read("src/styles/finance-v2.css");

test("the same three data calls, with the same filters", () => {
  assert.match(gl, /fetch\(`\/api\/accounting\/gl\?\$\{params\.toString\(\)\}`\)[\s\S]{0,240}setGl\(/, "one account: the inquiry");
  assert.match(gl, /fetch\(`\/api\/accounting\/gl-report\?\$\{params\.toString\(\)\}`\)[\s\S]{0,240}setReport\(/, "by account: the grouped report");
  assert.match(gl, /fetch\(`\/api\/accounting\/gl\?\$\{params\.toString\(\)\}`\)[\s\S]{0,240}setAll\(/, "flat listing");
  assert.match(gl, /\}, \[picked\.join\(","\), ledger, from, to, view\]\);/);
  assert.match(gl, /if \(picked\.length > 1\) params\.set\("accounts", picked\.join\(","\)\);/);
});

test("the Sales / Purchase scope still opens the per-party ledger", () => {
  assert.match(gl, /if \(ledger === "sales" \|\| ledger === "purchase"\) \{[\s\S]{0,260}<PartyLedgerTab side=\{ledger === "sales" \? "DEBTOR" : "CREDITOR"\} \/>/);
  assert.match(gl, /setLedger\(e\.target\.value as typeof ledger\);[\s\S]{0,200}setPicked\(\[\]\);\n\s*reset\(\);/, "a scope change clears the picked set");
});

test("Accounts: the multi-picker over the accounts in scope", () => {
  assert.match(gl, /const scopeOptions = accounts\n\s*\.filter\(inLedgerScope\)/);
  assert.match(gl, /<AccountMultiPicker options=\{scopeOptions\} picked=\{picked\} onChange=\{\(codes\) => \{ setPicked\(codes\); reset\(\); \}\} \/>/);
  assert.match(picker, /const codes = codesInRange\(options\.map\(\(o\) => o\.code\), rangeFrom, rangeTo\);\n\s*onChange\(\[\.\.\.new Set\(\[\.\.\.picked, \.\.\.codes\]\)\]\);/, "Tick adds the range to what is ticked");
  assert.match(picker, />By Code Range</);
  assert.match(picker, />Tick</);
  assert.match(picker, /picked\.length === 0 \? "All accounts in scope"/);
  assert.match(picker, /usePopover\(\)/, "closes on Esc and on a click outside");
});

test("Expand / Collapse All and the summary bar (totals from the server)", () => {
  assert.match(gl, /setCollapsedAccts\(anyShut \? \{\} : Object\.fromEntries\(report\.accounts\.map\(\(a\) => \[a\.code, true\]\)\)\)/);
  assert.match(gl, /\{anyShut \? "Expand all" : "Collapse all"\}/);
  assert.match(gl, /TOTAL DR \{formatCurrency\(report\.grandDr\)\}/);
  assert.match(gl, /TOTAL CR \{formatCurrency\(report\.grandCr\)\}/);
  assert.match(gl, /grandDiff === 0 \? "Diff RM 0\.00 ✓" : `Diff \$\{formatCurrency\(grandDiff\)\}`/);
});

test("balances: debit plain, credit in brackets — the inquiry turns a credit-normal account round", () => {
  assert.match(gl, /const inquiryDebitNormal = gl \? \(gl\.debitNormal \?\? \["ASSET", "EXPENSE", "COST"\]\.includes\(gl\.account\.type\)\) : true;/);
  assert.match(gl, /const drCr = \(natural: number\) => \(inquiryDebitNormal \? natural : -natural\);/);
  assert.match(gl, /<td data-cell="num">\{fmtLedgerBal\(drCr\(r\.runningSen\)\)\}<\/td>/);
  assert.match(gl, /<td data-cell="num">\{fmtLedgerBal\(r\.runningSen\)\}<\/td>/, "the grouped report already runs debit minus credit");
  assert.match(gl, /Acc\. No\.: <span className="tabular-nums">\{a\.code\}<\/span> \{a\.name\.toUpperCase\(\)\}/);
  assert.match(gl, /<td colSpan=\{6\}>Balance B\/F<\/td>/);
});

test("rows stay pinned to GL_ROW_PX; the windowed listings keep their spacers", () => {
  assert.match(gl, /const flatVirt = useVirtualRows\(\{\n\s*count: all\?\.rows\.length \?\? 0,\n\s*rowHeight: GL_ROW_PX,/);
  assert.match(gl, /\{inquiryVirt\.topSpacer\}/);
  assert.match(gl, /\{flatVirt\.bottomSpacer\}/);
  const pinned = (gl.match(/style=\{\{ height: GL_ROW_PX \}\}/g) ?? []).length;
  assert.equal(pinned, 8, "grouped B/F, line, total; account totals line; inquiry B/F, line, total; flat line");
  assert.match(ui, /const GL_ROW_PX = 29;/);
  assert.match(css, /table\[data-fin-report\]\[data-fin-dense\] > tbody > tr > td \{\n  padding-top: 4px;\n  padding-bottom: 4px;\n\}/, "a dense row fits in 29px");
});

test("double-click a line to open its source; one download on the title row", () => {
  assert.match(gl, /const openSource = \(href: string \| null\) => \(href \? \(\) => navigate\(href\) : undefined\);/);
  assert.equal((gl.match(/onDoubleClick=\{openSource\(href\)\}/g) ?? []).length, 3, "grouped, inquiry and flat lines");
  const bar = gl.slice(gl.indexOf("<FinanceTitleActions>"), gl.indexOf("</FinanceTitleActions>"));
  assert.match(bar, /<DownloadMenu items=\{downloads\} \/>/);
  assert.match(gl, /label: "Export to Excel"/);
  assert.match(gl, /label: "Print \/ PDF"/);
});
