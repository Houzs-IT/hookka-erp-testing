-- HK-0149 — how much of its PO line a purchase-invoice line covers, in the PO
-- line's unit, when the line is billed in another unit (uom set).
--
-- Example: PO line 3 ROLL, invoice line 100 MTR with po_qty 2 → the PO ceiling
-- counts 2 rolls, auto stock-in receives 100 MTR and moves the PO line's
-- receivedQty by 2. NULL on every line billed in the PO line's own unit.
--
-- RECORD ONLY. Migrations do not auto-apply on deploy. The live change is the
-- runtime self-apply in ensurePiMigrations() (src/api/routes/purchase-invoices.ts).
ALTER TABLE purchase_invoice_items ADD COLUMN IF NOT EXISTS po_qty NUMERIC;
