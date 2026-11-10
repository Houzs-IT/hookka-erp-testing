# Forecast P&L: materials by supplier, and Cash Flow "Hide past months" — design

> **Last verified: 2026-11-10** against `src/lib/forecast-pnl.ts`, `src/lib/cashflow-forecast.ts`, `src/lib/pnl-forecast.ts`, `src/pages/forecast.tsx`, `src/pages/accounting/index.tsx` (`CashFlowTab`), `src/api/routes/accounting.ts` (`GET` / `PUT /forecast`, `GET /forecast/suppliers`, `loadCashflowForecast`, `loadMonthlyPlForecast`, `GET /dashboard`) and read-only production data.

> Status: agreed with the owner on 2026-11-10 in three steps, each built and shipped:
> 1. 「supplier 那边还是你可以 set 根据 ratio 也可以，一个个也可以」 and 「hide past month 也一起做」 (#1266). That first build keyed one total per supplier and spread it over the materials by the supplier's recent purchases.
> 2. 「我的 hide past month 是把 docs forecast 和 P&L forecast hide 起来，actual 要 remain」 (#1272).
> 3. 「可以不可以这样，就是让他在每个categories 出现相关的supplier, 我从那边填」, then 「做」. Suppliers now sit under each material and are keyed there; the spread is gone. Sections 2 to 6 describe this.
> 4. 「每个supplier 填percentage 或amount」, then 「做」: each supplier keyed as RM or % of sales (section 9).
>
> It builds on `docs/superpowers/specs/2026-11-09-forecast-three-columns-design.md` (called "the three-columns spec" below).
> This repo is public, so this document carries no amounts and no counterparty names.
> Each decision is tagged **[owner]** or **[my call]**.

## 1. Intent

The owner keys customers one by one on the Forecast P&L (the three-columns spec, section 4) and wanted the same for suppliers: 「supplier part 我也像 customer 这样 key in amount」, with suppliers not used for a long time left off the list (「太久没使用的 supplier 就不在选项」). Both ways stay open: a material by its % (the ratio), or supplier by supplier. Then, after seeing the first build: the suppliers should appear under each material and be keyed there (「让他在每个categories 出现相关的supplier, 我从那边填」).

Separately, on Cash Flow with Forecast on: a button that hides the past months' forecasts (「先按 forecasting，然后再按不显示 past month」).

## 2. Each material, each month: by its %, or by its suppliers [owner]

- **By its %** (no supplier figure under that material that month): the material row as before, a % of sales or an RM amount.
- **By its suppliers** (any supplier figure under it that month): the material is the sum of its supplier figures, like Sales and the customer rows. The material row shows the sum greyed and cannot be typed that month. Its own % / RM stays saved and counts again once its supplier figures are cleared. [my call on keeping it]
- Each material decides on its own: one material can go by suppliers while the others keep their %. [owner's proposal as agreed]
- Nothing is spread by ratio any more: a figure counts under the material it was keyed under. [owner]
- Carriage and SST are not materials and stay keyed as before. [my call]

## 3. The Forecast P&L page [owner unless tagged]

- Each material row has a ▸. Opening it lists the suppliers that sold us that material in the window (section 4), plus any supplier keyed under it in some month (kept while it carries a figure, active or not), by name, then **Other (new suppliers)**. Each has a cell per month. It was RM only, with the % column showing the share of the month's sales; since section 9 it takes RM or %. [owner: 太久没使用的不列; my call on the window and on keeping keyed ones]
- Closed is the default on every load. A supplier with a figure in any month shows even while its material is closed. [owner]
- A new month copies the previous month's % but no supplier figures. [my call]
- A supplier keyed under a material it never sold us lately: key it under that material's Other. [my call; no "add supplier" picker for now]
- Storage: kv `forecast_pnl.months[ym].purchasesByType` = `{ "<MATERIAL>": { "<supplier id>": sen, "other": sen } }`. `PUT /forecast` keeps positive whole sen only (`cleanPurchasesByType`) and stores nothing derived. A cell can also be `{ bp }` since section 9. [my call]

## 4. Which suppliers a material lists [my call]

- **Window**: purchase invoices (confirmed, approved, part-paid or paid) dated from the 1st of the month three months before the current month, Malaysia time. On 2026-11-10 that is from 1 August, the window the owner was shown.
- **Who sold what**: those invoices' ledger legs on the material purchase accounts (the accounts the Forecast P&L folds into its material rows), debit minus credit, by supplier and by material type (`forecastMaterialType` of the account's name). A supplier with a positive amount under a material is listed under it. The ledger is what the P&L reads, so a supplier sits under the materials its purchases land on in the P&L.
- Measured on production on 2026-11-10: 19 suppliers, 35 supplier × material pairs.

## 5. Every reader takes the same figures [my call]

`forecastMonthFigures` reads the supplier figures, so the page, the Cash Flow P&L forecast column, the Monthly P&L forecast and the Finance Dashboard's forecast read the same amount per material. Supplier figures under a material the page has no row for count nowhere on the page, the Cash Flow or the Monthly P&L. The dashboard counts them, which only differs if a material account is renamed after keying.

## 6. Cash Flow [owner unless tagged]

- **P&L forecast column**, a material keyed by suppliers: each supplier's figure is paid after that supplier's own term (`paymentTerms`, the base spec's parser; Other after one month), on that material's line, the drill naming the supplier. [owner: 按供应商的 term]
- A material keyed by its %: as before (the term mix of its category's recent suppliers).
- The Docs forecast never carries Forecast P&L materials, so it does not change.

## 7. Cash Flow: Hide past months [owner]

- With Forecast on, a **Hide past months** toggle beside Forecast. Pressed: the **Docs forecast and P&L forecast columns** of the months before the statement's month go, and **their Actual column stays**. Accumulated, the statement's month and the months ahead stay whole. Excel and Print follow the screen. [owner, 2026-11-10, after the first build hid the whole month: 「我的 hide past month 是把 docs forecast 和 P&L forecast hide 起来，actual 要 remain」]
- Off on every load and whenever Forecast is switched off. [my call]

## 8. What must stay true

- A material without supplier figures reads exactly as before on every screen.
- Nothing here writes to the ledger or to any document.
- With Hide past months off, the Cash Flow forecast is exactly as before; with it on, every Actual column is still there.

## 9. Each supplier as RM or % of sales [owner unless tagged]

Asked 2026-11-10 after the owner's first supplier save: 「这个我可以填percentage 算会上去吗？就是每个supplier 填percentage 或amount」. A proposal followed, then 「做」. This section supersedes "RM only" in section 3.

- Each supplier cell has the material row's two boxes, RM and %. Typing one clears the other, and the empty box shows the other side worked out, greyed. [owner, as proposed]
- The % is of that month's sales, like the material row's own %. That is the sum of the customer rows when they are keyed. A % supplier follows the month's sales; an RM supplier stays as typed. [owner, as proposed]
- The material is the sum of its suppliers either way (section 2), and every reader takes that sum: Cash Flow pays each supplier the worked-out amount after its own term, and the Monthly P&L forecast and Finance Dashboard read the same figures. [owner, as proposed]
- A % supplier in a month without sales works out to 0. The material still counts as keyed by its suppliers, so it is 0 that month and Cash Flow pays nothing for it. [my call: "any figure keyed" decides, as for RM cells]
- Storage: each supplier in `purchasesByType` is whole sen (RM, as before) or `{ bp }` (whole basis points). `cleanPurchasesByType` keeps either when above zero and drops anything else. A sheet saved before this reads exactly as before. [my call]
