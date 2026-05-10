DROP INDEX IF EXISTS idx_rules_has_graph;
ALTER TABLE rules DROP COLUMN IF EXISTS definition_graph;
