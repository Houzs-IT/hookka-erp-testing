# Finance v2 — the owner's answers on the open questions — Implementation Plan

> **Last verified: 2026-10-17** against `src/lib/print-voucher.ts`, the voucher builders, `src/api/routes/accounting.ts` (`/payment-vouchers`, `/supplier-statement`, `/aging`, `/other-party-aging`, `/trade-finance`), `src/api/routes/customers.ts`, `src/api/routes/suppliers.ts`, `src/api/routes/credit-notes.ts`, `src/api/routes/delivery-returns.ts` and the design package (README, `Payment Voucher Print.dc.html`).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build what the owner approved on 2026-10-17 — the voucher print in the design's layout (option 1a with option 1b's signature boxes) and the five Debtors / Creditors features that were parked in plan 5.

**Architecture:** Six parts, each its own PR to `main`, each verified read-only on production before the next. The print is one shared renderer (`src/lib/print-voucher.ts`) fed by every document's builder; an AP payment's bill rows and balance come from one new read endpoint. Party fields are self-applied columns on the three party tables. The two aging pages merge their "other party" rows on the client from the existing `/other-party-aging` read (with a server-side month bucket), and Creditor Aging adds Trade Finance draws from the live `/trade-finance` read. The credit note from a delivery return prices its lines on the server from the invoice lines of the returned production orders.

**Tech Stack:** React 19 + TypeScript, Hono on Cloudflare Pages, Postgres through the D1-compat adapter (camelCases result columns), `node --import tsx/esm --test`.

**Spec:** `docs/superpowers/specs/2026-10-16-finance-v2-design.md` (README › Debtors / Creditors, Daily › Payment Vouchers) and the design package's `Payment Voucher Print.dc.html` (options 1a / 1b).

## Global Constraints

- The repo is public: no amounts, party names or prod figures in code, tests, commits, PRs or docs; tests use made-up figures.
- UI text is English. Money is integer sen.
- New columns are snake_case and reach prod only through a self-apply `ALTER TABLE … ADD COLUMN IF NOT EXISTS` awaited before the first write; reads are dual-keyed (`r.camelCase ?? r.snake_case`).
- Nothing is posted, saved or changed on prod by us; prod checks are read-only. The owner presses every write.
- Existing rules stay (spec, owner 2026-10-16): Trade Finance keeps its own block (setup, due dates, interest, bank charges, repay on the Supplier Payment page); interest is recorded at drawdown; knock-off is manual.
- A print block with no data on file is not printed (no empty boxes).

## Review Focus

- A posted AP payment printed later must show the bill's balance just before that payment, not today's balance — later payments must not leak into "Outstanding" or "Supplier balance before".
- A voided AP payment, a draft one (no settlement rows yet) and one with only an advance must all print without errors.
- A party saved before the new columns exist on prod must still list and open (reads must not name a column that may not exist).
- Debtor / Creditor Aging totals must still equal their sources: trade rows = `/aging`, other-party rows = `/other-party-aging`, Trade Finance rows = `/trade-finance` outstanding.
- A delivery return already turned into a credit note must not be offered again; a return line whose production order was never invoiced gets no price.

---

### Part A: Voucher print — design 1a with 1b's signature boxes

**Files:**
- Modify: `src/lib/print-voucher.ts` (renderer: logo + company line, party block with details, boxed amount, facts row, balance strip, boxed signatures, bottom line)
- Create: `src/lib/ap-payment-print.ts` (`ApPrintBill`, `ApPrintDetail`, `apBillsBlock(detail, opts)`, `billOutstandingBefore(...)`)
- Modify: builders in `src/pages/accounting/index.tsx` (PV, OR, other-party bill / payment, fund transfer, supplier discount), `src/lib/supplier-payment-voucher.ts`, `src/lib/customer-receipt.ts`, `src/pages/invoices/credit-notes.tsx`, `src/pages/invoices/debit-notes.tsx`
- Modify: `src/api/routes/accounting.ts` — `GET /ap-payment-print?paymentNo=` (voucher allocations, supplier-payment rows or other-party-payment rows → bills with supplier inv no., bill date, due date, outstanding before, paid; advance; party balance before)
- Test: `tests/print-voucher.test.mjs`, `tests/ap-payment-print.test.mjs`, re-pointed source tests (`pv-print-bill-date`, `pv-popup-form-transfer`, `payments-hub`, `finance-v2-pv-list`, `payment-allocation-numbers`)

**Interfaces:**
- Produces: `VoucherSpec` gains optional `partyDetails`, `amountBox`, `facts`, `balanceStrip` (`VoucherFact = { label; value }`) and `company.logoSrc`; `apBillsBlock(d: ApPrintDetail, { totalSen, money, docLabel, refLabel, partyWord }) → { columns, lines, totalCells, balanceStrip? }`; `GET /api/accounting/ap-payment-print?paymentNo=` → `{ success, data: ApPrintDetail & { partyKind, partyId } }`.

- [ ] Renderer in the 1a layout; boxed signatures; skip empty facts; the words inside the amount box. Test: logo, amount box, a fact with an empty value skipped, a 3-cell balance strip, one `.sig` per signature, the bottom line; existing sheet / escape / page-break tests still pass.
- [ ] Builders fill the new blocks ("Paid from" / "Deposited to" under the party; "Amount paid / received / transferred / payable"; bill no. / date as facts). An other-debtor receipt prints as a receipt (BUG-2026-10-17-310).
- [ ] `/ap-payment-print`: outstanding before = bill total − settlements on that bill by other payments dated on or before this payment (void / deleted excluded, credit-note markers and contra included); supplier balance before = the supplier statement's balance at the payment date with this payment's own rows added back; other creditor = sum of its bills' outstanding before. Pure helper unit-tested with a later payment, a same-day payment, a voided payment and a draft voucher.
- [ ] Single and batch print of AP vouchers, supplier payments and other-creditor payments load the detail first; a failed load prints the allocations without dates (batch print no longer drops the bills — BUG-2026-10-17-311).
- [ ] `GET /payment-vouchers` keeps a stored TRANSFER kind instead of overwriting it with EXPENSE (BUG-2026-10-17-309); transfers print "Transfer To <account>".
- [ ] Docs: BUG-HISTORY 309–311, BUG-CLASSES, CODEBASE-MAP, API.md; ship; prod check (read-only, print preview only).

### Part B: TIN / SST Reg. No. / Currency / Bank & account no. on parties

**Files:** `src/api/routes/customers.ts`, `src/api/routes/suppliers.ts`, `src/api/routes/accounting.ts` (other parties), `src/pages/customers.tsx`, `src/pages/procurement/supplier-form-dialog.tsx` (+ `maintenance.tsx`, `src/pages/suppliers/detail.tsx`), `src/pages/accounting/index.tsx` (`OtherPartiesTab`), `src/types/index.ts`, `src/pages/m/config/modules.ts` (supplier detail rows), e-invoice buyer TIN; `/ap-payment-print` adds `payeeBank`.

**Interfaces:** columns — customers `tin`, `sst_reg_no`, `currency` (default `MYR`), `bank_account`; suppliers `sst_reg_no`, `bank_account` (TIN = `tax_entity_tin`, BRN = `registration_no`, `currency` already there); other_parties `sst_reg_no`, `currency`, `bank_account`. JSON keys `tin`, `sstRegNo`, `currency`, `bankAccount` (suppliers keep `taxEntityTin`).

- [ ] Self-apply ensures awaited at the top of each master's POST / PUT; insert / update / row mappers carry the fields; GET reads never name a new column.
- [ ] Forms: TIN, SST Reg. No., Currency (MYR default), Bank & account no. on the three forms; supplier form also gets Registration No. and TIN (stored, never had an input).
- [ ] AP payment print shows "Payee bank" from the party; e-invoice buyer TIN reads the customer's TIN when the request carries none.
- [ ] Tests: ensure lists, mapper round-trip, form field presence; ship; prod check (read-only).

### Part C: Debtor Aging includes the other debtors

**Files:** `src/api/routes/accounting.ts` (`/other-party-aging` bills gain `mo`, the same calendar-month bucket as `/aging`), `src/pages/accounting/index.tsx` (`ARTab`), `src/lib/aging-export.ts` (sections), mobile `AgingScreen.tsx` / `m-finance-lib.ts`.

- [ ] Rows: trade customers from `/aging`, other debtors from `/other-party-aging?type=DEBTOR` bucketed by `mo`; Type column; chips All / Trade / Other debtors with counts; under All, a TRADE CUSTOMERS and an OTHER DEBTORS section with subtotals, then the grand total.
- [ ] Cards: the three trade cards unchanged; "Other debtors · 305-0000" = other-debtor outstanding, note "N parties"; Total outstanding = the rows shown.
- [ ] Opening an other debtor lists its bills; export carries both sections; the phone's Debtor Aging lists both kinds.
- [ ] Tests + prod check: trade rows/totals = `/aging`, other rows/totals = `/other-party-aging`.

### Part D: Creditor Aging — Trade Finance per drawdown, other creditors, Next Due

**Files:** `src/api/routes/accounting.ts` (`/aging` docs gain `due`; snapshot version bump), `src/pages/accounting/index.tsx` (`APTab`), `src/lib/aging-next-due.ts` (pure: `nextDue(docs, today)`, `dueTone(days)`), mobile aging.

- [ ] Rows: Trade Finance (one per open draw from `/trade-finance`, sorted by due date, bucketed by draw date), trade suppliers (`/aging`), other creditors (`/other-party-aging?type=CREDITOR`); Type column; chips All / Trade Finance / Trade / Other creditors; sections with subtotals in that order.
- [ ] Next Due: the earliest due date among a row's open bills (a draw's own due date; other-creditor bills carry none → "—"); "in N days" / "due today" / "N days overdue"; amber within 7 days, red when overdue.
- [ ] Cards: the AP control cards unchanged; "Other creditors · 405-0000"; "Overdue" = open amounts past their due date. The Trade Finance block stays below (owner 2026-10-16).
- [ ] Tests + prod check: each section equals its source; Next Due equals the earliest open due date.

### Part E: Credit Note from a Delivery Return

**Files:** `src/api/routes/credit-notes.ts` (`GET /from-return/:drId` prefill priced from invoice lines; POST accepts `deliveryReturnId`, stores it, refuses a return that already has a live note; writes the return's `credit_note_id`), `src/api/routes/delivery-returns.ts` (list exposes `creditNoteId`), `src/pages/invoices/credit-notes.tsx` ("From Delivery Return" picker on the title row → the New Credit Note form prefilled).

- [ ] Picker lists returns with returned lines that were invoiced: Return No, Date, Customer, Invoice, Items, Value, "CN issued" for returns already used (not selectable).
- [ ] Prefill: customer, invoice, reason RETURN, detail "Delivery Return <no>", one line per returned item at the invoice line's unit price (no invoice line → price left for the user, flagged).
- [ ] The existing DR detail "Return to stock" link lands on the same prefill.
- [ ] Tests (pricing join, used-return refusal) + prod check (read-only: picker lists the API's returns; nothing saved).
