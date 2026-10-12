-- 0241_pi_auto_grn_id.sql — the goods receipt a purchase invoice posted for
-- lines billed straight off a PO (BUG-2026-10-12-279, client tracker BUG-87).
--
-- RECORD ONLY — deploys do not replay migration files. The load-bearing copy is
-- `ensurePiMigrations` in src/api/routes/purchase-invoices.ts, awaited at the
-- top of the PI POST / PUT / void / unvoid.
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS auto_grn_id TEXT;
