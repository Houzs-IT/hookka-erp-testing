// ---------------------------------------------------------------------------
// finance-page-title.test.mjs — v2 page titles (spec: "Page explanations go
// behind an (i) icon instead of a grey sub-line"; page title 22px/700; plan
// 2026-10-16-finance-v2-foundation Task 8).
//   - every tab the accounting page can show has a Title Case name and an
//     explanation in src/lib/finance-nav.ts;
//   - the page header is FinancePageTitle, on the accounting page and on the
//     other finance pages (Credit / Debit Notes, e-Invoice, Financial
//     Dashboard, Forecast P&L);
//   - the tabs' own headings that repeated the title are gone.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { FINANCE_PAGES, financePage } from "../src/lib/finance-nav.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");

test("every tab has a Title Case name and an explanation", () => {
  const at = ui.indexOf("const TABS: {");
  const keys = [...ui.slice(at, ui.indexOf("];", at)).matchAll(/\{ key: "([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 30, "the tab list was read");
  const small = new Set(["&", "of", "and", "to", "in", "·"]);
  for (const k of keys) {
    const p = FINANCE_PAGES[k];
    assert.ok(p, `no page entry for ?tab=${k}`);
    for (const w of p.title.split(" ")) {
      assert.ok(small.has(w) || /^[A-Z0-9]/.test(w), `${k}: "${p.title}" is not Title Case`);
    }
    assert.ok(p.explain.length > 10, `${k}: explanation`);
  }
  assert.equal(FINANCE_PAGES.dailycash.title, "Daily Cash Position", "the v2 name");
  assert.deepEqual(Object.keys(financePage("no-such-tab")).sort(), ["explain", "title"], "no stray props to spread");
  assert.equal(financePage("no-such-tab").title, "Overview", "an unknown tab shows the Overview, as the page does");
});

test("the title component: 22px bold, an (i) that opens the explanation, Esc closes it", () => {
  const c = read("src/components/finance/page-title.tsx");
  assert.match(c, /<h1 className="[^"]*text-\[22px\][^"]*font-bold/);
  assert.match(c, /aria-label="About this page"/);
  assert.match(c, /useEscapeClose\(\(\) => setOpen\(false\), open\)/);
  assert.match(c, /\{explain && \(/, "no (i) without an explanation");
});

test("the finance pages use it, and the old grey header line is gone", () => {
  assert.match(ui, /<FinancePageTitle \{\.\.\.financePage\(tab\)\} actions=\{<div ref=\{setTitleSlot\}/, "the title, with the tab's button slot");
  assert.doesNotMatch(ui, /General ledger, accounts receivable, and accounts payable/);
  for (const p of [
    "src/pages/invoices/credit-notes.tsx", "src/pages/invoices/debit-notes.tsx", "src/pages/invoices/e-invoice.tsx",
    "src/pages/finance-dashboard.tsx", "src/pages/forecast.tsx",
  ]) {
    assert.match(read(p), /<FinancePageTitle\s/, `${p} uses the v2 title`);
  }
});

test("the tabs' own headings that repeated the page title are gone", () => {
  for (const t of [
    "Payment Vouchers", "Receipts", "Journal Entries", "Daily Cash Position", "Trial Balance", "General Ledger",
    "Stock Summary", "Opening Balance", "AP Invoices", "Self-check", "Corrections", "Chart of Accounts",
    "Statement of Cash Flow", "Accounts Receivable", "Accounts Payable",
  ]) {
    assert.ok(!ui.includes(`<h2 className="text-lg font-semibold text-[#1F1D1B]">${t}</h2>`), `${t} heading still there`);
  }
});
