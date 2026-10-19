// ---------------------------------------------------------------------------
// finance-v2-receipts-list.test.mjs — the Receipts list on the v2 table (plan
// 2026-10-16-finance-v2-daily-b Task 1). Same shape as Payment Vouchers: every
// money-in door in one list on DataGrid (funnels, header menu, total over
// active receipts, v2 pills); the click-to-expand row is gone (owner 「继续做」
// on the recommendation) — double-click opens the popup with the same detail.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { financePage } from "../src/lib/finance-nav.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const tab = ui.slice(ui.indexOf("function ReceiptsHubTab("), ui.indexOf("// =============== TAB: FUND TRANSFER"));

test("title row: New Official Receipt · New Other Debtor Receipt · New Customer Receipt (primary, last)", () => {
  const at = tab.indexOf("<FinanceTitleActions>");
  assert.ok(at >= 0);
  const row = tab.slice(at, tab.indexOf("</FinanceTitleActions>", at));
  const iOr = row.indexOf("New Official Receipt"), iOd = row.indexOf("New Other Debtor Receipt"), iC = row.indexOf("New Customer Receipt");
  assert.ok(iOr >= 0 && iOr < iOd && iOd < iC, "order");
  assert.match(row.slice(row.lastIndexOf("<Button", iC), iC), /variant="primary"/);
  assert.doesNotMatch(tab, /Every payment in, one door\. <b>/, "the grey line moved behind the (i)");
  assert.match(financePage("receipts").explain, /Each posts on save/);
});

test("the list is a DataGrid; no expand; rows and columns are stable", () => {
  assert.doesNotMatch(tab, /setExpanded|expanded\[r\.key\]/, "no click-to-expand any more");
  assert.match(tab, /const rows = useMemo<ReceiptHubRow\[\]>\(/);
  assert.match(tab, /const gridRows = useMemo\(/);
  assert.match(tab, /const receiptColumns = useMemo<Column<ReceiptGridRow>\[\]>\(/);
  const at = tab.indexOf("<DataGrid");
  const g = tab.slice(at, tab.indexOf("\n          />\n        </CardContent>", at));
  for (const p of [
    "data={gridRows}", 'keyField="key"', 'gridId="accounting-receipts"', "selectable", "checkboxSelectOnly",
    "onSelectionChange={setPicked}", "clearSelectionToken={clearPickedToken}", "headerMenu", "reorderableHeaders",
    'exportName="Receipts"', 'searchPlaceholder="Search no / from / reference"', 'emptyMessage="No receipts match"',
    "onDoubleClick={(r) => setDetailKey(r.key)}", "contextMenuItems={(r) => rowMenuItems(receiptRowMenu(r))}",
  ]) {
    assert.ok(g.includes(p), `DataGrid ${p}`);
  }
  assert.match(g, /<SegmentedChips/);
  assert.match(g, /footerLabel=\{\(shown\) => \(/);
});

test("the columns, money and pills", () => {
  const at = tab.indexOf("const receiptColumns = useMemo<Column<ReceiptGridRow>[]>(");
  const cols = tab.slice(at, tab.indexOf("\n  ], [", at));
  const keys = [...cols.matchAll(/\{ key: "([a-zA-Z]+)", label: "([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(keys, ["no:No", "date:Date", "from:From", "viaLabel:Via / Deposit To", "note:Note", "totalSen:Total", "statusLabel:Status"]);
  assert.match(cols, /exportValue: \(r\) => r\.no/);
  assert.match(cols, /total: \(rows\) => activeTotalSen\(rows\)/);
  assert.match(cols, /<FinPill tone=\{r\.status\.tone\} title=\{r\.status\.title\}>\{r\.status\.label\}<\/FinPill>/);
  // receiptGridRow (module level, beside RECEIPT_CHIPS) builds the pill.
  assert.match(ui, /receiptStatus\(\{ state, custStatus: r\.cust\?\.status, unallocated \}\)/);
  assert.match(tab, /rowClassName=\{\(r\) => \(r\.state !== "ACTIVE" \? "opacity-50" : r\.unallocated \? "text-blue-600" : ""\)\}/, "money on account stays blue");
});

test("the popup keeps the detail table; the batch bar reads the grid's ticks", () => {
  assert.equal((tab.match(/\{detailTable\(r\)\}/g) ?? []).length, 1, "the popup shows the allocations / bills / lines");
  assert.match(tab, /count=\{picked\.length\}\s*onClear=\{clearPicked\}\s*onPrint=\{\(\) => printVouchers\(picked\.map\(voucherOf\)\)\}/);
  assert.doesNotMatch(tab, /useRowSelection\(|\bsel\.(count|selectedRows|clear)/, "the old hand-made selection is gone");
});
