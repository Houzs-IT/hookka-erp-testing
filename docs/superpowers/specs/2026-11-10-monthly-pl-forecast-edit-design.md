# Monthly P&L: key the forecast in place — design

> **Last verified: 2026-11-10** against `src/pages/accounting/index.tsx` (`MonthlyPlTab`), `src/lib/pnl-matrix.ts`, `src/lib/pnl-forecast.ts`, `src/lib/forecast-pnl.ts`, `src/pages/forecast.tsx`, `src/api/routes/accounting.ts` (`/pl-monthly`, `loadMonthlyPlForecast`, `GET` / `PUT /forecast`, `/labor/departments`, `reportSnapshot`).

> Status: agreed with the owner on 2026-11-10. The owner asked 「我可以不可以把forecastP&L 自己做去现有的monthly P&L？因为我想要refer 数据」. Two options were offered: A, key the forecast in the Monthly P&L; B, show actual figures beside the Forecast P&L's cells. The owner chose A: 「我想要A, 因为我的forecast cash flow 也是在cash flow 变动」. The proposal below was confirmed by the owner (「是不是我可以理解forecast的可以在monthly pnl 点开填资料保存？」 → yes), then 「做」.
>
> This repo is public, so this document carries no amounts and no counterparty names. Each decision is tagged **[owner]** or **[my call]**.

## 1. Intent

The owner keys the forecast while looking at the actual months beside it, in the P&L's own layout. The Monthly P&L already shows the forecast beside the actual (Forecast toggle, spec `2026-11-09-forecast-three-columns-design.md` section 6), but read only. This makes those Forecast cells the place to key, the same way the Cash Flow forecast is adjusted inside Cash Flow. [owner]

## 2. Where and how [owner unless tagged]

- In the Monthly P&L (Overall), with **Forecast** on, an **Edit forecast** button. Pressed, the table switches to editing. [owner]
- Every month's **Forecast** column takes an RM amount or a % of that month's sales, like the Forecast P&L's cells: typing one side clears the other, and the empty box shows the other side worked out, greyed. Accumulated stays worked out. [owner]
- Months: the forecast months of the year shown, plus the months ahead. **Add month** adds the next month, which starts from the previous month's percentages, as on the Forecast P&L. [owner; my call on "next month" and the inheritance rule]
- **Save** stores, **Cancel** drops the changes. An unsaved banner shows while there are changes, and leaving the page asks first. [owner: Save 才存; my call on the banner and guard, as the Forecast P&L page has them]
- It is the same stored forecast (`PUT /forecast`), so the Forecast P&L page, Cash Flow and the Finance Dashboard follow. The Forecast P&L page stays, and either page can be used. [owner]

## 3. What each row keys [owner unless tagged]

- **SALES**: the month's sales, RM only, as on the Forecast P&L. **▸** opens the customers; once any customer is keyed, Sales is their sum, greyed. [owner]
- **Each raw material** (FABRIC …, the forecast's material types): RM or %. **▸** opens its suppliers, each RM or %; once any is keyed, the material is their sum, greyed. [owner]
- **CARRIAGE INWARDS** and **SST CHARGES**: RM or %. [my call: they are Forecast P&L lines]
- **Each account line** the Forecast P&L lists (direct labour, factory overhead, other income, operating expenses, salaries): RM or %. [owner]
- **Salary lines and departments**: a department's forecast sits on the account its wages post to (the labour map), as the Monthly P&L forecast already shows it. **▸** on that account opens its departments, each RM or %. The Forecast P&L's rule for a month with any department figure applies: the labour accounts and every account the labour map posts to show "—" that month (superseded), and their figure is the departments'. [owner: 工资科目展开部门; my call on keeping the Forecast P&L's supersede rule exactly]
- **A department with no posting account** shows on a line of its own (as today) and is keyed there. [my call]
- **Stock lines** (opening and closing stock, WIP, FG) and lines the Forecast P&L does not list have nothing to key. [owner]

## 4. How it is built [my call]

- **One sheet model for both pages.** `src/lib/forecast-sheet.ts` holds what the Forecast P&L page keys and saves: the cell shape, saved → sheet, sheet → stored month, the Save payload and the money checks. `src/pages/forecast.tsx` moves onto it unchanged in behaviour, and the Monthly P&L editor uses the same functions. Whatever is keyed on one page saves exactly as the other would save it.
- **One column layout for server and browser.** `forecastMatrixColumns` (`src/lib/pnl-forecast.ts`) lays out the Monthly P&L forecast columns: Accumulated actual and forecast, the months ahead, then each month's actual and forecast. The route already builds them this way; it moves into the shared function. In edit mode the browser runs it with the forecast windows worked out from the sheet as it is being typed (`forecastPnlWindow`), so every figure, total and % updates as the owner types.
- **The route serves what the browser needs.** `GET /pl-monthly?…&forecast=1&edit=1` also returns each actual column's window and the months ahead. The forecast's line structure comes from the same sources the Forecast P&L page reads: chart of accounts, section map, departments with their accounts, customers and suppliers.
- **Which cells are keyed** comes from the matrix rows (`buildPnlMatrix` tags them with their forecast key: `sales`, `cat:<TYPE>`, carriage, SST, the account code) and the forecast's own line groups. A row with no key has no box.
- **After Save** the table keeps the figures just saved. The Monthly P&L is a stored report copy, rebuilt behind the first read after a change. So when the toggle is next read, the read that may be stale says so, and the page asks again, as the Financial Dashboard does (#1280).

## 5. What must stay true

- The Monthly P&L with Edit forecast off reads exactly as before, Forecast on or off.
- The Forecast P&L page reads, keys and saves exactly as before.
- A sheet keyed on one page and saved reads the same on the other, to the sen.
- Nothing here writes to the ledger or to any document.
