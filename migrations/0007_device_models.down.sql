DROP INDEX IF EXISTS idx_devices_model;
ALTER TABLE devices DROP COLUMN IF EXISTS model_id;
DROP TABLE IF EXISTS device_model_attributes CASCADE;
DROP TABLE IF EXISTS device_models CASCADE;
