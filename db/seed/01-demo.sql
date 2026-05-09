-- =============================================================================
-- ZEINA — seed démo
--
-- Crée 1 tenant "acme", 1 site "hq-ouaga", 3 zones, 10 devices virtuels qui
-- matchent ceux publiés par services/simulator/simulator.yml. Plus 1 user
-- admin pour l'API (login : admin@acme.test / admin123).
--
-- Idempotent : utilise ON CONFLICT pour pouvoir être rejoué sans erreur.
-- Les UUIDs sont fixes pour faciliter les démos et tests.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tenant
-- ---------------------------------------------------------------------------
INSERT INTO tenants (id, slug, name, plan)
VALUES ('11111111-1111-1111-1111-111111111111', 'acme', 'Acme Corp', 'demo')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- User admin — bcrypt("admin123") généré avec :
--   htpasswd -bnBC 10 "" "admin123" | tr -d ':\n'
-- (10 rounds, le coût par défaut de bcrypt.DefaultCost en Go)
-- Depuis la migration 0008 : tenant_role + is_superadmin (plus de colonne role).
-- ---------------------------------------------------------------------------
INSERT INTO users (id, tenant_id, email, password_hash, full_name, tenant_role, is_superadmin)
VALUES (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'admin@acme.test',
    '$2a$10$mOfe2SYu.0sacjn0gA.XbezGClClhBUYO9r1Ob17XDanv8hTbOwPy',
    'Demo Admin',
    'owner',
    true
)
ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    tenant_role   = EXCLUDED.tenant_role,
    is_superadmin = EXCLUDED.is_superadmin;

-- ---------------------------------------------------------------------------
-- Site
-- ---------------------------------------------------------------------------
INSERT INTO sites (id, tenant_id, slug, name, address, lat, lng, timezone)
VALUES (
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'hq-ouaga',
    'Siège Ouagadougou',
    'Avenue de la Nation, Ouagadougou',
    12.3714, -1.5197,
    'Africa/Ouagadougou'
)
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Zones
-- ---------------------------------------------------------------------------
INSERT INTO zones (id, site_id, slug, name) VALUES
    ('44444444-4444-4444-4444-000000000001', '33333333-3333-3333-3333-333333333333', 'open-space-1',   'Open space 1'),
    ('44444444-4444-4444-4444-000000000002', '33333333-3333-3333-3333-333333333333', 'meeting-room-1', 'Salle de réunion'),
    ('44444444-4444-4444-4444-000000000003', '33333333-3333-3333-3333-333333333333', 'tableau-elec',   'Tableau électrique')
ON CONFLICT (site_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Devices (les mqtt_id/password ne servent que pour le hardware réel —
-- le simulator s'authentifie en tant que user "simulator" partagé).
-- Le hash est un placeholder bcrypt valide (= "placeholder").
-- ---------------------------------------------------------------------------
WITH placeholder_hash AS (
    SELECT '$2y$10$abcdefghijklmnopqrstuuQq8s0v0g8oBfWGTKlJv6xCtZh9iXq.S' AS h
)
INSERT INTO devices (id, zone_id, type, model, slug, name, category, mqtt_id, mqtt_password_hash, status, installed_at, metadata)
SELECT * FROM (VALUES
    -- open-space-1
    ('55555555-5555-5555-5555-000000000001'::uuid, '44444444-4444-4444-4444-000000000001'::uuid, 'environment'::device_type, 'V-Env-4M',     'env-01',           'Capteur ambiance',    'Environnement', 'dev_env_01_acme',          (SELECT h FROM placeholder_hash), 'online'::device_status, now(), '{}'::jsonb),
    ('55555555-5555-5555-5555-000000000002'::uuid, '44444444-4444-4444-4444-000000000001'::uuid, 'presence'::device_type,    'V-PIR',         'pir-01',           'Détecteur présence',  'Mouvement',     'dev_pir_01_acme',         (SELECT h FROM placeholder_hash), 'online'::device_status, now(), '{}'::jsonb),
    ('55555555-5555-5555-5555-000000000003'::uuid, '44444444-4444-4444-4444-000000000001'::uuid, 'actuator'::device_type,    'V-Relay',       'relay-light-01',   'Lumière open space',  'Éclairage',     'dev_relay_light_01_acme', (SELECT h FROM placeholder_hash), 'online'::device_status, now(), '{}'::jsonb),

    -- meeting-room-1
    ('55555555-5555-5555-5555-000000000004'::uuid, '44444444-4444-4444-4444-000000000002'::uuid, 'environment'::device_type, 'V-Env-3M',     'env-02',           'Capteur ambiance',    'Environnement', 'dev_env_02_acme',          (SELECT h FROM placeholder_hash), 'online'::device_status, now(), '{}'::jsonb),
    ('55555555-5555-5555-5555-000000000005'::uuid, '44444444-4444-4444-4444-000000000002'::uuid, 'presence'::device_type,    'V-PIR',         'pir-02',           'Détecteur présence',  'Mouvement',     'dev_pir_02_acme',         (SELECT h FROM placeholder_hash), 'online'::device_status, now(), '{}'::jsonb),

    -- tableau-elec
    ('55555555-5555-5555-5555-000000000006'::uuid, '44444444-4444-4444-4444-000000000003'::uuid, 'linky'::device_type,        'V-Linky',      'linky-01',         'Compteur principal',  'Énergie',       'dev_linky_01_acme',       (SELECT h FROM placeholder_hash), 'online'::device_status, now(), '{}'::jsonb),
    ('55555555-5555-5555-5555-000000000007'::uuid, '44444444-4444-4444-4444-000000000003'::uuid, 'actuator'::device_type,    'V-Relay',       'relay-clim-01',    'Climatisation',       'Climatisation', 'dev_relay_clim_01_acme',   (SELECT h FROM placeholder_hash), 'online'::device_status, now(), '{}'::jsonb),
    ('55555555-5555-5555-5555-000000000008'::uuid, '44444444-4444-4444-4444-000000000003'::uuid, 'actuator'::device_type,    'V-Relay',       'relay-light-02',   'Lumière tableau',     'Éclairage',     'dev_relay_light_02_acme',  (SELECT h FROM placeholder_hash), 'online'::device_status, now(), '{}'::jsonb),
    ('55555555-5555-5555-5555-000000000009'::uuid, '44444444-4444-4444-4444-000000000003'::uuid, 'environment'::device_type, 'V-Env-1M',      'env-03',           'Sonde T° tableau',    'Environnement', 'dev_env_03_acme',          (SELECT h FROM placeholder_hash), 'online'::device_status, now(), '{}'::jsonb),
    ('55555555-5555-5555-5555-000000000010'::uuid, '44444444-4444-4444-4444-000000000003'::uuid, 'presence'::device_type,    'V-PIR',         'pir-03',           'Présence tableau',    'Mouvement',     'dev_pir_03_acme',          (SELECT h FROM placeholder_hash), 'online'::device_status, now(), '{}'::jsonb)
) AS v(id, zone_id, type, model, slug, name, category, mqtt_id, mqtt_password_hash, status, installed_at, metadata)
ON CONFLICT (zone_id, slug) DO UPDATE SET
    category = EXCLUDED.category,
    name = EXCLUDED.name;

-- ---------------------------------------------------------------------------
-- Measurements metadata (bornes utilisées par l'ingestor pour validation)
-- ---------------------------------------------------------------------------
INSERT INTO measurements_metadata (device_id, measurement, unit, min_value, max_value, description) VALUES
    -- env-01
    ('55555555-5555-5555-5555-000000000001', 'temperature', 'celsius',  -10.0,  60.0, 'Température ambiante'),
    ('55555555-5555-5555-5555-000000000001', 'humidity',    'percent',    0.0, 100.0, 'Humidité relative'),
    ('55555555-5555-5555-5555-000000000001', 'co2',         'ppm',      350.0, 5000.0, 'Concentration CO2'),
    ('55555555-5555-5555-5555-000000000001', 'lux',         'lux',        0.0, 100000.0, 'Luminosité'),
    -- env-02
    ('55555555-5555-5555-5555-000000000004', 'temperature', 'celsius',  -10.0,  60.0, 'Température salle'),
    ('55555555-5555-5555-5555-000000000004', 'humidity',    'percent',    0.0, 100.0, 'Humidité salle'),
    ('55555555-5555-5555-5555-000000000004', 'co2',         'ppm',      350.0, 5000.0, 'CO2 salle'),
    -- env-03
    ('55555555-5555-5555-5555-000000000009', 'temperature', 'celsius',  -10.0,  80.0, 'Température tableau'),
    -- presence
    ('55555555-5555-5555-5555-000000000002', 'presence', 'bool', 0.0, 1.0, 'Détection PIR'),
    ('55555555-5555-5555-5555-000000000005', 'presence', 'bool', 0.0, 1.0, 'Détection PIR'),
    ('55555555-5555-5555-5555-000000000010', 'presence', 'bool', 0.0, 1.0, 'Détection PIR'),
    -- linky
    ('55555555-5555-5555-5555-000000000006', 'papp',  'VA',         0.0, 60000.0, 'Puissance apparente'),
    ('55555555-5555-5555-5555-000000000006', 'pact',  'watt',       0.0, 60000.0, 'Puissance active'),
    ('55555555-5555-5555-5555-000000000006', 'iinst', 'ampere',     0.0,   400.0, 'Intensité instantanée'),
    ('55555555-5555-5555-5555-000000000006', 'urms',  'volt',     200.0,   260.0, 'Tension RMS'),
    ('55555555-5555-5555-5555-000000000006', 'base',  'watt-hour',  0.0, 1.0e12, 'Index énergie cumulée')
ON CONFLICT (device_id, measurement) DO NOTHING;
