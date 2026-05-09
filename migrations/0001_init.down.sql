-- =============================================================================
-- ZEINA — rollback du schéma initial
-- =============================================================================

DROP TABLE IF EXISTS measurements CASCADE;
DROP TABLE IF EXISTS commands CASCADE;
DROP TABLE IF EXISTS rule_executions CASCADE;

DROP TRIGGER IF EXISTS rules_change_notify ON rules;
DROP FUNCTION IF EXISTS notify_rules_change();
DROP TABLE IF EXISTS rules CASCADE;

DROP TABLE IF EXISTS measurements_metadata CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS zones CASCADE;
DROP TABLE IF EXISTS sites CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

DROP TYPE IF EXISTS rule_execution_result;
DROP TYPE IF EXISTS command_status;
DROP TYPE IF EXISTS measurement_quality;
DROP TYPE IF EXISTS device_status;
DROP TYPE IF EXISTS device_type;
DROP TYPE IF EXISTS user_role;
