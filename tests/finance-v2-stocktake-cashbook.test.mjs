// ---------------------------------------------------------------------------
// finance-v2-stocktake-cashbook.test.mjs — Stock Take and Cash Book in the v2
// Monthly look (plan 2026-10-16-finance-v2-monthly Tasks 5–6). Light touch on
// two owner-tuned pages: the month and the existing buttons move to the title
// row, the lists take the v2 table look, Cash Book gains four cards read from
// the reconciliation it already shows. Every write keeps its handler and
// endpoint; the reconciliation card (three-state pill, difference first) is
// untouched.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const st = ui.slice(ui.indexOf("function StockTakeTab() {"), ui.indexOf("\nfunction OpeningStockTab()"));
const cb = (() => { const a = ui.indexOf("function CashBookTab({ accounts }: { accounts: ChartOfAccount[] }) {"); return ui.slice(a, ui.indexOf("\n}\n", a)); })();
const bar = (src) => src.slice(src.indexOf("<FinanceTitleActions>"), src.indexOf("</FinanceTitleActions>"));

test("Stock Take: the month and the same four buttons on the title row; the lists in the v2 look", () => {
  const b = bar(st);
  assert.match(b, /<PeriodStepper value=\{ym\} options=\{monthOptions\(todayYmdMY\(\)\.slice\(0, 7\), 18\)\} onChange=\{setYm\} \/>/);
  assert.match(b, /onClick=\{runAliasSeed\}/);
  assert.match(b, /onClick=\{handleExportTemplate\}/);
  assert.match(b, /if \(f\) void handleImportFile\(f\);/);
  assert.match(b, /onClick=\{save\} disabled=\{saving \|\| !allRowGroups\}>/);
  assert.equal((st.match(/<table data-fin-list className="w-full text-sm"/g) ?? []).length, 5);
  assert.match(st, /Closing stock for \{periodLabel\(ym, ""\)\}/);
  assert.doesNotMatch(st, /type="month"/, "the month picker lives on the title row now");
});

test("Cash Book: account, month and the same import / match buttons on the title row", () => {
  const b = bar(cb);
  assert.match(b, /onChange=\{\(e\) => \{ setAccount\(e\.target\.value\); setData\(null\); setReport\(null\); \}\}/);
  assert.match(b, /<PeriodStepper value=\{month\}/);
  assert.match(b, /onClick=\{\(\) => pdfInputRef\.current\?\.click\(\)\}/);
  assert.match(b, /onClick=\{\(\) => setShowImport\(!showImport\)\}>Import CSV</);
  assert.match(b, /onClick=\{handleAutoMatch\}>Auto-match</);
});

test("Cash Book: every reconciliation write is still there; the card keeps its pill and its table", () => {
  for (const ep of ["/bank-reco/import-session", "/bank-reco/automatch", "/bank-reco/match", "/bank-reco/unmatch", "/bank-reco/match-group", "/bank-reco/match-split", "/bank-reco/book-line", "/bank-reco/ignore", "/bank-reco/finalize", "/bank-reco/strict-lock"]) {
    assert.ok(cb.includes(ep), ep);
  }
  assert.match(cb, /NOT TALLY — out by/);
  assert.match(cb, /Tally ✓ · all recorded/);
  assert.match(cb, /Finalise this month/);
  assert.match(cb, /= explained to the sen by the two lines above ✓/);
  assert.equal((cb.match(/<table data-fin-list className="w-full text-sm">/g) ?? []).length, 6);
});

test("Cash Book cards read the same figures as the reconciliation card", () => {
  assert.match(cb, /const shown = recoFinal \?\? report;\n\s*const diffSen = shown\.statementClosingSen != null \? shown\.glSen - shown\.statementClosingSen : null;\n\s*const unexplained = diffSen == null \? null : diffSen - \(shown\.unclearedBookSen - shown\.unbookedStmtSen\);/);
  assert.match(cb, /value: `\$\{shown\.unbookedStmtCount\} bank · \$\{shown\.unclearedBookCount\} book`/);
});
