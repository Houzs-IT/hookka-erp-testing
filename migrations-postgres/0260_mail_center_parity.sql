-- ---------------------------------------------------------------------------
-- 0260_mail_center_parity.sql — Mail Center parity with Houzs (owner
-- 2026-11-26): reliable sending, delivery status, reply guard.
--
-- Why:
--   * a reply / new email whose first send fails is queued in outbox_emails
--     and retried; the thread entry points at that row (outbox_id) so it can
--     show "Queued, retrying" / "Not delivered";
--   * the provider's answer (Delivered / Bounced) is stored on the message
--     (delivery_status, delivery_status_at);
--   * "X is writing a reply" is one row per (thread, person), refreshed every
--     20 s by the reply box and ignored once older than 90 s.
--
-- Every statement is idempotent and the SAME DDL self-applies at runtime in
-- src/api/lib/mail-delivery-refresh.ts (ensureMailParitySchema) — migrations do
-- not auto-run on deploy here, so the routes create these on first use and
-- this file exists so a clean rebuild stands them up too.
--
-- ADAPTER RULE: every *_at column is written by the app via
-- new Date().toISOString(), so it MUST stay TEXT — never timestamptz.
-- ---------------------------------------------------------------------------

ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS outbox_id TEXT;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS delivery_status TEXT;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS delivery_status_at TEXT;
CREATE INDEX IF NOT EXISTS ix_email_messages_outbound_recent
  ON email_messages (direction, created_at);

CREATE TABLE IF NOT EXISTS mail_thread_replying (
  org_id TEXT NOT NULL DEFAULT 'hookka',
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  beat_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);
