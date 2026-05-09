-- =============================================================================
-- ZEINA — passe les continuous aggregates en mode "real-time"
--
-- Problème : par défaut, un CAGG en `materialized_only=true` ne sert que des
-- données déjà matérialisées par la refresh policy. Les nouvelles mesures
-- (poussées via POST /v1/devices/:id/measurements ou via MQTT direct) sont
-- invisibles tant que la policy ne tourne pas — refresh qui peut être espacé
-- jusqu'à 24h pour la vue 1d.
--
-- Avec `materialized_only=false`, Timescale fait une UNION transparente :
--   matérialisé + bucket à la volée sur les données plus récentes.
-- Coût négligeable à notre échelle, et la donnée la plus récente est toujours
-- visible immédiatement.
-- =============================================================================

ALTER MATERIALIZED VIEW measurements_1min  SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW measurements_15min SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW measurements_1h    SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW measurements_1d    SET (timescaledb.materialized_only = false);
