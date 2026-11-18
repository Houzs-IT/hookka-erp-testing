-- HK-0162/0163: scanned FAB_SEW orders become outsource piece records.
-- Inert on deploy: the same statements self-apply in ensureOutsourcePieceTables.
ALTER TABLE outsource_piece_records ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'IMPORT';
ALTER TABLE outsource_piece_records ADD COLUMN IF NOT EXISTS share_bp INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE outsource_piece_records ADD COLUMN IF NOT EXISTS completed_date TEXT;
