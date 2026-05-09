-- =============================================================================
-- ZEINA — schéma initial
--
-- Hypothèse : l'extension timescaledb est créée par db/init/01-extensions.sql
-- au premier démarrage du container. On la garantit ici également pour les
-- environnements où la migration tourne sur une DB pré-existante.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- Types ENUM
-- -----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'viewer');

CREATE TYPE device_type AS ENUM (
    'environment',  -- T°, humidité, CO2, lux dans un seul boîtier
    'presence',     -- PIR / radar
    'actuator',     -- relais commandable
    'linky',        -- compteur électrique
    'meter',        -- compteur générique (eau, gaz, ...)
    'gateway'       -- passerelle (ESP32 TIC, etc.)
);

CREATE TYPE device_status AS ENUM ('provisioned', 'online', 'offline', 'disabled');

CREATE TYPE measurement_quality AS ENUM ('good', 'uncertain', 'bad');

CREATE TYPE command_status AS ENUM ('pending', 'sent', 'acked', 'failed', 'timeout');

CREATE TYPE rule_execution_result AS ENUM ('success', 'partial', 'failure', 'skipped');

-- -----------------------------------------------------------------------------
-- Tenants
-- -----------------------------------------------------------------------------
CREATE TABLE tenants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,            -- ex: "acme" — utilisé dans les topics MQTT
    name        TEXT NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'free',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_slug ON tenants (slug);

-- -----------------------------------------------------------------------------
-- Users
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,               -- bcrypt
    role            user_role NOT NULL DEFAULT 'viewer',
    full_name       TEXT,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_tenant ON users (tenant_id);

-- -----------------------------------------------------------------------------
-- Sites
-- -----------------------------------------------------------------------------
CREATE TABLE sites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    slug        TEXT NOT NULL,                   -- ex: "hq-ouaga" — utilisé dans les topics
    name        TEXT NOT NULL,
    address     TEXT,
    lat         DOUBLE PRECISION,
    lng         DOUBLE PRECISION,
    timezone    TEXT NOT NULL DEFAULT 'Africa/Ouagadougou',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, slug)
);

CREATE INDEX idx_sites_tenant ON sites (tenant_id);

-- -----------------------------------------------------------------------------
-- Zones (hiérarchique : une zone peut avoir une zone parente)
-- -----------------------------------------------------------------------------
CREATE TABLE zones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    parent_zone_id  UUID REFERENCES zones(id) ON DELETE CASCADE,
    slug            TEXT NOT NULL,               -- ex: "open-space-1"
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (site_id, slug)
);

CREATE INDEX idx_zones_site ON zones (site_id);
CREATE INDEX idx_zones_parent ON zones (parent_zone_id);

-- -----------------------------------------------------------------------------
-- Devices
-- -----------------------------------------------------------------------------
CREATE TABLE devices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id             UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    type                device_type NOT NULL,
    model               TEXT,
    slug                TEXT NOT NULL,           -- ex: "env-01" — segment final du topic
    name                TEXT,                    -- libellé humain ("Capteur entrée")
    mqtt_id             TEXT NOT NULL UNIQUE,    -- username MQTT généré (ex: "dev_abc123")
    mqtt_password_hash  TEXT NOT NULL,           -- bcrypt
    status              device_status NOT NULL DEFAULT 'provisioned',
    last_seen_at        TIMESTAMPTZ,
    installed_at        TIMESTAMPTZ,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (zone_id, slug)
);

CREATE INDEX idx_devices_zone ON devices (zone_id);
CREATE INDEX idx_devices_type ON devices (type);
CREATE INDEX idx_devices_status ON devices (status);

-- -----------------------------------------------------------------------------
-- Measurements metadata (par device, par measurement)
--   - bornes utilisées pour validation à l'ingest
--   - unité utilisée pour l'affichage côté front
-- -----------------------------------------------------------------------------
CREATE TABLE measurements_metadata (
    device_id    UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    measurement  TEXT NOT NULL,                  -- ex: "temperature", "co2", "papp"
    unit         TEXT NOT NULL,                  -- ex: "celsius", "ppm", "watt"
    min_value    DOUBLE PRECISION,
    max_value    DOUBLE PRECISION,
    description  TEXT,
    PRIMARY KEY (device_id, measurement)
);

-- -----------------------------------------------------------------------------
-- Rules (moteur de règles)
-- -----------------------------------------------------------------------------
CREATE TABLE rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    definition  JSONB NOT NULL,                  -- format documenté dans le README
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rules_tenant_enabled ON rules (tenant_id, enabled);

-- Notification trigger pour hot-reload côté rules-engine (LISTEN/NOTIFY)
CREATE OR REPLACE FUNCTION notify_rules_change() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('rules_change', json_build_object(
        'op',         TG_OP,
        'rule_id',    COALESCE(NEW.id, OLD.id),
        'tenant_id',  COALESCE(NEW.tenant_id, OLD.tenant_id)
    )::text);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rules_change_notify
AFTER INSERT OR UPDATE OR DELETE ON rules
FOR EACH ROW EXECUTE FUNCTION notify_rules_change();

-- -----------------------------------------------------------------------------
-- Rule executions (audit trail)
-- -----------------------------------------------------------------------------
CREATE TABLE rule_executions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id       UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    triggered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    action_taken  JSONB NOT NULL,
    result        rule_execution_result NOT NULL,
    error_message TEXT,
    latency_ms    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_rule_executions_rule_time ON rule_executions (rule_id, triggered_at DESC);

-- -----------------------------------------------------------------------------
-- Commands (issue → MQTT publish → ACK via state)
-- -----------------------------------------------------------------------------
CREATE TABLE commands (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    action      TEXT NOT NULL,                   -- "set", "reset", ...
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    status      command_status NOT NULL DEFAULT 'pending',
    issued_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at     TIMESTAMPTZ,
    ack_at      TIMESTAMPTZ,
    error_message TEXT
);

CREATE INDEX idx_commands_device_time ON commands (device_id, issued_at DESC);
CREATE INDEX idx_commands_status ON commands (status) WHERE status IN ('pending', 'sent');

-- -----------------------------------------------------------------------------
-- MEASUREMENTS (hypertable TimescaleDB)
-- -----------------------------------------------------------------------------
CREATE TABLE measurements (
    ts          TIMESTAMPTZ NOT NULL,
    device_id   UUID        NOT NULL,
    measurement TEXT        NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    quality     measurement_quality NOT NULL DEFAULT 'good'
);

-- Hypertable partitionnée par jour, chunk_time_interval = 1 jour
SELECT create_hypertable(
    'measurements',
    'ts',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Index pour les requêtes "dernière valeur" et "fenêtre temporelle par device+measurement"
CREATE INDEX idx_measurements_device_meas_ts
    ON measurements (device_id, measurement, ts DESC);

-- Refresh policy + continuous aggregates et compression sont définis dans 0002.
