-- name: GetDeviceByID :one
SELECT * FROM devices WHERE id = $1;

-- name: GetDeviceByMQTTID :one
SELECT * FROM devices WHERE mqtt_id = $1;

-- name: ListDevicesByZone :many
SELECT * FROM devices WHERE zone_id = $1 ORDER BY slug;

-- name: ListDevicesBySite :many
SELECT d.*
FROM devices d
JOIN zones z ON z.id = d.zone_id
WHERE z.site_id = $1
ORDER BY d.slug;

-- name: ListDevicesByTenant :many
SELECT d.*
FROM devices d
JOIN zones z ON z.id = d.zone_id
JOIN sites s ON s.id = z.site_id
WHERE s.tenant_id = $1
ORDER BY d.slug;

-- name: CreateDevice :one
INSERT INTO devices (
    zone_id, type, model, slug, name,
    mqtt_id, mqtt_password_hash, status, installed_at, metadata
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: UpdateDeviceStatus :exec
UPDATE devices SET status = $2, last_seen_at = $3, updated_at = now()
WHERE id = $1;

-- name: TouchDeviceLastSeen :exec
UPDATE devices SET last_seen_at = now(), status = 'online'
WHERE mqtt_id = $1;

-- name: DeleteDevice :exec
DELETE FROM devices WHERE id = $1;

-- name: UpsertMeasurementMetadata :exec
INSERT INTO measurements_metadata (device_id, measurement, unit, min_value, max_value, description)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (device_id, measurement) DO UPDATE
SET unit = EXCLUDED.unit,
    min_value = EXCLUDED.min_value,
    max_value = EXCLUDED.max_value,
    description = EXCLUDED.description;

-- name: ListMeasurementMetadataByDevice :many
SELECT * FROM measurements_metadata WHERE device_id = $1;
