# Finance v2 — Plan 1: Foundation (look + table system) Implementation Plan

> **Last verified: 2026-10-16** against `src/components/ui/data-grid.tsx`, `src/api/routes/datagrid-layouts.ts`, `src/lib/export-report.ts`, `src/components/ui/button.tsx`, `src/pages/accounting/index.tsx` (Journals grid ~L3431/L3598, page root ~L614) on branch `feat/finance-v2-foundation`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Finance and Forecasting pages get the v2 look (type, colours, lines, buttons, page title with an (i) explanation), and the shared DataGrid gains the v2 "PV table" behaviours (header right-click menu, header drag-reorder, number-range filter, sticky total row, per-user saved layout), proven on the Journal Entries list. No figure, posting or rule changes.

**Architecture:** The look is one unlayered stylesheet `src/styles/finance-v2.css` scoped to `[data-fin-ui]` (unlayered rules beat Tailwind v4's layered utilities), plus stable `data-dg` / `data-variant` hooks in DataGrid and Button that change nothing on their own. Behaviour is opt-in DataGrid props backed by pure helpers in `src/lib/grid-layout.ts`. Per-user layouts reuse the existing `datagrid_org_layouts` table with kind `user:<userId>`. Later plans convert the page groups (Daily, Reports, Monthly, Debtors/Creditors, e-Invoice, Setup), then Forecasting, mobile and print.

**Tech Stack:** React 19 + TypeScript, Tailwind v4 (`@tailwindcss/vite`), Hono API on Cloudflare Pages, Postgres via the D1-compat adapter, `node --test` with `tsx/esm`, `@fontsource/ibm-plex-sans` 5.3.0 (new).

**Spec:** `docs/superpowers/specs/2026-10-16-finance-v2-design.md` (the designer's README plus the owner's 2026-10-16 decisions, which win where they differ).

## Global Constraints

- Scope: Finance and Forecasting pages only — every v2 CSS rule sits under `[data-fin-ui]` (or `body:has([data-fin-ui])`); the other 40+ DataGrid users keep their look and behaviour unless a page passes a new prop.
- No change to any figure, posting, permission or business rule; money stays integer sen.
- Public repo: no amounts, party names or real figures in code, tests or docs (tests use made-up numbers).
- UI copy in English, Title Case for labels and buttons.
- Header menu labels, exactly, in this order: `Sort Ascending`, `Sort Descending`, `Clear Sorting` (only when sorted), —, `Filter This Column…` (only when the column can be filtered), `Clear All Filters` (only when any filter is on), —, `Hide This Column`, `Column Chooser…`, `Best Fit`, `Best Fit (All Columns)`, —, `Save Layout`, `Reset Layout`, —, `Export to Excel`, `Export to PDF`, `Print`. Menu x is clamped to `window.innerWidth - 248`. Hiding the last visible column toasts `Keep at least one column`.
- Hover lift: `transform: translateY(-2px)` (no scale), `box-shadow: 0 8px 18px rgba(31,29,27,.16), 0 0 0 1.5px #7A6E5E`, rounded corners, grid lines kept; a lifted row passes under the sticky header and total row.
- Lines: group / header-body / frozen-column / outer frame `1.5px #7A6E5E`; body cells `1px #E7E1D8`; header cells `#CBD5E1`.
- Colours: ink `#1F1D1B`; text `#1F2937` / `#374151`; muted `#6B7280`; faint `#9CA3AF`; page `#FAF8F4`; card `#FFFFFF`; card border `#E2DDD8`; table header bg `#E2E8F0`; subtotal bg `#F1EEE8`; total/footer bg `#F7F7F5`; accent `#6B5C32` (hover `#574A28`).
- Status: OK `#27500A` on `#E7F0E3`; warning `#7A5B12` on `#FBF3E4`; error `#9A3A2D` on `#F3E8E5`; neutral `#4B5563` on `#EEF1F4`.
- Buttons: primary `#1F1D1B` bg / white text; secondary white bg, `#E2DDD8` border, `#1F1D1B` text; height 34px, radius 8px, 13px/600.
- Type: IBM Plex Sans (system-ui fallback), tabular numerals; page title 22px/700; section title 15px/700; table body 13px; header 12.5px/600; amounts 13–13.5px/600–700; % 11–11.5px. Radii: cards 10px, modals 14px, inputs 8px, chips 9999px. Menu shadow `0 14px 34px rgba(31,29,27,.18)`; modal shadow `0 24px 60px rgba(31,29,27,.28)`.
- Page explanations sit behind an (i) icon next to the title, not in a grey sub-line.
- Kept on purpose (2026-06-03 decision): the date filter stays a flat list of dates plus range presets — no year/month/day tree.

## Review Focus

1. **A non-finance grid must not change.** A page that passes none of the new props, outside `[data-fin-ui]`, renders and behaves exactly as before → Task 7 test: every selector in `finance-v2.css` is scoped; Tasks 3–6 tests: every new handler is gated by its prop.
2. **Typed amounts in the number filter.** `1,234.50`, `(500)`, `-12`, a blank side, or text → parsed or ignored, never a crash; a currency column compares in RM typed against sen stored → Task 1 `parseAmount` tests, Task 3 test (×100 for currency).
3. **The total row sums what is shown.** Totals cover the filtered rows (not the render cap), in whole sen, and the label reads `Total · N shown of M` → Task 1 `columnTotals` integer test, Task 4 test (`sortedData`).
4. **Saved layout precedence.** A newer change in this browser is not overwritten by an older saved default on reload; a fresh browser gets the saved default → Task 1 `pickLayoutSource` tests, Task 6 test (hydrate compares timestamps).
5. **Header right-click etiquette.** Shift + right-click keeps the browser menu; Esc and a click outside close the header menu → Task 5 test.

---

### Task 1: Pure grid helpers

**Files:**
- Create: `src/lib/grid-layout.ts`
- Test: `tests/grid-layout.test.mjs`

**Interfaces:**
- Produces:
  - `moveColumn(order: string[], from: string, to: string): string[]` — new array with `from` placed immediately before `to`; returns a copy unchanged when `from === to` or either key is missing.
  - `RANGE_MODE = "range"`; `rangeTerm(lo: number | null, hi: number | null): string` → `"<lo>..<hi>"` with empty sides (`"100..", "..250", "100..250"`); `""` when both null.
  - `decodeRange(filter: string): { lo: number | null; hi: number | null } | null` — parses `"range:<lo>..<hi>"`; `null` for any other filter.
  - `inRange(value: unknown, r: { lo: number | null; hi: number | null }): boolean` — `Number(value)`; non-finite → false; bounds inclusive.
  - `parseAmount(text: string): number | null` — strips commas and spaces; `(x)` → `-x`; `""`/non-numeric → `null`.
  - `columnTotals<T>(rows: T[], cols: { key: string; total?: "sum" | ((rows: T[]) => number) }[], get: (row: T, key: string) => unknown): Record<string, number>` — `"sum"` adds finite `Number(get(row, key))`; a function is called with `rows`; columns without `total` are absent.
  - `headerMenuItems(o: { sorted: "asc" | "desc" | null; filterable: boolean; anyFilter: boolean }): string[]` — the Global Constraints label sequence, `"-"` for a separator, conditional items dropped (and a separator dropped when its whole group is empty).
  - `pickLayoutSource(localSavedAt: string | null, serverUpdatedAt: string | null): "local" | "server" | "none"` — ISO strings; server when only server exists or server is strictly newer; local when only local exists or local is newer or equal; none when neither.

- [ ] **Step 1: Write the failing tests** — `tests/grid-layout.test.mjs` (import from `../src/lib/grid-layout.ts`):
  - `moveColumn(["a","b","c","d"], "d", "b")` → `["a","d","b","c"]`; `moveColumn(["a","b"], "a", "a")` → `["a","b"]`; missing key → unchanged copy.
  - `rangeTerm(100, null)` → `"100.."`; `decodeRange("range:100..250")` → `{ lo: 100, hi: 250 }`; `decodeRange("range:..250")` → `{ lo: null, hi: 250 }`; `decodeRange("equals:x")` → `null`.
  - `inRange(150, { lo: 100, hi: 250 })` true; `inRange(250, …)` true; `inRange("x", …)` false.
  - `parseAmount("1,234.50")` → 1234.5; `parseAmount("(500)")` → -500; `parseAmount("-12")` → -12; `parseAmount("")` → null; `parseAmount("abc")` → null.
  - `columnTotals` with sen values `[12345, 1, 99]` on `"sum"` → `12445` (an integer); a function total receives the rows; a column without `total` is absent.
  - `headerMenuItems({ sorted: null, filterable: true, anyFilter: false })` deep-equals `["Sort Ascending","Sort Descending","-","Filter This Column…","-","Hide This Column","Column Chooser…","Best Fit","Best Fit (All Columns)","-","Save Layout","Reset Layout","-","Export to Excel","Export to PDF","Print"]`; with `sorted: "asc", anyFilter: true` it adds `"Clear Sorting"` after `Sort Descending` and `"Clear All Filters"` after `Filter This Column…`; with `filterable: false, anyFilter: false` the filter group and its separator are gone.
  - `pickLayoutSource(null, "2026-10-16T08:00:00Z")` → `"server"`; `pickLayoutSource("2026-10-16T09:00:00Z", "2026-10-16T08:00:00Z")` → `"local"`; equal → `"local"`; `(null, null)` → `"none"`.
- [ ] **Step 2: Run to verify it fails** — `node --import tsx/esm --test tests/grid-layout.test.mjs` → FAIL (module not found).
- [ ] **Step 3: Implement** the functions in `src/lib/grid-layout.ts` (no React imports; pure).
- [ ] **Step 4: Run to verify it passes** — same command → all pass.
- [ ] **Step 5: Commit** — `feat(grid): pure helpers for column order, range filter, totals, header menu, layout precedence`.

### Task 2: Per-user saved layout on the server

**Files:**
- Create: `src/api/lib/datagrid-layout-kind.ts`
- Modify: `src/api/routes/datagrid-layouts.ts` (GET ~L127, PUT ~L162, DELETE ~L251)
- Test: `tests/datagrid-user-layout.test.mjs`; regenerate `docs/API.md`

**Interfaces:**
- Produces:
  - `layoutKindFor(kind: string, userId: string | undefined): string | null` — `"org-default"`/`"print"` → unchanged; `"user"` → `` `user:${userId}` `` when `userId` is non-empty, else `null`; anything else → `null`.
  - `GET /api/datagrid-layouts?gridId=` adds `mine: { visibleCols: string[]; colOrder: string[]; colWidths: Record<string,string> | null; updatedAt: string | null } | null` (the caller's own `user:<id>` row).
  - `PUT` / `DELETE` accept `kind: "user"` from any signed-in caller (stored as `user:<id>`); `org-default` and `print` keep `requireSuperAdmin`.

- [ ] **Step 1: Write the failing test** — `layoutKindFor("user","u1")` → `"user:u1"`; `("user", undefined)` → `null`; `("org-default","u1")` → `"org-default"`; `("x","u1")` → `null`. Source assertions on the route: GET selects the caller's `user:` row and returns `mine`; PUT/DELETE call `requireSuperAdmin` only when the kind is not `"user"`; the SQL stays snake_case.
- [ ] **Step 2: Run** `node --import tsx/esm --test tests/datagrid-user-layout.test.mjs` → FAIL.
- [ ] **Step 3: Implement** the helper and the route changes (no schema change: `kind` is TEXT and the unique index is `(org_id, grid_id, kind)`).
- [ ] **Step 4: Run** the test → PASS; `node scripts/gen-api-docs.mjs` then `--check` → up to date.
- [ ] **Step 5: Commit** — `feat(grid): per-user saved layouts in datagrid-layouts (kind user:<id>)`.

### Task 3: Number filter in the column funnel

**Files:**
- Modify: `src/components/ui/data-grid.tsx` (`matchesFilter` ~L365; `ColumnFilterDropdown` ~L492, tabs ~L930, text tab ~L1205)
- Test: `tests/datagrid-number-filter.test.mjs`

**Interfaces:**
- Consumes: `RANGE_MODE`, `rangeTerm`, `decodeRange`, `inRange`, `parseAmount` (Task 1).
- Produces: a column filter value `"range:<lo>..<hi>"` in raw units (currency columns in sen), applied through the existing `onApplyText(text, mode)` → `setColFilter`.

- [ ] **Step 1: Write the failing test** (source level, comments stripped): `matchesFilter` decodes a `range:` filter with `decodeRange` before lower-casing and checks `inRange`; for `columnType` `"currency"` or `"number"` the second tab reads `Number Filters` (date stays `Date Filters`, others `Text Filters`); the tab has `From` and `To` inputs parsed with `parseAmount`; a currency column multiplies by 100 (`Math.round(x * 100)`); Apply calls `onApplyText(rangeTerm(lo, hi), RANGE_MODE)`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Reopening the funnel shows the current range (decode `textFilter`, currency ÷ 100). Both inputs blank + Apply = clear.
- [ ] **Step 4: Run** the test, then `npx tsc -p tsconfig.app.json --noEmit` → clean.
- [ ] **Step 5: Commit** — `feat(grid): number range filter for amount columns`.

### Task 4: Sticky total row

**Files:**
- Modify: `src/components/ui/data-grid.tsx` (`Column` type ~L120, `DataGridProps` ~L190, after `</tbody>` ~L3460)
- Test: `tests/datagrid-total-row.test.mjs`

**Interfaces:**
- Consumes: `columnTotals` (Task 1).
- Produces: `Column.total?: "sum" | ((rows: T[]) => number)`; `Column.totalFormat?: (n: number) => React.ReactNode` (default `formatRM(n)` for `type: "currency"`, else `formatNumber(n)`); `DataGridProps.footerLabel?: (shown: number, all: number) => React.ReactNode` (default `` `Total · ${shown} shown of ${all}` ``). A `<tfoot data-dg="foot">` renders only when a visible column has `total`.

- [ ] **Step 1: Write the failing test** (source level): the tfoot is gated on a visible column with `total`; totals come from `columnTotals(sortedData, …)` (the filtered rows, not the capped render list); the default label text is `Total · `; the footer row is `sticky bottom-0`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** First visible cell carries the label; selectable gutter and kebab column get empty cells; sticky first column cells keep their `left` offset.
- [ ] **Step 4: Run** test + tsc → pass.
- [ ] **Step 5: Commit** — `feat(grid): sticky total row from column totals`.

### Task 5: Header right-click menu

**Files:**
- Modify: `src/components/ui/data-grid.tsx` (header `<th>` ~L3165; export menu ~L2966 for the listing AOA; reuse `ContextMenu` ~L394 styling)
- Modify: `src/lib/export-report.ts` (`exportReportPdf` ~L82: `opts.print?: boolean` → `doc.autoPrint()` + open the blob URL instead of saving)
- Test: `tests/datagrid-header-menu.test.mjs`

**Interfaces:**
- Consumes: `headerMenuItems`, `columnTotals` (Task 1); `saveUserDefault()` (Task 6 — until Task 6 lands, `Save Layout` calls the existing personal save).
- Produces: `DataGridProps.headerMenu?: boolean`. Actions: sort asc/desc/clear (`setSortKey`/`setSortDir`); `Filter This Column…` opens the existing funnel at the menu point; `Clear All Filters` empties text and value filters; `Hide This Column` (toast `Keep at least one column` on the last one); `Column Chooser…` opens the existing Columns popover; `Best Fit` = `resetColumnWidth(key)`; `Best Fit (All Columns)` resets every width; `Save Layout` / `Reset Layout`; `Export to Excel` = the existing WYSIWYG listing (+ the total row when Task 4 totals exist); `Export to PDF` = `exportReportPdf(file, title, "As at dd/mm/yyyy", aoa)`; `Print` = the same with `{ print: true }`. Title = `exportName ?? gridId`.

- [ ] **Step 1: Write the failing test** — source level: `onContextMenu` on the header cell is wired only when `headerMenu`; a Shift + right-click returns without `preventDefault`; x is clamped with `window.innerWidth - 248`; the menu closes through `useEscapeClose` and an outside `mousedown`; labels come from `headerMenuItems`; the menu head shows the column label and `sorted A → Z` / `sorted Z → A` / `column`. Plus `exportReportPdf` honours `print`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test + tsc → pass.
- [ ] **Step 5: Commit** — `feat(grid): header right-click menu (sort, filter, columns, layout, export, print)`.

### Task 6: Drag headers to reorder + Save Layout per user

**Files:**
- Modify: `src/components/ui/data-grid.tsx` (layout persistence ~L1678–L2090: `fetchOrgLayouts`, personal saves, reset; header `<th>`)
- Test: `tests/datagrid-user-default.test.mjs`

**Interfaces:**
- Consumes: `moveColumn`, `pickLayoutSource` (Task 1); `GET`/`PUT`/`DELETE /api/datagrid-layouts` with `kind: "user"` (Task 2).
- Produces: `DataGridProps.reorderableHeaders?: boolean`; internal `saveUserDefault(): Promise<void>` used by `Save Layout`; local timestamp key `datagrid-layout-ts-${gridId}-${userKey()}`.

- [ ] **Step 1: Write the failing test** (source level): header cells are `draggable` and carry drag handlers only when `reorderableHeaders`; a drop calls `moveColumn` then the existing order setter (which persists); every personal save (visibility, order, width) also writes the timestamp key; `saveUserDefault` PUTs `kind: "user"` with visible columns, order and widths, then writes the timestamp and toasts `Layout saved as your default`; hydrate reads `mine` and applies it when `pickLayoutSource(localTs, mine.updatedAt) === "server"`; `Reset Layout` also DELETEs the `user` row.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Drop target shows a 2px `#6B5C32` left border while dragging over; the drag image is the header text.
- [ ] **Step 4: Run** test + tsc → pass.
- [ ] **Step 5: Commit** — `feat(grid): drag headers to reorder; Save Layout stores a per-user default`.

### Task 7: Finance look

**Files:**
- Create: `src/styles/finance-v2.css`; import it once in `src/main.tsx` after `index.css`
- Modify: `package.json` (`@fontsource/ibm-plex-sans` 5.3.0; import weights 400/500/600/700 at the top of `finance-v2.css`)
- Modify: `src/components/ui/data-grid.tsx` (hooks only: `data-dg="table"` on `<table>`, `"th"` on header cells, `"row"` on body rows, `"foot"` on the tfoot)
- Modify: `src/components/ui/button.tsx` (hooks only: `data-variant`, `data-size`)
- Modify: `data-fin-ui` on the page roots of `src/pages/accounting/index.tsx` (~L614), `src/pages/invoices/credit-notes.tsx`, `debit-notes.tsx`, `e-invoice.tsx`, `src/pages/finance-dashboard.tsx`, `src/pages/forecast.tsx`
- Test: `tests/finance-v2-look.test.mjs`

**Interfaces:**
- Produces: CSS custom properties on `[data-fin-ui]` (`--fin-ink`, `--fin-line-strong`, `--fin-line`, `--fin-head-bg`, `--fin-head-line`, `--fin-sub-bg`, `--fin-foot-bg`, `--fin-ok-fg/bg`, `--fin-warn-fg/bg`, `--fin-err-fg/bg`, `--fin-neutral-fg/bg`) for later plans; `table[data-fin-list]` as the opt-in marker that gives a plain (non-DataGrid) list table the v2 header, lines and lift — later plans add it page by page.

- [ ] **Step 1: Write the failing test** — every rule's selector in `finance-v2.css` starts with `[data-fin-ui]` or `body:has([data-fin-ui])` (or is `@import` / `@font-face`); the file contains the Global Constraints values for header bg, lines, lift shadow and button height; `main.tsx` imports it; the six page roots carry `data-fin-ui`; DataGrid has the four `data-dg` hooks; Button carries `data-variant` / `data-size`; `package.json` pins `@fontsource/ibm-plex-sans` to `5.3.0`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** DataGrid tables under `[data-fin-ui]`: `border-collapse: separate; border-spacing: 0`, cell lines on the cells, header `#E2E8F0` 12.5px/600 with `#CBD5E1` inner lines and a `1.5px #7A6E5E` bottom line, body 13px, footer `#F7F7F5` with a `1.5px #7A6E5E` top line, row lift on `:hover` with `position: relative; z-index: 1` (header and footer stay above), `transition: transform .15s ease, box-shadow .15s ease`. Buttons by `data-size` default/sm → 34px, radius 8px, 13px/600; `data-variant="default"` → `#1F1D1B`; `outline` → white / `#E2DDD8`. Cards radius 10px. Page background `#FAF8F4` on the content area via `body:has([data-fin-ui])`. Plain report tables are left alone in this plan.
- [ ] **Step 4: Run** test + tsc + `npx vite build` → pass.
- [ ] **Step 5: Commit** — `feat(finance-v2): scoped finance look — type, colours, lines, buttons, lift`.

### Task 8: Page title with an (i) explanation

**Files:**
- Create: `src/lib/finance-nav.ts` (titles + explanations per `?tab=`; start from `git show feat/finance-ui-refresh:src/lib/finance-nav.ts`, renamed to the v2 names — `Daily Cash Position`, `Debtor Aging`, `Creditor Aging`, …)
- Create: `src/components/finance/page-title.tsx`
- Modify: `src/pages/accounting/index.tsx` (the static "Accounting" header ~L617), `src/pages/invoices/credit-notes.tsx` (~L352), `debit-notes.tsx` (~L273), `e-invoice.tsx` (~L261), `src/pages/finance-dashboard.tsx` (~L961), `src/pages/forecast.tsx` (~L486)
- Test: `tests/finance-page-title.test.mjs`

**Interfaces:**
- Produces: `financePage(tab: string): { title: string; explain: string }` (unknown tab → `{ title: "Accounting", explain: "" }`); `FinancePageTitle({ title, explain, icon?, actions? }: { title: string; explain?: string; icon?: React.ReactNode; actions?: React.ReactNode })` — `<h1>` 22px/700, an (i) button (`Info` 16px, `#9CA3AF`, `aria-label="About this page"`) toggling a popover with `explain`, closed by Esc (`useEscapeClose`) or an outside click; no (i) when `explain` is empty.

- [ ] **Step 1: Write the failing test** — every `?tab=` key the accounting page renders has a `financePage` entry with a Title Case title; the six pages render `FinancePageTitle`; no grey sub-line under those titles any more.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test + tsc → pass.
- [ ] **Step 5: Commit** — `feat(finance-v2): page titles with an (i) explanation`.

### Task 9: Pilot on Journal Entries, docs, ship

**Files:**
- Modify: `src/pages/accounting/index.tsx` (Journals `columns` ~L3431, `<DataGrid>` ~L3598)
- Modify: `docs/CODEBASE-MAP.md` (DataGrid new props; `grid-layout.ts`; `finance-v2.css`; `finance-nav.ts`; `page-title.tsx`), `docs/WORK-TRACKER.md`
- Test: `tests/finance-v2-journals-pilot.test.mjs`; update any source test the new markup breaks

- [ ] **Step 1: Write the failing test** — the Journals grid passes `headerMenu`, `reorderableHeaders`, `exportName="Journal Entries"`; `totalDebit` and `totalCredit` have function totals over `lines` (sen) with `formatRM`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** — full suite via the commit hook; `npx tsc -p tsconfig.app.json --noEmit`; eslint on touched files; `node scripts/check-codebase-map.mjs`; `node scripts/gen-api-docs.mjs --check`; `node scripts/check-docs-freshness.mjs --base origin/main`. On the PR canary (production database — look and click only, never save/post/approve/void, and do not press `Save Layout`, which writes a row): Journal Entries shows the slate header, lift, total row, header menu, number filter and drag-reorder; another finance page and one non-finance grid (e.g. Sales Orders) look unchanged apart from type/buttons on finance pages.
- [ ] **Step 5: Commit, PR, merge** (owner 2026-10-16: ship after Claude's own verification), then verify on production read-only and record it in the tracker.
