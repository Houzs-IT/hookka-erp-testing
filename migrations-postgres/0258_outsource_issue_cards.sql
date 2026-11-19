-- HK-0164 rev 3: an outsource issue covers job cards of the worker's own department, not only Fabric Sewing.
-- Inert on deploy: the same statements self-apply in ensureOutsourceIssueTable.
ALTER TABLE outsource_issues ADD COLUMN IF NOT EXISTS department_code TEXT NOT NULL DEFAULT 'FAB_SEW';
CREATE TABLE IF NOT EXISTS outsource_issue_cards (
  issue_id    TEXT NOT NULL,
  job_card_id TEXT NOT NULL,
  piece_no    INTEGER,
  org_id      TEXT NOT NULL DEFAULT 'hookka',
  PRIMARY KEY (issue_id, job_card_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outsource_issue_cards_slot ON outsource_issue_cards (job_card_id, COALESCE(piece_no, 0));
CREATE INDEX IF NOT EXISTS idx_outsource_issue_cards_card ON outsource_issue_cards (job_card_id);
INSERT INTO outsource_issue_cards (issue_id, job_card_id, piece_no, org_id)
  SELECT oi.id, jc.id, oi."piece_no", oi.org_id
    FROM outsource_issues oi
    JOIN job_cards jc ON jc."productionOrderId" = oi.production_order_id
     AND jc."departmentCode" = 'FAB_SEW'
     AND (oi.wip_key IS NULL OR jc."wipKey" = oi.wip_key)
   WHERE NOT EXISTS (SELECT 1 FROM outsource_issue_cards oc WHERE oc.issue_id = oi.id)
  ON CONFLICT DO NOTHING;
