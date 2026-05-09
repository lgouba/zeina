-- name: GetZoneByID :one
SELECT * FROM zones WHERE id = $1;

-- name: ListZonesBySite :many
SELECT * FROM zones WHERE site_id = $1 ORDER BY name;

-- name: ListChildZones :many
SELECT * FROM zones WHERE parent_zone_id = $1 ORDER BY name;

-- name: CreateZone :one
INSERT INTO zones (site_id, parent_zone_id, slug, name)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateZone :one
UPDATE zones SET name = $2, parent_zone_id = $3, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteZone :exec
DELETE FROM zones WHERE id = $1;
