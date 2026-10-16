// ---------------------------------------------------------------------------
// finance-v2-fund-transfer.test.mjs — the old Fund Transfer page in the v2 look
// (plan 2026-10-16-finance-v2-daily-b Task 3): its plain list opts into the v2
// table rules, dates read "15 Oct 2026", the state is a pill, and a footer
// totals the active transfers. Posting, void and the description edit are
// untouched.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const ui = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
const tab = ui.slice(ui.indexOf("function FundTransferTab("), ui.indexOf("// =============== TAB: STOCK SUMMARY"));

test("the list uses the v2 list look, the v2 date and a status pill", () => {
  assert.match(tab, /<table data-fin-list className="w-full text-sm">/);
  assert.match(tab, /\{fmtDocDate\(r\.date\)\}/);
  assert.match(tab, /<FinPill tone=\{\(r\.lifecycleState \?\? "ACTIVE"\) === "ACTIVE" \? "ok" : "faint"\}>/);
  assert.match(tab, /<tr data-fin-nolift><td colSpan=\{9\}[^>]*>No transfers yet/);
});

test("a footer totals the active transfers", () => {
  assert.match(tab, /<tfoot>/);
  assert.match(tab, /activeTotalSen\(rows\.map\(\(r\) => \(\{ state: r\.lifecycleState \?\? "ACTIVE", totalSen: r\.amountSen \}\)\)\)/);
});

test("posting, void, print and the description edit are unchanged", () => {
  assert.match(tab, /onDoubleClick=\{\(\) => setDetailFt\(r\.no\)\}/);
  assert.match(tab, /onContextMenu=\{rowMenu\.onContextMenu\(r\.no, \(\) => ftRowMenu\(r\)\)\}/);
  assert.match(tab, /\{saving \? "Posting…" : "Post Transfer"\}/);
  assert.match(tab, /<FtDescriptionEditor ft=\{r\} onClose=\{\(\) => setEditFt\(null\)\} onSaved=\{load\} \/>/);
});
