-- =============================================================================
-- ZEINA — Catalogue de modèles de capteurs
--
-- Un modèle = une référence constructeur (ex: Milesight AM308) avec une
-- liste d'attributs (= mesures supportées) prédéfinis. Quand on crée un
-- device en référençant un modèle, les measurements_metadata sont
-- automatiquement provisionnées depuis device_model_attributes.
-- =============================================================================

CREATE TABLE device_models (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand       TEXT NOT NULL,           -- ex: "Milesight", "Adeunis", "IoTSens"
    code        TEXT NOT NULL,           -- ex: "AM308", "Pulse-V4", "T1"
    category    TEXT NOT NULL,           -- ex: "Environnement", "Énergie", "Mouvement"
    protocol    TEXT,                    -- ex: "LoRaWAN", "MQTT", "REST"
    description TEXT,
    default_interval_minutes INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (brand, code)
);

CREATE INDEX idx_device_models_brand    ON device_models (brand);
CREATE INDEX idx_device_models_category ON device_models (category);

CREATE TABLE device_model_attributes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_model_id UUID NOT NULL REFERENCES device_models(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,       -- ex: "temperature", "co2", "battery"
    unit            TEXT NOT NULL,       -- ex: "celsius", "ppm", "percent"
    min_value       DOUBLE PRECISION,
    max_value       DOUBLE PRECISION,
    description     TEXT,
    position        INTEGER NOT NULL DEFAULT 0,
    -- configurable=true ⇒ visible dans les widgets/règles, configurable=false
    -- ⇒ attribut technique (battery, rssi) caché par défaut.
    configurable    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_model_id, name)
);

CREATE INDEX idx_model_attrs_model ON device_model_attributes (device_model_id, position);

-- ---------------------------------------------------------------------------
-- FK optionnelle sur devices : un device peut être lié à un modèle catalogue.
-- Nullable pour rétrocompat avec les devices existants (créés avant le
-- catalogue).
-- ---------------------------------------------------------------------------
ALTER TABLE devices ADD COLUMN model_id UUID REFERENCES device_models(id) ON DELETE SET NULL;
CREATE INDEX idx_devices_model ON devices (model_id);
