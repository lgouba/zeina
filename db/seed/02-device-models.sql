-- =============================================================================
-- Catalogue initial de modèles
-- Idempotent : INSERT ... ON CONFLICT DO NOTHING
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Milesight AM308 — capteur d'ambiance LoRaWAN 8-en-1
-- ---------------------------------------------------------------------------
INSERT INTO device_models (id, brand, code, category, protocol, description, default_interval_minutes) VALUES
    ('aaaa0001-0000-0000-0000-000000000308', 'Milesight', 'AM308', 'Environnement', 'LoRaWAN',
     'Capteur d''ambiance 8-en-1 : T°/H/CO2/lumière/PIR/TVOC/PM2.5/PM10', 15)
ON CONFLICT (brand, code) DO NOTHING;

INSERT INTO device_model_attributes (device_model_id, name, unit, min_value, max_value, description, position, configurable) VALUES
    ('aaaa0001-0000-0000-0000-000000000308', 'temperature', 'celsius',  -10,  60,    'Température ambiante', 1, TRUE),
    ('aaaa0001-0000-0000-0000-000000000308', 'humidity',    'percent',    0, 100,    'Humidité relative',    2, TRUE),
    ('aaaa0001-0000-0000-0000-000000000308', 'co2',         'ppm',        0, 5000,   'Concentration CO2',    3, TRUE),
    ('aaaa0001-0000-0000-0000-000000000308', 'light_level', 'level',      0, 5,      'Niveau de luminosité (0=nuit, 5=plein jour)', 4, TRUE),
    ('aaaa0001-0000-0000-0000-000000000308', 'pir',         'bool',       0, 1,      'Détection de mouvement PIR', 5, TRUE),
    ('aaaa0001-0000-0000-0000-000000000308', 'tvoc',        'µg/m³',      0, 60000,  'Composés organiques volatils', 6, TRUE),
    ('aaaa0001-0000-0000-0000-000000000308', 'pm2_5',       'µg/m³',      0, 1000,   'Particules fines PM2.5', 7, TRUE),
    ('aaaa0001-0000-0000-0000-000000000308', 'pm10',        'µg/m³',      0, 1000,   'Particules PM10',     8, TRUE),
    ('aaaa0001-0000-0000-0000-000000000308', 'pressure',    'hPa',      300, 1100,   'Pression atmosphérique', 9, TRUE),
    ('aaaa0001-0000-0000-0000-000000000308', 'battery',     'percent',    0, 100,    'Niveau de batterie',  10, FALSE)
ON CONFLICT (device_model_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Adeunis Pulse V4 — compteur d'impulsions LoRaWAN
-- ---------------------------------------------------------------------------
INSERT INTO device_models (id, brand, code, category, protocol, description, default_interval_minutes) VALUES
    ('aaaa0002-0000-0000-0000-000000000004', 'Adeunis', 'Pulse-V4', 'Énergie', 'LoRaWAN',
     'Compteur d''impulsions 4 canaux pour eau / gaz / électricité', 60)
ON CONFLICT (brand, code) DO NOTHING;

INSERT INTO device_model_attributes (device_model_id, name, unit, min_value, max_value, description, position, configurable) VALUES
    ('aaaa0002-0000-0000-0000-000000000004', 'pulse_count_a', 'impulsions', 0, 1e12, 'Compteur canal A', 1, TRUE),
    ('aaaa0002-0000-0000-0000-000000000004', 'pulse_count_b', 'impulsions', 0, 1e12, 'Compteur canal B', 2, TRUE),
    ('aaaa0002-0000-0000-0000-000000000004', 'battery',       'percent',    0, 100,  'Niveau de batterie', 3, FALSE)
ON CONFLICT (device_model_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Linky virtuel — modèle correspondant aux compteurs simulés
-- ---------------------------------------------------------------------------
INSERT INTO device_models (id, brand, code, category, protocol, description, default_interval_minutes) VALUES
    ('aaaa0003-0000-0000-0000-000000000001', 'ZEINA', 'V-Linky', 'Énergie', 'MQTT',
     'Compteur électrique virtuel (TIC standard) — papp / pact / iinst / urms / base', 1)
ON CONFLICT (brand, code) DO NOTHING;

INSERT INTO device_model_attributes (device_model_id, name, unit, min_value, max_value, description, position, configurable) VALUES
    ('aaaa0003-0000-0000-0000-000000000001', 'papp',  'VA',          0, 60000,  'Puissance apparente',  1, TRUE),
    ('aaaa0003-0000-0000-0000-000000000001', 'pact',  'watt',        0, 60000,  'Puissance active',     2, TRUE),
    ('aaaa0003-0000-0000-0000-000000000001', 'iinst', 'ampere',      0, 400,    'Intensité instantanée', 3, TRUE),
    ('aaaa0003-0000-0000-0000-000000000001', 'urms',  'volt',      200, 260,    'Tension RMS',          4, TRUE),
    ('aaaa0003-0000-0000-0000-000000000001', 'base',  'watt-hour',   0, 1e12,   'Index énergie cumulée', 5, TRUE)
ON CONFLICT (device_model_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Capteur environnement virtuel (correspond au profil simulator "environment")
-- ---------------------------------------------------------------------------
INSERT INTO device_models (id, brand, code, category, protocol, description, default_interval_minutes) VALUES
    ('aaaa0004-0000-0000-0000-000000000001', 'ZEINA', 'V-Env-4M', 'Environnement', 'MQTT',
     'Capteur ambiance virtuel : température / humidité / CO2 / lux', 1)
ON CONFLICT (brand, code) DO NOTHING;

INSERT INTO device_model_attributes (device_model_id, name, unit, min_value, max_value, description, position, configurable) VALUES
    ('aaaa0004-0000-0000-0000-000000000001', 'temperature', 'celsius', -10, 60,    'Température ambiante', 1, TRUE),
    ('aaaa0004-0000-0000-0000-000000000001', 'humidity',    'percent',   0, 100,   'Humidité relative',    2, TRUE),
    ('aaaa0004-0000-0000-0000-000000000001', 'co2',         'ppm',     350, 5000,  'Concentration CO2',    3, TRUE),
    ('aaaa0004-0000-0000-0000-000000000001', 'lux',         'lux',       0, 100000, 'Luminosité',          4, TRUE)
ON CONFLICT (device_model_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Capteur PIR virtuel
-- ---------------------------------------------------------------------------
INSERT INTO device_models (id, brand, code, category, protocol, description, default_interval_minutes) VALUES
    ('aaaa0005-0000-0000-0000-000000000001', 'ZEINA', 'V-PIR', 'Mouvement', 'MQTT',
     'Détecteur de présence virtuel — booléen 0/1', 1)
ON CONFLICT (brand, code) DO NOTHING;

INSERT INTO device_model_attributes (device_model_id, name, unit, min_value, max_value, description, position, configurable) VALUES
    ('aaaa0005-0000-0000-0000-000000000001', 'presence', 'bool', 0, 1, 'Détection de présence', 1, TRUE)
ON CONFLICT (device_model_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Relais virtuel (actionneur)
-- ---------------------------------------------------------------------------
INSERT INTO device_models (id, brand, code, category, protocol, description, default_interval_minutes) VALUES
    ('aaaa0006-0000-0000-0000-000000000001', 'ZEINA', 'V-Relay', 'Éclairage', 'MQTT',
     'Relais virtuel commandable on/off', NULL)
ON CONFLICT (brand, code) DO NOTHING;

-- Pas d'attributs de mesure pour un relais — il publie uniquement son state.
