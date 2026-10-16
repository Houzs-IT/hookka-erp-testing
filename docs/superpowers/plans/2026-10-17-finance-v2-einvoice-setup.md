# Finance v2 — Plan 6: e-Invoice + Setup (look only) Implementation Plan

> **Last verified: 2026-10-17** against `src/pages/invoices/e-invoice.tsx`, `src/pages/accounting/index.tsx` (`COATab`, `StockMapCard`, `OpeningStockTab`, `OpeningBalanceTab`, `GstRateCard`, `FyeCard`, `CleanupReportCard`, `LandedCostCard`, `DocNumberingCard`), `src/pages/accounting/tabs/AuditLogTab.tsx` on `main` after #936.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The e-Invoice page and the Setup pages in the v2 look: buttons on the title row where a page has one main action, summary figures as KPI cards, the tab strip as the v2 switch, every plain list in the v2 list look. No new data, rule or write.

**Architecture:** Attribute-and-placement changes only, as in plans 4–5. Plain tables gain `data-fin-list`, and rows holding inputs gain `data-fin-nolift`. A page's single main button moves into `FinanceTitleActions`. Pages with several cards that each save on their own (Settings) keep their buttons in their cards. Existing summary figures become `KpiCards`.

**Tech Stack:** React 19 + TypeScript, Tailwind v4, `src/styles/finance-v2.css`, node:test source assertions.

**Spec:** `docs/superpowers/specs/2026-10-16-finance-v2-design.md` (README › e-Invoice, Setup). Not built here, because each is deferred to the owner or conflicts with a rule the owner set:
- e-Invoice submission tracking (the "Uploaded To MyInvois" column, Record Result).
- The Chart of Accounts form rework (Section chips, parent-first inheritance, auto next code, the Reporting block).
- Currency & FX monthly rates. The owner chose per-document rates.
- Change Year End with closed-year locks.
- SST tax codes.
- Adding pre-opening invoices one at a time.

## Global Constraints

- Plans 1–5 constraints hold (scope `[data-fin-ui]`, no figure / posting / rule change, public repo, Title Case, Excel / PDF only).
- Every write keeps its handler, endpoint, confirm and label. This covers:
  - e-Invoice: generate / submit / cancel.
  - Chart of Accounts: add / rename / deactivate / drag to re-parent.
  - Stock Mapping, Opening Stock, Opening Balance and Settings: their saves.
  - Opening Balance: post.
  - Landed Cost: allocate.
  - Closing Stock: post.

## Review Focus

1. **A row that holds an input lifting under the cursor** (Stock Mapping selects, Opening Stock / Opening Balance amounts, SST rates, document numbering) → those rows carry `data-fin-nolift`.
2. **A page's buttons moved to the title row while the page is nested elsewhere** → check every place the component renders (the Settings cards are stacked in one tab; a nested page uses a null title slot as on the Bills page).
3. **Figures on cards that the page did not show before** → none: a card only takes a figure already on the page (or a count of the rows it lists).

---

### Task 1: e-Invoice (part A)
The Dashboard / Generate / XML Preview tab strip becomes a `SegmentedSwitch`. The four status figures become `KpiCards`, with the same labels and values. The submissions and generate lists use `data-fin-list`. The standing amber notice and Refresh stay. Test `tests/finance-v2-einvoice.test.mjs`.

### Task 2: Setup (part B)
- **Chart of Accounts**: Add Account on the title row; the tree is unchanged.
- **Stock Mapping** and **Opening Stock**: Save on the title row; the lists use `data-fin-list` with input rows not lifted.
- **Opening Balance**: Post on the title row (same guard), the balance line as a `CheckStrip` from the same totals, and the lists in the v2 look.
- **Audit Log**: its list uses `data-fin-list`.
- **Settings**: each card keeps its own buttons; its tables use `data-fin-list` with input rows not lifted.

Test `tests/finance-v2-setup.test.mjs`.

### Ship
In parts (A = e-Invoice, B = Setup). Each part goes through docs (CODEBASE-MAP, WORK-TRACKER), guards and merge. The prod check is read-only: each list's rows and totals equal the API, and no write is pressed.
