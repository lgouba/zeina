-- name: InsertMeasurement :exec
-- L'ingestor utilise CopyFrom pour le bulk ; cette query reste utile pour les tests.
INSERT INTO measurements (ts, device_id, measurement, value, quality)
VALUES ($1, $2, $3, $4, $5);

-- name: GetLatestMeasurements :many
-- Dernière valeur par measurement pour un device — utilise l'index DESC.
SELECT DISTINCT ON (measurement)
    ts, device_id, measurement, value, quality
FROM measurements
WHERE device_id = $1
ORDER BY measurement, ts DESC;

-- name: GetMeasurementsRaw :many
SELECT ts, value, quality
FROM measurements
WHERE device_id = $1
  AND measurement = $2
  AND ts >= $3
  AND ts <  $4
ORDER BY ts ASC;

-- name: GetMeasurements1Min :many
SELECT bucket AS ts, avg_value, min_value, max_value, sample_count
FROM measurements_1min
WHERE device_id = $1 AND measurement = $2 AND bucket >= $3 AND bucket < $4
ORDER BY bucket ASC;

-- name: GetMeasurements15Min :many
SELECT bucket AS ts, avg_value, min_value, max_value, sample_count
FROM measurements_15min
WHERE device_id = $1 AND measurement = $2 AND bucket >= $3 AND bucket < $4
ORDER BY bucket ASC;

-- name: GetMeasurements1H :many
SELECT bucket AS ts, avg_value, min_value, max_value, sample_count
FROM measurements_1h
WHERE device_id = $1 AND measurement = $2 AND bucket >= $3 AND bucket < $4
ORDER BY bucket ASC;

-- name: GetMeasurements1D :many
SELECT bucket AS ts, avg_value, min_value, max_value, sum_value, sample_count
FROM measurements_1d
WHERE device_id = $1 AND measurement = $2 AND bucket >= $3 AND bucket < $4
ORDER BY bucket ASC;
