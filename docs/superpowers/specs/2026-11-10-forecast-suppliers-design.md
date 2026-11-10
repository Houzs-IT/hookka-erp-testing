# Forecast P&L: materials by supplier, and Cash Flow "Hide past months" — design

> **Last verified: 2026-11-10** against `src/lib/forecast-pnl.ts`, `src/lib/cashflow-forecast.ts`, `src/lib/pnl-forecast.ts`, `src/pages/forecast.tsx`, `src/pages/accounting/index.tsx` (`CashFlowTab`), `src/api/routes/accounting.ts` (`GET` / `PUT /forecast`, `loadCashflowForecast`, `loadMonthlyPlForecast`, `GET /dashboard`) and read-only production data.

> Status: proposed to the owner on 2026-11-10 and agreed: 「supplier 那边还是你可以 set 根据 ratio 也可以，一个个也可以」 and 「hide past month 也一起做」.
> It builds on `docs/superpowers/specs/2026-11-09-forecast-three-columns-design.md` (called "the three-columns spec" below).
> This repo is public, so this document carries no amounts and no counterparty names.
> Each decision is tagged **[owner]** or **[my call]**.

## 1. Intent

The owner keys customers one by one on the Forecast P&L (the three-columns spec, section 4) and wanted the same for suppliers: 「supplier part 我也像 customer 这样 key in amount」, with suppliers not used for a long time left off the list (「太久没使用的 supplier 就不在选项」). Then: 「supplier 先根据 ratio 吧」 and 「你可以 set 根据 ratio 也可以，一个个也可以」. Both ways stay open, month by month.

Separately, on Cash Flow with Forecast on: a button that hides the months already past (「先按 forecasting，然后再按不显示 past month」).

## 2. Materials: by ratio, or one by one [owner]

- **By ratio** (a month with no supplier cell): the material rows as today, each type a % of sales or an RM amount.
- **One by one** (a month with any supplier cell): the month's materials are the sum of its supplier cells, like Sales and the customer rows. Each supplier's amount spreads over the material rows by what that supplier sold us lately (section 4). The material rows show the result greyed and cannot be typed in that month. Their own % / RM stay saved and come back if the month's supplier cells are all cleared. [my call on keeping them]
- Carriage and SST are not materials and stay keyed as today in both ways. [my call]

## 3. The Forecast P&L page [owner unless tagged]

- Inside RAW MATERIALS / PURCHASES, above the material rows, a **By supplier** block: one row per supplier, then **Other (new suppliers)**. A cell per month, RM only; the % column shows the share of the month's sales.
- Listed: active suppliers we bought raw materials from in the window (section 4), plus any supplier keyed in some month (kept while it carries a figure, active or not), by name. [owner: 太久没使用的不列; my call on the window and on keeping keyed ones]
- Like the customer rows: empty supplier rows hide with "Hide empty lines"; a new month copies the previous month's % but not its supplier cells. [my call]
- Storage: kv `forecast_pnl.months[ym].purchasesBySupplier` = `{ "<supplier id>": sen, "other": sen }`. `PUT /forecast` keeps positive whole sen only and stores nothing derived: the spread is worked out when read, from the current purchases. [my call]

## 4. The spread: what each supplier sold us lately [my call]

- **Window**: purchase invoices (confirmed, approved, part-paid or paid) dated from the 1st of the month three months before the current month to today, Malaysia time. On 2026-11-10 that is 1 August to 10 November, the window the owner was shown.
- **Weights**: those invoices' ledger legs on the material purchase accounts (the accounts the Forecast P&L folds into its material rows), debit minus credit, by supplier and by material type (`forecastMaterialType` of the account's name). The ledger is what the P&L reads, so a supplier's split matches where its purchases land on the P&L.
- **Spread**: largest remainder, so the parts add up to the cell to the sen. A supplier with no material purchase in the window, and the Other row, take all suppliers' weights together. With no purchase at all in the window, everything goes on the OTHERS row (else the first material row), so the month's total is never lost.

## 5. Every reader takes the same spread [my call]

`forecastMonthFigures` takes the weights, so the page, the Cash Flow P&L forecast column, the Monthly P&L forecast and the Finance Dashboard's forecast all read the same amounts per type and the same total. The weights come from one loader on the server and from `GET /forecast/suppliers` on the page.

## 6. Cash Flow [owner unless tagged]

- **P&L forecast column**, a one-by-one month: each supplier's amount is paid after that supplier's own term (`paymentTerms`, the base spec's parser; Other after one month), on the material type lines its spread gives, the drill naming the supplier. [owner: 按供应商的 term]
- A by-ratio month: as today (each type by the term mix of its category's recent suppliers).
- The Docs forecast never carries Forecast P&L materials, so it does not change.

## 7. Cash Flow: Hide past months [owner]

- With Forecast on, a **Hide past months** toggle beside Forecast. Pressed: the months before the statement's month go, all their columns. Accumulated, the statement's month and the months ahead stay. Excel and Print follow the screen.
- Off on every load and whenever Forecast is switched off. [my call]

## 8. What must stay true

- A month without supplier cells reads exactly as before on every screen.
- Nothing here writes to the ledger or to any document.
- With Hide past months off, the Cash Flow forecast is exactly as before.
