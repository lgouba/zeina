-- name: GetTenantByID :one
SELECT * FROM tenants WHERE id = $1;

-- name: GetTenantBySlug :one
SELECT * FROM tenants WHERE slug = $1;

-- name: ListTenants :many
SELECT * FROM tenants ORDER BY created_at DESC;

-- name: CreateTenant :one
INSERT INTO tenants (slug, name, plan)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateTenant :one
UPDATE tenants
SET name = $2, plan = $3, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteTenant :exec
DELETE FROM tenants WHERE id = $1;
