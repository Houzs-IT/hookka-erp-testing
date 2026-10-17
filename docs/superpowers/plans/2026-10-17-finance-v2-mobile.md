# Finance v2 — Plan 8: Mobile Finance (`/m/finance`) Implementation Plan

> **Last verified: 2026-10-17** against `src/pages/m/MobileLayout.tsx` (routes), `src/pages/m/nav.ts` (More groups, `navGate`), `src/pages/m/screens/More.tsx` (`isNavAllowed` filter), `src/pages/m/components/*` (`MobileHeader`, `MobileCard`, `ListRow`, `SubTabs`), `src/pages/m/theme.ts`, `src/pages/m/config/modules.ts` (`receivablesConfig`), and the desktop endpoints each screen reads, on `main` after plan 7.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The design's mobile Finance app: a Finance menu under More, opening eight read-only screens.
- **Finance:** Finance Dashboard, Daily Cash Position.
- **Reports:** Overview, P&L, Cash Flow, Balance Sheet.
- **Debtors & Creditors:** Debtor Aging, Creditor Aging.

Each screen reads the endpoint its desktop page reads. One month at a time; dropdowns or steppers instead of horizontal scroll; 44px tap targets. Every row is gated like its desktop page (no permission, no row).

**Architecture:**
- One route family in `MobileLayout`: `finance` (the menu) and `finance/:screen`.
- The screens live in `src/pages/m/screens/finance/`, one file each, plus a small shared kit (`FinanceShell`: header with back to the menu and an optional share action, the period stepper, the framed table).
- The menu's rows and their gates are one list, `FINANCE_MENU` in `src/pages/m/finance-menu.ts`. More shows a "Finance" row when any of its rows is allowed. The menu shows only the allowed rows.
- Figures are never recomputed on the phone where the desktop shows a server figure: the same endpoint, the same field.

**Tech Stack:** React 19 + TypeScript, the `/m` mobile kit (inline styles from `theme.ts`), recharts (Overview / Dashboard), node:test (pure helpers + source assertions).

**Spec:** `docs/superpowers/specs/2026-10-16-finance-v2-design.md` (README › Mobile app; Look and feel › 8) and the design's `mobile-finance-permissions.md`:
- mobile follows the desktop gate;
- no permission means no row;
- a deep link without permission shows "No access" (the API still denies).

Not here:
- aging as at a chosen month-end (deferred; the aging screens are as at today);
- Forecast P&L on mobile (the design says desktop only);
- voucher / receipt entry (not on mobile).

## Global Constraints

- Read-only: no screen writes anything.
- Gates: the same `navGate` hrefs as the desktop sidebar, checked by `usePermissions().isNavAllowed`.
- Amounts: each screen shows the server's figure for a line; a total shown on the phone that the server does not send must be the sum of rows the screen shows (and tested).
- Company line on report frames: `COMPANY.HOOKKA.name`.
- Public repo: tests use made-up figures.

## Review Focus

1. **A role without finance access** sees no Finance row in More, and gets "No access" on a deep link. This is tested on the pure gate helper.
2. **A month with no data** (a fresh month, a failed read) shows "No data" or the error, never a column of zeros.
3. **Swipe-back / back** returns to the Finance menu, not to More, from every screen.

---

### Task 1 (part A): Finance menu, gates, Debtor / Creditor Aging
- `src/pages/m/finance-menu.ts`:
  - `FINANCE_MENU` lists the three sections, their rows (label, icon, slug, `navGate`);
  - `allowedFinanceRows(isAllowed)` returns the allowed rows;
  - `anyFinanceAllowed(isAllowed)` answers whether More shows the Finance row.
- `nav.ts`:
  - People & Finance gains Finance → `/m/finance`, shown when `anyFinanceAllowed` is true;
  - Receivables gains `navGate: "/accounting?tab=ar"` (the 2026-10-14 decision).
- `MobileLayout`: routes `finance` and `finance/:screen`. An unknown or not-allowed screen shows "No access".
- **Debtor Aging** (`/api/accounting/aging` `ar`):
  - an Outstanding card (the sum of the rows' buckets, the desktop Total);
  - a stacked bucket bar;
  - five bucket chips;
  - a search box;
  - debtor rows that expand to their documents.
- **Creditor Aging**: the same layout on `ap`.

Tests: `tests/m-finance-menu.test.mjs` and `tests/m-finance-aging.test.mjs`.

### Task 2 (part B): Overview, P&L, Cash Flow, Balance Sheet
- **Overview:** `/api/accounting/overview-trend?months=` with a 3 / 6 / 12 switch. One card per figure, each with the latest month's value and a small bar chart.
- **P&L:** `/api/accounting/pl-statement?period=&line=`.
  - Month stepper and the Overall / Sofa / Bedframe switch.
  - Gross Profit and Net Profit cards, with % of sales from the statement rows.
  - A framed Item / RM / % Sales table, folded with `foldStatementRows`.
- **Cash Flow:** `/api/accounting/cashflow-statement?period=`. Month stepper; one column (the month); sections fold.
- **Balance Sheet:** `/api/accounting/pl?period=` `balanceSheet`, in the desktop arrangement (Fixed Assets; Current Assets less Current Liabilities; Financed By) with the two-sides check.

Test: `tests/m-finance-reports.test.mjs`.

### Task 3 (part C): Finance Dashboard, Daily Cash Position
- **Finance Dashboard:** the desktop dashboard's reads. One chart card at a time, picked from a dropdown. Each card shows the latest month's figure, its forecast and % of sales.
- **Daily Cash Position:** the desktop page's reads.
  - Day stepper.
  - A "Current cash available" card.
  - An awaiting-approval note.
  - Banks collapsed (tap opens one).
  - Share as image: the page's existing image path, sent to `navigator.share` with a file, and downloaded where share is missing.

Test: `tests/m-finance-dash-cash.test.mjs`.

### Ship
In parts (A, B, C). For each part: docs (CODEBASE-MAP, WORK-TRACKER), guards, merge.

The prod check is read-only, at phone width:
- every figure equals the endpoint;
- a role without finance access is not measured on prod. That is UNMEASURED unless the owner asks; the gate helper's test covers it.
