# Finance & Forecasting v2 — design handoff (spec)

> **Last verified: 2026-10-17**: the owner's three answers added under "Owner decisions" (legal name on reports, the Balance Sheet arrangement, no CSV).

> **Last verified: 2026-10-16** against the Claude Design handoff package "Finance 和 Forecasting 功能优化" (`design_handoff_finance_v2/README.md`, downloaded by the owner 2026-10-16) and the owner's decisions in chat the same day (section "Owner decisions" at the end). The design files themselves (HTML prototypes with mock data, screenshots) are not in the repo; ask the owner for the package.

This is the designer's README, unchanged except for this title, followed by what the owner decided when it was compared with the code. Where the two disagree, **the owner decisions win**.

## Overview
A redesign of the Finance (`/accounting?tab=…`), e-Invoice and Forecasting (`/finance-dashboard`, `/forecast`) modules of the Hookka ERP, plus a mobile Finance app under `/m`. It covers every Finance tab (Reports, Daily, Monthly, Debtors, Creditors, e-Invoice, Setup) and both Forecasting pages. The goals: one consistent table system, readable reports, shorter entry flows, a calmer palette and a mobile view that only shows what each role may see.

## About the design files
The files here are **design references built in HTML**. They are prototypes that show the intended look and behaviour, not production code. Rebuild them in the existing Hookka repo (React + TypeScript, `src/pages/accounting/index.tsx`, `src/pages/forecast.tsx`, `src/pages/finance-dashboard*`, `src/pages/m/*`), using its components, API layer and permission helpers (`isNavAllowed`, `navGate`).

Every `.dc.html` opens straight in a browser (keep `support.js` and `lucide-icons.js` next to it). All data is **mock data** written inline in each file's `<script data-dc-script>` logic class (constants such as `D_GL`, `D_COA0`, `D_TF` and the `AR_D` / `AP_D` arrays). Hook each screen up to the real API rather than copying these numbers.

## Fidelity
**High-fidelity.** Colours, type, spacing, borders, hover "lift", and interactions are final. Recreate them closely using the codebase's own primitives.

## Files
- `Hookka Finance v2.dc.html`: the full desktop design (sidebar, all Finance tabs, Forecasting Dashboard, Forecast P&L, e-Invoice, Setup). Navigate with the left sidebar; route state is in `this.state.route`, and the page switch is in `renderVals()` (`isDash`, `isForecast`, `isPv`, `isRc`, `isCp`, `isMo`…). Tab bodies for Monthly / Debtors / Creditors / Setup are built in `moVals()` with the shared `mkGrid()` + `tableCols()` helpers.
- `Hookka Finance App Mobile.dc.html`: the **single mobile app** entry. It mounts the three part files below and routes between them with `onNav(app, screen)`; each part keeps its own state.
  - `Hookka Reports Mobile.dc.html`: Finance menu, Overview, P&L, Cash Flow, Balance Sheet, Debtor Aging, Creditor Aging.
  - `Hookka Cash Position Mobile.dc.html`: Daily Cash Position, with a share-as-image action.
  - `Hookka Finance Mobile.dc.html`: Finance Dashboard cards.
  - Tweaks: `platform` (iOS / Android) and `role` (Super Admin / Finance / Office / QA) to preview the permission gating.
- `Payment Voucher Print.dc.html`: A4 print layouts for the Payment Voucher, AP Payment Voucher and Receipt, including the foreign-currency version.
- `baseline/Hookka Finance.dc.html`: a 1:1 recreation of the **current** app, kept for diffing. Do not implement from it.
- `mobile-finance-permissions.md`: the agreed mobile permission rules.
- `assets/hookka-logo.png`: the logo used on vouchers.

## Global rules (apply everywhere)
1. **"PV table" standard.** Every Finance table behaves like the Payment Vouchers table:
   - double-click a row to open its detail modal;
   - row context menu (right-click), also opened from the row's ⋮;
   - **header right-click menu** holding Export Excel / Export PDF / Print / Columns (AutoCount style), so the toolbar is not crowded;
   - drag column borders to resize (with a visible divider line) and drag headers to reorder;
   - a per-column filter funnel with two tabs: **Values** (tick list with "(All)" and search) and **Condition** (range for numbers/dates, contains/equals for text);
   - Columns picker with **Set as default**, which persists widths, order and visibility;
   - checkbox multi-select for bulk Print / Export;
   - sticky header, sticky first column, and a sticky footer **total row**;
   - **no expand arrows** on rows.
   Exceptions agreed with the owner: Cash Book and the Monthly pages (Stock Take, Labour, Fixed Assets, Self-check, Corrections) have no row context menu. Daily Cash Position has resize only, with no funnel or Columns.
2. **Hover lift.** Pointing at a table row (or a dashboard chart) lifts it: `transform: translateY(-2px)` (no scale, so layout never jumps), shadow `0 8px 18px rgba(31,29,27,.16), 0 0 0 1.5px #7A6E5E`, rounded corners, and grid lines kept. A lifted row passes **under** the sticky header and total row (header/footer `z-index: 3`, row `z-index: 1`). Charts lift on their own; tables lift on their own; they are not linked.
3. **Lines, not fills, separate groups.** Month groups, the header/body boundary, the frozen first column and the outer frame use a **1.5px #7A6E5E** line. Inner cells use 1px `#E7E1D8` (body) / `#CBD5E1` (header). The frozen side column and the data cells share one line.
4. **Numbers.** Amount and its percentage(s) (RM · % sales · % prod.) sit together under one month group, centred under a merged header. Amounts are larger and bolder than percentages. Zero is shown as "-". Ledger-style balances show **credit in brackets**: `(RM 1,000.00)`.
5. **Months.** Show only months that have happened (the current month is partial). The Dashboard shows a rolling 6 months, defaulting to start in July; when a new month arrives, the oldest drops off. Switching month must not shift layout: buttons have fixed widths and labels have reserved widths.
6. **Copy.** Title Case For Labels And Buttons. Page explanations go behind an (i) icon instead of a grey sub-line. Forms have no subtitle line.
7. **Motion.** Show/hide toggles and tab switches animate (≈150–200ms ease on opacity/transform/height). Chart lines use smooth curves (monotone), not sharp corners.
8. **Mobile.** Use dropdowns instead of horizontal scroll, show one month at a time, make tap targets at least 44px, and use the iOS status bar on both platforms unless Android is chosen. **No permission = no menu row** (see the permissions file). Forecast P&L has no mobile version. Payment Voucher / Receipt entry is not on mobile.

## Design tokens
- Ink `#1F1D1B`; text `#1F2937` / `#374151`; muted `#6B7280`; faint `#9CA3AF`.
- Page `#FAF8F4`; card `#FFFFFF`; card border `#E2DDD8`; inner border `#E7E1D8`; strong line `#7A6E5E`.
- Table header bg `#E2E8F0` (cool slate) with header inner lines `#CBD5E1`; subtotal bg `#F1EEE8` (a different family from the header); total/footer bg `#F7F7F5`.
- Accent / link `#6B5C32` (hover `#574A28`); sand (single-colour charts) is used instead of yellow or blue.
- Status colours: OK `#27500A` on `#E7F0E3` / `#EAF3DE`; warning `#7A5B12` on `#FBF3E4`; error `#9A3A2D` on `#F3E8E5` / `#FBEDEC`; neutral `#4B5563` on `#EEF1F4`. Forecast line `#C0392B`-family red. Trade Finance tag: navy.
- Primary button: `#1F1D1B` bg, white text. Secondary: white bg, `#E2DDD8` border, `#1F1D1B` text. Height 34px, radius 8px, 13px/600.
- Type: IBM Plex Sans (system-ui fallback), with tabular numerals on all figures. Page title 22px/700. Section title 15px/700. Table body 13px; header 12–12.5px/600. Amount 13–13.5px/600–700; % 11–11.5px.
- Radii: cards 10px, modals 14px, inputs 8px, chips 9999px.
- Shadows: menu `0 14px 34px rgba(31,29,27,.18)`; modal `0 24px 60px rgba(31,29,27,.28)`.

## Screens and key behaviour
### Forecasting
- **Dashboard**: charts for Income Statement, Production / Non-Production Salary (RM/unit, RM/head share one colour), Cost Structure, Material Trend, Financial Ratios and Balance Sheet.
  - Multi-series charts use the categorical palette; single-series charts use one colour (sand family, not blue). The forecast line stays red.
  - Y-axis line visible, with clearer axis labels.
  - Tooltip has three aligned columns (name / amount / % sales) in stack order, a bold Total row, and a separate Forecast section.
  - Tables below the charts follow the PV-table rules plus a sticky month header and side column.
- **Forecast P&L** (desktop only):
  - Month picker and "Add Month" are combined; a new month copies the previous month's inputs, and deleting a month asks for confirmation.
  - Keyboard: arrow keys and Enter move between cells. An unsaved-changes banner and leave guard protect edits.
  - User-entered cells have a very light warm bg. Auto-calculated cells use a plain neutral style (not teal, not grey italic).
  - No account numbers in the side column. Section/subtotal labels are larger; child accounts are indented.
  - The title and the button row share one line; the table fills the width.

### Finance › Reports
- **Overview, P&L** (statement / monthly / cost structure):
  - P&L "est." cells mark fixed costs estimated from the previous month.
  - A negative-stock warning banner can be expanded into a list.
  - **Edit Layout** lets you drag accounts between groups.
  - The FY label follows Settings.
- **Cash Flow**: Edit Layout with drag-and-drop. Each supplier's uncoded / opening payments are their own row, which can be dragged into any group without changing totals or Bank C/F.
- **Balance Sheet**:
  - company switch (Hookka Industries / Hookka Penang / All Companies; "All" adds a By Company table);
  - Year-End Close card, synced with Settings;
  - levels L1–L4 and Edit Layout.
- **Trial Balance**: double-click an account to open the General Ledger filtered to it.
- **General Ledger**:
  - one block per account (header "Acc. No.: code NAME" plus DR / CR / Balance; collapsible);
  - Balance B/F row, a postings table, and a subtotal row;
  - Scope, a multi-select Accounts picker with a "By code range" prefix range and Tick, plus From / To months;
  - a single download icon offering Excel / PDF;
  - brackets for credit balances.
- **Stock Summary**: WIP total = sum of WIP by PO, and it feeds the Balance Sheet WIP line.
- Period pickers (Month / Quarter / Financial Year) are derived from Settings › Financial Year End, including transition years.

### Finance › Daily
- **Payment Vouchers**:
  - approval ladder Draft → Prepared → Checked → Approved;
  - Accrue now / pay later;
  - Duplicate;
  - A4 print, plus bulk print.
- **AP Payment** (part of PV):
  - Supplier picker you can type straight into.
  - Enter the total paid, tick the bills to knock off, and the remainder becomes an advance. Unallocated advances are shown prominently.
  - Foreign currency: bills in USD etc. use the monthly rate from Setup › Currency & FX. The RM amount is confirmed when the bank posts ("Confirm bank amount"). Amount boxes show RM large and the foreign amount small, and the PV prints in RM.
  - **TF repayment** lives here. Pick the drawdown(s) to repay; interest is entered at drawdown and spread pro-rata.
  - Description field. Duplicate, without copying knock-offs.
- **Receipts**: customer receipts and other-debtor receipts, with the same table and Duplicate rules (no knock-off copy) and A4 print.
- **Daily Cash Position** (renamed from Cash Position): per-bank cards, collapsed by default.
  - Pending lines list **receipts first, then payments**.
  - "TO REPAY" includes Trade Finance due dates.
  - Export as an image / PDF.

### Finance › Monthly
- **Journal Entries**: PV table, double-click to open, Print voucher, + New Journal Entry, Duplicate (including "duplicate as manual" for auto journals).
- **Cash Book**: PV table without the row menu; bank matching uses a pick list instead of left/right description matching.
- **Stock Take** / **Labour**: the period follows the month picker; import / post / undo.
- **Fixed Assets**: register grouped by category with subtotals (detail rows white, subtotal bg kept), and monthly depreciation grouped the same way.
  - Depreciation accounts are maintained in the COA.
  - Picking a fixed-asset account on a PV or AP Invoice opens "Add New Asset" on save.
  - PDF / Excel export.
- **Self-check**, **Corrections**: PV-table lists that link to the page that fixes each item.

### Finance › Debtors / Creditors
- **Debtor Aging**:
  - month selector;
  - Code and Company in separate columns;
  - includes other-debtor aging;
  - whole-row lift on hover;
  - no "All Companies" (company switching lives in the top bar);
  - Record Receipt removed.
- Customers and other debtors are maintained here (sidebar "+ New Party"). The detailed form follows the Sales › Customers fields plus **TIN, SST Reg. No., Currency, Bank & account no.**
- **Credit / Debit Notes**:
  - create a Credit Note from a Delivery Return;
  - row context menu and bulk Print / Export;
  - posted notes update Debtor Aging.
- **Creditor Aging**: mirrors Debtor Aging.
  - Groups: Trade Suppliers / Other Creditors / **Trade Finance**, where Trade Finance has **one row per drawdown**, sorted by due date.
  - A Next Due column: amber within 7 days, red when overdue.
- **AP Invoices**, **Other Creditors**, **Supplier Discount**. Suppliers are pulled in from Procurement › Suppliers, with the same extra fields as debtors.

### e-Invoice
- Submission list in a PV table: the column is "Uploaded To MyInvois" (blank when not uploaded), plus an XML Preview with an invoice selector.

### Setup
- **Chart of Accounts**:
  - New Account form: Section chips with a normal-balance hint, Parent first (inherits Cash Flow and P&L category), and an auto next-free Code with validation;
  - Reporting block: Cash flow and P&L category segmented controls, plus a Special type picker.
- **Currency & FX**: FX gain / loss accounts, and a monthly rate table per currency.
- **Stock Mapping**, **Opening Stock**.
- **Opening Balance**: account balances; debtor and creditor opening invoices; already-entered pre-opening invoices that can be added one at a time.
- **Audit Log**.
- **Settings**: SST rates; Financial Year End (Change Year End is Super Admin only, closed years are locked, transition-year preview); document numbering; landed cost; clean-up checks.

## Mobile app (`/m`)
- Finance menu with three sections and icons:
  - **Finance**: Finance Dashboard, Daily Cash Position.
  - **Reports**: Overview, P&L, Cash Flow, Balance Sheet.
  - **Debtors & Creditors**: Debtor Aging, Creditor Aging.
- Every row opens its screen in place. Swipe-back from the left edge; back returns to the menu.
- Rows are gated by the desktop permissions (`navGate`). Roles without access see no row.
- Daily Cash Position: banks collapsed, share-as-image.

## State to persist
User column layouts (Set as default), Dashboard palette / colour choices, the Financial Year End setting (it drives every period picker), FX monthly rates, report layouts (P&L / Cash Flow / BS group mapping), and posting status per month for Stock Take, Labour and Depreciation.

## Screenshots
`screenshots/desktop/` (one per Finance / Forecasting page, numbered in sidebar order) and `screenshots/mobile/` (menu plus each mobile screen). They were captured at a narrow preview width (~920px), so open the HTML files for true layout at desktop width. Forecast P&L is not captured; open it in `Hookka Finance v2.dc.html`.

## Assets
- `assets/hookka-logo.png`: company logo (from the user's voucher PDF).
- Icons: Lucide (`lucide-icons.js` is just a data-URI map for the prototype; use `lucide-react` in the repo).

## Owner decisions (2026-10-16, chat)

Compared with the code on `main` the same day. The design was drawn from a recreation of the app with mock data, so where it differs from a rule the owner had already set, the owner was asked:

| Design | Decision |
|---|---|
| Trade Finance repaid inside AP Payment, interest spread at repayment; drawdowns inside Creditor Aging | **Keep today's rules**: Trade Finance stays its own block; interest is recorded at drawdown. |
| "Auto knock-off oldest first", "Knock off advance" | **Knock-off stays manual.** |
| Delete "removes for good" | **Delete hides and keeps the record** (old records are never erased). |
| Monthly P&L: oldest month first, Accumulated last | **Keep**: Accumulated first, newest month first. |
| Balance Sheet company switch ("Hookka Penang") | "Hookka Penang" was only an example. A per-company sheet needs every ledger entry to carry its company, which it does not today: **deferred**, to be confirmed as its own piece of work. |
| Stock Take "Post closing stock / Undo" | Explained to the owner; default **keep today's rule** (#840: the Balance Sheet reads the P&L closing stock, no posting). |
| "Duplicate as manual" for system journals | Explained to the owner; default **keep today's rule** (system journals are not duplicated, so nothing is posted twice). |
| Monthly FX rate table, FX gain/loss account picker, "Confirm bank amount" | Not raised yet; default **keep** per-document rates and the FX difference at payment (owner decision 2026-06). |
| Release | **Each batch ships straight to production after Claude's own verification** (no canary wait). |
| Report heads: three company names in use (HOOKKA INDUSTRIES SDN BHD / HOOKKA MANUFACTURING SDN BHD / HOOKKA INDUSTRIES SDN. BHD.) | **2026-10-17: HOOKKA INDUSTRIES SDN BHD** (`COMPANY.HOOKKA.name`) on every report, screen and PDF. |
| Balance Sheet: Fixed Assets; Current Assets less Current Liabilities = Net Current Assets; Financed By (no Total Assets / Total Liabilities) | **2026-10-17: yes** — the sheet takes the design's arrangement, same sections and figures; the check compares the two sides. |
| Downloads: CSV, Excel, PDF | **2026-10-17: Excel and PDF only** — CSV removed from the finance downloads. |

**Deferred, each to be confirmed with the owner before it is built** (they need new data, new API or change the books): per-company Balance Sheet; Month / Quarter / Financial Year pickers with transition years, Change Year End and closed-year locks; aging as at a chosen month-end; TIN / SST Reg. No. / Currency / Bank on customers, suppliers and other parties; e-Invoice submission tracking (Uploaded To MyInvois, Record Result); the new Credit / Debit Note steps (from Delivery Return, Back to Draft, notes as their own aging lines — fix the statement double count first); a full Audit Log of every change; SST tax codes, per-document numbering, the new landed-cost method; "Add New Asset" when a fixed-asset account is used on a voucher; WIP by production order feeding the Balance Sheet; Trade Finance due dates in TO REPAY; separate Reference fields on vouchers and journals; editing an official receipt.

**Scope of the look:** the v2 colours, type and table rules apply to the Finance and Forecasting pages only (`[data-fin-ui]`); other modules keep theirs.

**Supersedes** the earlier refresh on PR #849 (unmerged); its Overview shipped separately as #851.
