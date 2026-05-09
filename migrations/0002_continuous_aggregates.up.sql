-- =============================================================================
-- ZEINA — Continuous aggregates + compression + retention
--
-- Continuous aggregates : pré-agrégats matérialisés et incrémentaux pour
-- accélérer les requêtes longues (jour/semaine/mois) côté API.
--
-- Note : ces vues doivent être créées hors transaction côté Timescale.
-- golang-migrate gère ça quand on met le SQL dans un fichier dédié.
-- =============================================================================

-- ----------------------------- 1 minute --------------------------------------
CREATE MATERIALIZED VIEW measurements_1min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', ts) AS bucket,
    device_id,
    measurement,
    AVG(value)  AS avg_value,
    MIN(value)  AS min_value,
    MAX(value)  AS max_value,
    COUNT(*)    AS sample_count
FROM measurements
GROUP BY bucket, device_id, measurement
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'measurements_1min',
    start_offset => INTERVAL '2 hours',
    end_offset   => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute'
);

-- ----------------------------- 15 minutes ------------------------------------
CREATE MATERIALIZED VIEW measurements_15min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('15 minutes', ts) AS bucket,
    device_id,
    measurement,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    COUNT(*)   AS sample_count
FROM measurements
GROUP BY bucket, device_id, measurement
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'measurements_15min',
    start_offset => INTERVAL '1 day',
    end_offset   => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes'
);

-- ----------------------------- 1 heure ---------------------------------------
CREATE MATERIALIZED VIEW measurements_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', ts) AS bucket,
    device_id,
    measurement,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    COUNT(*)   AS sample_count
FROM measurements
GROUP BY bucket, device_id, measurement
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'measurements_1h',
    start_offset => INTERVAL '7 days',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);

-- ----------------------------- 1 jour ----------------------------------------
CREATE MATERIALIZED VIEW measurements_1d
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', ts) AS bucket,
    device_id,
    measurement,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    SUM(value) AS sum_value,
    COUNT(*)   AS sample_count
FROM measurements
GROUP BY bucket, device_id, measurement
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'measurements_1d',
    start_offset => INTERVAL '30 days',
    end_offset   => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day'
);

-- =============================================================================
-- Compression — gain ~10-20x sur les données numériques homogènes
-- =============================================================================
ALTER TABLE measurements SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id, measurement',
    timescaledb.compress_orderby = 'ts DESC'
);

SELECT add_compression_policy('measurements', INTERVAL '7 days');

-- =============================================================================
-- Politique de rétention
--   - raw : 90 jours
--   - 1min : 30 jours (sinon table énorme)
--   - 15min, 1h, 1d : 2 ans
-- =============================================================================
SELECT add_retention_policy('measurements',       INTERVAL '90 days');
SELECT add_retention_policy('measurements_1min',  INTERVAL '30 days');
SELECT add_retention_policy('measurements_15min', INTERVAL '2 years');
SELECT add_retention_policy('measurements_1h',    INTERVAL '2 years');
SELECT add_retention_policy('measurements_1d',    INTERVAL '2 years');
