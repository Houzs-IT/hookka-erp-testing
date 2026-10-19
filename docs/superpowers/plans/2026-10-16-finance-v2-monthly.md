# Finance v2 — Plan 4: Monthly Group Implementation Plan

> **Last verified: 2026-10-16** against `src/pages/accounting/index.tsx` (`SelfCheckTab`, `CorrectionsTab`, `LaborTab`, `FixedAssetsTab`, `StockTakeTab`, `CashBookTab`, `JournalsTab`), `src/components/finance/report-shell.tsx`, `src/components/ui/data-grid.tsx` on `main` after plan 3 (#924–#930).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Finance › Monthly pages in the v2 look — title-row controls, a status banner and KPI cards where the design has them, and the v2 table look — without changing any posting, matching, saving or reading behaviour.

**Architecture:** Two shared pieces first (`KpiCards`, `StatusBanner` in `src/components/finance/report-shell.tsx`), then one page per task. Every write button keeps its handler, endpoint, confirm and label; only where it sits and how it looks change. Lists that are plain tables either become `DataGrid` (Corrections, Self-check) or opt into `table[data-fin-list]`; grouped registers use `table[data-fin-report]`.

**Tech Stack:** React 19 + TypeScript, Tailwind v4, `src/styles/finance-v2.css` (scoped to `[data-fin-ui]`), node:test source assertions.

**Spec:** `docs/superpowers/specs/2026-10-16-finance-v2-design.md` (README › Finance › Monthly) — owner decisions win: stock-take posting / undo and "duplicate as manual" stay as today; "Add New Asset" from a PV / AP Invoice and WIP-by-PO into the sheet are deferred (Class C).

## Global Constraints

- Plans 1–3 constraints hold (scope `[data-fin-ui]`, flat CSS, no figure / posting / rule change, public repo — no amounts or names in commits, tests use made-up figures, Title Case UI).
- **Write buttons are untouched in behaviour**: Labour Post / Unpost, Fixed Assets Save / dispose / del / depreciation Post, Stock Take Save / mapping / valuation-mode toggles, Cash Book import / auto-match / match / unmatch / combine / split / book / ignore / del / Finalise / Re-open / strict lock. Same handler, endpoint, confirm text and label. Prod checks never press them.
- Status banner: radius 10, `1px` border, padding `10px 14px`, min-height 40; title 13px/700; sub 12px `#4B5563`. Done = bg `#F1F6EE`, border `#C9DBBE`, text `#27500A`; to do = bg `#FBF6EC`, border `#E9D9B4`, text `#7A5B12`.
- KPI cards: grid `repeat(auto-fit, minmax(180px, 1fr))`, gap 10; card white, `1px #E2DDD8`, radius 10, padding `12px 14px`; label 11px/600 uppercase tracking `.5px` `#6B7280`; value 20px/700; note 11px `#9CA3AF`.
- A KPI or banner shows only figures the page already has (no new endpoint, no new arithmetic beyond counting rows already loaded).
- Month pickers become `PeriodStepper` over months (the pages read `YYYY-MM`).

## Review Focus

1. **A write button changed behaviour** → each task's test pins the handler's endpoint, method and confirm text after the move.
2. **A status shown that the page cannot know** (e.g. "Posted" without the server saying so) → banners read only the existing posted flags (`/labor/preview` posted state, Cash Book finalise state).
3. **Stock Take's long-standing source pins** (`stock-take-priced-count`, `money-input-parsing`) → re-pointed to the same behaviour, never weakened.
4. **Cash Book's plain tables lose a control** (match select, combine, split, book) → its task's test counts the controls before and after.
5. **DataGrid rows not memoised** (BUG-CLASSES C24) → Corrections / Self-check rows and columns in `useMemo`.

---

### Task 1: Shared pieces — `KpiCards`, `StatusBanner`
Add to `report-shell.tsx`: `KpiCards({ items: { label, value, tone?: "ink" | "ok" | "warn" | "err", note? }[] })`, `StatusBanner({ done, title, sub })`. Test `tests/finance-v2-month-shell.test.mjs` (exact classes above).

### Task 2: Corrections + Self-check
Corrections: `DataGrid` (When / Kind / Document / By / Reason / Reversed / Re-posted), month stepper on the title row with "Last 90 days", download via the grid's header menu. Self-check: KPI "Checks · N of M OK", `DataGrid` (Result pill / Area / Check / Detail / Fix →), Run again on the title row; same reads. Test `tests/finance-v2-selfcheck-corrections.test.mjs`.

### Task 3: Labour
Title row: month stepper, "Check in Payroll ↗" (link to the payroll page), Post / Unpost as today; status banner from the preview's posted state; KPI (Production labour · month, Status); By department and GL posting preview as `data-fin-list` tables; the map editor unchanged. Re-point `labour-statutory-accruals`. Test `tests/finance-v2-labour.test.mjs`.

### Task 4: Fixed Assets
Title row: Add Asset; register grouped by asset account with a subtotal per group and a total (`data-fin-report`), depreciation card in the report look with its Preview / Post as today; Excel / PDF of the register. Test `tests/finance-v2-fixed-assets.test.mjs`.

### Task 5: Stock Take
Title row: month stepper and its existing buttons; status banner + KPI from figures already loaded; its tables opt into `data-fin-list`; every source pin re-pointed, not weakened. Test `tests/finance-v2-stock-take.test.mjs`.

### Task 6: Cash Book
Title row: month stepper, account select, Upload / Auto-match / Finalise as today; KPI (Bank balance, Book balance, Open items, Unexplained) from the report it already loads; tables opt into `data-fin-list`; every match control kept (counted). Test `tests/finance-v2-cash-book.test.mjs`.

### Ship
Part A = Tasks 1–2, part B = Tasks 3–4, part C = Tasks 5–6; each: docs (CODEBASE-MAP, WORK-TRACKER), guards, PR → merge → prod read-only check (figures and counts equal the API; no write button pressed).
