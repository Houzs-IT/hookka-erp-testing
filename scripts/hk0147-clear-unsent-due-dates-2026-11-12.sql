-- ============================================================================
-- HK-0147 — clear the production Due Date on job cards whose "Sent" is unticked
-- ============================================================================
-- Ticket (Violet, 2026-11-12): "Please clear all existing due dates for orders
-- where the Sent column is unticked."
--
-- Screen:  Production → a department tab (e.g. /production/fab_cut). Columns
--          "Sent" and "Due" (src/pages/production/index.tsx, deptColumns).
--   Sent = job_cards.distributed_at   (NULL / '' = unticked)
--   Due  = job_cards.due_date         (TEXT, 'YYYY-MM-DD'; '' = "— Set —")
--
-- WHERE to run: the PRODUCTION Supabase → SQL Editor. Run the steps in order,
--               one at a time, and read each result before the next.
--
-- Scope (default below): OPEN job cards only (WAITING / IN_PROGRESS / PAUSED /
-- BLOCKED) on POs that are not COMPLETED / CANCELLED. A finished card keeps its
-- date. If the owner wants finished cards cleared too, delete the two lines
-- marked [OPEN-ONLY] in STEP 2 and STEP 3 (and re-run STEP 1b to see the extra
-- count first).
--
-- Blank is written as '' (not NULL) — the same value the SO-confirm builder
-- writes when Auto-schedule is OFF, so old and new rows look alike.
-- updated_at = NOW() so the Production page's snapshot cache refreshes.
-- ============================================================================


-- ── STEP 0 — is "Auto-schedule due dates" OFF? (read-only) ─────────────────
-- No row, or autoScheduleEnabled = true  →  new orders still get dates.
-- Turn it OFF in the app: Planning → Production Lead Times → "Auto-schedule
-- due dates". Do that BEFORE step 3, or orders confirmed in between get dates.
SELECT key, value, updated_at FROM kv_config WHERE key = 'lead-time-settings';


-- ── STEP 1 — preview (read-only) ─────────────────────────────────────────────
-- 1a. What will be cleared, per department.
SELECT jc.department_code, COUNT(*) AS cards_to_clear
FROM job_cards jc
JOIN production_orders po ON po.id = jc.production_order_id
WHERE jc.org_id = 'hookka'
  AND COALESCE(TRIM(jc.distributed_at), '') = ''
  AND COALESCE(jc.due_date, '') <> ''
  AND jc.status NOT IN ('COMPLETED', 'TRANSFERRED')
  AND po.status NOT IN ('COMPLETED', 'CANCELLED')
GROUP BY jc.department_code
ORDER BY jc.department_code;

-- 1b. All unticked cards with a date, by card status and PO status
--     (shows what the [OPEN-ONLY] lines leave alone).
SELECT jc.status AS card_status, po.status AS po_status, COUNT(*) AS cards
FROM job_cards jc
JOIN production_orders po ON po.id = jc.production_order_id
WHERE jc.org_id = 'hookka'
  AND COALESCE(TRIM(jc.distributed_at), '') = ''
  AND COALESCE(jc.due_date, '') <> ''
GROUP BY jc.status, po.status
ORDER BY 1, 2;


-- ── STEP 2 — backup (restore source) ─────────────────────────────────────────
-- Keeps every card's id and its current date. Do not drop this table until
-- the owner has confirmed the result.
CREATE TABLE hk0147_due_date_backup AS
SELECT jc.id, jc.production_order_id, jc.department_code, jc.due_date, NOW() AS backed_up_at
FROM job_cards jc
JOIN production_orders po ON po.id = jc.production_order_id
WHERE jc.org_id = 'hookka'
  AND COALESCE(TRIM(jc.distributed_at), '') = ''
  AND COALESCE(jc.due_date, '') <> ''
  AND jc.status NOT IN ('COMPLETED', 'TRANSFERRED')     -- [OPEN-ONLY]
  AND po.status NOT IN ('COMPLETED', 'CANCELLED');      -- [OPEN-ONLY]

-- Must equal the STEP 1a total:
SELECT COUNT(*) AS backed_up FROM hk0147_due_date_backup;


-- ── STEP 3 — clear (one transaction) ─────────────────────────────────────────
-- Clears exactly the backed-up rows, and only if they are still unticked
-- (a card ticked Sent between STEP 2 and now is left alone).
BEGIN;

UPDATE job_cards jc
SET due_date = '', updated_at = NOW()
FROM hk0147_due_date_backup b
WHERE jc.id = b.id
  AND COALESCE(TRIM(jc.distributed_at), '') = '';

-- After-check: must be 0. If not, ROLLBACK and ask.
SELECT COUNT(*) AS still_dated_unsent_open
FROM job_cards jc
JOIN production_orders po ON po.id = jc.production_order_id
WHERE jc.org_id = 'hookka'
  AND COALESCE(TRIM(jc.distributed_at), '') = ''
  AND COALESCE(jc.due_date, '') <> ''
  AND jc.status NOT IN ('COMPLETED', 'TRANSFERRED')     -- [OPEN-ONLY]
  AND po.status NOT IN ('COMPLETED', 'CANCELLED');      -- [OPEN-ONLY]

COMMIT;   -- or ROLLBACK;


-- ── RESTORE (only if the owner wants the dates back) ─────────────────────────
-- Puts back the saved date on every card that is still blank. A date someone
-- typed in after the clear is kept.
-- UPDATE job_cards jc
-- SET due_date = b.due_date, updated_at = NOW()
-- FROM hk0147_due_date_backup b
-- WHERE jc.id = b.id
--   AND COALESCE(jc.due_date, '') = '';

-- When the owner has signed off:
-- DROP TABLE hk0147_due_date_backup;
