// ---------------------------------------------------------------------------
// finance-ui-refresh.test.mjs — owner 2026-10-14 「优化 finance 模块的整体显示」
// (display only, no figure changes). Guards:
//   - menu name = page name: every finance page has one record, named as its
//     menu item names it, in the menu group it sits under;
//   - one way to write an amount: 1,234.00, (1,234.00), "–" for zero;
//   - the page frame: header from the record, breadcrumbs Finance › group ›
//     page, the scoped finance style on every finance page.
// Plan: docs/superpowers/specs/2026-10-14-finance-ui-refresh-design.md
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { FINANCE_PAGES, FINANCE_GROUP_HOME, financePage, financeMenuKey, financeSubtitle } from "../src/lib/finance-nav.ts";
import { fmtAmount, isNegativeAmount, ZERO_AMOUNT } from "../src/lib/finance-money.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const sidebar = read("src/components/layout/sidebar.tsx");

/** The finance menu in order: groups and the /accounting?tab= items under them. */
function financeMenu() {
  const start = sidebar.indexOf('name: "Reports", href: "/accounting?tab=overview"');
  const end = sidebar.indexOf('name: "Settings", href: "/accounting?tab=maint"');
  assert.ok(start > 0 && end > start, "finance menu block found");
  const block = sidebar.slice(start, end + 200);
  const out = [];
  let group = null;
  for (const m of block.matchAll(/(\{ )?name: "([^"]+)", href: "([^"]+)", icon: \w+(, children: \[)?/g)) {
    const [, , name, href, parent] = m;
    if (parent) { group = name; out.push({ kind: "group", name, href }); continue; }
    out.push({ kind: "item", name, href, group });
  }
  return out;
}

test("every page the accounting page can show has one record, and nothing else does", () => {
  const tabs = [...ui.slice(ui.indexOf("const TABS"), ui.indexOf("// =============== MAIN PAGE")).matchAll(/key: "([a-z-]+)", label:/g)].map((m) => m[1]);
  assert.ok(tabs.length >= 30, "TABS read");
  assert.deepEqual([...tabs].sort(), Object.keys(FINANCE_PAGES).sort());
});

test("menu name = page name, under the group it sits in", () => {
  const menu = financeMenu();
  const groups = menu.filter((m) => m.kind === "group");
  assert.deepEqual(groups.map((g) => g.name), ["Reports", "Daily", "Monthly", "Debtors", "Creditors", "Setup"]);
  for (const g of groups) assert.equal(g.href, `/accounting?tab=${FINANCE_GROUP_HOME[g.name]}`, `${g.name} opens its first page`);
  const listed = new Set();
  for (const it of menu.filter((m) => m.kind === "item" && m.href.startsWith("/accounting?tab="))) {
    const key = it.href.slice("/accounting?tab=".length);
    const p = FINANCE_PAGES[key];
    assert.ok(p, `${key}: a page record`);
    assert.equal(p.title, it.name, `${key}: the page is called what the menu calls it`);
    assert.equal(p.group, it.group, `${key}: in the ${it.group} group`);
    assert.equal(p.menuKey, undefined, `${key}: has its own menu item`);
    listed.add(key);
  }
  // A page with no menu item of its own lights its parent and takes its group.
  for (const [key, p] of Object.entries(FINANCE_PAGES)) {
    if (listed.has(key)) continue;
    assert.ok(p.menuKey && listed.has(p.menuKey), `${key}: belongs to a menu item`);
    assert.equal(p.group, FINANCE_PAGES[p.menuKey].group, `${key}: same group as ${p.menuKey}`);
  }
});

test("page lookups: unknown tab is the Overview, sub-pages light their parent", () => {
  assert.equal(financePage(null).key, "overview");
  assert.equal(financePage("nope").title, "Overview");
  assert.equal(financePage("plmonthly").title, "Profit & Loss");
  assert.equal(financeMenuKey("plmonthly"), "pl");
  assert.equal(financeMenuKey("transfer"), "payments");
  assert.equal(financeMenuKey("bs"), "bs");
  assert.equal(financeSubtitle(financePage("bs")), `${FINANCE_PAGES.bs.subtitle} · amounts in RM`);
  assert.equal(financeSubtitle(financePage("coa")), FINANCE_PAGES.coa.subtitle, "no money, no RM note");
});

test("one amount format: 1,234.00 · (1,234.00) · – for zero", () => {
  assert.equal(fmtAmount(123456), "1,234.56");
  assert.equal(fmtAmount(100), "1.00");
  assert.equal(fmtAmount(-123456), "(1,234.56)");
  assert.equal(fmtAmount(0), ZERO_AMOUNT);
  assert.equal(fmtAmount(-0), ZERO_AMOUNT);
  assert.equal(fmtAmount(0, { zero: "0.00" }), "0.00");
  assert.equal(fmtAmount(Number.NaN), ZERO_AMOUNT);
  assert.equal(fmtAmount(12345678901), "123,456,789.01");
  assert.equal(fmtAmount(123.45), "1.2345", "a fractional sen keeps its decimals");
  assert.equal(isNegativeAmount(-1), true);
  assert.equal(isNegativeAmount(0), false);
  const amount = read("src/components/finance/amount.tsx");
  assert.match(amount, /red && isNegativeAmount\(sen\) && "text-\[#9A3A2D\]"/, "a negative reads red unless red={false}");
});

test("the page frame: header from the record, finance style on every finance page", () => {
  assert.match(ui, /const page = financePage\(tab\);/);
  assert.match(ui, /<div ref=\{tablesRef\} data-fin-tables data-fin-ui className="space-y-6 max-md:space-y-4">\n      <PageHeader title=\{page\.title\} subtitle=\{financeSubtitle\(page\)\}\n        actions=\{headerActions \? <div ref=\{setHeaderSlot\} className="flex flex-wrap items-center gap-2" \/> : undefined\} \/>/);
  assert.match(ui, /import "\.\/finance-ui\.css";/);
  assert.doesNotMatch(ui, /<h1[^>]*>Accounting<\/h1>/, "the old page title is gone");
  for (const t of ["Stock Group Mapping", "Accounts Receivable", "Accounts Payable", "Payment Vouchers", "Receipts", "Fund Transfer", "Statement of Cash Flow", "General Ledger"]) {
    assert.doesNotMatch(ui, new RegExp(`<h2 className="text-lg font-semibold text-\\[#1F1D1B\\]">${t}</h2>`), `${t}: no second title under the header`);
  }
  for (const p of ["src/pages/invoices/credit-notes.tsx", "src/pages/invoices/debit-notes.tsx", "src/pages/invoices/e-invoice.tsx"]) {
    const src = read(p);
    assert.match(src, /data-fin-ui className="space-y-6 max-md:space-y-4">\n      <PageHeader\n/, `${p}: finance frame`);
    assert.match(src, /import "@\/pages\/accounting\/finance-ui\.css";/, `${p}: finance style`);
    assert.doesNotMatch(src, /className="p-6 space-y-6/, `${p}: no second padding inside the layout's`);
  }
  const css = read("src/pages/accounting/finance-ui.css");
  // Every selector is scoped, at-rule blocks (@media) included: a selector is
  // the text before a "{" since the last "}" or ";".
  const pieces = css.replace(/\/\*[\s\S]*?\*\//g, "").split("{").slice(0, -1);
  for (const piece of pieces) {
    const sel = piece.slice(Math.max(piece.lastIndexOf("}"), piece.lastIndexOf(";")) + 1).trim();
    if (!sel || sel.startsWith("@")) continue;
    // A finance page's own subtree, or the page around one (body:has(...)).
    // Split on top-level commas only (":is(h1, h2, h3)" is one selector).
    const parts = [];
    let depth = 0, cur = "";
    for (const ch of sel) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
    }
    parts.push(cur);
    for (const one of parts) assert.match(one.trim(), /^(\[data-fin-ui\]( |$)|body:has\(\[data-fin-ui\]\))/, `scoped: ${one.trim()}`);
  }
});

test("breadcrumbs and the sidebar read the same record", () => {
  const crumbs = read("src/components/layout/breadcrumbs.tsx");
  assert.match(crumbs, /financePage\(new URLSearchParams\(search\)\.get\("tab"\)\)/);
  assert.match(crumbs, /\[titleForPath\("\/accounting"\), finance\.group, finance\.title\]\[idx\]/);
  assert.match(crumbs, /key=\{`\$\{idx\}:\$\{p\}`\}/, "Finance and Reports both point at the Overview — keys stay unique");
  assert.match(sidebar, /const lit = hp === "\/accounting" \? financeMenuKey\(curTab\) : curTab;/);
  assert.match(read("src/lib/workspaceTabs.ts"), /financePage\(/);
  assert.match(read("src/lib/route-titles.ts"), /"Finance"/);
});

test("amounts on the finance pages go through <Amount>, not formatCurrency, as JSX text", () => {
  for (const p of ["src/pages/accounting/index.tsx", "src/pages/invoices/credit-notes.tsx", "src/pages/invoices/debit-notes.tsx", "src/pages/invoices/e-invoice.tsx"]) {
    const src = read(p);
    // A bare {formatCurrency(x)} between tags (one argument) is the old look.
    assert.doesNotMatch(src, />\s*\{formatCurrency\([^(),]+\)\}\s*</, `${p}: no bare {formatCurrency(x)} between tags`);
  }
  // A sign glued in front of an amount would read "-–" for zero: the sign is the amount's.
  assert.doesNotMatch(read("src/pages/invoices/credit-notes.tsx"), /-<Amount /);
  assert.doesNotMatch(read("src/pages/invoices/debit-notes.tsx"), /\+<Amount /);
});

// ---- Step 2: the reports ----------------------------------------------------
import { acctName } from "../src/lib/finance-names.ts";
import { levelNames } from "../src/lib/finance-nav.ts";
import { pctChange } from "../src/lib/finance-money.ts";

const slice = (src, a, b) => {
  const i = src.indexOf(a);
  assert.ok(i >= 0, `marker ${a}`);
  const j = src.indexOf(b, i + a.length);
  return src.slice(i, j < 0 ? undefined : j);
};

test("account names in normal case; abbreviations and codes stay; hand-cased names untouched", () => {
  assert.equal(acctName("INTEREST ON TRADE FINANCE"), "Interest on Trade Finance");
  assert.equal(acctName("STOCK - FABRIC S.M"), "Stock - Fabric S.M");
  assert.equal(acctName("STOCK - WORK-IN-PROGRESS"), "Stock - Work-in-Progress");
  assert.equal(acctName("GROSS PROFIT / (LOSS)"), "Gross Profit / (Loss)");
  assert.equal(acctName("WIP MOVEMENT (net)"), "WIP Movement (net)");
  assert.equal(acctName("CASH AT BANK - HLBB"), "Cash at Bank - HLBB");
  assert.equal(acctName("ACCRUAL - EPF"), "Accrual - EPF");
  assert.equal(acctName("PRODUCTION - SOCSO"), "Production - SOCSO");
  assert.equal(acctName("R&D EXPENSES"), "R&D Expenses");
  assert.equal(acctName("STOCK - WD STRIP"), "Stock - WD Strip");
  assert.equal(acctName("TOTAL B.FILLER"), "Total B.FILLER");
  assert.equal(acctName("Current Year Earnings (unclosed)"), "Current Year Earnings (unclosed)");
  assert.equal(acctName("Amount due to HOUZS"), "Amount due to HOUZS", "mostly small letters = cased by hand");
  assert.equal(acctName(""), "");
  assert.equal(acctName(undefined), "");
});

test("detail levels have names, not L1–L4", () => {
  assert.deepEqual(levelNames(1), ["All lines"]);
  assert.deepEqual(levelNames(2), ["Summary", "All lines"]);
  assert.deepEqual(levelNames(3), ["Summary", "Groups", "All lines"]);
  assert.deepEqual(levelNames(4), ["Summary", "Groups", "Sub-groups", "All lines"]);
  assert.deepEqual(levelNames(5), ["Summary", "Groups", "Sub-groups", "Level 4", "All lines"]);
  assert.doesNotMatch(ui, />L\{L\}</, "no L1–L4 buttons left on the finance page");
  assert.match(ui, /<LevelPicker max=\{4\} level=\{level\} onPick=\{\(L\) => applyLevel\(rows, L\)\} \/>/, "P&L statement");
  assert.match(ui, /<LevelPicker max=\{maxLevel\} level=\{level\} onPick=\{applyLevel\} \/>/, "Monthly P&L");
  assert.match(ui, /<LevelPicker max=\{3\} level=\{level\} onPick=\{applyLevel\} \/>/, "Cash Flow");
  assert.match(ui, /<LevelPicker max=\{2\} level=\{showAccounts \? 2 : 1\} onPick=\{setBsLevel\} \/>/, "Balance Sheet");
});

test("P&L: key figures from the statement's own rows, this period before the year to date", () => {
  assert.equal(pctChange(110, 100), 10);
  assert.equal(pctChange(-50, -100), 50, "a smaller loss is up");
  assert.equal(pctChange(5, 0), null, "nothing to compare with");
  const kf = slice(ui, "function plKeyFigures(", "\n}\n");
  assert.match(kf, /r\.kind === "grandtotal" && r\.label\.startsWith\("GROSS PROFIT"\)/);
  assert.match(kf, /r\.kind === "group" && r\.depth === 0 && r\.label === "OPERATING EXPENSES"/);
  assert.match(kf, /r\.kind === "grandtotal" && r\.label\.startsWith\("NET PROFIT"\)/);
  const pl = slice(ui, "function PLStatementTab() {", "// =============== TAB: OTHER DEBTORS");
  assert.match(pl, /fetch\(`\/api\/accounting\/pl-statement\?period=\$\{prevYm\}&line=\$\{line\}`\)/, "last month for the comparison");
  assert.match(pl, /<KpiChange cur=\{kf\.opex\} prev=\{prevKf\.opex\} vs=\{vs\} upIsGood=\{false\} \/>/, "costs going up reads red");
  assert.match(pl, /const numCell = \(v: number \| undefined\) => \(v === undefined \? "" : <Amount sen=\{v\} \/>\);/);
  const head = slice(pl, "<thead>", "</thead>");
  assert.ok(head.indexOf("{data?.periodLabel ?? period}") < head.indexOf("FY to date"), "the period column comes first");
  assert.equal((pl.match(/\{numCell\(row\.periodSen\)\}<\/td>\n\s*<td className="text-right px-2 text-\[#6B7280\]">\{pct\(row\.periodSen\)\}<\/td>\n\s*<td className="text-right px-2 tabular-nums">\{numCell\(row\.ytdSen\)\}/g) ?? []).length, 4, "every row kind in that order");
  assert.equal((pl.match(/\{acctName\(row\.label\)\}/g) ?? []).length, 5, "names in normal case");
});

test("P&L views live in the URL", () => {
  const hub = slice(ui, "function PlHubTab(", "\n}\n");
  assert.match(hub, /n\.set\("tab", v\.tab\)/);
  assert.match(hub, /\{ key: "statement", tab: "pl", label: "Statement"/);
  assert.match(hub, /\{ key: "monthly", tab: "plmonthly", label: "Monthly"/);
  assert.match(hub, /\{ key: "cost", tab: "coststruct", label: "Cost structure"/);
  assert.doesNotMatch(hub, /useState\(initialView\)/, "no view state apart from the URL");
});

test("Monthly P&L and Cash Flow: one amount format, names in normal case", () => {
  const monthly = slice(ui, "function MonthlyPlTab() {", "// Monthly P&L inline drill");
  assert.match(monthly, /const fmt = \(sen: number\) => fmtAmount\(sen\);/);
  assert.doesNotMatch(monthly, /uppercase/, "names are cased by acctName, not CSS capitals");
  assert.equal((monthly.match(/acctName\(r\.label\)/g) ?? []).length, 2);
  const cf = slice(ui, "function CashFlowTab() {", "\n}\n");
  assert.match(cf, /const fmt = \(v: number \| null\): string => \(v === null \|\| v === undefined \? "" : fmtAmount\(v\)\);/);
  assert.equal((cf.match(/acctName\(r\.label\)/g) ?? []).length, 2);
});

test("Balance Sheet: key figures with the balance check, two sides, one Inventories line", () => {
  const bs = slice(ui, "function BalanceSheetTab() {", "// Phase 5.4 — Cash Flow");
  assert.match(bs, /<KpiCard label="Balance check" tone=\{balanced \? "good" : "bad"\}/);
  assert.match(bs, /<div className="grid gap-4 xl:grid-cols-2 xl:items-start">/, "assets beside liabilities + equity on a wide screen");
  assert.match(bs, /const stockCodes = new Set\(bsStock\?\.accounts \?\? \[\]\);/);
  assert.match(bs, /Inventories\n/);
  assert.match(bs, /\{invShown && stockRows\.map\(\(r\) => renderEntry\(r, true\)\)\}/);
  assert.match(bs, /<Amount sen=\{e\.balance\} \/>/);
  assert.match(bs, /acctName\(e\.accountName\)/);
  // Hooks stay above the loading return.
  assert.ok(bs.indexOf("const [bsLevel, setBsLevel] = useState(2);") < bs.indexOf("if (bsLoading) {"));
  assert.equal((ui.match(/<table data-col-resize="first"/g) ?? []).length, 8, "still one sheet table in the source (rendered per side)");
});

// ---- Step 3: daily pages and the phone ---------------------------------------
test("Payment Vouchers: summary cards, one status pill, actions in the page header, cards on a phone", () => {
  const pv = slice(ui, "function PaymentsTab(", "// =============== TAB: OFFICIAL RECEIPT");
  // Status colours: Draft grey · Prepared blue · Checked gold (palette E) · Approved green · Void red.
  assert.match(ui, /CHECKED: "bg-\[#FBF3E4\] text-\[#7A5B12\]",/);
  assert.match(ui, /VOID: "bg-\[#F9E1DA\] text-\[#9A3A2D\]",/);
  assert.equal((pv.match(/\{statusChipOf\((row|g)\)\}/g) ?? []).length, 3, "table (both kinds of row) and phone card");
  assert.doesNotMatch(pv, /<span className="text-\[#9CA3AF\]">VOID<\/span>/, "void reads as a red pill now");
  // Summary cards filter the list.
  assert.match(pv, /<KpiCard label="Waiting for approval"/);
  assert.match(pv, /<KpiCard label="Drafts"/);
  assert.match(pv, /<KpiCard label="Paid this month"/);
  assert.match(pv, /r\.door !== "TR" && r\.door !== "FT"/, "a transfer between our own banks is not money out");
  assert.match(pv, /!\(r\.pv\.accrued === 1 && !r\.pv\.settledAt\)/, "accrued, unpaid is not paid");
  // Actions portalled into the page header's slot.
  assert.match(ui, /\{tab === "payments" && <PaymentsTab accounts=\{accounts\} headerSlot=\{headerActions \? headerSlot : null\} \/>\}/);
  assert.match(pv, /headerSlot \? createPortal\(node, headerSlot\)/);
  assert.match(pv, /\{inHeader\(<>\n\s*<ScanVouchers /);
  // Phone: cards below md, the table from md up.
  assert.match(pv, /<div className="md:hidden space-y-2">/);
  assert.match(pv, /<Card className="max-md:hidden">/);
});

test("phone: key figures two to a row; Cash Flow keeps its names in view", () => {
  const css = read("src/pages/accounting/finance-ui.css");
  assert.match(css, /@media \(max-width: 639px\) \{\n  \[data-fin-ui\] \.fin-kpis \{\n    grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  const cf = slice(ui, "function CashFlowTab() {", "\n}\n");
  assert.match(cf, /sticky left-0 z-\[1\] bg-\[#F7F4EF\]">PERIOD<\/td>/);
  assert.match(cf, /<td className=\{`py-1 whitespace-nowrap sticky left-0 z-\[1\] \$\{pinBg\}`\} style=\{pad\}>/);
});

// ---- Canary review fixes (2026-10-14) ------------------------------------------
import { fmtPct } from "../src/lib/finance-money.ts";
import { FINANCE_STANDALONE } from "../src/lib/finance-nav.ts";

test("percentages read like the amounts; each P&L column is a share of its own sales", () => {
  assert.equal(fmtPct(12.345), "12.3%");
  assert.equal(fmtPct(-36.25), "(36.3%)");
  assert.equal(fmtPct(-0.04), "0.0%", "rounds to nothing → no brackets");
  assert.equal(fmtPct(Number.NaN), "");
  const pl = slice(ui, "function PLStatementTab() {", "// =============== TAB: OTHER DEBTORS");
  assert.match(pl, /const ytdNet = rows\.find\(\(r\) => r\.kind === "group" && r\.depth === 0 && r\.label === "SALES"\)\?\.ytdSen \?\? 0;/);
  assert.equal((pl.match(/\{pctYtd\(row\.ytdSen\)\}<\/td>/g) ?? []).length, 4, "the year column divides by the year's sales");
  assert.doesNotMatch(pl, /\{pct\(row\.ytdSen\)\}/);
  assert.match(pl, /is still running — the changes compare it so far with the whole of \{vs\}\./);
  assert.match(ui, /\{fmtPct\(r\.pctValues\[j\] \?\? 0\)\}<\/td>/, "Monthly P&L");
});

test("phone: a report's name column leaves room for the figures", () => {
  const css = read("src/pages/accounting/finance-ui.css");
  assert.match(css, /@media \(max-width: 767px\) \{\n  \[data-fin-ui\] table\[data-col-resize="first"\] tr > :first-child:not\(\[colspan\]\) \{\n    max-width: 9\.5rem;/);
});

test("Overview figures and the standalone pages follow the same rules", () => {
  const ov = read("src/pages/accounting/overview-tab.tsx");
  assert.doesNotMatch(ov, /formatCurrency|formatRM/, "the Overview writes amounts one way (<Amount>)");
  assert.deepEqual(FINANCE_STANDALONE["/invoices/credit-notes"], { group: "Debtors", title: "Credit Notes" });
  assert.deepEqual(FINANCE_STANDALONE["/invoices/e-invoice"], { title: "e-Invoice" });
  const crumbs = read("src/components/layout/breadcrumbs.tsx");
  assert.match(crumbs, /const standalone = finance \? undefined : FINANCE_STANDALONE\[path\];/);
  for (const p of ["src/pages/invoices/credit-notes.tsx", "src/pages/invoices/debit-notes.tsx"]) {
    assert.doesNotMatch(read(p), /[-+]<Amount /, `${p}: the sign belongs to the amount`);
    assert.doesNotMatch(read(p), /formatRM/, `${p}: one amount format`);
  }
});

// ---- Palette E (owner 2026-10-14 「配色用 E 藏青青绿金，做」) -------------------------
import { execFileSync } from "node:child_process";
import { ensureFinanceFonts, FINANCE_FONTS_HREF } from "../src/lib/finance-fonts.ts";

test("palette E: the generated colour layer is current and only touches finance pages", () => {
  // Fails when a class names an old colour the layer has no rule for yet.
  execFileSync(process.execPath, ["scripts/gen-finance-theme.mjs", "--check"], { stdio: "pipe" });
  const theme = read("src/pages/accounting/finance-theme.css");
  const rules = theme.split("\n").filter((l) => l.includes("{ ") && l.includes(": "));
  assert.ok(rules.length > 150, "the layer covers the finance colours");
  for (const r of rules) assert.match(r, /^\s*(@media [^{]+\{ )?:where\(\[data-fin-ui\]\) /, `scoped: ${r.trim().slice(0, 80)}`);
  assert.match(theme, /^@layer utilities \{$/m, "same layer as Tailwind, so state variants keep working");
  assert.ok(theme.includes(String.raw`:where([data-fin-ui]) .bg-\[\#6B5C32\] { background-color: #1F3B63; }`), "brown → navy");
  assert.ok(theme.includes(String.raw`:where([data-fin-ui]) .text-\[\#9A3A2D\] { color: #C2413D; }`), "brick red → coral red");
  assert.ok(theme.includes(String.raw`:where([data-fin-ui]) .bg-\[\#EAF3DE\] { background-color: #E4F4F1; }`), "green → teal");
  const css = read("src/pages/accounting/finance-ui.css");
  assert.match(css, /^@import "\.\/finance-theme\.css";$/m);
  assert.match(css, /body:has\(\[data-fin-ui\]\) \{\n  background-color: #f4f5f7;/, "a cool grey canvas behind finance pages only");
  assert.match(css, /\[data-fin-ui\] \{\n  font-family: Inter, var\(--font-sans\);/);
});

test("palette E: the fonts load on a finance page, once", () => {
  assert.match(FINANCE_FONTS_HREF, /family=Inter:.*family=Montserrat:/);
  const added = [];
  const doc = { getElementById: (id) => added.find((l) => l.id === id) ?? null, createElement: () => ({}), head: { appendChild: (l) => added.push(l) } };
  ensureFinanceFonts(doc);
  ensureFinanceFonts(doc);
  assert.equal(added.length, 1, "one link, however many pages open");
  assert.equal(added[0].href, FINANCE_FONTS_HREF);
  for (const p of ["src/pages/accounting/index.tsx", "src/pages/invoices/credit-notes.tsx", "src/pages/invoices/debit-notes.tsx", "src/pages/invoices/e-invoice.tsx"]) {
    assert.match(read(p), /useEffect\(\(\) => \{ ensureFinanceFonts\(\); \}, \[\]\);/, `${p}: loads the finance type`);
  }
  assert.doesNotMatch(read("index.html"), /Montserrat|family=Inter/, "the rest of the app never fetches them");
});
