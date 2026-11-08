# Cash Flow forecast — design

> **Last verified: 2026-11-09** against `src/api/routes/accounting.ts`, `src/lib/cashflow-engine.ts`, `src/lib/cashflow-forecast.ts`, `src/lib/terms.ts`, `src/pages/forecast.tsx` and read-only production data.

> Status: design agreed with the owner in chat, 2026-11-06 to 2026-11-08. The owner said 做
> (build it) on 2026-11-08. Build plan: `docs/superpowers/plans/2026-11-08-cash-flow-forecast.md`.
> This repo is public, so this document carries no amounts and no counterparty names.
> The owner's handover file keeps the measured figures.
> Each decision is tagged **[owner]** (the owner decided it) or **[my call]** (Claude chose it and the owner can still change it).

## 1. Intent

The owner wants to know, month by month, **how much money will come in and how much will go out
in the coming months**. They also want to **compare the forecast with what actually happened**.
The forecast sits on the existing Cash Flow statement, not on a new page.

Today the Cash Flow tab (`/accounting?tab=cashflow`) shows actuals only, on a cash basis. Three
existing features look similar but are not this one:

- the legacy `/accounting/cash-flow` 12-week page
- Forecast P&L (`/forecast`, accrual, no cash timing)
- Daily Cash Position (one day, not a monthly statement)

## 2. Goals, non-goals, anti-goals

**Goals**
- A forecast for every month shown: receipts and payments by Cash Flow section, plus a forecast Bank c/f.
- The forecast sits beside the actual figures for the same month.
- A few future months are shown, as far as the documents reach (see section 7).

**Non-goals**
- No new entry screen. The forecast reads data that already exists: open documents, master-file
  terms, Forecast P&L and Planned payments.
- No posting. It never touches the books, the trial balance or the balance sheet.
- No stored snapshots. Past months are rebuilt "as at" their first day (see section 4).
- No filling of sales that have not been invoiced yet (先不补, see section 5).
- No raw-material purchases beyond the purchase invoices (PIs) that exist.
- No difference (actual less forecast) row or column.

**Anti-goals**
- Counting the same money twice. This covers receipts recorded but not knocked off, bills
  already covered by a document, and overdue amounts summed across months.
- A salary or expense figure that disagrees with what the owner's Forecast P&L page shows.
- Any change to the page while the toggle is off.

## 3. Where it lives and how it looks

- The forecast goes on the Cash Flow tab, in `CashFlowTab`
  (`src/pages/accounting/index.tsx`, around line 18817). The toolbar is around lines 19436–19454
  and the table around line 19505. It reads `GET /api/accounting/cashflow-statement`
  (`src/api/routes/accounting.ts`, around line 11320; the shared computation is around line 10676)
  and the pure engine in `src/lib/cashflow-engine.ts`.
- **A "Forecast" toggle in the toolbar, default off. Off means the page is exactly as today.** [owner]
- **With the toggle on, every month column splits into two columns, Actual and Forecast, across
  all the months shown.** [owner: 「一个月 oct 里面包括 actual 和 forecast，然后多月」]
  - The owner was shown a second layout, with forecast rows under the actual rows, and chose the
    two-column layout instead. Don't offer the other layout again.
  - Future months show a Forecast column only. They appear only when the selected period is the
    current month (MYT). [my call]
  - The month columns are the financial-year months (`fyMonths`), newest first. Future months
    follow the same newest-first order. [my call]
  - The Accumulated column stays Actual only. Overdue money rolls from month to month, so a
    summed forecast would double count. [my call]
  - Months up to and including the opening month show "-" in the Forecast column. [my call]
- Look and feel: use the finance v2 look (`[data-fin-ui]`), with forecast cells and headers in the
  project's forecast colour (red family `#C0392B`, dashed, `FORECAST_DASH`). The UI is 100%
  English, with loading, empty and error states. The v2 report stylesheet
  (`src/styles/finance-v2.css`) has no dark-mode rules, so the forecast cells add none either.
- Rows. All [my call]; the builder can refine how granular they are:
  - Forecast amounts show at least at section (group) level.
  - Lines that come from accounts (Forecast P&L lines) may also show at account-line level.
  - Forecast-only rows: "Overdue (past term)" under Revenue Collection and under the payment
    sections that have bills, and one "Planned payments" row.
  - Opening a forecast cell lists what makes it up: customers, suppliers or documents.
  - Actual-only lines show "-" in the Forecast column.

## 4. "As at" and months

- **Past and current months:** the forecast is what was expected as at the 1st of that month. It
  is rebuilt from the as-at aging (`GET /aging?asOf=`, `accounting.ts` around lines 562 and 663,
  `src/api/lib/aging-as-at.ts`), not from stored snapshots. [my call; the owner was told and did not object]
  - The current month's Forecast column is the comparison baseline, so it stays as at the 1st
    for the whole month, and the Bank c/f chain starts from it (section 8, owner-approved).
  - A document dated after the 1st and due in that same month, for example a C.O.D. bill, is in
    neither that month's forecast nor the chain. It shows in the Actual column. [my call]
  - For testing, the engine takes an "as at" date, so a hand check made on any day (such as the
    one in section 10) can be reproduced.
- **Future months:** computed as at today.
- **Customer and supplier terms:** use today's master terms for every month. [my call]

## 5. Receipts (Revenue Collection) [owner]

- **Basis.** Open sales invoices on the Debtor Aging basis: outstanding after receipts and
  credit/debit notes.
- **Receive month = invoice month + the customer's term in months.** The owner rejected using
  term alone or aging alone (「根据 term + aging，而不是单看一边」).
  - Example: with a 1-month term, last month's invoices are due this month. With a 2-month term,
    the invoices from two months ago are due this month.
- **Customer term.** Read `customers.creditTerms`, a free-text field that defaults to NET30.
  - The invoice due date (`nextMonthDueDate`, always the end of the next month,
    `src/lib/terms.ts`) does not use it. The forecast reads the master term, not the invoice's
    `dueDate`.
  - Parsing [my call]:
    - `NETn` → round(n / 30) months; `n DAYS` the same; `n MONTHS` → n (the field is free text)
    - `COD`, `C.O.D.` or `CASH` → 0 months, so due in the invoice month
    - blank or unreadable → 1 month, named in a footnote under the statement
- **Received but not knocked off.** Money that was received and recorded as a receipt but not yet
  allocated to an invoice is in `loadUnappliedCustomerAdvances` (`accounting.ts` around line 519).
  The Debtor Aging shows it as negative rows. The forecast nets it per customer, against that
  customer's **oldest** expected month first. [owner]
  - Netting stops at zero, and leftover credit is never a negative receipt. [my call]
  - Money that reached the bank but was never recorded is unknown to the system and is not
    netted. [owner understood this]
  - **Opening period [owner, 2026-11-09 「把这些初期的排除掉」, narrowed to 「…的收款就行」].** A
    customer receipt not knocked off and dated up to the end of the month after the opening month
    (with the May opening: up to 30 June) is not netted. Such receipts pay invoices from before
    the opening that the system does not hold yet; they wait for the customers' opening balances
    instead of lowering what current invoices are expected to bring. The invoices themselves still
    count. Supplier payments are unchanged. A footnote under the statement gives how many were
    left out and their total. [my call: the rule is by date, not by customer name, and it applies
    to every as-at aging, so past months' baselines follow it too]
- **Past term, still unpaid.** One row, "Overdue (past term)", counted in the current month. If
  it stays unpaid, next month counts it again in the same way, so it accumulates. [owner]
- **Not-yet-invoiced sales are not filled.** [owner, 先不补] So the months furthest out show only
  what is already invoiced.
- **Other debtor bills** were not discussed: treat them like customer invoices with a 1-month term,
  mirroring the Other Creditor Bill decision. [my call]

## 6. Payments

### 6.1 Money with a document [owner unless tagged]

- **Supplier PIs.** Creditor Aging basis: outstanding after payments, with unapplied supplier
  payments netted oldest-first, floored at zero.
  - **Pay month = PI month + the supplier's term in months.** The term comes from
    `suppliers.paymentTerms`, which the supplier list shows as "Terms". Its dropdown offers COD,
    NET15, NET30, NET45 and NET60; imported rows also hold `C.O.D.`. Parse it the same way as
    customer terms.
  - The legacy `suppliers.creditTerm` column (all `C.O.D.`) is ignored. `paymentTerms` is only
    displayed on the PO and PI forms and drives nothing else.
- **Other Creditor Bills:** bill month + 1 month, because they have no term field. Use
  `GET /other-party-aging?type=CREDITOR` (`accounting.ts` around line 5777).
- **Trade-finance drawdowns:** each one's outstanding principal on its own due date. The `/aging`
  response already carries `tf[].draws[]` with `dueDate` and `outstandingSen`.
  - [my call] A repayment not yet allocated to a draw (the facility owes less than its draws add
    up to) is netted against the draws oldest due date first, like an advance.
  - [my call; the owner did not object] Interest is charged at drawdown, so it is not forecast
    separately.
- **Past due, still unpaid:** "Overdue (past term)" counted in the current month, the same rule
  as receipts.
- [my call, by symmetry with receipts; the owner never stated it] Bills not received yet are not
  filled.
- [my call] Every PI is assumed to be paid from the bank, even though some are later paid through
  trade finance. The system cannot know in advance which ones.
- Section placement follows the actual statement: PI lines by material or account mapping
  (including the supplier-category map, kv `cashflow_supplier_category_map`), Other Creditor Bills
  by their line accounts, and drawdowns in Trade Finance.

### 6.2 Money without a document: salaries and general expenses, reverse-calculated [owner]

The owner's rule (「薪水和 general expense 能根据我 forecast P&L 的 ratio，然后在 cash flow 预计收到的钱，反算」):

- **Ratio.** For month M, take each Forecast P&L line's ratio to that month's forecast sales:
  - a %-keyed line → its %
  - an RM-keyed line → RM ÷ that month's forecast sales
- **Which lines.** The ratios must match exactly what the `/forecast` page computes, so salaries
  and expenses never disagree with the owner's own page:
  - Forecast P&L lines are stored in kv `forecast_pnl`: `months[ym] = { salesSen, pct: { [code]: {bp} | {amtSen} } }`.
  - Pseudo-codes `dept:<CODE>` are salaries per department; `cat:<TYPE>` are material types.
  - Apply the dept-mode supersede rule (`monthHasDeptForecast` / `forecastEntryKind` in
    `src/lib/salary-dept.ts`): in a month with any dept row, the 750-x accounts and every account
    the labour map posts to are ignored.
  - Sort lines into buckets with `pnlBucketFor` (`src/lib/pnl-bucket.ts`) plus the
    `/pnl/section-map` overrides and the `/labor/departments` buckets and `mappedAccounts`.
  - Today that logic lives inside `src/pages/forecast.tsx`. Move it into one shared pure function
    that the page and the forecast both use.
- **Lines used:** production salary dept rows, non-production salary dept rows, and operating
  expenses (OPEX_SALARIES and OPERATING_EXPENSE buckets).
- **Lines left out because no cash moves** [my call]:
  - depreciation, amortisation and written-off accounts (in the seeded chart, for example
    780-0080, 780-0090, 900-D001 and 900-I001);
  - trade-finance interest accounts (900-I004). Interest is already inside each drawdown's
    amount (`src/lib/trade-finance.ts`, `TfDraw.amountSen`), which 6.1 repays on its due date.
  - The parity check in section 10 covers the lines that are used. A footnote under the statement
    names the left-out lines as "not forecast (no cash moves)". Production has none of them keyed
    today (measured 2026-11-08 for November to January).
- **Cash amount = ratio × the total forecast receipts of month M**, meaning the Revenue Collection
  forecast including the overdue row.
- **Timing:**
  - Salaries are paid in M + 1. [owner: November salary goes out in December] Non-production
    salaries are treated the same way, and so are the OPEX_SALARIES (staff salary) accounts and
    the 750-x accounts of a month keyed without department rows. [my call]
  - Operating expenses (the OPERATING_EXPENSE bucket) are paid in M. [my call]
- **Factory overhead** (for example rent) is not scaled by receipts. It uses the Forecast P&L RM
  amount as keyed and is paid in M. [my call; the owner said 对]
- **Not used from Forecast P&L:** raw materials and purchases, SST charges and carriage. Their
  cash comes from PIs (section 6.1). [owner]
- **Section placement.** Each line goes to the Cash Flow section of its account, through owner
  overrides in kv `cashflow_account_map` and otherwise `defaultSectionFor`, with the statement's
  own defaults on top (finance-cost parent, payroll accruals, trade finance). For example, loan
  interest lands in Finance Cost. A dept row goes on that department's line in the section where
  the statement puts salary settlements (410-0010, Direct Labour by default), because the actual
  salary payments are split by department there; that keeps the forecast beside the actual. [my call]
- **No double count.** If a bill for the same account and month is already counted in 6.1, deduct
  it from the reverse-calculated amount, floored at zero. [my call]
- **Missing data.** A month with no Forecast P&L entry gets no forecast on these lines ("-"). The
  builder decides what to do when forecast sales are zero but RM lines exist; the simplest choice
  is to show the RM amount.

### 6.3 Irregular money: loan repayments, tax, capex [owner]

- Use the existing Planned payments on Daily Cash Position (table `planned_payments`: party, ref,
  `expected_date`, amount, `done_at`; `POST/DELETE /cash-position/planned`).
- Each payment goes into the month of its expected date, as one row, "Planned payments", without
  splitting into Loan, Tax or Capex. That split is a possible later addition.
- **There is no way to mark a planned payment done today.** The only writes are add and delete,
  and Daily Cash Position reads `done_at IS NULL`. The build adds a "Mark paid" control there,
  which sets `done_at`. [my call: the owner agreed to this approach after being told a plan is
  marked done once paid, so the control has to exist]
- **As at the 1st, like the bills** [my call]. A month's row holds the plans that were still unpaid
  on the 1st of that month (`done_at` empty or on or after the 1st) and expected that month or
  earlier. So a plan whose date has passed and is still not paid moves into the next month's row,
  the same rule as overdue bills, and a plan paid during the month stays in that month's
  baseline, so it can be compared with the actual.
- **Future months:** only plans not marked paid, by their expected month.
- **No double counting:** the form says Planned payments are for money with no bill and not in
  the Forecast P&L, for example loan principal, tax or capex without a bill. There is no
  automatic matching. [my call]

## 7. Horizon [my call, plus one owner decision]

- **Owner, 2026-11-08 (「显示」): show them.** A month that only known payments reach, such as a
  bill on a long term or a trade-finance due date, is shown. Its receipts are incomplete, because
  sales not invoiced yet are not filled (section 5).

- Future months run up to the furthest month that has a document-based amount: a receipt, a bill
  or a drawdown due date. Today that is about two months ahead.
- Reverse-calculated and planned amounts stop at the same horizon. Otherwise later months would
  show money going out with nothing coming in.

## 8. Bank c/f forecast [my call; the owner approved it on 2026-11-08]

- **Past months and the current month:** forecast c/f = that month's actual b/f + forecast
  receipts − forecast payments.
- **Future months:** the previous month's forecast c/f + forecast receipts − forecast payments.
- Every figure the chain uses is visible on the screen.

## 9. Data the owner must fix before go-live [owner action]

- **Supplier terms.** In production, most suppliers carry `C.O.D.`, which is not their real term.
  The owner has given the real terms for 12 suppliers: 10 to NET30 and 2 to NET60. The names are
  in the handover file. The change is made with the Supplier maintenance page's batch edit, by the
  owner or on the owner's explicit order.
- **Customer terms.** Every customer shows NET30 apart from one CASH customer, but the owner says
  some customers are on 2 months. The owner still has to say which ones.
- Everyone else keeps their master term.

## 10. How to know it works

- **Toggle off:** the statement is byte-for-byte what it is today. Fingerprint the rows and values
  for a few periods before and after.
- **Forecast P&L parity:** the ratio and amount for each line equal what `/forecast` shows for that
  month.
- **Hand check.** On 2026-11-06 the bills-only payments by term were computed by hand from
  `/aging`, PI plus Other Creditor Bill plus drawdowns, giving month totals for the next three
  months (figures in the handover file). The engine must reproduce the same totals from the same
  data.
- **Tests:** add pure-engine tests next to `tests/cashflow-engine.test.mjs`. Cover term parsing,
  oldest-first netting, the overdue row, the salary lag, the reverse calculation and the horizon.
- **Production:** verify read-only, as the project does after each deploy.

## 11. Left to the builder

- Endpoint shape: one new forecast endpoint, or an extra block on `cashflow-statement`.
- Where the pure computation lives, caching (the actual statement runs in about 0.65 s and the
  forecast should be similar), the drill UI, and how the forecast rows map onto the existing row
  keys.
- Foreign-currency bills: use the RM outstanding the aging already uses.
- How to ship it: a likely split is the engine and endpoint, then the UI.
