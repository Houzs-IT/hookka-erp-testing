// ---------------------------------------------------------------------------
// finance-v2-bills-notes.test.mjs — the other-party aging, bills and payments
// lists, and the Credit / Debit Note pages in the v2 look (plan
// 2026-10-17-finance-v2-debtors-creditors Task 3). Row menus, double-clicks,
// figures and writes unchanged; CN / DN grids gain the v2 header menu (Excel /
// PDF / Print, columns) and draggable headers.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const block = (from, to) => { const a = ui.indexOf(from); assert.ok(a > 0, from); return ui.slice(a, ui.indexOf(to, a + 1)); };
const aging = block("function OtherPartyAging(", "\n}\n");
const bills = block("function OtherPartyBillsManager(", "\nfunction OtherPartyPaymentForm(");
const pays = block("function OtherPartyPaymentsManager(", "// =============== TAB: GENERAL LEDGER");

test("other-party aging: v2 list; an open party and its bills stay put; the total is the total row", () => {
  assert.match(aging, /<table data-fin-list className="w-full text-sm">/);
  assert.match(aging, /<tr data-fin-nolift=\{openParty === r\.partyId \? "" : undefined\}/);
  assert.match(aging, /<tr key=\{b\.billNo\} data-fin-nolift=""/);
  assert.match(aging, /<\/tbody>\n\s*<tfoot>\n\s*<tr className="border-t border-\[#C9C2BA\] bg-\[#F7F5F2\] font-semibold">\n\s*<td className="px-4 py-1\.5">Total outstanding<\/td>/);
  assert.match(aging, /const grand = data\.aging\.reduce\(\(s, r\) => s \+ r\.totalSen, 0\);/);
});

// Since 2026-10-17 both lists are the Payment Vouchers table (DataGrid).
test("bills list: the PV-table grid; double-click opens the bill card in its popup; the row menu is the grid's", () => {
  assert.match(bills, /columns=\{billColumns\}/);
  assert.match(bills, /gridId=\{`accounting-\$\{side === "CREDITOR" \? "creditor" : "debtor"\}-bills`\}/);
  assert.match(bills, /onDoubleClick=\{\(b\) => setDetailBillId\(b\.id\)\}\n\s*contextMenuItems=\{\(b\) => rowMenuItems\(billRowMenu\(b\)\)\}/);
  assert.match(bills, /function OtherPartyBillCard\(\{ b, accounts, onChanged \}/);
  assert.match(bills, /emptyMessage="No bills yet"/);
});

test("payments list: the PV-table grid; double-click / right-click as before", () => {
  assert.match(pays, /columns=\{opayColumns\}/);
  assert.match(pays, /onDoubleClick=\{\(g\) => setDetail\(g\)\}\n\s*contextMenuItems=\{\(g\) => rowMenuItems\(opayRowMenu\(g\)\)\}/);
});

for (const [file, kind, list, total, sign, sel, title] of [
  ["src/pages/invoices/credit-notes.tsx", "CN", "creditNotes", "totalCNValue", "-", "setSelectedCreditNotes", "Credit Notes"],
  ["src/pages/invoices/debit-notes.tsx", "DN", "debitNotes", "totalDNValue", "+", "setSelected", "Debit Notes"],
]) {
  const src = read(file);
  test(`${title}: the same three figures as KPI cards, a caption with the count`, () => {
    assert.ok(src.includes(`{ label: "Total ${kind} value", value: \`${sign}\${formatCurrency(${total})}\``), "total, signed as before");
    assert.match(src, /\{ label: "Draft", value: String\(draftCount\) \}/);
    assert.match(src, /\{ label: "Posted", value: String\(postedCount\) \}/);
    assert.ok(src.includes(`<h3 className="text-[14px] font-semibold text-[#1F1D1B]">All ${title}</h3>`));
    assert.ok(src.includes(`{${list}.length} note{${list}.length === 1 ? "" : "s"}`));
    assert.doesNotMatch(src, /CardHeader|CardTitle/);
  });
  test(`${title}: the grid gains the v2 header menu and draggable headers; columns memoised (C24)`, () => {
    assert.ok(src.includes(`onSelectionChange={${sel}}\n              contextMenuItems={contextMenuItems}\n              headerMenu\n              reorderableHeaders\n              exportName="${title}"`));
    assert.match(src, /const columns = useMemo<Column<(Credit|Debit)Note>\[\]>\(\(\) => \[\n/);
    assert.match(src, /\n {2}\], \[\]\);\n/);
    assert.match(src, /<BatchActionsBar\n\s*count=\{selected(CreditNotes)?\.length\}/, "the batch print / export of ticked notes stays");
    assert.ok(src.includes(`New ${title.slice(0, -1)}`), "the create button stays on the title");
  });
}
