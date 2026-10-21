-- T-006 R5 — database backstop on a GRN line's invoiced quantity
-- (BUG-2026-10-20-355). Ported from staging's 0233 (renumbered: 0233 is taken
-- on main).
--
-- The app checks `invoiced_qty <= accepted_qty` before every PI write, but the
-- check and the write are separate statements, so two invoices saved at the
-- same moment can both pass and together bill more than was received. This
-- CHECK makes the second write fail (SQLSTATE 23514); the PI routes map that
-- to a 409 on create, edit and unvoid.
--
-- RECORD ONLY. Migrations do not auto-apply on deploy. The live change is the
-- runtime self-apply in ensurePiMigrations() (src/api/routes/purchase-invoices.ts).
--
-- NOT VALID: existing rows are NOT checked, so deploy cannot fail on old data;
-- new writes are. Count the old rows that would fail before running
-- `ALTER TABLE grn_items VALIDATE CONSTRAINT chk_grn_items_invoiced_qty`:
--   SELECT COUNT(*) FROM grn_items
--    WHERE invoiced_qty < 0 OR invoiced_qty > accepted_qty;
DO $$
BEGIN
  ALTER TABLE grn_items
    ADD CONSTRAINT chk_grn_items_invoiced_qty
    CHECK (invoiced_qty >= 0 AND invoiced_qty <= accepted_qty) NOT VALID;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
