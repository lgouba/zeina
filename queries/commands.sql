-- name: CreateCommand :one
INSERT INTO commands (device_id, action, payload, status, issued_by)
VALUES ($1, $2, $3, 'pending', $4)
RETURNING *;

-- name: MarkCommandSent :exec
UPDATE commands SET status = 'sent', sent_at = now() WHERE id = $1;

-- name: MarkCommandAcked :exec
UPDATE commands SET status = 'acked', ack_at = now() WHERE id = $1;

-- name: MarkCommandFailed :exec
UPDATE commands SET status = 'failed', error_message = $2 WHERE id = $1;

-- name: GetCommandByID :one
SELECT * FROM commands WHERE id = $1;

-- name: ListRecentCommandsByDevice :many
SELECT * FROM commands
WHERE device_id = $1
ORDER BY issued_at DESC
LIMIT $2;
