-- HK-0130 outsource piece-rate wages. Documentation of the schema only: this
-- reaches prod through ensureOutsourcePieceTables (src/api/lib/outsource-piece.ts).

CREATE TABLE IF NOT EXISTS outsource_piece_rates (
  id         TEXT PRIMARY KEY,
  worker_id  TEXT NOT NULL,
  item_code  TEXT NOT NULL,
  rate_sen   INTEGER NOT NULL,
  org_id     TEXT NOT NULL DEFAULT 'hookka',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outsource_piece_rates_worker_item
  ON outsource_piece_rates (worker_id, item_code);

CREATE TABLE IF NOT EXISTS outsource_piece_records (
  id                  TEXT PRIMARY KEY,
  worker_id           TEXT NOT NULL,
  emp_no              TEXT,
  worker_name         TEXT,
  production_order_id TEXT NOT NULL,
  po_no               TEXT,
  sales_order_no      TEXT,
  customer_po_id      TEXT,
  product_code        TEXT,
  item_code           TEXT NOT NULL,
  quantity            INTEGER NOT NULL,
  rate_sen            INTEGER NOT NULL,
  amount_sen          INTEGER NOT NULL,
  payroll_period      TEXT NOT NULL,
  payslip_id          TEXT,
  org_id              TEXT NOT NULL DEFAULT 'hookka',
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outsource_piece_records_order
  ON outsource_piece_records (production_order_id);
CREATE INDEX IF NOT EXISTS idx_outsource_piece_records_period
  ON outsource_piece_records (payroll_period);
CREATE INDEX IF NOT EXISTS idx_outsource_piece_records_worker
  ON outsource_piece_records (worker_id);

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS piece_wages_sen INTEGER NOT NULL DEFAULT 0;
