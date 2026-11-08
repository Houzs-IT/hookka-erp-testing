# Cash Flow Forecast Implementation Plan

> **Last verified: 2026-11-08** against `src/api/routes/accounting.ts` (`/aging` 563, `/other-party-aging` 5778, `computeCashflowStatement` 10699, `/cashflow-statement` 11317, `/labor/departments` 14911, planned payments 18606–18694), `src/lib/cashflow-engine.ts`, `src/pages/forecast.tsx`, `src/pages/accounting/index.tsx` (`CashFlowTab` 18817, Daily Cash Position planned block ~15848–16115).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Forecast" toggle on the Cash Flow tab that shows, beside every month's actual figures, what was expected to come in and go out, plus a few future months and a forecast bank c/f.

**Architecture:** A pure scheduling module (`src/lib/cashflow-forecast.ts`) turns as-at agings, master terms, Forecast P&L figures and planned payments into forecast pseudo-legs. The existing statement engine (`buildStatement`) places those legs exactly like actual ledger legs (same sections, same material / department lines) into extra forecast columns. A new read-only endpoint `GET /cashflow-forecast` feeds the toggle; `GET /cashflow-statement` is not touched, so the toggle-off page is unchanged.

**Tech Stack:** TypeScript, Hono on Cloudflare Pages, Postgres via the D1-style adapter, React. Tests: `node --import tsx/esm --test tests/*.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-08-cash-flow-forecast-design.md`

## Global Constraints

- Toggle off = today's page. `GET /cashflow-statement` output must be byte-identical before and after (fingerprinted on prod).
- Every extracted helper (`/aging`, `/other-party-aging`, `/labor/departments`, the PI material weights) is a pure move: each route's JSON is byte-identical before and after (fingerprinted on prod).
- Read-only: the forecast never posts, never writes kv, never touches the ledger. Only the new Mark-paid endpoint writes (`planned_payments.done_at`).
- Money is integer sen. Ratios are applied as `Math.round(R × num / den)`, never with floats carried between steps.
- "Today" is Malaysia time: `new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)`.
- UI is 100% English. Forecast colour: `#C0392B` (spec 3). The v2 report stylesheet has no dark-mode rules, so the forecast cells add none either.
- The repo is public: no amounts and no counterparty names in code, tests, commits, PRs or docs. Measured figures go to the handover file only.
- New DB reads are dual-keyed (`r.camelCase ?? r.snake_case`).
- `npx tsc -p tsconfig.app.json --noEmit` exit 0 and the full test suite green before every push.
- Branch from `origin/main`. On the branch: no `Last verified` line on `docs/CODEBASE-MAP.md`, `docs/modules/*.md` or `docs/BUG-HISTORY.md`; never commit `docs/API.md`.
- Prod checks are read-only. The owner presses every write button; the Mark-paid write path is proven with an unknown id (404), never a real plan.

## Review Focus

1. **Ambiguous PI number.** An aging line names a PI by number only. Two PIs with the same number for one supplier must not borrow each other's materials: the line goes to that supplier's `Unallocated — <supplier>` row. Test: `piIdIndex` in Task 2.
2. **A party with only credits.** A customer or supplier whose only open lines are advances or credit notes produces no receipt or payment, never a negative one. Test: `scheduleOpenDocs` in Task 2.
3. **A past period selected.** With the period set to an earlier month, no future columns appear and the last column follows the as-at-1st rule like any other month. Test: `buildForecastLegs` in Task 3.
4. **Missing or zero-sales Forecast P&L month.** A column month with no Forecast P&L entry gets no salary or expense legs. A month with zero sales pays RM-keyed lines as keyed. Test: `buildForecastLegs` in Task 3.
5. **Mid-month document due the same month.** An invoice or bill dated after the 1st and due in the current month (C.O.D., term 0) is in neither the current Forecast column nor any future one. Test: `buildForecastLegs` in Task 3.

---

## Batch 1 — engine and endpoint

### Task 1: Shared Forecast P&L figures

The Forecast page's line classification and amount rule move into one pure module that the page and the cash forecast both use (spec 6.2, "Move it into one shared pure function").

**Files:**
- Create: `src/lib/forecast-pnl.ts`
- Modify: `src/pages/forecast.tsx:188-287` (the `lines` memo, `cogsRows`, `calc`)
- Test: `tests/forecast-pnl.test.mjs`

**Interfaces:**
- Produces:
  - `type FcEntry = number | { bp?: number; amtSen?: number }`
  - `type FcMonth = { salesSen?: number; pct?: Record<string, FcEntry> }` (the kv `forecast_pnl.months[ym]` shape)
  - `type FcAccount = { code: string; name: string; type: string; isPostable?: boolean }`
  - `type FcDept = { code: string; bucket: string }`
  - `type FcLineGroups = { materials; direct; labour; labourOvhDepts; labourExpDepts; labourAccounts; overhead; otherIncome; expenses }`, each `FcAccount[]`
  - `forecastLineGroups(accounts: FcAccount[], override: Record<string, string>, depts: FcDept[]): FcLineGroups` (the page's `lines` memo body, moved as is, `CARRIAGE` / `SST` included)
  - `forecastCogsRows(g: FcLineGroups): FcAccount[]` (the page's `cogsRows` order)
  - `forecastEntryAmount(salesSen: number, e: FcEntry | undefined): number` (legacy number = bp; `{amtSen}` truthy wins; else `{bp}`)
  - `forecastEntryRatio(salesSen: number, e: FcEntry | undefined): { num: number; den: number } | { fixedSen: number }` (bp → `{num: bp, den: 10000}`; RM-keyed with sales > 0 → `{num: amtSen, den: salesSen}`; RM-keyed with sales ≤ 0 → `{fixedSen: amtSen}`)
  - `forecastMonthFigures(m: FcMonth | undefined, g: FcLineGroups, mappedAccounts: ReadonlySet<string>): { salesSen; amt(code): number; superseded(code): boolean; cogs; gp; oi; exp; np }` (the page's `calc` arithmetic)

- [ ] **Step 1: Write the failing tests** in `tests/forecast-pnl.test.mjs` (same `register("tsx/esm")` header as `tests/cashflow-engine.test.mjs`):
  - `forecastEntryAmount`: `(1_000_000, {bp: 1540}) → 154_000`; `(1_000_000, 1540) → 154_000`; `(1_000_000, {amtSen: 300_000}) → 300_000`; `(0, {bp: 1540}) → 0`; `(1_000_000, undefined) → 0`.
  - `forecastEntryRatio`: `(1_000_000, {bp: 1000}) → {num: 1000, den: 10000}`; `(1_000_000, {amtSen: 50_000}) → {num: 50_000, den: 1_000_000}`; `(0, {amtSen: 50_000}) → {fixedSen: 50_000}`.
  - `forecastLineGroups` on a fixture of postable accounts `701-0010 PURCHASE - B.M FABRIC` and `701-0020 PURCHASE - S FABRIC` (COST), `700-1015`, `706-0000`, `750-0010` (COST), `780-0030` (COST), `900-S001` and `900-0010` (EXPENSE), `530-0010` (REVENUE), a parent `702-0000` with `isPostable: false`, and depts `PROD-A/DIRECT_LABOUR`, `OFFICE/OPEX_SALARIES`, `WH/FACTORY_OVERHEAD`: `materials` codes `["cat:FABRIC"]`, `direct` `["700-1015","706-0000"]`, `labour` `["dept:PROD-A"]`, `labourExpDepts` `["dept:OFFICE"]`, `labourOvhDepts` `["dept:WH"]`, `labourAccounts` `["750-0010"]`, `overhead` `["780-0030"]`, `otherIncome` `["530-0010"]`, `expenses` `["900-0010","900-S001"]`.
  - `forecastMonthFigures` for `{salesSen: 1_000_000, pct: {"cat:FABRIC": {bp: 3000}, "dept:PROD-A": {bp: 1000}, "750-0010": {bp: 500}, "780-0030": {amtSen: 20_000}, "900-0010": {bp: 300}, "900-S001": {bp: 200}}}` with `mappedAccounts = {"900-S001"}`: `superseded("750-0010") === true`, `superseded("900-S001") === true`, `cogs === 420_000`, `exp === 30_000`, `gp === 580_000`, `np === 550_000`.
  - Source guard: `src/pages/forecast.tsx` imports `forecastLineGroups` and `forecastMonthFigures` from `@/lib/forecast-pnl`, and no longer defines `catOf` or `const sumGuard`.
- [ ] **Step 2:** Run `node --import tsx/esm --test tests/forecast-pnl.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Create `src/lib/forecast-pnl.ts`** by moving the page code. The page keeps its string state and converts each month for the calc with a local `toFcMonth(ms: MonthState): FcMonth`: `salesSen = Math.max(0, moneyFieldToSen(salesStr) ?? 0)`; an entry with a non-empty `a` becomes `{ amtSen: moneyFieldToSen(a) ?? 0 }`, anything else `{ bp: strToBp(p ?? "") }`. `calc(ym)` becomes `forecastMonthFigures(toFcMonth(months[ym]), lines, mappedAccounts)`; every caller of `calc(...)` keeps the same field names.
- [ ] **Step 4:** Run the new tests and `tests/cashflow-engine.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `refactor(forecast): Forecast P&L line groups and amounts in src/lib/forecast-pnl.ts`.

### Task 2: Forecast schedule for documents

**Files:**
- Create: `src/lib/cashflow-forecast.ts`
- Modify: `src/lib/cashflow-engine.ts` (types and two constants only, see Interfaces)
- Test: `tests/cashflow-forecast.test.mjs`

**Interfaces:**
- Produces in `src/lib/cashflow-engine.ts` (the engine owns the shapes it consumes; `cashflow-forecast.ts` imports them as types):
  - `export const OVERDUE_LABEL = "Overdue (past term)"`, `export const PLANNED_LABEL = "Planned payments"`
  - `CfSection` gains `"PLANNED"` (label `"Planned payments"` in `SECTION_LABELS`; **not** added to `SECTION_ORDER`, so the mapping editor and every `SECTION_ORDER` loop never see it)
  - `type ForecastItem = { kind: "invoice" | "pi" | "ocb" | "odb" | "tf" | "pnl" | "planned"; party: string; ref: string; date?: string; expectedYm?: string; note?: string }`
  - `type ForecastLeg = { col: string; sen: number; accountCode?: string; section?: CfSection; label?: string; order?: number; splitKey?: string; item: ForecastItem }` (`sen`: + money in, − money out; `col` = `fc:YYYY-MM`)
  - `type ForecastColumn = { ym: string; future: boolean; blank: boolean }`
- Produces in `src/lib/cashflow-forecast.ts`:
  - `parseTermMonths(raw: string | null | undefined): { months: number; flagged: boolean }`
  - `addMonthsYm(ym: string, n: number): string`, `fcCol(ym: string): string` (`"fc:" + ym`)
  - `type OpenDoc = { kind: "invoice" | "pi" | "ocb" | "odb" | "tf"; partyId: string; partyName: string; no: string; date: string; sen: number; accountCode: string; mix?: { accountCode: string; weight: number }[]; splitKey?: string; label?: string }` (`sen` > 0 still owed, < 0 a credit; for `tf`, `date` is the due date)
  - `type ScheduledDoc = OpenDoc & { expectedYm: string; dueSen: number; termFlagged: boolean }`
  - `scheduleOpenDocs(docs: OpenDoc[], termOf: (d: OpenDoc) => { months: number; flagged: boolean }): ScheduledDoc[]` (owed lines only, after netting)
  - `docLegsForColumn(docs: ScheduledDoc[], colYm: string, mode: "baseline" | "future", isCreditorControl: (code: string) => boolean): ForecastLeg[]`
  - `piIdIndex(rows: { id: string; piNo: string; supplierId: string }[]): (supplierId: string, piNo: string) => string | null`

Rules the code must follow (spec 5 and 6.1):
- Terms: trim and upper-case. `NETn` → `Math.round(n / 30)`; `n DAY(S)` → `Math.round(n / 30)`; `n MONTH(S)` → `n`; `COD`, `C.O.D.`, `CASH` → 0. Anything else, blank included → `{ months: 1, flagged: true }`. (The DAYS and MONTHS forms are my call: the customer field is free text.)
- `expectedYm` = document month + term months.
- Netting is per `(kind family, partyId)`: invoices with that customer's credits, PIs with that supplier's, TF draws with that facility's unallocated repayment. Credits are applied to owed lines ordered by `(expectedYm, date, no)`, oldest first. `dueSen` is floored at 0 and leftover credit is dropped.
- `docLegsForColumn`, `"baseline"` (as at colYm-01): `expectedYm < colYm` gives overdue legs, `expectedYm === colYm` gives due legs, later lines give none. `"future"` (as at today): only `expectedYm === colYm`, due legs. Zero `dueSen` gives no leg.
- Signs: invoice and odb are money in; pi, ocb and tf are money out.
- Due legs:
  - invoice: `{ accountCode }` (the debtor control).
  - pi: `{ accountCode, splitKey }` (the creditor control, split by material).
  - tf: `{ accountCode, label }` (`Repaid to <lender>`).
  - ocb and odb: one leg per `mix` account, split with `splitByLargestRemainder`. An ocb part on a creditor control gets the label `Suppliers settled via <party>`. An ocb with no mix gets `{ accountCode: "405-0000", label: "<party> (other creditor)" }`. An odb with no mix gets `{ accountCode: "305-0000" }`.
- Overdue legs use the same accounts, the ocb and odb mix included, with `label: OVERDUE_LABEL, order: 98` and no `splitKey`.
- `item` carries kind, party, document number, document date and expectedYm.

- [ ] **Step 1: Write the failing tests** in `tests/cashflow-forecast.test.mjs`:
  - `parseTermMonths`: `NET30→{1,false}`, `NET60→{2,false}`, `NET45→{2,false}`, `NET15→{1,false}`, `NET0→{0,false}`, `"C.O.D."→{0,false}`, `"cod"→{0,false}`, `CASH→{0,false}`, `"30 days"→{1,false}`, `"2 Months"→{2,false}`, `""→{1,true}`, `null→{1,true}`, `"SOON"→{1,true}`.
  - `addMonthsYm("2026-11", 2) === "2027-01"`, `addMonthsYm("2026-01", -1) === "2025-12"`.
  - Netting, oldest first. Customer C1 with term 1 has invoices `S1` 2026-09-10 for 5000 and `S2` 2026-10-05 for 3000, plus an advance of −6000. Result: S1 has `expectedYm "2026-10"` and `dueSen 0`, S2 has `"2026-11"` and `2000`. No result is negative, and none comes from the advance.
  - Two-month term: an invoice dated 2026-09-30 with `months: 2` has `expectedYm "2026-11"`.
  - **Review 2:** a supplier whose only lines are −1208 and −50 gives `[]`.
  - Column pick: docs expected 2026-10, 2026-11 and 2026-12 at baseline `"2026-11"` give one overdue leg (label `OVERDUE_LABEL`, order 98) and one due leg. At future `"2026-12"` they give exactly one leg, the December one.
  - Signs and accounts:
    - An invoice due leg is +sen on its debtor control.
    - A pi due leg is −sen with its `splitKey`.
    - An ocb with mix `[{"900-0010",3},{"200-0040",1}]` for 4000 gives −3000 on 900-0010 and −1000 on 200-0040.
    - An ocb mix part on `400-0000` (with `isCreditorControl` true) carries `label "Suppliers settled via P1"`.
    - An ocb with no mix gives `{accountCode "405-0000", label "P1 (other creditor)"}`.
    - A tf due leg carries `label "Repaid to L1"`.
  - TF netting: draws with due dates 2026-12-15 (30_000) and 2027-01-10 (20_000), plus the facility's credit of −5_000, leave 25_000 due in 2026-12 and 20_000 in 2027-01.
  - **Review 1:** `piIdIndex([{id:"a",piNo:"PI-1",supplierId:"S"},{id:"b",piNo:"PI-1",supplierId:"S"},{id:"c",piNo:"PI-2",supplierId:"S"}])` returns `null` for `("S","PI-1")`, `"c"` for `("S","PI-2")` and `null` for `("T","PI-2")`.
- [ ] **Step 2:** Run it. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the types in `cashflow-engine.ts` and the functions in `cashflow-forecast.ts`. Reuse `splitByLargestRemainder` from the engine.
- [ ] **Step 4:** Run `tests/cashflow-forecast.test.mjs` and `tests/cashflow-engine.test.mjs`. Expected: PASS. The engine tests are unchanged.
- [ ] **Step 5:** Commit `feat(cashflow-forecast): term parsing and document schedule (pure)`.

### Task 3: Salaries, expenses, planned payments, horizon

**Files:**
- Modify: `src/lib/cashflow-forecast.ts`
- Test: `tests/cashflow-forecast.test.mjs`

**Interfaces:**
- Consumes: Task 1 `forecastLineGroups`, `forecastMonthFigures`, `forecastEntryRatio`, `pnlBucketFor` (`src/lib/pnl-bucket.ts`); Task 2 everything.
- Produces:
  - `type FcCashLine = { code: string; name: string; timing: "salary" | "expense" | "overhead"; ratio: { num: number; den: number } | { fixedSen: number }; amtSen: number; accountCode: string; label?: string }`
  - `forecastCashLines(m: FcMonth | undefined, g: FcLineGroups, override: Record<string, string>, mappedAccounts: ReadonlySet<string>, opts: { salaryAccount: string; nonCash: (code: string, name: string) => boolean }): { salesSen: number; lines: FcCashLine[]; excluded: { code: string; name: string; amtSen: number }[] }`
  - `type PlannedPayment = { id: string; party: string; ref: string | null; expectedDate: string; amountSen: number; doneAt: string | null }`
  - `type ForecastInput = { today: string; period: string; months: string[]; openingYm: string | null; baselines: Map<string, ScheduledDoc[]>; live: ScheduledDoc[] | null; pnl: Map<string, { salesSen: number; lines: FcCashLine[] }>; plans: PlannedPayment[]; isCreditorControl: (code: string) => boolean }` (`months` is the statement's FY months, newest first; `baselines` holds every displayed month after the opening month plus the month before the earliest one; `live` is null unless `period` is the current month)
  - `buildForecastLegs(input: ForecastInput): { columns: ForecastColumn[]; legs: ForecastLeg[]; termFlagged: string[] }` (`columns` newest first: future months, then `months`)
  - `isNonCashAccount(code: string, name: string, tfInterestCode: string): boolean` — the name matches `/DEPRECIATION|AMORTI[SZ]ATION|WRITTEN OFF|WRITE[- ]?OFF/i`, or the code equals `tfInterestCode`

Rules (spec 6.2, 6.3, 7, 8):
- `forecastCashLines` sorts the Forecast P&L lines into three cash timings.
  - **Salary** (paid in M + 1):
    - every dept row (`labour`, `labourOvhDepts`, `labourExpDepts`), with `accountCode: opts.salaryAccount` and `label: <dept code>`
    - the `labourAccounts` that are not superseded
    - `expenses` whose `pnlBucketFor` is `OPEX_SALARIES` and that are not superseded

    (OPEX_SALARIES counts as salary timing on the owner's 「薪水下个月付」. My call: this refines the spec's wording, which grouped it with operating expenses.)
  - **Expense** (paid in M): `expenses` in the `OPERATING_EXPENSE` bucket that are not superseded.
  - **Overhead** (paid in M, as keyed): `overhead` lines that are not superseded.
  - Materials, carriage, SST and other income are not used.
  - Lines whose amount is 0 are skipped, and `nonCash` lines go to `excluded`.
- `buildForecastLegs`:
  - Columns. `currentYm = today.slice(0, 7)`. A month is `blank` when `openingYm` is set and the month is ≤ `openingYm`. Future columns exist only when `period === currentYm` and `live` is set. They run from `currentYm + 1` to the horizon H, the greatest `expectedYm` with `dueSen > 0` in `live`.
  - Documents. Each non-blank month takes the baseline legs of `baselines.get(m)` for that month. Each future month takes the future legs of `live`.
  - Receipts. `R[col]` is the sum of the col's invoice and odb legs, overdue included. `R` of the month before the earliest one comes from its baseline, but that month gets no column and no legs.
  - Ratio cash: `Math.round(R × num / den)`, or `fixedSen`.
    - Expense lines of month X go in column X.
    - Overhead lines of month X go in column X at `amtSen`.
    - Salary lines of month X go in column X + 1. They are computed only when X has a Forecast P&L entry, X is after `openingYm`, and column X + 1 is displayed.
    - A future column at H + 1 or later does not exist, so the salary of H is dropped.
  - Bill deduction. The P&L leg of an account-keyed line (not a dept row) in column X is reduced by the ocb legs in the same column on the same `accountCode`, floored at 0.
  - Planned payments. Past and current column X (as at `X-01`) takes the plans with `doneAt` null or `doneAt.slice(0, 10) >= X-01`, and expected month ≤ X. A future column F takes the plans with `doneAt` null and expected month === F. Each becomes `{ section: "PLANNED", label: PLANNED_LABEL, sen: −amount }`. Using `done_at` as at the 1st is my call: it keeps the current baseline fixed for the whole month (spec 4), and it refines spec 6.3's "only payments not marked paid".
  - Every leg's `item` says how it was made, for example `note: "10.00% of Nov'26 forecast receipts"` or `"as keyed"`.
  - `termFlagged` holds the distinct party names with `termFlagged` among docs that have `dueSen > 0`.

- [ ] **Step 1: Write the failing tests** (`tests/cashflow-forecast.test.mjs`):
  - `forecastCashLines` on the Task 1 fixture with `override = {}` and `opts.salaryAccount = "410-0010"`, where `nonCash` is true for `780-0080 DEPRECIATION`:
    - `dept:PROD-A` gives `{timing "salary", accountCode "410-0010", label "PROD-A"}`.
    - `900-0010` gives `"expense"` and `780-0030` gives `"overhead"`.
    - `cat:FABRIC`, `700-1015` and `530-0010` are absent.
    - A keyed `780-0080` shows up in `excluded`.
  - `isNonCashAccount("900-I004", "INTEREST ON TRADE FINANCE", "900-I004") === true`, `isNonCashAccount("780-0090", "AMORTISATION OF X", "900-I004") === true`, `isNonCashAccount("900-0010", "UPKEEP", "900-I004") === false`.
  - `buildForecastLegs`, current month. Use `today "2026-11-08"`, `period "2026-11"`, `months ["2026-11","2026-10","2026-09"]` and `openingYm "2026-05"`. Baselines: 2026-08 with one invoice due 2026-08 for 100_000, 2026-09 and 2026-10 empty, 2026-11 with one invoice due 2026-11 for 200_000. `live` has one invoice expected 2026-12 for 80_000 and one TF draw due 2027-01 for 30_000. `pnl` for 2026-11 has sales 1_000_000 with dept PROD-A at bp 1000, 900-0010 at bp 300 and 780-0030 at a fixed 20_000. Expected:
    - Columns are `["2027-01","2026-12","2026-11","2026-10","2026-09"]`, with future true for the first two.
    - `fc:2026-11` has +200_000 receipts, −6_000 for 900-0010 and −20_000 for 780-0030.
    - `fc:2026-12` has the +80_000 receipt and the 2026-11 salary of −20_000 on label PROD-A.
    - `fc:2027-01` has the −30_000 TF leg. It has no salary leg, because 2026-12 has no Forecast P&L entry.
  - Salary lag from the extra baseline. In the same setup, `pnl` for 2026-08 has sales 1_000_000 with dept PROD-A at bp 1000. Then `fc:2026-09` has a −10_000 salary on PROD-A (10% of the 2026-08 receipts of 100_000), and no `fc:2026-08` column exists.
  - Bill deduction. One ocb in 2026-11 on 900-0010 for 4_000 leaves the expense leg at −2_000. An ocb for 8_000 leaves no expense leg, because it is floored at 0.
  - Zero sales (**review 4**). `pnl` for 2026-11 has sales 0 with 900-0010 RM-keyed at 50_000. The leg is −50_000, as keyed. A column month missing from `pnl` gets no expense, overhead or salary leg.
  - Planned payments. Each case below is one plan, with `today` 2026-11-08:

    | Plan | Expected | Paid on | Result |
    |------|----------|---------|--------|
    | A | 2026-10-20 | not paid | in `fc:2026-11` and in `fc:2026-10` |
    | B | 2026-11-25 | 2026-11-15 | in `fc:2026-11` |
    | C | 2026-10-05 | 2026-10-06 | in `fc:2026-10` only |
    | D | 2026-12-10 | not paid | in `fc:2026-12` |
    | E | 2027-03-01 | not paid | nowhere (beyond the horizon) |

    Every planned leg has `section "PLANNED"` and `label "Planned payments"`.
  - Opening. With `openingYm "2026-10"`, columns 2026-10 and 2026-09 are blank and carry no legs. Column 2026-11 gets no salary leg, because 2026-10 is not after the opening month.
  - **Review 3:** with `period "2026-10"` and `live` null, columns are `["2026-10","2026-09"]`, none of them future.
  - **Review 5:** an invoice dated 2026-11-03 with term 0 (`expectedYm "2026-11"`) appears in `live`, but not in the 2026-11 baseline. It produces no leg anywhere.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `forecastCashLines`, `isNonCashAccount` and `buildForecastLegs`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(cashflow-forecast): salaries and expenses from Forecast P&L, planned payments, horizon (pure)`.

### Task 4: Forecast columns in the statement engine

**Files:**
- Modify: `src/lib/cashflow-engine.ts` (`rmLineOrder`, `CfColumn`, `CfStatement`, `buildStatement`)
- Test: `tests/cashflow-engine-forecast.test.mjs`

**Interfaces:**
- Consumes: Task 2 types.
- Produces:
  - `CfColumn` gains `ym?: string; forecast?: boolean; future?: boolean; blank?: boolean`.
  - `CfStatement` gains `forecastSources?: Record<string, Record<string, (ForecastItem & { sen: number; ofSen?: number })[]>>`, keyed by lineKey, then column key.
  - `buildStatement(opts)` takes `forecast?: { columns: ForecastColumn[]; legs: ForecastLeg[]; rmSplit: RmSplit }`.
  - `rmLineOrder(OVERDUE_LABEL) === 98`.

Rules:
- Without `forecast`, the output is exactly today's. With it, the columns are: `__accum__`; each future column (`key fcCol(ym)`, `forecast: true, future: true`); then for each month, the actual column (`key ym`, `ym`) followed by its forecast column (`key fcCol(ym)`, `forecast: true`, `blank` copied). Labels use `monthLabel(ym)` for both columns of a month.
- Forecast legs never add to `__accum__` and never to an actual column.
- Each leg is placed by these rules, in order:
  - `section` set: that section, line `label`.
  - Otherwise, `label` set: the account's placement section, line `label`. The line keeps `accountCode` only in `TRADE_FINANCE`.
  - Otherwise, the placement is `RAW_MATERIALS` and `rmSplit[splitKey]` exists: the same split and `supplierSectionFor` path as an actual leg.
  - Otherwise: the account's own line, the same as an actual leg.
- In forecast columns:
  - `total` is the sum of the column's legs.
  - `bf` of a non-future column equals that month's actual `bf`.
  - `bf` of a future column equals the previous column's forecast `cf`. For the first future month, that is the current month's forecast column.
  - `cf = bf + total`.
  - A blank column is `null` in every row.
- `PLANNED` is emitted after `LOAN` and before `UNALLOCATED`, and only when it has a line, edit mode included.
- When `forecast` is passed, `forecastSources` records every leg's item against its lineKey and column. A split leg records its share, with `ofSen` set to the whole leg.

- [ ] **Step 0: Pin today's output first.** Before the engine changes, add a golden test to `tests/cashflow-engine-forecast.test.mjs`. It runs `buildStatement` on a fixture that covers a receipt, a split raw-material payment, a department salary split, a TF draw and repayment, and a CAPEX payment, then `assert.deepEqual`s the full output against a literal captured from the current engine. It passes now, and it must still pass after Step 3.
- [ ] **Step 1: Write the failing tests** (`tests/cashflow-engine-forecast.test.mjs`):
  - Column order: forecast columns `[{ym:"2026-12",future:true,blank:false},{ym:"2026-11",future:false,blank:false},{ym:"2026-10",future:false,blank:true}]` with `period "2026-11"` give keys `["__accum__","fc:2026-12","2026-11","fc:2026-11","2026-10","fc:2026-10"]`.
  - Same line as the actuals: one actual receipt leg on `300-0000` in 2026-11, and one forecast leg of +500 on `300-0000` in `fc:2026-11`. They share the lineKey `REVENUE_COLLECTION|<300-0000 name>`, with the actual value in the `2026-11` column and 500 in `fc:2026-11`. `__accum__` holds only the actual.
  - Overdue line: a forecast leg on `400-0000` with `label OVERDUE_LABEL` makes a flat `RAW_MATERIALS` line with no `accountCode` and no group parent.
  - Material split: a leg with `splitKey "fc:pi:1"` and `rmSplit {"fc:pi:1": [{line:"FABRIC",weight:3},{line:"FOAM",weight:1}]}` for −400 gives −300 on `RAW_MATERIALS|FABRIC` and −100 on `RAW_MATERIALS|FOAM`.
  - Bank chain: actual `bf` 2026-11 is 1_000. Forecast legs are +500 and −200 in `fc:2026-11`, and −100 in `fc:2026-12`. Expected: `fc:2026-11` has bf 1_000, total 300 and cf 1_300; `fc:2026-12` has bf 1_300, total −100 and cf 1_200; `fc:2026-10` (blank) is null in every row.
  - Planned block: one planned leg makes a `group` row `"Planned payments"` placed after any LOAN rows and before UNALLOCATED. Without such a leg there is no PLANNED row, even with `editable: true`.
  - `forecastSources["REVENUE_COLLECTION|<name>"]["fc:2026-11"]` has the receipt's item with `sen: 500`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement in `buildStatement`. Add a column-targeted `addToLine` variant for forecast legs. Keep the existing loops untouched for actual legs.
- [ ] **Step 4:** Run the new test, `tests/cashflow-engine.test.mjs` and `tests/cashflow-card.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(cashflow): forecast columns in the statement engine`.

### Task 5: Data loading, the forecast endpoint, Mark paid

**Files:**
- Modify: `src/api/routes/accounting.ts`
- Test: `tests/cashflow-forecast-route.test.mjs` (source guards)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `computeAgingData(db, orgId: string, asOf: string | null, co: CompanyFilter): Promise<{ data: { ar; ap; tf } }>`. This is the `buildAging` closure body moved out of `/aging`. The route calls it inside `withSnapshot` exactly as before.
  - `computeOtherPartyAging(db, orgId: string, type: "DEBTOR" | "CREDITOR", asOf: string | null): Promise<(Bill & { id: string })[]>`. The route strips `id` with `({ id: _id, ...b }) => b`, so its JSON is unchanged. The `SELECT` already returns `b.id`.
  - `loadLabourDepartments(db, orgId: string): Promise<{ departments: { code; account; bucket }[]; mappedAccounts: string[] }>`, the body of `/labor/departments`.
  - `loadPiMaterialWeights(db, piIds: Iterable<string>, sgOverride: Record<string, string>): Promise<(piId: string, supplier: string) => Map<string, number>>`. This moves the raw-material groups, the SKU bindings, the description match, `piItemsById` and `piWeightsFor` out of `computeCashflowStatement`. The actual path calls it with the same PI ids as today.
  - `computeCashflowStatement(db, period, editable, orgId, opts?: { traceKey?: string; forecast?: { today: string } })`. With `forecast`, it also returns `forecastSources`, `termFlagged`, `excluded`, `openingYm` and `today`.
  - `GET /api/accounting/cashflow-forecast?period=YYYY-MM[&asOf=YYYY-MM-DD]`, requiring `accounting:read`. `asOf` replaces today only when it is a valid date not after today (MYT). It returns `{ success, data: { period, today, openingYm, columns, rows, forecastSources, termFlagged, excluded } }`.
  - `POST /api/accounting/cash-position/planned/:id/paid` with body `{ paid: boolean }`, requiring `accounting:update`. It sets `done_at` to the current ISO time, or to NULL for `paid: false`. An unknown id returns 404. It emits the audit actions `planned-paid` and `planned-unpaid`.

Loading rules for the forecast branch:
- As-at dates are `${m}-01` for every FY month after `openingYm` up to the period, plus `${month before the earliest}-01` when that month is after `openingYm`. When the period is the current month, today is added; for today, pass `asOf: null`, the live view. Each date runs `computeAgingData(..., inactive company filter)` and both `computeOtherPartyAging` types.
- Run the dates with `Promise.all`, then measure. If `/cashflow-forecast` takes more than 3 s on prod, share the base reads across dates before shipping.
- `OpenDoc` sources:
  - AR docs come from the aging `ar[].docs`: positive lines are invoices and debit notes, negative lines are advances and credit notes. The account is the chart's single `SDC` account, else `"300-0000"`.
  - AP docs come from `ap[].docs`, on `AP_CONTROL` (`"400-0000"`). `splitKey` is `fc:pi:<id>` from `piIdIndex` on `SELECT id, piNo, supplierId FROM purchase_invoices`. With no id, the PI's `rmSplit` is the single line `Unallocated — <supplier>`, or `Opening creditors — <supplier>` for `pi-ob-` ids, exactly as `weightsForPayment` labels it.
  - TF docs come from `tf[].draws` (outstanding, due date) on the facility account, with label `Repaid to <lender>`. The facility credit is `max(0, −unallocatedSen)`.
  - Bill docs (ocb and odb) come from `computeOtherPartyAging`. Their `mix` is the bill's `other_party_bill_items` counterAccount weights; the control accounts are `405-0000` and `305-0000`.
- Terms come from `customers.creditTerms`, read dual-key. Supplier terms come from `suppliers.paymentTerms`. Ocb and odb are fixed at `{ months: 1 }`, TF at `{ months: 0 }`.
- Forecast P&L:
  - kv `forecast_pnl` is parsed like `GET /forecast`.
  - Accounts use the same `isPostable` that `GET /coa` returns.
  - The override comes from `getPnlSectionMap`, and departments from `loadLabourDepartments`.
  - `salaryAccount` is `LABOUR_ACCRUAL_ACCT`. `nonCash` is `isNonCashAccount(code, name, TF_INTEREST_ACCT.code)`.
- Planned payments: call `ensureCashBoardTables`, then `SELECT id, party_name, ref, expected_date, amount_sen, done_at FROM planned_payments`.
- Placement uses the statement's own `map` (after the TF, payroll, finance-cost and raw-stock defaults). `isCreditorControl` is the statement's (SCC, band 400 or 405).

- [ ] **Step 1: Write the failing source guards** (`tests/cashflow-forecast-route.test.mjs`):
  - The source matches `app.get("/cashflow-forecast"`, `computeAgingData(c.var.DB, orgId, asOf, coFilter)` inside `/aging`, `computeOtherPartyAging(`, `loadLabourDepartments(` inside `/labor/departments`, and `app.post("/cash-position/planned/:id/paid"`.
  - The `/cashflow-statement` handler body does not mention `forecast`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3a:** Make the four extractions as pure moves. Each route keeps its own snapshot, cache key and response shape. Run tsc and the existing suite. Expected: PASS, with no other change.
- [ ] **Step 3b:** Add the forecast branch of `computeCashflowStatement` and `GET /cashflow-forecast`.
- [ ] **Step 3c:** Add `POST /cash-position/planned/:id/paid`.
- [ ] **Step 4:** Run `npx tsc -p tsconfig.app.json --noEmit` (exit 0) and the full suite `node --import tsx/esm --test tests/*.test.mjs` (all pass).
- [ ] **Step 5:** Commit `feat(cashflow-forecast): GET /cashflow-forecast, as-at agings, Mark paid endpoint`.

### Task 6: Ship batch 1 and verify on prod

- [ ] **Step 1: Prod fingerprints before merge** (built-in browser, read only). Take the SHA-256 of the JSON body for each of:
  - `/api/accounting/cashflow-statement?period=` 2026-11, 2026-10 and 2026-08
  - `/api/accounting/aging` and `/aging?asOf=2026-10-01`
  - `/api/accounting/other-party-aging?type=CREDITOR`, `?type=DEBTOR` and `?type=CREDITOR&asOf=2026-10-01`
  - `/api/accounting/labor/departments`

  Note the time.
- [ ] **Step 2:** Add a WORK-TRACKER entry, newest first: the forecast, batch 1, with the asks of this session. Change the BUG-2026-11-08-419 status line to "✅ Shipped and verified on production 2026-11-08 (#1201, #1202)". Then push, open the PR to `main` and merge.
- [ ] **Step 3: After deploy (about 8 minutes).** Every fingerprint must be identical. A mismatch on a list that changed through owner activity is explained line by line, or the batch is not done.
- [ ] **Step 4: Forecast figures.** Read `/cashflow-forecast?period=2026-11`:
  - The `fc:2026-11` Revenue Collection must equal a hand sum from `/aging?asOf=2026-11-01`: invoices whose month plus the customer's term is November or earlier, netted per customer oldest first.
  - Every forecast `cf` must equal `bf + total`.
  - The forecast columns must not change any actual column: compare with the step-1 statement.
  - `/cashflow-forecast` must take no more than about 3 s.
- [ ] **Step 5: Hand-check reproduction.** A scratchpad script, not committed, runs `scheduleOpenDocs` on prod's `/aging?asOf=2026-11-06`, the Other Creditor bills and the TF draws, with the owner's 12 supplier terms from the handover file. Expected: the November (overdue included), December and January totals match the 11-06 figures in the handover, or every difference is explained by a document entered since.
- [ ] **Step 6:** Record the measured figures in the handover file only.

## Batch 2 — the page

### Task 7: Forecast toggle on the Cash Flow tab

**Files:**
- Modify: `src/pages/accounting/index.tsx` (`CashFlowTab` 18817–19586, `CfMonthlyDrillRows` 18740–18803, `CfApiData` 18804)
- Modify: `src/styles/finance-v2.css` (a `fc` cell token next to `acc`, lines 275–281)
- Test: `tests/cashflow-forecast-ui.test.mjs` (source guards)

**Interfaces:**
- Consumes: `GET /api/accounting/cashflow-forecast` (Task 5).
- Produces: `CfForecastDrillRows({ items, cols, depth })` in the same file.

Rules:
- Toggle state:
  - `const [forecast, setForecast] = useState(false)`, so the page is off after every reload.
  - A toolbar button labelled "Forecast" with a pressed look (borrow `EditLayoutToggle`'s styling), placed after `DetailLevels`.
  - The button is hidden in edit mode, and switching edit on turns forecast off.
- Data. Off: the existing `useCachedJson` URL, unchanged. On: `/api/accounting/cashflow-forecast?period=${period}`.
  - Loading: the actual table stays, with "Loading forecast…" next to the button.
  - Error: an inline line "Could not load the forecast" with a Retry button, and the actual table stays.
  - Empty (no forecast column has a value): a note "No forecast for this period".
- Header with forecast on: two rows.
  - Row 1: `Item`, then `Accumulated` with rowSpan 2, then one cell per month spanning its columns (2 for a past or current month, 1 for a future month).
  - Row 2: `Actual` / `Forecast`.
  - A forecast `th` has `data-cell` containing `fc`.
- Forecast cells have `data-cell` containing `fc`. CSS sets `color: #C0392B` on `td[data-cell~="fc"]`, and a dashed top border on `th[data-cell~="fc"]`. A blank forecast column prints "-".
- Clicking a line's drill in forecast mode shows the existing actual rows, then `CfForecastDrillRows`. That component renders one row per item, `party · ref · due Mon'YY · note`, with the amount under its forecast column.
- `CfMonthlyDrillRows` leaves forecast columns empty and builds the GL link months from non-forecast columns only.
- In forecast mode, the export labels are `"<month> Actual"` and `"<month> Forecast"`.
- Footnote in forecast mode: "Forecast (red): open documents by customer / supplier term as at the 1st of each month; salaries and expenses from Forecast P&L × forecast receipts (salaries paid the month after); planned payments. Future months run as far as documents reach." When `termFlagged` is non-empty, add "Term blank or unreadable, taken as 1 month: <names>." When `excluded` is non-empty, add "Not forecast (no cash moves): <names>."

- [ ] **Step 1: Write failing source guards.** `CashFlowTab` contains `useState(false)` for `forecast` and fetches `/api/accounting/cashflow-forecast`. `finance-v2.css` contains `td[data-cell~="fc"]` and `#C0392B`. `CfMonthlyDrillRows` filters `!c.forecast` for its months.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tsc and the full suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(cashflow): Forecast toggle with Actual / Forecast columns`.

### Task 8: Mark paid on Daily Cash Position

**Files:**
- Modify: `src/pages/accounting/index.tsx` (planned block ~15848–16115)
- Test: `tests/cashflow-forecast-ui.test.mjs`

Rules:
- Each planned row gets a "paid" action next to "del". It asks for confirmation ("Mark <party> RM x paid? It leaves the board and future forecasts."), then calls `POST /cash-position/planned/:id/paid` with `{ paid: true }` and reloads.
- The section heading hint becomes: "— money with no bill and not in Forecast P&L (loan principal, tax, capex without a bill); used by future-date projections and the Cash Flow forecast".

- [ ] **Step 1:** Write the failing source guard: the file fetches `/cash-position/planned/${id}/paid`, and the heading contains "not in Forecast P&L".
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tsc and the full suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(cash-position): Mark paid on planned payments`.

### Task 9: Ship batch 2 and verify on prod

- [ ] **Step 1:** Update the tracker entry and refresh the Cash Flow entry in `docs/CODEBASE-MAP.md` (new files and endpoint, with no `Last verified` line). Push, open the PR and merge.
- [ ] **Step 2: After deploy, toggle off.** `/accounting?tab=cashflow` shows the same text as before the deploy. Compare `get_page_text` with a capture taken before the merge.
- [ ] **Step 3: Toggle on.**
  - The columns pair up; future months show Forecast only; forecast cells are red; a blank month prints "-".
  - The figures equal the endpoint's.
  - The drill lists customers, suppliers and documents.
  - Export carries the paired labels.
  - Take a screenshot.
- [ ] **Step 4: Mark paid.** Daily Cash Position shows the "paid" action and the new hint. Prove the write path without touching a real plan: `POST` to an unknown id returns 404.
- [ ] **Step 5:** Update the handover checkpoint with the measured figures and the remaining owner items: supplier terms, which customers are on 2-month terms, and the dashboard's own copy of the Forecast P&L rule, which this plan leaves in place.
