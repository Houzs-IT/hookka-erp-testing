-- HK-0036: CNC cut list export stamps, bedframe batch markers, sofa .plt layouts.
-- Record only: the tables reach prod through ensureCutListTables
-- (src/api/lib/cnc-cut-list.ts, awaited by the /api/cnc-cut-list middleware)
-- and the cnc_templates columns through ensureMaterialColumn
-- (src/api/routes/cnc-templates.ts, awaited by that route's middleware).
-- Down: DROP TABLE cnc_cut_markers, cnc_cut_items, cnc_cut_batches;
--       ALTER TABLE cnc_templates DROP COLUMN plt_key, DROP COLUMN plt_metres;
CREATE TABLE IF NOT EXISTS cnc_cut_batches (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, exported_at TEXT NOT NULL,
  exported_by TEXT, card_count INTEGER NOT NULL DEFAULT 0,
  change_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cnc_cut_items (
  org_id TEXT NOT NULL, job_card_id TEXT NOT NULL, batch_id TEXT NOT NULL,
  exported_at TEXT NOT NULL, snap_qty INTEGER, snap_fabric TEXT,
  snap_size TEXT, snap_status TEXT, change_batch_id TEXT, change_note TEXT,
  PRIMARY KEY (org_id, job_card_id));
CREATE INDEX IF NOT EXISTS idx_cnc_cut_items_batch ON cnc_cut_items (batch_id);
CREATE INDEX IF NOT EXISTS idx_cnc_cut_items_change ON cnc_cut_items (change_batch_id);
CREATE TABLE IF NOT EXISTS cnc_cut_markers (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, batch_id TEXT NOT NULL,
  group_key TEXT NOT NULL, file_name TEXT NOT NULL, storage_key TEXT NOT NULL,
  metres DOUBLE PRECISION, size_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL, uploaded_by TEXT);
CREATE INDEX IF NOT EXISTS idx_cnc_cut_markers_batch ON cnc_cut_markers (batch_id);
ALTER TABLE cnc_templates ADD COLUMN IF NOT EXISTS plt_key TEXT;
ALTER TABLE cnc_templates ADD COLUMN IF NOT EXISTS plt_metres DOUBLE PRECISION;
