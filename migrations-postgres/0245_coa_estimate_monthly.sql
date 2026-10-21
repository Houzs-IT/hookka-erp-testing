-- "Estimate every month" on an expense or cost account (owner 2026-10-21
-- 「别在setting，在COA 可以吗？」 → 「可以，全部做」): the running month's P&L
-- shows the account at last month's amount while nothing is recorded, without
-- the three-month history the automatic rule needs (src/lib/expense-estimates.ts).
-- 1 = ticked.
--
-- ⚠ RECORD ONLY. Migrations do not auto-apply on deploy — the live schema
-- change is the runtime self-apply in src/api/routes/accounting.ts
-- (`ensureCoaEstimateColumn`), awaited before the first read or write that names it.
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS estimate_monthly INTEGER DEFAULT 0;
