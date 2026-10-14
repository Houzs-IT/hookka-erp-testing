-- HK-0005 (2026-10-14): scan originals go to the file store (Supabase Storage
-- + file_assets, resourceType 'scan-original') instead of base64 text in the
-- queue row. The row keeps the file_assets id. Applied at runtime by
-- ensureScanQueueTable (src/api/routes/scan-queue.ts); this file is the record.
ALTER TABLE scan_queue ADD COLUMN IF NOT EXISTS file_asset_id TEXT;
