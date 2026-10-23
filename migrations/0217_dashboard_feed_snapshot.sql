-- Dashboard feed cache-aside snapshot.
--
-- GET /api/dashboard/prototype and the month / quarter / year
-- GET /api/dashboard/overview only had a 60s KV copy. Once it expired
-- (6 min hard TTL) the next visitor waited for the full rebuild: ~2.8s and
-- ~2.3s, measured on staging 2026-10-22. Both now read through withSnapshot
-- with this table. One row per (feed, payload version, day); rows older than
-- two days are pruned on each rebuild.
--
-- Migrations are inert on deploy (see CLAUDE.md), so both routes also
-- runtime-ensure this table (ensureFeedSnapshotTable in
-- src/api/lib/dashboard-snapshot.ts). Same shape as
-- accounting_dashboard_snapshot (migration 0210).
CREATE TABLE IF NOT EXISTS dashboard_feed_snapshot (
  org_id TEXT NOT NULL,
  cache_key TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  built_from TEXT NOT NULL,
  built_at TEXT NOT NULL DEFAULT '',
  refresh_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, cache_key)
);
