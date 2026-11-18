-- HK-0164: fabric handed to outsourced sewers, tracked until Fabric Sewing is scanned complete.
-- Inert on deploy: the same statements self-apply in ensureOutsourceIssueTable.
CREATE TABLE IF NOT EXISTS outsource_issues (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL DEFAULT 'hookka',
  worker_id           TEXT NOT NULL,
  emp_no              TEXT,
  worker_name         TEXT,
  item_key            TEXT NOT NULL,
  qr_raw              TEXT NOT NULL,
  production_order_id TEXT NOT NULL,
  wip_key             TEXT,
  piece_no            INTEGER,
  total_pieces        INTEGER,
  po_no               TEXT NOT NULL,
  product_code        TEXT,
  product_name        TEXT,
  item_label          TEXT,
  status              TEXT NOT NULL DEFAULT 'INCOMPLETE' CHECK (status IN ('INCOMPLETE', 'COMPLETED')),
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by           TEXT,
  completed_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outsource_issues_item ON outsource_issues (org_id, item_key);
CREATE INDEX IF NOT EXISTS idx_outsource_issues_worker_status ON outsource_issues (worker_id, status);
CREATE INDEX IF NOT EXISTS idx_outsource_issues_order ON outsource_issues (production_order_id) WHERE status = 'INCOMPLETE';
CREATE INDEX IF NOT EXISTS idx_outsource_issues_issued_at ON outsource_issues (issued_at DESC);
