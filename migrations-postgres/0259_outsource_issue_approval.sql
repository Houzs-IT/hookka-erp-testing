-- HK-0164: an outsourced worker's finished scan waits for the office's approval.
-- Record only: these columns reach prod through ensureOutsourceIssueTable
-- (src/api/lib/outsource-issue.ts), awaited before the first read or write.
-- Down: ALTER TABLE outsource_issues DROP COLUMN submitted_at, DROP COLUMN submitted_scan, DROP COLUMN approved_by;
ALTER TABLE outsource_issues ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE outsource_issues ADD COLUMN IF NOT EXISTS submitted_scan TEXT;
ALTER TABLE outsource_issues ADD COLUMN IF NOT EXISTS approved_by TEXT;
