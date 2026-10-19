# Finance v2 — Plan 7: Forecasting (Financial Dashboard + Forecast P&L) Implementation Plan

> **Last verified: 2026-10-17** against `src/pages/finance-dashboard.tsx` (`ChartTip`, `ChartCard`, `SalaryDeptCard`, `FinanceDashboardPage`) and `src/pages/forecast.tsx` (`ForecastPage`, `AmountInput`, `addMonth`, `removeMonth`, `save`) on `main` after plan 6.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two Forecasting pages as the design draws them:
- the dashboard's charts readable: a visible y-axis, clearer labels, a tooltip with aligned columns, a Total row and a Forecast section;
- its tables in the v2 look with a sticky month header and side column;
- the Forecast P&L comfortable to key: picking a month adds it, deleting a month asks first, arrow keys and Enter move between cells, and unsaved changes are flagged and guarded;
- calm cell colours, labels without account numbers.

Nothing in the figures, the forecast rules or the saved data changes.

**Architecture:** Presentation inside the two page files plus one small shared helper for the keyboard grid (`src/lib/grid-keys.ts`, pure: the next cell for a key). The dashboard tooltip stays one component (`ChartTip`) that every chart passes its series kinds to. The leave guard uses the router's `useBlocker` plus `beforeunload`, active only while there are unsaved changes.

**Tech Stack:** React 19 + TypeScript, recharts, react-router 7, Tailwind v4, node:test (pure helper tests + source assertions).

**Spec:** `docs/superpowers/specs/2026-10-16-finance-v2-design.md` (README › Forecasting; Look and feel › colours). Kept as today (owner rules): a new month starts from the previous month's percentages; Forecast P&L is desktop only.

## Global Constraints

- Plans 1–6 constraints hold.
- Forecast data:
  - same reads and the same `save` payload;
  - a removed month is still only removed on Save;
  - keying one side of a line still clears the other.
- Chart colours:
  - the forecast line stays red (`#9A3A2D` family);
  - single-series bars stay sand (`#6B5C32`);
  - multi-series charts keep `CS_COLOURS` (already categorical).

## Review Focus

1. **The leave guard blocks a navigation it should not**: after a Save, after the page loads, or after a month is added and then removed again. The guard compares the current inputs with the last saved snapshot; it does not count edit events.
2. **Arrow keys inside a text input**: Left / Right move the caret, so they move to the next cell only when the caret is at the edge. Up / Down / Enter always move.
3. **Tooltip totals**:
   - the Total row sums only the bar series shown;
   - a hidden (toggled-off) series is not counted;
   - the forecast line is never added into the actual total.

---

### Task 1: Financial Dashboard (part A)
- Y-axis line visible (`axisLine` stroke `#CBD5E1`); tick labels 12px `#4B5563`.
- `ChartTip` becomes a three-column grid (name / amount / % sales):
  - series in stack order (top first);
  - a bold Total row when more than one bar series is shown;
  - line series (Forecast, Net change, ratios) under a separate "Forecast" / "Line" heading.
- Chart tabs use `SegmentedSwitch`.
- The tables under the charts use `data-fin-list`, with the month header sticky (top) and the side column sticky (left).

Test `tests/finance-v2-dashboard.test.mjs`.

### Task 2: Forecast P&L (part B)
- Title row: one month control. Picking a month in the month input adds it (the same `addMonth` path and checks).
- The ✕ on a month asks "Remove {month}? It goes when you Save" before it marks the month removed.
- `src/lib/grid-keys.ts` `nextCell({row, col}, key, caretAtStart, caretAtEnd, rows, cols)` drives arrow / Enter movement across the input cells (`data-fc-cell="r:c"`).
- An unsaved-changes banner, "You have unsaved changes · Save", shows while the inputs differ from the last loaded or saved snapshot. A `useBlocker` confirm and `beforeunload` guard navigation while it shows.
- Cells:
  - user-entered cells get a very light warm background (`#FFFBF2`);
  - computed cells are plain;
  - section / subtotal labels are 14px semibold;
  - child lines are indented;
  - no account codes in the side column, which keeps the name only (the code is in the row's title).
- The table fills the width.

Tests `tests/grid-keys.test.mjs` (pure) and `tests/finance-v2-forecast.test.mjs`.

### Ship
In parts (A = dashboard, B = Forecast P&L). Each part goes through docs, guards and merge.

The prod check is read-only:
- the dashboard's figures equal the API, with the tooltip read by hovering;
- on the Forecast P&L, no Save is pressed. Only the client-side guard and keys are exercised, and the page is left with nothing changed.
