-- name: GetRuleByID :one
SELECT * FROM rules WHERE id = $1;

-- name: ListRulesByTenant :many
SELECT * FROM rules WHERE tenant_id = $1 ORDER BY created_at DESC;

-- name: ListEnabledRules :many
SELECT * FROM rules WHERE enabled = TRUE ORDER BY created_at DESC;

-- name: CreateRule :one
INSERT INTO rules (tenant_id, name, description, enabled, definition, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpdateRule :one
UPDATE rules
SET name = $2, description = $3, enabled = $4, definition = $5, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetRuleEnabled :exec
UPDATE rules SET enabled = $2, updated_at = now() WHERE id = $1;

-- name: DeleteRule :exec
DELETE FROM rules WHERE id = $1;

-- name: InsertRuleExecution :one
INSERT INTO rule_executions (rule_id, action_taken, result, error_message, latency_ms)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListRuleExecutions :many
SELECT * FROM rule_executions
WHERE rule_id = $1
ORDER BY triggered_at DESC
LIMIT $2;
