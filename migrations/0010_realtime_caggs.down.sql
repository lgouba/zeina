ALTER MATERIALIZED VIEW measurements_1min  SET (timescaledb.materialized_only = true);
ALTER MATERIALIZED VIEW measurements_15min SET (timescaledb.materialized_only = true);
ALTER MATERIALIZED VIEW measurements_1h    SET (timescaledb.materialized_only = true);
ALTER MATERIALIZED VIEW measurements_1d    SET (timescaledb.materialized_only = true);
