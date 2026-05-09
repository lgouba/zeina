-- name: GetSiteByID :one
SELECT * FROM sites WHERE id = $1;

-- name: GetSiteBySlug :one
SELECT * FROM sites WHERE tenant_id = $1 AND slug = $2;

-- name: ListSitesByTenant :many
SELECT * FROM sites WHERE tenant_id = $1 ORDER BY name;

-- name: CreateSite :one
INSERT INTO sites (tenant_id, slug, name, address, lat, lng, timezone)
VALUES ($1, $2, $3, $4, $5, $6, COALESCE(sqlc.narg('timezone'), 'Africa/Ouagadougou'))
RETURNING *;

-- name: UpdateSite :one
UPDATE sites
SET name = $2, address = $3, lat = $4, lng = $5, timezone = $6, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteSite :exec
DELETE FROM sites WHERE id = $1;
