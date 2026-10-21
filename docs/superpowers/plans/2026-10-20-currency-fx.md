# Currency & FX — implementation plan

> **Last verified: 2026-10-20** against the code read for it (`src/api/routes/supplier-payments.ts`, `src/api/routes/purchase-invoices.ts`, `src/lib/supplier-payment-alloc.ts`, `src/lib/party-finance.ts`, `src/api/routes/accounting.ts` AP Payment guard, the design handoff's Currency & FX page) and the owner's answers below.

**Goal:** the design's Setup › Currency & FX page — monthly rates per currency, the FX gain / loss accounts — wired into the documents that carry a foreign amount, then foreign bills on AP Payment and "Confirm bank amount".

**The owner's rulings (2026-10-20, four questions):**
1. A monthly rate is **only a default**: forms fill it in for the document's month, it can be changed, and every document keeps its own rate — changing the table never changes a posted document (the 2026-06-12 rule "rate keyed per document" stands).
2. FX gain and loss both post to **530-0000** for now (today's account); the page lets him split them later.
3. The yuan is **CNY** (the design's code), replacing RMB everywhere (measured on prod 2026-10-20: no document, party, price-list row or GRN holds RMB — nothing to rewrite).
4. All three steps, one after another.

**Measured on prod 2026-10-20:** no foreign-currency document anywhere (every purchase invoice MYR, no supplier payment with a foreign amount, every supplier / customer MYR, every supplier price-list and price-history row MYR, no goods in transit, GRNs with no currency). The work is for what comes next; it changes no posted figure.

## Steps (each its own PR, verified on prod read-only before the next)

1. **CNY for RMB.** `PARTY_CURRENCIES` (party masters), the supplier price list / price history / goods in transit APIs and types, the GRN landed-cost currency, with RMB read as CNY wherever a code is normalised. The three 0001_init `CHECK (currency IN ('MYR','RMB'))` constraints (`supplier_material_bindings`, `price_histories`, `goods_in_transit`) widened at runtime, catalogue-driven like `ensureEInvoiceStatuses` (e-invoices.ts), `NOT VALID`.
2. **Setup › Currency & FX page** (`?tab=fx`, Setup group after Chart of Accounts). kv `fx_settings`: currencies (code + name), monthly rates (1 unit = RM, up to 6 decimals), the gain and loss accounts (default 530-0000 both). Six months to the current one, each cell edited in place, "+ Add currency", remove a currency (its rates go; documents keep theirs), a warning when this month's rate is missing. Posting reads the two accounts (gain → CR gain account, loss → DR loss account) in supplier payments, their restate and PI Mark Paid; the bank-leg lookup skips 530-0000 and both accounts. Every change audited. The month's rate becomes the default in the Supplier Payment rate box, the GRN → PI booking rate and PI Mark Paid; the Supplier Payment list stops showing RM amounts under the foreign code.
3. **AP Payment pays foreign bills** (Payment Vouchers). The guard that sends them to the Supplier Payment page goes; a foreign bill row shows its currency amount and booking rate, the rate box defaults to the payment month's rate ("from Setup" / "edited"), "USD x × rate = RM y" and the FX gain / loss against the booking rate; the settlement goes through the existing builder (`foreignSen` / `payRate`); the voucher prints the currency, rate and RM.
4. **Confirm bank amount.** A foreign AP payment posts at approval at the estimated rate and reads "Approved · bank amount pending" until Finance keys the RM the bank debited; confirming re-states the settlement at the actual rate (rate = RM ÷ foreign, FX = booked − bank), same number. Row menu + popup; Daily Cash Position flags the pending ones.
