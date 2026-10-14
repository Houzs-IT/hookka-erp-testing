# Finance UI refresh — design and build plan

> **Last verified: 2026-10-14** against `src/pages/accounting/index.tsx`, `src/components/layout/sidebar.tsx`,
> `src/components/layout/breadcrumbs.tsx`, `src/lib/route-titles.ts`, `src/components/ui/page-header.tsx`,
> `src/lib/use-resizable-tables.ts` (branch `feat/finance-ui-refresh`).

Owner request (2026-10-13/14): improve the whole finance module's display — consistent look, key figures first,
easier navigation, usable on a phone — **built in one go**, tested by the owner on the PR's canary URL, merged only
after the owner approves. Display only: no figure, calculation, endpoint or posting changes.

Agreed defaults (from the Claude Design proposal; the owner can change any after testing):
money `1,234.00` with no "RM" inside tables (page subtitle says amounts are in RM), negatives `(1,234.00)` in red,
zero `–`; the P&L's current period before the year to date; menu name = page title; status colours
Draft grey · Prepared blue · Checked plum · Approved green · Void red; cards instead of wide tables on a phone.

## Findings that shape the work (survey 2026-10-13)

- 29 of the 32 finance menu items render inside `AccountingPage` (`?tab=`), which already marks its root with
  `data-fin-tables` and injects a scoped stylesheet (`FIN_TABLES_CSS`).
- About 82 hand-written tables with ~6 header styles; six money formats; ~2,100 hard-coded hex classes; the shared
  `PageHeader` / `FilterBar` / `StatusBadge` are unused here; the h1 always reads "Accounting"; the breadcrumb and the
  workspace tab title always read "Accounting"; menu labels differ from page titles; almost no phone handling.

## Plan

1. **One page frame.** `src/lib/finance-nav.ts` holds every finance page's title, menu group and the menu item it
   belongs to (URL-only pages light up their parent). `AccountingPage` renders `PageHeader` with that title, a
   `Finance / group / title` trail and a one-line subtitle; in-tab headings that repeat the title go. The sidebar
   labels match the titles; the breadcrumb strip and workspace tab titles read the `?tab=` page.
2. **One table look, one control look.** A finance stylesheet scoped to `[data-fin-ui]` (the accounting root and the
   standalone finance pages): uppercase small header on cream, sticky header, even cell padding, tabular figures,
   hover tint, total rows, inputs / selects / date fields at one height and radius. Applied by CSS so all tables
   change together; per-table markup is touched only where a total or group row needs a class.
3. **One money format.** `src/lib/finance-money.ts` (`fmtAmount`) and an `<Amount>` component (red when negative).
   JSX children `{formatCurrency(x)}` in finance files become `<Amount sen={x} />` (MYR only); report helpers that
   already bracket (P&L, monthly, cash flow, balance sheet, drills) switch to the same function. Sentences, toasts
   and tooltips keep "RM".
4. **Reports.** P&L: key-figure cards (net sales, gross profit, operating expenses, net profit with change against
   the previous month and the estimate note), current period first, view switch kept in the URL. Balance Sheet:
   key-figure cards with the balance check, assets beside liabilities + equity on wide screens, stock accounts under
   an Inventories subtotal. Other reports: frame + table look.
5. **Daily pages.** Payment Vouchers: summary cards (waiting for approval, drafts, paid this month) above the existing
   status chips; the main actions in the page header. Receipts / Cash Position / Cash Book / AP Invoices: frame +
   table look.
6. **Phone.** Header actions and filter rows wrap; wide tables scroll inside their card with the first column pinned
   on reports; the Payment Vouchers list renders as cards below the `md` breakpoint.

Each step is its own commit on the branch; the full test suite runs on every commit; the canary is reviewed in a
browser before the link goes to the owner. Guards: `tests/finance-ui-refresh.test.mjs` (navigation map ⇄ sidebar,
money format, frame wiring).
