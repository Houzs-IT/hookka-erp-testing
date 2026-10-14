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
  assert.match(ui, /<div ref=\{tablesRef\} data-fin-tables data-fin-ui className="space-y-6 max-md:space-y-4">\n      <PageHeader title=\{page\.title\} subtitle=\{financeSubtitle\(page\)\} \/>/);
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
  for (const rule of css.match(/^[^\s/*}][^{]*\{/gm) ?? []) {
    for (const sel of rule.replace(/\{$/, "").split(",")) assert.match(sel.trim(), /^\[data-fin-ui\] /, `scoped: ${sel.trim()}`);
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
