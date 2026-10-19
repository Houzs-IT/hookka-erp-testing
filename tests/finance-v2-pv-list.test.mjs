// ---------------------------------------------------------------------------
// finance-v2-pv-list.test.mjs — the Payment Vouchers list on the v2 table
// (plan 2026-10-16-finance-v2-daily-a Task 4). Everything the page did stays:
// every money-out door in one list, the ladder batch on vouchers only, print /
// export of the ticked rows, double-click popups, row menus — now on DataGrid
// with funnels, the header menu, the total row and the v2 status pills.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { FINANCE_PAGES, financePage } from "../src/lib/finance-nav.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const tab = ui.slice(ui.indexOf("function PaymentsTab("), ui.indexOf("function ReceiptsHubTab("));

test("the title row carries Scan, New Payment Voucher and New AP Payment (primary, last)", () => {
  const at = tab.indexOf("<FinanceTitleActions>");
  assert.ok(at >= 0, "the buttons sit on the title row");
  const row = tab.slice(at, tab.indexOf("</FinanceTitleActions>", at));
  const iFooter = row.indexOf('aria-label="Print footer"');
  const iScan = row.indexOf("<ScanVouchers");
  const iPv = row.indexOf("New Payment Voucher");
  const iAp = row.indexOf("New AP Payment");
  assert.ok(iFooter >= 0 && iFooter < iScan && iScan < iPv && iPv < iAp, "⚙ · Scan · New Payment Voucher · New AP Payment");
  assert.match(row.slice(row.lastIndexOf("<Button", iAp), iAp), /variant="primary"/, "New AP Payment is the primary action");
  assert.doesNotMatch(tab, /Every payment out, one door\. <b>/, "the grey explanation moved behind the (i)");
});

test("the page explanation keeps its links to the Supplier Payment and Other Creditor Payments pages", () => {
  const p = financePage("payments");
  assert.match(p.explain, /Supplier Payment page/);
  assert.deepEqual(p.links, [
    { label: "Supplier Payment page", to: "/invoices/supplier-payments" },
    { label: "Other Creditor Payments", to: "/accounting?tab=ocreditorpay" },
  ]);
  assert.equal(FINANCE_PAGES.overview.links, undefined);
  const t = read("src/components/finance/page-title.tsx");
  assert.match(t, /\{links\?\.map\(\(l\) => \(/);
  assert.match(t, /<Link key=\{l\.to\} to=\{l\.to\}/);
});

test("segmented chips with counts; the old date / bank / door inputs and door-count line are gone", () => {
  assert.match(tab, /<SegmentedChips\s+options=\{PV_STATUS_CHIPS\.map\(\(ch\) => \(\{ key: ch\.key, label: ch\.label, count: ch\.key === "ALL" \? undefined : chipCount\(ch\.key\) \}\)\)\}\s+value=\{statusFilter\}\s+onChange=\{setStatusFilter\}/);
  assert.doesNotMatch(tab, /type="date" value=\{dateFrom\}/);
  assert.doesNotMatch(tab, /<option value="">All banks<\/option>/);
  assert.doesNotMatch(tab, /<option value="">All doors<\/option>/);
  assert.doesNotMatch(tab, /old fund transfer\n/);
});

test("the list is a DataGrid with the v2 rules and today's behaviour", () => {
  const at = tab.indexOf("<DataGrid");
  assert.ok(at >= 0);
  // Up to the grid's own closing tag (the chips inside it close first).
  const g = tab.slice(at, tab.indexOf("\n          />\n        </CardContent>", at));
  for (const p of [
    "data={gridRows}", 'keyField="key"', 'gridId="accounting-payments"', "selectable", "checkboxSelectOnly",
    "onSelectionChange={setPicked}", "clearSelectionToken={clearPickedToken}", "headerMenu", "reorderableHeaders",
    'exportName="Payment Vouchers"', 'searchPlaceholder="Search PV no / payee / bill no"', 'emptyMessage="No payments match"',
  ]) {
    assert.ok(g.includes(p), `DataGrid ${p}`);
  }
  assert.match(g, /onDoubleClick=\{\(r\) => \(r\.pv \? setDetailPvId\(r\.pv\.id\) : setDetailPayKey\(r\.key\)\)\}/);
  assert.match(g, /contextMenuItems=\{\(r\) => rowMenuItems\(r\.pv \? pvRowMenu\(r\.pv\) : payRowMenu\(r\)\)\}/);
  // + the Reference (2026-10-19, tests/finance-reference-fields.test.mjs).
  assert.match(g, /alwaysSearchKeys=\{\["no", "payeeText", "descText", "refText", "billNos"\]\}/, "a bill number still finds its voucher");
  assert.match(tab, /const gridRows = useMemo\(/, "stable rows (BUG-CLASSES C24: an unstable list loops the selection)");
  assert.match(tab, /const payColumns = useMemo<Column<PayGridRow>\[\]>\(/, "stable columns");
});

test("the columns, in the design's order, with the money and the funnels right", () => {
  const at = tab.indexOf("const payColumns = useMemo<Column<PayGridRow>[]>(");
  const cols = tab.slice(at, tab.indexOf("\n  ], [", at));
  const keys = [...cols.matchAll(/\{ key: "([a-zA-Z]+)", label: "([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
  // + Reference after Payee / Description (2026-10-19, the owner's 「Reference 栏」).
  assert.deepEqual(keys, ["no:PV No", "date:Date", "payeeText:Payee / Description", "refText:Reference", "viaLabel:Paid From", "lineText:Line", "totalSen:Total", "statusLabel:Status"]);
  assert.match(cols, /filterAccessor: \(r\) => PAY_DOOR_LABEL\[r\.door\], exportValue: \(r\) => r\.no/, "the PV No funnel lists doors; the export writes the number");
  assert.match(cols, /r\.viaLabel \|\| \(r\.door === "SP" \? "\(no bank leg\)" : "—"\)/, "a contra supplier payment is findable, never hidden");
  assert.match(cols, /type: "currency", align: "right", width: "140px", total: \(rows\) => activeTotalSen\(rows\)/, "the total skips void rows");
  assert.match(cols, /<FinPill tone=\{r\.status\.tone\} title=\{r\.status\.title\}>\{r\.status\.label\}<\/FinPill>/);
  assert.match(cols, /fmtDocDate\(r\.date\)/);
});

test("the footer counts every payment; the batch bars read the grid's ticks and clear after", () => {
  assert.match(tab, /footerLabel=\{\(shown\) => \(/);
  assert.match(tab, /of \{payRows\.length\}/);
  assert.match(tab, /const ids = picked\.map\(\(r\) => r\.pv\?\.id\)\.filter\(\(id\): id is string => !!id\);/, "the ladder takes vouchers only");
  assert.match(tab, /clearPicked\(\);\s*load\(\);/, "the selection clears after a batch");
  assert.match(tab, /count=\{picked\.length\}\s*onClear=\{clearPicked\}\s*onPrint=\{\(\) => void printPayRows\(picked\)\}/);
  assert.doesNotMatch(tab, /pvSel\./, "the old hand-made selection is gone");
});
