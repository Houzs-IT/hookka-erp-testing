-- ---------------------------------------------------------------------------
-- 0253_user_sessions_device.sql — "Signed-in devices" (hardening batch
-- 2026-11-08).
--
-- RECORD ONLY — deploys do not replay migration files in this repo, so the
-- LOAD-BEARING copy of this DDL is `ensureSessionDeviceColumns` in
-- src/api/lib/user-sessions.ts. Keep the two in step.
--
--   user_agent   — browser / device string at sign-in (trimmed to 500 chars)
--   ip_address   — CF-Connecting-IP at sign-in
--   last_seen_at — ISO time, refreshed by authMiddleware on a session-cache
--                  miss when older than 15 minutes
--
-- All nullable: sessions issued before this lands simply show no device.
-- ---------------------------------------------------------------------------
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_seen_at TEXT;
