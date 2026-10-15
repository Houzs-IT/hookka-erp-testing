-- HK-0036: what the CNC fabric cutter reported back for a FAB_CUT job card.
-- One row per job card; the card's own status is NOT touched (completion
-- cascades stay with the shop floor until the owner decides otherwise).
-- The route (src/api/routes/cnc-jobs.ts) self-applies this at runtime.
CREATE TABLE IF NOT EXISTS cnc_cut_results (
  job_card_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'hookka',
  status TEXT NOT NULL,
  cut_qty INTEGER NOT NULL DEFAULT 0,
  reported_by TEXT,
  reported_at TEXT NOT NULL
);
