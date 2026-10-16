# Finance v2 — Plan 3: Reports Implementation Plan

> **Last verified: 2026-10-16** against `src/pages/accounting/index.tsx` (`PlHubTab`, `PLStatementTab`, `MonthlyPlTab`, `CostStructureTab`, `CashFlowTab`, `BalanceSheetTab`, `TrialBalanceTab`, `GeneralLedgerTab`, `StockSummaryTab`), `src/pages/accounting/overview-tab.tsx`, `src/lib/export-report.ts`, `src/lib/constants.ts` on branch `feat/finance-v2-reports`, after plans 1, 2a, 2b (#918, #922, #923).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every report gets the v2 report shell — one toolbar on the title row (period stepper, Edit Layout, DETAIL L1–L4, one download), a check strip where the report balances, the framed report with a centred company / report / note head, and the v2 report table (slate sticky header, strong group lines, row kinds) — plus the design's small behaviours on data the pages already have (Trial Balance sections and double-click to the ledger, General Ledger account range picker and Expand / Collapse All, "Open In GL →" in drills, Stock Summary TOTAL STOCK). No figure changes.

**Architecture:** Shared shell first (`src/components/finance/report-shell.tsx`, pure `src/lib/finance-reports.ts`, CSS `table[data-fin-report]` keyed by `data-row` / `data-cell`), then one report per task, each keeping its data and engine untouched. The P&L hub lifts the line switch so the hub's views render one toolbar each.

**Spec:** `docs/superpowers/specs/2026-10-16-finance-v2-design.md` — owner decisions win: Monthly P&L keeps Accumulated first and newest month first; Trade Finance stays its own Cash Flow block (interest under Finance Cost); GL Sales / Purchase scope keeps opening the per-party ledger; Month / Quarter / FY pickers with transition years, the per-company sheet and WIP-by-PO feeding the sheet are deferred.

## Global Constraints

- Plans 1 / 2 constraints hold (scope `[data-fin-ui]`, flat CSS, no figure / posting / rule change, public repo, Title Case).
- Toolbar controls: 32px tall, `1px #D9D3CA` border, radius 8, white, 12.5px/600, hover `#F4F6F8`; groups split by a 1×22px `#E2DDD8` divider. Active segment ink `#1F1D1B` / white. DETAIL label 11px/700 `#9CA3AF`. Download menu items `Export to Excel`, `Print / PDF`.
- Period stepper label: `Oct 2026 · so far` for the running month; disabled arrow opacity .35. The stepper offers only the periods each report already supports (P&L: months, calendar quarters, calendar years; Cash Flow: months only — BUG-2026-08-13-092; others: months).
- Check strip: `#EEF5E9` balanced / `#FBEDEC` not; `Balanced ✓` in `#27500A`, `Out of balance · difference x` in `#9A3A2D`.
- Frame: `1.5px solid #7A6E5E`, radius 10; head centred: company 15px/700, report 13px `#4B5563`, note 12px `#9CA3AF`; company = `COMPANY.HOOKKA.name` except where a report prints a name today (kept until the owner confirms the legal name).
- Report table: header `#E2E8F0` 12.5px/700 sticky; first column sticky with `1.5px #7A6E5E` right line; Accumulated header `#D9E1EA`, body `#F7F5F1`; amounts 13px, negatives `#9A3A2D`, % 11px `#6B7280`; rows by `data-row`: `top`, `sec`, `grp`, `line`, `sub` (`#F1EEE8`), `res` (`#E9E3D8`), `fin` (double bottom `3px #1F1D1B`), `bf`, `det` (`#F4F6F8`), `detsum` (`#E8EDF2`), `est` (`#FAEFCB`, text `#9C6F1E`).
- Ledger balances with credit in brackets: `(RM 1,000.00)`.
- Waiting on the owner (2026-10-16): the legal company name on report heads, the Balance Sheet layout (Fixed Assets / CA less CL / Financed By), dropping CSV. Until answered: keep today's printed names, keep CSV inside the download menu, and the Balance Sheet keeps today's layout.

## Review Focus

1. **Figures identical before and after** for every report — the shell only re-dresses the rows the engine already returns → each report task's test asserts the rows come from the same data call; prod check compares totals before / after.
2. **Trial Balance → General Ledger by double-click lands on the same balance** (both by document date) → Task 3 test + prod check.
3. **GL range picker never hides a picked account silently** (blank / swapped ends) → Task 1 `codesInRange` tests.
4. **Cash Flow stays months-only** (BUG-092 guard) → Task 7 test.
5. **Sticky header + sticky first column + lifted row layering** on wide month reports → CSS z-order assertions in Task 2; prod scroll check.

---

### Task 0: Daily polish carried over
Popup dates and the Daily Cash Position table read `15 Oct 2026` (`fmtDocDate`). Test in the existing `finance-v2-*` files. Commit `fix(finance-v2): document dates in popups and the cash position read the v2 way`.

### Task 1: Pure helpers — `src/lib/finance-reports.ts`
`monthOptions`, `stepPeriod`, `periodLabel` (`Oct 2026 · so far`), `asAtDate`, `glLink({ account, fromYm, toDate })`, `tbSections`, `codesInRange`, `fmtLedgerBal`, `stockTotals`, `rowKindOf`. Test `tests/finance-reports.test.mjs` (made-up figures).

### Task 2: Report shell — `src/components/finance/report-shell.tsx` + CSS
`ReportToolbar` (`PeriodStepper`, `EditToggle`, `DetailLevels`, `DownloadMenu`), `CheckStrip`, `ReportFrame`, `EditLayoutBanner`; `table[data-fin-report]` rules keyed by `data-row` / `data-cell`. Popovers close on Esc and outside click. Test `tests/finance-v2-report-shell.test.mjs`.

### Task 3: Trial Balance (pilot)
Toolbar on the title row, frame, check strip, sections by account type with fold and subtotal, L1 / L2, double-click an account → `glLink`, download (Excel / PDF). Test `tests/finance-v2-tb.test.mjs`.

### Task 4: General Ledger
Account multi-picker with "By Code Range" + Tick, Expand / Collapse All, summary bar (accounts, TOTAL DR / CR, Diff ✓, download), blocks in the v2 look, credit balances in brackets; the Sales / Purchase scope unchanged. Test `tests/finance-v2-gl.test.mjs`.

### Task 5: P&L hub + Statement
One toolbar per view (line switch lifted into the hub), frame, two-row header, row kinds, amber negative-stock warning with View / Hide, "Open In GL →" in the drill total. Update `pl-inline-drill`, `pl-drill-like-cashflow`, `expense-estimates`, `accounting-ui-truthfulness` to the same behaviour.

### Task 6: Monthly P&L + Cost Structure
Frame, Accumulated shading, month group lines, drill rows as `det` / `detsum` with "Open In GL →"; Cost Structure section frames and a Total row. Order unchanged (owner). Update `finance-tables-drills`.

### Task 7: Cash Flow
Months-only stepper, Edit Layout + banner, L1–L3, download, frame "Statement Of Cash Flow", row kinds; engine order and the TF block unchanged. Update `cashflow-level-expand`, `cashflow-inline-drill`, `cashflow-drill-*`, `cashflow-unified-signs`, `accounting-ui-truthfulness`.

### Task 8: Stock Summary (+ Balance Sheet look once the owner answers)
Stock: section frames, TOTAL STOCK, "Every group balances ✓". Balance Sheet: frame, check strip, stepper, download; the new layout only with the owner's yes. Update `bs-inline-drill`, `bs-stock`.

### Task 9: Overview + ship
Overview cards in the v2 look, range switch on the title row; docs (CODEBASE-MAP, WORK-TRACKER), guards, PR → merge → prod read-only check (totals identical; never press Year-End Close, never drag in Edit Layout).
