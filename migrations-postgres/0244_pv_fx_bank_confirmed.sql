-- Confirm bank amount (Currency & FX step 4, owner 2026-10-20 「三步都做」;
-- plan docs/superpowers/plans/2026-10-20-currency-fx.md): a foreign-currency
-- AP Payment posts at approval at the payment's estimated rate; when Finance
-- keys the RM the bank actually debited, the settlement is re-stated at that
-- RM and the voucher records when and by whom (its fx_rate / total become the
-- actual ones). NULL = still at the estimate.
--
-- ⚠ RECORD ONLY. Migrations do not auto-apply on deploy — the live schema
-- change is the runtime self-apply in src/api/routes/accounting.ts
-- (`ensurePvApColumns`), awaited before the first read or write that names them.
ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS fx_bank_confirmed_at TEXT;
ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS fx_bank_confirmed_by TEXT;
