-- The e-Invoice record gains REJECTED ("Rejected by LHDN") — owner 2026-10-19
-- 「1 做」, the design's MyInvois tracking. The status CHECK from 0001 only knew
-- PENDING / SUBMITTED / VALID / INVALID / CANCELLED.
--
-- ⚠ RECORD ONLY. Migrations do not auto-apply on deploy — the live change is
-- the runtime self-apply `ensureEInvoiceStatuses` in
-- src/api/routes/e-invoices.ts, awaited at the top of PUT /api/e-invoices/:id.
-- It reads the CHECK's real name from pg_constraint before dropping it (the
-- name below is Postgres's default for the 0001 inline CHECK, not a measured
-- one). NOT VALID: existing rows are not re-checked, new writes are.
ALTER TABLE e_invoices DROP CONSTRAINT IF EXISTS e_invoices_status_check;
ALTER TABLE e_invoices ADD CONSTRAINT e_invoices_status_chk_v2
  CHECK (status IN ('PENDING','SUBMITTED','VALID','INVALID','REJECTED','CANCELLED')) NOT VALID;
