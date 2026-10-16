# Finance v2 — Plan 5: Debtors / Creditors (look only) Implementation Plan

> **Last verified: 2026-10-17** against `src/pages/accounting/index.tsx` (`ARTab`, `ARControlPanel`, `APTab`, `APControlPanel`, `ContraCard`, `ApInvoicesTab`, `SupplierDiscountTab`, `OtherPartiesTab`, `OtherPartyAging`, `OtherPartyBillsManager`, `OtherPartyPaymentsManager`), `src/pages/accounting/tabs/TradeFinanceBlock.tsx`, `src/pages/invoices/credit-notes.tsx`, `src/pages/invoices/debit-notes.tsx`, `src/types/index.ts` (`ARAgingEntry`, `APAgingEntry`) on `main` after #934.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Debtors and Creditors pages in the v2 look — buttons and downloads on the title row, KPI cards where a page already shows summary figures, every plain list in the v2 table look (`table[data-fin-list]`), the Credit / Debit Note grids with the v2 header menu — without any new data, rule or write.

**Architecture:** Attribute-and-placement changes only. Plain tables keep their markup and gain `data-fin-list` (the existing finance sheet styles them); page buttons move into `FinanceTitleActions`; old `ExportButtons` become a `DownloadMenu` (Excel / Print-PDF, no CSV — owner 2026-10-17); existing summary figures become `KpiCards`; a write button that sat on a figure card moves to the title row with its handler, endpoint and confirm unchanged (the design's Debtor Aging: Recalculate counter beside the period). The row menus of the bills / payments managers stay on `useRowMenu` (pinned by `finance-row-menu-esc`), so those lists are not moved to DataGrid.

**Tech Stack:** React 19 + TypeScript, Tailwind v4, `src/styles/finance-v2.css`, node:test source assertions.

**Spec:** `docs/superpowers/specs/2026-10-16-finance-v2-design.md` (README › Debtors / Creditors). Not built here — waiting on the owner (asked 2026-10-16): other-debtor aging inside Debtor Aging; a Next Due column (the aging documents carry no due date); one Trade Finance row per drawdown in Creditor Aging; TIN / SST / Currency / Bank on parties; a Credit Note from a Delivery Return. Also not here: "Code" columns (the aging entries carry no customer / supplier code).

## Global Constraints

- Plans 1–4 constraints hold (scope `[data-fin-ui]`, no figure / posting / rule change, public repo, Title Case).
- Every write keeps its handler, endpoint, confirm and label: AR counter Recalculate, Contra post, Trade Finance cell saves and setup, AP bill void / restore / form, Supplier Discount save / restate / cancel, party save / delete / (de)activate, bill and payment save / restate / lifecycle, CN / DN create.
- Existing test pins are re-pointed only where the markup they read moves; their behaviour is never weakened.

## Review Focus

1. **A pinned control moved out of the slice a test reads** (`ap-invoices-popup`, `ap-invoices-chips`, `finance-row-menu-esc`, `doc-detail-dblclick`) → run each before commit; re-point only the position.
2. **The aging totals and expandable rows** → the lists keep their own markup; only the attribute and the title-row download are added.
3. **`data-fin-list` lift on rows that hold inputs** (Trade Finance editable cells, Supplier Discount inline edit) → those rows carry `data-fin-nolift`.

---

### Task 1: Debtor Aging + Creditor Aging (part A — shipped first)
Title row: the company picker (renders nothing with one company), Debtor Aging's Recalculate counter (moved off its card; label gains "counter" now that it sits outside the card), one `DownloadMenu` from the existing aging export builders (Excel / Print-PDF). KPI cards from the control panels' figures (`useArControl` / `useApControl`, split out of the old panels with the statement as its own card) plus the list's Total outstanding. The aging lists, statement lists, contra list and Trade Finance tables `data-fin-list` (open rows, document rows and rows with inputs `data-fin-nolift`). Creditor Aging order: cards, list, Trade Finance, Contra, statement. Test `tests/finance-v2-aging.test.mjs`.

### Task 2: AP Invoices + Supplier Discount + Other parties (part B)
AP Invoices: its two buttons on the title row, its three cards as `KpiCards`, its list `data-fin-list`. Supplier Discount: its lists `data-fin-list` (inline-edit rows `data-fin-nolift`). Other Debtor / Creditor lists: Add Party on the title row, list `data-fin-list`. Test `tests/finance-v2-ap-parties.test.mjs`.

### Task 3: Bills / payments managers + Credit / Debit Notes (part B)
Bills and payments lists, the other-party aging list: `data-fin-list` (row menus unchanged). CN / DN grids: `headerMenu` + `reorderableHeaders`. Test `tests/finance-v2-bills-notes.test.mjs`.

### Ship
In parts (part A = Task 1, then Tasks 2–3), docs (CODEBASE-MAP, WORK-TRACKER), guards, merge, prod read-only check (each list's row count and totals equal the API; no write pressed).
