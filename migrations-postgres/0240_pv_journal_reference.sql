-- A Reference field on payment vouchers and journal entries (owner
-- 2026-10-19 「先做 Reference 栏」): the TT / cheque no. (or, on an AP Payment
-- drawn on trade finance, the bank's drawdown no.), its own field — the
-- description stays the printed text.
--
-- ⚠ RECORD ONLY. Migrations do not auto-apply on deploy — the live schema
-- change is the runtime self-apply in src/api/routes/accounting.ts:
-- `ensurePvApColumns` (payment_vouchers) and `ensureJournalReferenceColumn`
-- (journal_entries), each awaited before the first write that names it.
ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reference TEXT;
