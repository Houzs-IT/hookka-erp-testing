// ---------------------------------------------------------------------------
// finance-v2-aging.test.mjs — Debtor and Creditor Aging in the v2 look (plan
// 2026-10-17-finance-v2-debtors-creditors Task 1). Same reads, figures and
// writes. New places, as in the design: the control figures as KPI cards with
// Recalculate counter on the title row, one download (Excel / PDF, no CSV —
// owner 2026-10-17), the lists in the v2 list look, then (creditor side) Trade
// Finance under the list. Since 2026-10-20 (owner) the statements and Contra
// live elsewhere: the supplier statement on AP Invoices, the customer statement
// on Other Debtor Bills, Contra on its own Monthly page; the trade-finance
// block has no Repay (an AP Payment repays it).
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
const ar = fn("ARTab");
const list = fn("AgingListTable");
const ap = fn("APTab");
const arCtl = fn("useArControl");
const apCtl = fn("useApControl");
const tf = read("src/pages/accounting/tabs/TradeFinanceBlock.tsx");
const shell = read("src/components/finance/report-shell.tsx");
const bar = (body) => body.slice(body.indexOf("<FinanceTitleActions>"), body.indexOf("</FinanceTitleActions>"));

test("the control reads and the counter rebuild are unchanged", () => {
  assert.match(arCtl, /fetch\(`\/api\/accounting\/ar-control\$\{company \? `\?orgId=\$\{encodeURIComponent\(company\)\}` : ""\}`\)/);
  assert.match(arCtl, /title: "Recalculate customer counters\?"/);
  assert.match(arCtl, /fetch\("\/api\/accounting\/ar-control\/rebuild-counter", \{ method: "POST" \}\)/);
  assert.match(arCtl, /setCtlRev\(\(n\) => n \+ 1\);/, "the figures reload after a rebuild");
  assert.match(apCtl, /fetch\(`\/api\/accounting\/ap-control\$\{company \? `\?orgId=\$\{encodeURIComponent\(company\)\}` : ""\}`\)/);
  assert.match(ar, /const ctl = useArControl\(company\);/);
  assert.match(ap, /const ctl = useApControl\(company\);/);
  assert.doesNotMatch(ui, /function ARControlPanel|function APControlPanel/);
});

test("title row: the company picker, Recalculate counter (debtors), one download", () => {
  const a = bar(ar);
  assert.match(a, /<CompanySelect value=\{company\} onChange=\{pickCompany\} options=\{companyOptions\} \/>/);
  assert.match(a, /onClick=\{\(\) => void ctl\.rebuildCounter\(\)\} disabled=\{ctl\.rebuilding\}/);
  assert.match(a, /\{ctl\.rebuilding \? "Recalculating…" : "Recalculate counter"\}/);
  assert.match(a, /<DownloadMenu items=\{downloads\} \/>/);
  const p = bar(ap);
  assert.match(p, /<CompanySelect value=\{company\} onChange=\{pickCompany\} options=\{companyOptions\} \/>/);
  assert.match(p, /<DownloadMenu items=\{downloads\} \/>/);
  for (const body of [ar, ap]) {
    for (const l of ["Export to Excel", "Print / PDF"]) assert.ok(body.includes(`label: "${l}"`), l);
    assert.doesNotMatch(body, /CSV|ExportButtons/, "no CSV (owner 2026-10-17)");
    assert.doesNotMatch(body, /<div className="flex justify-end">\s*<CompanySelect/, "the empty company row is gone");
  }
});

test("the download is the same aging builder: Excel and a printable PDF", () => {
  // Since the other debtors joined (owner 2026-10-17) the export is grouped.
  assert.match(ar, /buildGroupedAgingExportAoa\("Customer", groups\.map\(\(g\) => \(\{ label: g\.label, parties: g\.rows \}\)\)\)/);
  assert.match(ap, /buildGroupedAgingExportAoa\("Creditor", groups\.map\(\(g\) => \(\{/);
  assert.match(ui, /const AGING_PDF: PdfExportOpts = \{ rowKind: agingRowKind, leftCols: \[1, 2\], colWidths: \{ 0: 168,/);
  for (const body of [ar, ap]) {
    assert.match(body, /\{ \.\.\.AGING_PDF, print: true \}/);
    assert.match(body, /\{ moneyFormat: true \}/, "Excel keeps real numbers formatted as money");
    // Dated by the as-at month (2026-10-17): today in Malaysia time for the
    // running month (useAgingAsAt → asAtDate(ym, todayYmdMY())).
    assert.match(body, /const asAt = at\.asOf;/, "dated as at the chosen month");
  }
});

test("KPI cards carry the figures the page already had", () => {
  assert.match(ar, /value: formatCurrency\(ctl\.data\.tradeControlSen\), tone: "info" as const, note: "per ledger"/);
  assert.match(ar, /value: formatCurrency\(ctl\.data\.invoiceOutstandingSen\), note: <>gross · \{controlDriftNote\(ctl\.data\.driftControlVsInvoicesSen\)\}<\/>/);
  assert.match(ar, /value: formatCurrency\(ctl\.data\.customerCounterSen\), note: controlDriftNote\(ctl\.data\.driftCounterVsInvoicesSen\)/);
  assert.match(ap, /value: formatCurrency\(ctl\.tradeControlSen\), tone: "err" as const, note: "per ledger"/);
  assert.match(ap, /value: formatCurrency\(ctl\.netOutstandingSen \?\? ctl\.piOutstandingSen\)/);
  assert.match(ap, /bills \{formatCurrency\(ctl\.piOutstandingSen\)\} − un-knocked advances \{formatCurrency\(ctl\.unappliedAdvanceSen \?\? 0\)\}/);
  assert.match(ap, /\{controlDriftNote\(ctl\.driftControlVsPiSen\)\}/);
  for (const body of [ar, ap]) assert.match(body, /\{ label: "Total outstanding", value: formatCurrency\(totalOutstanding\)/);
  // The note keeps the old pill's meaning: green when it matches, red with the gap.
  const note = fn("controlDriftNote");
  assert.match(note, /n === 0 \? "matches ✓" : `drift \$\{formatCurrency\(n\)\}`/);
  assert.match(note, /n === 0 \? "text-\[#27500A\]" : "font-semibold text-\[#9A3A2D\]"/);
  assert.match(shell, /info: "text-\[#3E6570\]"/);
});

test("the aging lists in the v2 list look; an open row and its documents stay put", () => {
  // Debtor Aging renders through the shared AgingListTable (2026-10-17).
  assert.match(ar, /<AgingListTable\n\s*partyHeader="Customer"/);
  assert.match(list, /<table data-fin-list className="w-full text-sm">/);
  assert.match(list, /<tr data-fin-nolift=\{isOpen \? "" : undefined\} className="border-b border-\[#F0ECE9\]/);
  assert.match(list, /\{isOpen && detail == null && r\.docs\.map\(\(d, i\) => \(\n\s*<tr key=\{`d-\$\{i\}`\} data-fin-nolift=""/);
  assert.match(list, /\{AGING_KEYS\.map\(\(k\) => <td key=\{k\} className="py-3 px-4 text-right">\{formatCurrency\(sumOf\(rows, k\)\)\}<\/td>\)\}/);
  // Creditor Aging too (2026-10-17), with its Next Due column.
  assert.match(ap, /<AgingListTable\n\s*partyHeader="Creditor"[\s\S]*?nextDue=\{nextDueCell\}/);
  assert.match(ar, /<h3 className="text-\[14px\] font-semibold text-\[#1F1D1B\]">By debtor<\/h3>/);
  assert.match(ap, /<h3 className="text-\[14px\] font-semibold text-\[#1F1D1B\]">By creditor<\/h3>/);
});

test("statements: same reads and print; v2 list look with the closing balance as the total row", () => {
  const cs = fn("CustomerStatementCard");
  const ss = fn("SupplierStatementCard");
  assert.match(cs, /fetch\(`\/api\/accounting\/customer-statement\?\$\{p\.toString\(\)\}`\)/);
  assert.match(ss, /fetch\(`\/api\/accounting\/supplier-statement\?\$\{p\.toString\(\)\}`\)/);
  assert.match(cs, /<h2>\$\{COMPANY\.HOOKKA\.name\}<\/h2>/, "the print still carries the legal name");
  for (const s of [cs, ss]) {
    assert.match(s, /<table data-fin-list className="w-full text-sm">/);
    assert.match(s, /<tr data-fin-nolift="" className="border-b border-\[#F0ECE9\] text-\[#6B7280\]">\n\s*<td className="px-3 py-1\.5" colSpan=\{5\}>Opening balance<\/td>/);
    assert.match(s, /<tfoot>\n\s*<tr className="border-t border-\[#1F1D1B\] font-semibold">\n\s*<td className="px-3 py-2" colSpan=\{5\}>Closing balance<\/td>/);
  }
  // The statements moved (owner 2026-10-20): customer → Other Debtor Bills, supplier → AP Invoices.
  assert.doesNotMatch(ar, /<CustomerStatementCard \/>/);
  assert.doesNotMatch(ap, /<SupplierStatementCard \/>/);
  assert.match(ui, /\{tab === "odebtorbills" && \(\n\s+<div className="space-y-4">\n\s+<OtherPartyBillsTab accounts=\{accounts\} side="DEBTOR" \/>\n\s+<CustomerStatementCard \/>\n\s+<\/div>\n\s+\)\}/);
  assert.match(ui, /\{tab === "apinvoices" && \(\n\s+<div className="space-y-4">\n\s+<ApInvoicesTab accounts=\{accounts\} \/>\n\s+<SupplierStatementCard \/>\n\s+<\/div>\n\s+\)\}/);
});

test("Creditor Aging: the cards, then the list with the trade-finance drawdowns in it; Contra is its own Monthly page", () => {
  const order = ["<KpiCards", "<AgingListTable", "<TfDrawDetail", "<TfRepaidRows"];
  let at = -1;
  for (const o of order) {
    const i = ap.indexOf(o, at + 1);
    assert.ok(i > at, `${o} in order`);
    at = i;
  }
  assert.match(ui, /\{tab === "ap" && <APTab apData=\{apData\} onRefresh=\{fetchAll\} \/>\}/);
  assert.doesNotMatch(ap, /<ContraCard \/>/);
  // Contra: Monthly in the sidebar and the tab list, a page of its own (owner 2026-10-20 「放去side bar 那边的monthly」).
  assert.match(ui, /\{ key: "contra", label: "Contra", icon: <Scale className="h-4 w-4" \/>, group: "Monthly" \},/);
  assert.match(ui, /\{tab === "contra" && <ContraCard \/>\}/);
  assert.match(read("src/components/layout/sidebar.tsx"), /\{ name: "Fixed Assets", href: "\/accounting\?tab=assets", icon: Building2 \},\n\s+\{ name: "Contra", href: "\/accounting\?tab=contra", icon: Scale \},/);
  assert.match(read("src/lib/finance-nav.ts"), /contra: \{ title: "Contra", explain: /);
  // Trade finance is repaid with an AP Payment — the block has no Repay (owner 「拿掉」).
  assert.doesNotMatch(tf, />Repay</);
  assert.doesNotMatch(tf, /supplier-payments\?supplier=/);
  assert.match(ap, /Pay a bill or repay trade finance with an AP Payment on <Link to="\/accounting\?tab=payments"/);
  const contra = fn("ContraCard");
  assert.match(contra, /<table data-fin-list className="w-full text-sm">/);
  assert.match(contra, /fetch\("\/api\/accounting\/contra", \{\n\s*method: "POST"/, "the contra post is unchanged");
  assert.match(contra, /title: "Post contra\?"/);
});

test("Trade Finance in the list: a drawdown's figures open under its row, the repaid ones behind a line; saves unchanged", () => {
  assert.match(tf, /export function TfDrawDetail\(\{ d, editable, onSaved \}/);
  assert.match(list, /\{detail != null && \(\n\s*<tr data-fin-nolift="" className="border-b border-\[#F7F4F1\] bg-\[#FAF8F6\]">\n\s*<td colSpan=\{cols\} className="py-2\.5 px-4 pl-10">\{detail\}<\/td>/);
  assert.match(tf, /\{open \? "Hide" : "Show"\} \{draws\.length\} repaid drawdown\{draws\.length === 1 \? "" : "s"\}/);
  assert.match(tf, /<tr key=\{d\.drawSourceId\} data-fin-nolift="" className="border-b border-\[#F7F4F1\] bg-\[#FAF8F6\]">/);
  assert.match(tf, /fetch\("\/api\/accounting\/trade-finance\/draw-due", \{\n\s*method: "PUT"/);
  assert.match(tf, /`\/api\/accounting\/trade-finance\/\$\{kind === "interest" \? "draw-interest" : "draw-bank-charge"\}`/);
  assert.match(tf, /fetch\("\/api\/accounting\/trade-finance\/setup", \{\n\s*method: "POST"/);
});
