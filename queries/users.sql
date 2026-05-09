-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: ListUsersByTenant :many
SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at DESC;

-- name: CreateUser :one
INSERT INTO users (tenant_id, email, password_hash, role, full_name)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateUserPassword :exec
UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1;

-- name: TouchUserLogin :exec
UPDATE users SET last_login_at = now() WHERE id = $1;

-- name: DeleteUser :exec
DELETE FROM users WHERE id = $1;
