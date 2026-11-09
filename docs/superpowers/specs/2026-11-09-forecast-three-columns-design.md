# Forecast in three columns, sales by customer, trade-finance plans, P&L forecast — design

> **Last verified: 2026-11-09** against `src/lib/cashflow-forecast.ts`, `src/lib/forecast-pnl.ts`, `src/lib/trade-finance.ts`, `src/api/routes/accounting.ts` (`GET /cashflow-forecast`, `GET` / `PUT /forecast`, `GET /trade-finance`, `GET /pl-monthly`), `src/pages/forecast.tsx`, `src/pages/accounting/index.tsx` and read-only production data.

> Status: agreed with the owner in chat on 2026-11-09, item by item, ending with 「可以」. Building waits
> for the owner's 「做」. This builds on `docs/superpowers/specs/2026-11-08-cash-flow-forecast-design.md`
> (called "the base spec" below), which stays true except where this document says otherwise.
> This repo is public, so this document carries no amounts and no counterparty names; the owner's
> handover file keeps the measured figures.
> Each decision is tagged **[owner]** (the owner decided it) or **[my call]** (Claude chose it and the
> owner can still change it).

## 1. Intent

The owner's words: 「我觉得我的 cash flow 显示的是每个月要有三个 column，一个是 live 的数据，一个是根据现有的数据算接下来一两个月的 cash flow，一个是根据我 forecast PNL 的数据反推接下来多个月的 cash flow in 和 out」, and 「我的 PNL 我也是想要把 forecast 和 live 的对比可以吗？像 cash flow 一样」.

Today the Cash Flow forecast has one Forecast column a month, built from documents (invoices, bills, trade-finance due dates) plus salaries and expenses scaled from the Forecast P&L. Documents only reach a month or two ahead. The owner also plans months further out in the Forecast P&L, and wants that plan turned into cash, side by side with the document view and with what actually happened. The same comparison is wanted on the P&L.

Four parts, built in this order (section 8):

1. Forecast P&L: sales keyed by customer (section 4).
2. Cash Flow: a third column a month, "P&L forecast" (sections 2 and 3).
3. Trade finance: planned drawdowns keyed on the Cash Flow page (section 5).
4. Monthly P&L: a Forecast toggle, forecast beside actual (section 6).

Non-goals: no ledger entries, no documents, nothing posted by any of this; no change to the actual columns of either report; no forecast for the Sofa / Bedframe product-line views.

## 2. Cash Flow: three columns a month [owner]

- With the Forecast toggle on, each month has up to three columns: **Actual**, **Docs forecast** and **P&L forecast**, under one month heading. [my call on the words; the owner called them "live", "根据现有的数据" and "根据我 forecast PNL"]
- **Docs forecast** is today's Forecast column, unchanged (base spec sections 5 to 6.4), plus the planned trade-finance drawdowns of section 5.
- **P&L forecast** is new (section 3).
- **Past months and the current month** show all three, so the owner can see which forecast came closer to the actual. [owner, after it was explained: the base spec's as-at-the-1st rule stays for the Docs forecast; the P&L forecast of a past month is simply what the plan put in that month]
- **Future months** (only on the current month's statement, as today) show Docs forecast and P&L forecast. Docs forecast stops where documents stop, as today; beyond that its cells print "-". P&L forecast reaches as far as the Forecast P&L has months, plus the collection and payment delays of section 3. Future months stop at twelve months ahead; only the repayment of a planned drawdown (section 5) may stretch them to fifteen. [my call on the caps]
- **Bank b/f and c/f** chain per forecast kind, the same rule as today: a past or current month's forecast b/f is the actual b/f; a future month's Docs b/f is the previous month's Docs c/f, and the same for P&L.
- Toggle off: the statement is exactly what it is today (the golden pin in `tests/cashflow-engine-forecast.test.mjs` stays).
- The drill under a line lists the P&L forecast items too: which Forecast P&L month and line fed the cell (for money in, which customer and term). [my call]
- Implementation note [my call]: the P&L forecast gets its own column key (`fp:YYYY-MM`) beside `fc:YYYY-MM`, so `buildStatement` places both kinds of leg the way it places today's.

## 3. The P&L forecast column [owner unless tagged]

Amounts are exactly the Forecast P&L page's figures for that month (`forecastMonthFigures` in `src/lib/forecast-pnl.ts`: a % line = the month's sales × %, an RM line = as keyed, the department supersede rule included). Unlike the Docs forecast (base spec 6.2), nothing here is scaled by receipts.

### 3.1 Money in

- Each customer's forecast sales of month S (section 4) arrive in S + that customer's term in months, read from `customers.creditTerms` with the base spec's parser (NET30 → 1, NET60 → 2, CASH or C.O.D. → 0; blank or unreadable → 1). The "Other" row arrives after 1 month. [owner]
- A month keyed only as a total, with no customer rows: the total is split by the share of each term in the customer invoices of the three complete calendar months before today. If there were none, all of it arrives after 1 month. [my call on the window and the fallback]
- Placed on the debtor control's line (TRADE DEBTORS), like the Docs forecast's receipts. No "Overdue" row: this column is a plan, not documents. [my call]
- Other-income lines of the Forecast P&L arrive in their own month, on their account's line. [my call]

### 3.2 Money out

| Forecast P&L line | Paid in |
|---|---|
| Materials (`cat:<TYPE>` rows) | Spread over the months by the terms of the suppliers that type was bought from. The weights are the PI lines of that type in the three complete calendar months before today, by amount, and each supplier's `paymentTerms`. A type with no such purchases is paid after 1 month. [owner: 按供应商的 term; my call on the window and the fallback] |
| Carriage and SST rows | The month itself. [my call] |
| Salaries: department rows (production and non-production), staff-salary and 750-x accounts, and the statutory contributions (EPF, SOCSO, EIS) | The next month. [owner] |
| Factory overhead | The month itself. [owner] |
| Other operating expenses | The month itself. [owner] |
| Depreciation, amortisation, written-off, trade-finance interest | Not forecast: no cash moves. [owner for the first three; trade-finance interest is in section 5] |

Section placement follows base spec 6.2: the owner's account map first, then the defaults; a department row on that department's salary line; a material type under Raw Materials on the purchase line of that type (the actual statement's own nesting).

### 3.3 In both forecast columns [owner]

The same amounts appear in the Docs forecast and the P&L forecast:

- Capex & financing keyed amounts (base spec 6.4).
- Planned payments (base spec 6.3).
- Trade finance: repayments of draws already made, on their due dates (base spec 6.1), and the planned drawdowns of section 5.

## 4. Forecast P&L: sales by customer [owner]

- On the Forecast P&L page (`src/pages/forecast.tsx`), under the Sales row: one row per customer, and an "Other" row for sales to customers not in the list yet. Each month has a cell per row. [owner: 「根据 customer 去 key-in 他的预计 sales」]
- In a month where any customer cell is keyed, Sales is the sum of the customer rows and cannot be typed. A month with no customer cells keeps today's single Sales input. [owner: Sales 总数自动等于各客户加起来]
- Every % line keeps reading the month's Sales, so nothing the owner keyed changes. [owner]
- Customer rows: the customers master, sorted by name; a customer keyed earlier stays listed even when inactive. [my call]
- A new month does not copy the customer cells of the previous month (it still copies the %, as today). [my call]
- Storage: kv `forecast_pnl.months[ym].salesByCustomer` = `{ "<customer id>": sen, "other": sen }`. `PUT /forecast` keeps the field, drops zeros, and writes `salesSen` = the sum whenever the field has any cell, so every reader of `salesSen` (the Finance Dashboard, base spec 6.2, `forecastMonthFigures`) reads the same total. [my call]

## 5. Trade finance: planned drawdowns [owner]

The owner's words: 「我认为应该是手动输入或调整」.

- In the Capex & financing popup, below the CAPEX and Loan groups, one block per trade-finance facility (`getTfSources`): an input row **Drawdown**, one cell a month for the same twelve months. A cell is what the owner expects the lender to pay suppliers for us that month. [owner]
- **Fill from bills** (a button): fills each month with the bills the Docs forecast expects that month from suppliers this facility has paid before (the draws' `paidSupplier`), capped so the facility's owed amount stays within its limit. The owner then changes any cell. [owner: 输入或调整]
- **Settings** in the block, per facility: tenor in days (default the facility's `tenorDays`) and interest % (default the average of interest ÷ principal over the facility's last six draws). Both can be changed. [owner; my call on "last six"]
- **Computed rows**, shown under the input row:
  - Interest (est.) = drawdown × interest %.
  - Repayment = the existing draws' outstanding on their due dates, plus each planned drawdown's principal and interest in the drawdown month + round(tenor ÷ 30) months.
  - Owed at month end.
  - Room left = the limit − owed. A negative room shows red but can still be saved, because this is a forecast. [owner]
- **What the forecast shows** (both forecast columns, the actual statement's way):
  - Drawdown month: Trade Finance "Drawdown — planned" + principal; the interest in Finance Cost on the trade-finance interest account, with the same amount + on Trade Finance. The bank does not move. [owner: 提款那个月银行不减]
  - Repayment month: Trade Finance "Repaid to <lender>" − (principal + interest). [owner: 还款那个月银行才减]
- **A plan meets the real draws** [found by the builder check, 2026-11-09]. A real draw shows up in the trade-finance aging with its own due date (base spec 6.1), and its repayment must not be counted twice:
  - **The plan's own month always shows the plan as keyed**, in both forecast columns, current month and past months alike; the Actual column shows what was really drawn. [owner, 2026-11-09: 「我看的是 forecast 啊？本身应该还是 remain 100k？」]
  - **Repayments in later months**: the real draws on their own due dates (from today's aging), plus, for a plan of the current month, only the part not drawn yet (plan − the facility's real draws dated this month, floored at zero). A plan of a future month repays in full. A past month's plan produces no repayment: what was really drawn is in the aging. [my call]
  - The popup shows the twelve months from the current month; past plans are kept, not shown, and need no clearing.
  - "Fill from bills" reads today's aging for every month, the current one included, so a bill already paid or drawn since the 1st is not filled again. [my call]
- To roll a draw over, the owner keys a new drawdown in its repayment month. [my call; no separate roll-over control]
- Storage: kv `cashflow_forecast_tf` = `{ facilities: { "<facility account code>": { tenorDays?, rateBp?, months: { "YYYY-MM": sen } } } }`. The PUT is audited and refuses an account that is not a trade-finance source. [my call]
- A repayment month stretches the future months as a keyed amount does, up to fifteen months ahead (twelve keyable months plus a tenor). [my call]

## 6. Monthly P&L: forecast beside actual [owner]

- A Forecast toggle on the Monthly P&L view (`MonthlyPlTab`, `GET /pl-monthly`), off on every load, as on Cash Flow. Shown for the Overall product line only. [owner for the toggle; my call on the rest]
- On: each month has **Actual** and **Forecast** columns. Forecast is that month of the Forecast P&L:
  - Sales on the sales group (the total; the customer rows stay on the Forecast P&L page). [my call]
  - Materials by type, the way the Forecast P&L keys them. The report has one purchase group per account (for example three fabric groups), so with Forecast on, each type with more than one group gets a type row above its groups, carrying Actual = the sum of its groups and Forecast = the type's figure; a type with one group compares on that group's row. [my call; found by the builder check]
  - **A department salary row on the account its wages post to** (the labour map, `GET /labor/departments` → `account`), so each forecast sits beside the actual money. An account line on its own account row. [my call, after the owner's 「这些不是在 COGS 吗？」 was checked]
    - Measured on production 2026-11-09: every department posts to the production salaries account in COGS, the non-production ones included (the forecast page files those under its non-production section, which also counts in COGS, owner 2026-08-29 / 08-31), except one, which posts to the staff salaries account under Operating Expenses. My first answer to the owner said all non-production departments sat under Operating Expenses; that was read off the department bucket, not the posting account, and was wrong.
    - So the forecast matches the page everywhere except that one department, whose forecast moves from COGS to Operating Expenses here.
  - Net profit equals the Forecast P&L page's `np` for that month to the sen. Gross profit equals the page's `gp` plus the forecast of any department whose posting account is outside COGS; Total expenses changes by the same amount. [my call; this is the parity test]
  - A month with no Forecast P&L prints "-".
- **Future months**, as on Cash Flow (「像 cash flow 一样」): with Forecast on, the months after the current one show Forecast only, as far as the Forecast P&L has months and at most twelve months ahead, also past the financial-year end. [owner's words; my call on the cap]
- The Accumulated column gets an Actual and a Forecast part, over the same months (the start of the financial year to the current month), so the two compare like for like; future months are not in it. Forecast cells use the Cash Flow forecast's red. [my call]
- Toggle off: the view is exactly what it is today.

## 7. What must stay true

- Nothing in this document writes to the ledger or to any document.
- The actual columns of Cash Flow and Monthly P&L do not change, toggle on or off.
- With nothing new keyed (no customer cells, no planned drawdowns), the Docs forecast equals today's Forecast column to the sen.
- The Forecast P&L page shows the same figures as before for every month without customer cells.

## 8. Batches [my call]

1. Sales by customer on the Forecast P&L (page, `PUT /forecast`, the sum rule).
2. The P&L forecast column on Cash Flow (engine, statement, page, drill).
3. Trade-finance planned drawdowns (popup block, kv, legs in both forecast columns).
4. Monthly P&L Forecast toggle.

Each batch ships on its own and is verified on production on the read side. Production writes are the owner's (their first Save); until then the write path is marked unverified.

## 9. Left to the builder

Column widths and labels within the finance v2 look, the drill's wording, how the term mixes and the Forecast P&L figures are computed once per request, and the tests for each batch (including a pin that every toggle-off view is unchanged).
