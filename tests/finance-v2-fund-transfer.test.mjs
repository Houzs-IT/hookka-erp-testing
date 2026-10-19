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

// Since 2026-10-17 the list is the Payment Vouchers table (DataGrid: header
// menu, filters, resize / reorder, Set as default, sticky total).
test("the list is the PV-table grid, with the v2 date and a status pill", () => {
  assert.match(tab, /<DataGrid\n\s*columns=\{ftColumns\}/);
  assert.match(tab, /gridId="accounting-fund-transfers"/);
  assert.match(tab, /headerMenu\n\s*reorderableHeaders\n\s*exportName="Fund Transfers"/);
  assert.match(tab, /\{fmtDocDate\(r\.date\)\}/);
  assert.match(tab, /<FinPill tone=\{\(r\.lifecycleState \?\? "ACTIVE"\) === "ACTIVE" \? "ok" : "faint"\}>/);
  assert.match(tab, /emptyMessage="No transfers yet"/);
});

test("the total row counts the active transfers", () => {
  assert.match(tab, /total: \(list\) => activeTotalSen\(list\.map\(\(r\) => \(\{ state: r\.lifecycleState \?\? "ACTIVE", totalSen: r\.amountSen \}\)\)\)/);
});

test("posting, void, print and the description edit are unchanged", () => {
  assert.match(tab, /onDoubleClick=\{\(r\) => setDetailFt\(r\.no\)\}/);
  assert.match(tab, /contextMenuItems=\{\(r\) => rowMenuItems\(ftRowMenu\(r\)\)\}/);
  assert.match(tab, /\{saving \? "Posting…" : "Post Transfer"\}/);
  assert.match(tab, /<FtDescriptionEditor ft=\{r\} onClose=\{\(\) => setEditFt\(null\)\} onSaved=\{load\} \/>/);
});
