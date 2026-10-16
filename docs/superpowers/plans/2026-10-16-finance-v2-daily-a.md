# Finance v2 — Plan 2a: Daily pages, part 1 (shell + Payment Vouchers list) Implementation Plan

> **Last verified: 2026-10-16** against `src/pages/accounting/index.tsx` (`PaymentsTab` ~L10140, list ~L11285–11515, `buildPayRows` ~L9971), `src/components/ui/data-grid.tsx` (`handleRowClick`, `handleContextMenu`, `handleKebabTap`, search box), `src/components/accounting/row-menu.tsx`, `src/styles/finance-v2.css` on branch `feat/finance-v2-daily`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Payment Vouchers page looks and works like the v2 "PV table": title-row buttons, segmented status chips, a DataGrid list with funnels, header menu, total row and the v2 status pills — with every current action (ladder, batch, print, attachments, foreign doors, popups, menus) unchanged.

**Architecture:** Shared pieces first (status-pill tones, segmented chips, a title-row slot the tabs portal their buttons into, ink primary buttons, styling for menus portalled to `<body>`), then one DataGrid opt-in (`checkboxSelectOnly`: ticks change only through the checkbox, as on today's finance lists), then the PV list moves from its hand-written `<table>` to DataGrid. Pure mapping lives in `src/lib/finance-daily.ts`. Plan 2b covers the popups, Receipts, Daily Cash Position and Fund Transfer.

**Tech Stack:** React 19 + TypeScript, Tailwind v4, DataGrid (`src/components/ui/data-grid.tsx`), `node --test` with `tsx/esm`.

**Spec:** `docs/superpowers/specs/2026-10-16-finance-v2-design.md` (owner decisions at the end win). Plan 1: `docs/superpowers/plans/2026-10-16-finance-v2-foundation.md`.

## Global Constraints

- Plan 1's constraints hold (scope `[data-fin-ui]`, no figure / posting / rule change, public repo, Title Case, exact header-menu labels).
- Status pills (README tokens): OK `#27500A` on `#E7F0E3`; warning `#7A5B12` on `#FBF3E4`; error `#9A3A2D` on `#F3E8E5`; neutral `#4B5563` on `#EEF1F4`; info (Prepared) `#2C4170` on `#EEF2FB`; faint (VOID) `#9CA3AF` on `#F4F4F2`.
- PV pill labels, exactly: `Draft`, `Prepared`, `Checked · awaiting approval`, `Approved · paid`, `Approved · accrued, unpaid`, `Approved · advance open RM x`, `VOID`.
- PV columns in order: `PV No` · `Date` · `Payee / Description` · `Paid From` · `Line` · `Total` · `Status`; dates as `15 Oct 2026`; the footer total leaves VOID / deleted rows out and reads `Total · N shown of M` (M = every payment, before the chip).
- Title-row buttons, left to right: Scan · New Payment Voucher (secondary) · New AP Payment (primary, last).
- Owner rules kept: single click does nothing to the ticks; right-click / ⋮ open the row menu without changing the ticks; Shift + right-click keeps the browser menu; double-click opens the popup.
- Out of scope (deferred or other plans): FX (Confirm bank amount, bank-amount-pending), Knock off advance / auto knock-off, TF inside AP Payment, a separate Reference field, the AP form's total-paid input, popups / forms restyle (2b).

## Review Focus

1. **Ticks survive a right-click.** Tick three vouchers, right-click a fourth → still three ticked, the menu acts on the fourth → Task 3 test (`checkboxSelectOnly` skips `setSelectedKeys` in the context-menu and ⋮ paths).
2. **The ladder batch acts on vouchers only and clears after.** Ticked foreign rows (SP / OCP / FT) are left out of Prepare / Check / Approve; the selection clears when the batch finishes → Task 4 test.
3. **Search still finds a bill number.** A PI / bill number that only appears in a voucher's settled bills finds the voucher → Task 4 test (`billNos` in `alwaysSearchKeys`).
4. **The export writes PV numbers, not door names.** The PV No funnel lists doors, but the export cell is the number → Task 4 test (`exportValue` on `no`).
5. **A supplier payment with no bank leg is never hidden silently.** It shows `—` and its funnel value is `(no bank leg)` → Task 4 test.

---

### Task 1: Pure helpers for the Daily lists

**Files:** Create `src/lib/finance-daily.ts`; Test `tests/finance-daily-helpers.test.mjs`

**Interfaces — Produces:**
- `type FinTone = "ok" | "warn" | "err" | "neutral" | "info" | "faint"`
- `fmtDocDate(iso: string | null | undefined): string` — `"2026-10-15"` / ISO timestamp → `"15 Oct 2026"`; blank or unreadable → `""`.
- `activeTotalSen(rows: { state: string; totalSen: number }[]): number` — whole sen over rows whose state is `ACTIVE`.
- `pvStatus(v: { status?: string | null; approvalState?: string | null; advanceOpenSen?: number | null; accrued?: number | null; settledAt?: string | null; rejectReason?: string | null; pvNo?: string | null }): { label: string; tone: FinTone; title?: string }` — the Global Constraints labels; legacy rows without a state read Approved.
- `foreignPayStatus(state: string, advanceOpenSen: number, hint: string): { label: string; tone: FinTone; title?: string }` — non-ACTIVE → `{ label: state, tone: "faint" }`; an open advance → warning `Approved · advance open RM x`; else OK `Approved · paid` titled `Posted on save — <hint>`.

- [ ] **Step 1: failing test** — dates (`"2026-10-15"` → `"15 Oct 2026"`, `"2026-10-15T09:00:00Z"` → `"15 Oct 2026"`, `""` → `""`, `"x"` → `""`); `activeTotalSen` skips VOID / DELETED and stays an integer; every `pvStatus` branch with its label and tone (Draft with a reject reason carries `title: "Rejected: …"`; Checked carries `Formal No. <pvNo> — pending in Cash Position`); `foreignPayStatus` three branches.
- [ ] **Step 2: run** `node --import tsx/esm --test tests/finance-daily-helpers.test.mjs` → FAIL.
- [ ] **Step 3: implement** (relative imports only; money text via `formatCurrency` from `./utils`).
- [ ] **Step 4: run** → PASS. **Step 5: commit** `feat(finance-v2): pure helpers for the Daily lists`.

### Task 2: Shared shell — pills, chips, title-row slot, ink primary

**Files:** Create `src/components/finance/pill.tsx`, `src/components/finance/segmented-chips.tsx`, `src/components/finance/title-actions.tsx`; Modify `src/styles/finance-v2.css`, `src/pages/accounting/index.tsx` (page root ~L614, `JournalsTab` header); Test `tests/finance-v2-daily-shell.test.mjs`

**Interfaces — Produces:**
- `FinPill({ tone, title?, children }: { tone: FinTone; title?: string; children: ReactNode })` — rounded-full, 11px/600, the tone's colours.
- `SegmentedChips<K extends string>({ options, value, onChange }: { options: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void })` — 34px tall joined buttons; active = `#6B5C32` bg, white text; a count after the label in 11px at 70% opacity (hidden when 0 or absent).
- `FinanceTitleSlotContext` (`createContext<HTMLElement | null>(null)`) and `FinanceTitleActions({ children })` — portals `children` into the slot; with no slot (tab rendered elsewhere) renders them inline, right-aligned.
- The accounting page passes `actions={<div ref={setTitleSlot} className="flex flex-wrap items-center gap-2" />}` to `FinancePageTitle` and wraps the tab content in the provider.
- CSS: `[data-fin-ui] button[data-variant="primary"]` → `#1F1D1B` / white (hover `#000`); `body:has([data-fin-ui]) [data-dg="menu"]` gets the v2 menu radius / shadow (row menus portal to `<body>`); `--fin-info-fg: #2C4170`, `--fin-info-bg: #EEF2FB`, `--fin-faint-bg: #F4F4F2`; plain-list lift skips rows marked `data-fin-nolift`.

- [ ] **Step 1: failing test** — the three components' props and classes; the page root provides the slot; Journals' "New Journal Entry" renders inside `<FinanceTitleActions>`; the CSS rules above exist and stay scoped (Plan 1's look test still passes).
- [ ] **Step 2–4:** run → FAIL → implement → PASS (+ tsc).
- [ ] **Step 5: commit** `feat(finance-v2): pills, segmented chips, title-row slot, ink primary buttons`.

### Task 3: DataGrid — select only through the checkbox

**Files:** Modify `src/components/ui/data-grid.tsx` (`DataGridProps`, `handleRowClick`, `handleContextMenu`, `handleKebabTap`, search input, body row class), `src/components/accounting/row-menu.tsx` (export `rowMenuItems`); Test `tests/datagrid-checkbox-select.test.mjs`

**Interfaces — Produces:** `DataGridProps.checkboxSelectOnly?: boolean`; `DataGridProps.searchPlaceholder?: string` (default `"Search..."`); `rowMenuItems(groups: RowMenuGroups): ContextMenuItem[]` (the existing `flatten`, exported).

- [ ] **Step 1: failing test** — with `checkboxSelectOnly`: `handleRowClick` leaves `selectedKeys` alone (still calls `onRowClick`); `handleContextMenu` returns early on `e.shiftKey` and does not call `setSelectedKeys`; `handleKebabTap` does not call `setSelectedKeys`; the row whose menu is open gets a highlight class; without the prop every path is unchanged (the existing `setSelectedKeys(new Set([key]))` calls still there behind the flag). `searchPlaceholder` feeds the search input. `rowMenuItems` is exported and `useRowMenu` uses it.
- [ ] **Step 2–4:** run → FAIL → implement → PASS (+ tsc).
- [ ] **Step 5: commit** `feat(grid): checkboxSelectOnly and searchPlaceholder opt-ins`.

### Task 4: Payment Vouchers list on DataGrid

**Files:** Modify `src/pages/accounting/index.tsx` (`PaymentsTab`: header ~L10891, filters ~L11285–11318, selection ~L10363, batch bars ~L11320–11389, table ~L11391–11515), `src/lib/finance-nav.ts` (PV explanation = the page's grey line); Tests `tests/finance-v2-pv-list.test.mjs`, and update the source tests that pin the old table (`payments-hub`, `doc-detail-dblclick`, `finance-row-menu-esc`, `pv-ap-payment`, any other the suite flags) to the same behaviour on the new markup.

**Interfaces — Consumes:** Task 1 helpers, Task 2 `FinPill` / `SegmentedChips` / `FinanceTitleActions`, Task 3 `checkboxSelectOnly` / `searchPlaceholder` / `rowMenuItems`, Plan 1 `headerMenu` / `reorderableHeaders` / `total` / `footerLabel`.
- `type PayGridRow = PayRow & { payeeText: string; viaLabel: string; lineText: string; billNos: string; statusLabel: string }` built once from `payRows` filtered by the chip.

- [ ] **Step 1: failing test** — title-row buttons in `FinanceTitleActions` in the Global Constraints order (New AP Payment `variant="primary"` last); `SegmentedChips` with the seven chips and counts; no date / bank / door inputs and no door-count line; `<DataGrid` with `data={gridRows}`, `checkboxSelectOnly`, `headerMenu`, `reorderableHeaders`, `exportName="Payment Vouchers"`, `searchPlaceholder="Search PV no / payee / bill no"`, `alwaysSearchKeys` containing `billNos`, `onDoubleClick` routing to `setDetailPvId` / `setDetailPayKey`, `contextMenuItems` via `rowMenuItems(r.pv ? pvRowMenu(r.pv) : payRowMenu(r))`; columns in order with `no` carrying `exportValue: (r) => r.no` and a door `filterAccessor`, `viaLabel` falling back to `(no bank leg)`, `totalSen` `type: "currency"` with a total that skips non-ACTIVE rows; the footer label counts every payment; the ladder bar and `BatchActionsBar` read the grid's selection, offer the ladder for vouchers only, and clear through `clearSelectionToken` after a batch.
- [ ] **Step 2–4:** run → FAIL → implement → PASS; then the full suite, fixing the pinned tests to assert the same behaviour on the new markup (never weakening what they guard).
- [ ] **Step 5: commit** `feat(finance-v2): Payment Vouchers list on the v2 table`.

### Task 5: Ship 2a

- [ ] Docs: CODEBASE-MAP (PV list now DataGrid; new finance components; DataGrid opt-ins), WORK-TRACKER entry; `node scripts/check-codebase-map.mjs`, `gen-api-docs --check`, `check-docs-freshness`.
- [ ] PR → merge (owner 2026-10-16: ship after Claude's own check) → prod read-only check: PV title row, chips with counts, list funnels / header menu / total (= sum of ACTIVE rows from the APIs), ticks kept on right-click, a non-finance grid unchanged.
