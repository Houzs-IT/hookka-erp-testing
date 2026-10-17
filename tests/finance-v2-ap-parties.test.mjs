// ---------------------------------------------------------------------------
// finance-v2-ap-parties.test.mjs — AP Invoices, Supplier Discount and the
// Other Debtors / Creditors names list in the v2 look (plan
// 2026-10-17-finance-v2-debtors-creditors Task 2). Same reads, figures and
// writes; buttons on the title row, summary figures as KPI cards, the shared
// chips, lists in the v2 list look (rows holding inputs stay put).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const fn = (name) => {
  const a = ui.indexOf(`function ${name}(`);
  assert.ok(a > 0, `${name} exists`);
  return ui.slice(a, ui.indexOf("\n}\n", a));
};
const bar = (body) => body.slice(body.indexOf("<FinanceTitleActions>"), body.indexOf("</FinanceTitleActions>"));
const ap = ui.slice(ui.indexOf("function ApInvoicesTab("), ui.indexOf("function DocDetailModal("));
const sd = fn("SupplierDiscountTab");
const parties = fn("OtherPartiesTab");

test("AP Invoices: both buttons on the title row, unchanged", () => {
  const b = bar(ap);
  assert.match(b, /<Button variant="outline" size="sm" onClick=\{\(\) => setBillPopup\(\{ mode: "new" \}\)\}>New AP bill<\/Button>/);
  assert.match(b, /<Link to="\/accounting\?tab=payments"><Button variant="primary" size="sm">New AP Payment<\/Button><\/Link>/);
});

test("AP Invoices: the three open totals as KPI cards, the server's figures", () => {
  assert.match(ap, /\{ label: "Open · all", value: formatCurrency\(data\.totals\.openSen\), note: `\$\{data\.totals\.openCount\} invoice/);
  assert.match(ap, /\{ label: "Open · AP bills", value: formatCurrency\(data\.totals\.apOpenSen\) \}/);
  assert.match(ap, /\{ label: "Open · purchase invoices", value: formatCurrency\(data\.totals\.piOpenSen\) \}/);
  assert.doesNotMatch(ap, /<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">/, "the old card row is gone");
});

test("AP Invoices: the shared chips with counts; the list in the v2 look", () => {
  assert.match(ap, /<SegmentedChips\n\s*options=\{AP_KIND_CHIPS\.map/);
  assert.match(ap, /<SegmentedChips\n\s*options=\{AP_STATUS_CHIPS\.map/);
  assert.doesNotMatch(ap, /const chipBtn =/);
  // Since 2026-10-17 the list is the Payment Vouchers table (DataGrid); the
  // outstanding total is its sticky total row (cancelled not counted).
  assert.match(ap, /gridId="accounting-ap-invoices"/);
  assert.match(ap, /emptyMessage="Nothing matches"/);
  assert.match(ap, /key: "outstandingSen", label: "Outstanding", type: "currency", align: "right", width: "130px", total: \(list\) => liveSum\(list, \(r\) => r\.outstandingSen\)/);
});

test("Supplier Discount: v2 lists; rows holding inputs stay put; writes unchanged", () => {
  assert.equal((sd.match(/<table data-fin-list className="w-full text-sm">/g) ?? []).length, 2, "the knock-off list and the history");
  assert.match(sd, /<tr key=\{pi\.id\} data-fin-nolift="" className="border-b border-\[#F0ECE9\]">/);
  assert.match(sd, /<tr data-fin-nolift=\{editing \? "" : undefined\} className="border-b border-\[#F0ECE9\]">/);
  assert.match(sd, /<tr data-fin-nolift="" className="border-b border-\[#F0ECE9\] bg-\[#FAF9F7\]">/, "the reason row while editing");
  assert.match(sd, /\{visibleHistory\.length\} note\{visibleHistory\.length === 1 \? "" : "s"\}/);
  assert.match(sd, /fetch\("\/api\/accounting\/purchase-credit-notes"\)/);
  assert.match(sd, /\/restate`/);
});

test("Other parties: Add Party on the title row with the same reset; the control balance and the names as cards", () => {
  assert.match(bar(parties), /<Button variant="primary" size="sm" onClick=\{newParty\}>\n\s*<Plus className="h-4 w-4" \/> Add Party/);
  assert.match(parties, /const newParty = \(\) => \{ setEditingId\(null\); setForm\(\{ type: side, name: "", contactPerson: "", phone: "", email: "", tin: "", registrationNo: "", address: "", notes: "", sstRegNo: "", currency: "MYR", bankAccount: "" \}\); setShowForm\(!showForm\); \};/);
  assert.match(parties, /label: "Other debtor control · 305-0000", value: controls \? formatCurrency\(controls\.od\) : "—"/);
  assert.match(parties, /label: "Other creditor control · 405-0000", value: controls \? formatCurrency\(controls\.oc\) : "—"/);
  assert.match(parties, /value: parties === null \? "—" : String\(mine\.length\), note: `\$\{mine\.filter\(\(p\) => p\.isActive\)\.length\} active`/);
});

test("Other parties: the status filter as chips with counts; same matching; the list in the v2 look", () => {
  assert.match(ui, /const PARTY_STATUS_CHIPS: \{ key: "ALL" \| "ACTIVE" \| "INACTIVE"; label: string \}\[\] = \[/);
  assert.match(parties, /options=\{PARTY_STATUS_CHIPS\.map\(\(ch\) => \(\{ key: ch\.key, label: ch\.label, count: statusCount\(ch\.key\) \}\)\)\}/);
  assert.match(parties, /const visible = \(parties \?\? \[\]\)\.filter\(\(p\) => passes\(p, statusFilter\)\);/);
  assert.match(parties, /if \(st === "ACTIVE" && !p\.isActive\) return false;\n\s*if \(st === "INACTIVE" && p\.isActive\) return false;/);
  assert.match(parties, /<table data-fin-list className="w-full text-sm">/);
  // Writes unchanged.
  assert.match(parties, /const url = editingId \? `\/api\/accounting\/other-parties\/\$\{editingId\}` : "\/api\/accounting\/other-parties";/);
  assert.match(parties, /fetch\(`\/api\/accounting\/other-parties\/\$\{p\.id\}`, \{ method: "DELETE" \}\)/);
});

test("the names list nested on the Bills page keeps its buttons in its fold", () => {
  const bills = fn("OtherPartyBillsTab");
  assert.match(bills, /<FinanceTitleSlotContext\.Provider value=\{null\}>\n\s*<OtherPartiesTab side=\{side\} \/>\n\s*<\/FinanceTitleSlotContext\.Provider>/);
  const actions = read("src/components/finance/title-actions.tsx");
  assert.match(actions, /if \(slot\) return createPortal\(children, slot\);\n\s*return <div className="flex flex-wrap items-center justify-end gap-2">\{children\}<\/div>;/, "without a slot the buttons render in place");
});
