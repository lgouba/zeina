-- =============================================================================
-- Rollback continuous aggregates + policies
-- =============================================================================

SELECT remove_retention_policy('measurements_1d', if_exists => TRUE);
SELECT remove_retention_policy('measurements_1h', if_exists => TRUE);
SELECT remove_retention_policy('measurements_15min', if_exists => TRUE);
SELECT remove_retention_policy('measurements_1min', if_exists => TRUE);
SELECT remove_retention_policy('measurements', if_exists => TRUE);

SELECT remove_compression_policy('measurements', if_exists => TRUE);

DROP MATERIALIZED VIEW IF EXISTS measurements_1d   CASCADE;
DROP MATERIALIZED VIEW IF EXISTS measurements_1h   CASCADE;
DROP MATERIALIZED VIEW IF EXISTS measurements_15min CASCADE;
DROP MATERIALIZED VIEW IF EXISTS measurements_1min CASCADE;
