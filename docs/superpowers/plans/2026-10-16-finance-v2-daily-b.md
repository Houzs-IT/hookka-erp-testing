# Finance v2 — Plan 2b: Daily pages, part 2 (Receipts, Daily Cash Position, Fund Transfer, popups) Implementation Plan

> **Last verified: 2026-10-16** against `src/pages/accounting/index.tsx` (`ReceiptsHubTab` ~L11859–12170, `FundTransferTab`, `DailyCashTab`, `DocDetailModal`) on branch `feat/finance-v2-daily-b`, after plan 2a (#922).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receipts on the v2 table like Payment Vouchers; Daily Cash Position, Fund Transfer and the document popups in the v2 look — every action unchanged.

**Architecture:** Receipts follows plan 2a's pattern (memoised grid rows from a pure builder, memoised columns, `checkboxSelectOnly`, chips in the toolbar, title-row buttons, explanation behind the (i)). Daily Cash Position and Fund Transfer keep their plain tables (grouped per bank, tick boxes, fold rows) and opt into `table[data-fin-list]`. The popup shell `DocDetailModal` gets the v2 look in one place, so every list's popup follows.

**Spec / owner decisions:** `docs/superpowers/specs/2026-10-16-finance-v2-design.md`; 2026-10-16 「继续做」 accepted the recommendations: Receipts loses the click-to-expand row (double-click shows the same detail); Daily Cash Position bank cards stay open.

## Global Constraints

- Plan 1 / 2a constraints hold (scope, no figure / posting / rule change, public repo, Title Case, the finance lists' tick rule).
- Receipts pills: `Posted` (OK), `Posted · cleared` (OK), `Posted · unallocated` (info), `Bounced` (error), void / deleted state (faint).
- Receipts columns in order: `No` · `Date` · `From` · `Via / Deposit To` · `Note` · `Total` · `Status`; title-row buttons: New Official Receipt · New Other Debtor Receipt · New Customer Receipt (primary, last); search hint `Search no / from / reference`.
- Daily Cash Position pending lines list receipts first, then payments, each by date — on screen, in Get image and in Print alike.
- Out of scope: FX banners / estimated rates, Trade Finance in TO REPAY, official-receipt edit, separate Reference fields, the A4 cash-position export preview (print plan).

## Review Focus

1. **Receipts: a receipt with money still on account stays visible as such** — blue row and `Posted · unallocated` pill → Task 1 test.
2. **Receipts: the popup still shows the allocations / bills / lines** now that the inline expand is gone → Task 1 test (`detailTable` rendered in the popup).
3. **Cash Position: ticking still works and the ticked fold row stays** → Task 2 test (`cashpos-ticked-fold` stays green; fold / empty rows carry `data-fin-nolift`).
4. **Cash Position: the same order everywhere** — screen, image and print use one sort → Task 2 test.
5. **Popups: Esc and the buttons inside behave as before** → Task 4 test (shell props unchanged; existing Esc tests green).

---

### Task 1: Receipts list on DataGrid

**Files:** Modify `src/lib/finance-daily.ts` (`receiptStatus`), `src/pages/accounting/index.tsx` (`ReceiptsHubTab`; module-level `receiptGridRow`), `src/lib/finance-nav.ts` (receipts explanation); Tests `tests/finance-v2-receipts-list.test.mjs`, update pinned ones (`doc-detail-dblclick` Receipts block, `finance-row-menu-esc` lists, `receipts-hub`).

**Interfaces — Produces:** `receiptStatus(v: { state: string; custStatus?: string | null; unallocated?: boolean }): FinStatus`; `type ReceiptGridRow = ReceiptHubRow & { state: string; viaLabel: string; unallocated: boolean; statusLabel: string; status: FinStatus }`.

- [ ] Failing tests → implement → pass: memoised `rows` and `gridRows`; DataGrid with `checkboxSelectOnly`, `headerMenu`, `reorderableHeaders`, `exportName="Receipts"`, total via `activeTotalSen`, chips as `SegmentedChips` in `toolbarStart`, double-click → `setDetailKey`, `contextMenuItems` via `rowMenuItems(receiptRowMenu(r))`; no expand state; title-row buttons in the order above; batch bar on the grid's ticks.
- [ ] Commit `feat(finance-v2): Receipts list on the v2 table`.

### Task 2: Daily Cash Position look

**Files:** Modify `src/lib/finance-daily.ts` (`pendingReceiptsFirst`), `src/pages/accounting/index.tsx` (`DailyCashTab`: title buttons, bank card header, pending table, image / print builders); Test `tests/finance-v2-cashpos.test.mjs`.

**Interfaces — Produces:** `pendingReceiptsFirst<T extends { date: string; inSen?: number | null; outSen?: number | null }>(lines: T[]): T[]` — receipts (money in) first, then payments, each by date then original order.

- [ ] Failing tests → implement → pass: Show / Hide planned, Get image and Print in `FinanceTitleActions`; the grey line behind the (i); bank tables `data-fin-list` with a slate header strip; fold / empty rows `data-fin-nolift`; the same sort feeds the screen, image and print.
- [ ] Commit `feat(finance-v2): Daily Cash Position in the v2 look`.

### Task 3: Fund Transfer look

**Files:** Modify `src/pages/accounting/index.tsx` (`FundTransferTab`); Test `tests/finance-v2-fund-transfer.test.mjs`.

- [ ] Failing tests → implement → pass: `table data-fin-list`, dates via `fmtDocDate`, status `FinPill`, a `<tfoot>` total over active transfers, the Post Transfer button on the title row. Behaviour (post, void, edit description) unchanged.
- [ ] Commit `feat(finance-v2): Fund Transfer in the v2 look`.

### Task 4: Popup shell

**Files:** Modify `src/pages/accounting/index.tsx` (`DocDetailModal`, `DetailField`); Test `tests/finance-v2-popup.test.mjs`.

- [ ] Failing tests → implement → pass: the design's shell — backdrop `rgba(31,29,27,.42)`, radius 14px, shadow `0 24px 60px rgba(31,29,27,.28)`, white header (16px/600 title, badges, close ✕), body `#F7F5F2`, a white action bar; `DetailField` labels 11px/600 uppercase. Props unchanged.
- [ ] Commit `feat(finance-v2): document popups in the v2 shell`.

### Task 5: Ship 2b

- [ ] Docs (CODEBASE-MAP, WORK-TRACKER), guards, PR → merge → prod read-only check.
