-- An AP Payment of foreign-currency bills (Currency & FX step 3, owner
-- 2026-10-20 「要」; plan docs/superpowers/plans/2026-10-20-currency-fx.md):
-- the voucher carries the bills' currency and the payment's rate (RM per 1
-- unit); each ticked bill carries what was paid in its own currency and
-- whether that settles all that is left (amount_sen = the booked RM it clears).
--
-- ⚠ RECORD ONLY. Migrations do not auto-apply on deploy — the live schema
-- change is the runtime self-apply in src/api/routes/accounting.ts
-- (`ensurePvApColumns`), awaited before the first write that names them.
ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS fx_currency TEXT;
ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS fx_rate DOUBLE PRECISION;
ALTER TABLE payment_voucher_allocs ADD COLUMN IF NOT EXISTS foreign_sen INTEGER;
ALTER TABLE payment_voucher_allocs ADD COLUMN IF NOT EXISTS full_pay INTEGER;
