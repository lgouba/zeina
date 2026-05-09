DROP INDEX IF EXISTS idx_devices_category;
ALTER TABLE devices DROP COLUMN IF EXISTS category;
