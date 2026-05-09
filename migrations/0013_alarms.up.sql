-- 0013_alarms — Workflow d'incident (Alarmes) déclenchées par le moteur de règles.
--
-- Une règle peut maintenant inclure une action `alarm` qui crée (ou réveille)
-- une entrée dans `alarms`. Chaque déclenchement subséquent ajoute un
-- `alarm_events` et incrémente le compteur. L'utilisateur peut prendre en
-- compte (ack) ou acquitter (resolve) une alarme depuis l'UI.

CREATE TYPE alarm_severity AS ENUM ('minor', 'major', 'critical');
CREATE TYPE alarm_state    AS ENUM ('triggered', 'acknowledged', 'resolved', 'archived');

CREATE TABLE alarms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id         UUID NOT NULL REFERENCES sites(id)   ON DELETE CASCADE,
  rule_id         UUID NOT NULL REFERENCES rules(id)   ON DELETE CASCADE,
  device_id       UUID REFERENCES devices(id)          ON DELETE SET NULL,
  zone_id         UUID REFERENCES zones(id)            ON DELETE SET NULL,
  -- Identité fonctionnelle de l'alarme (vient de l'action `alarm` de la règle)
  label           TEXT NOT NULL DEFAULT 'Dépassement de seuil',
  name            TEXT NOT NULL,
  description     TEXT,
  severity        alarm_severity NOT NULL DEFAULT 'major',
  model           TEXT NOT NULL DEFAULT 'Standard',
  status_text     TEXT, -- ex: "Comportement anormal" / "Comportement normal"
  -- État courant + dénormalisation utile pour list view
  state           alarm_state NOT NULL DEFAULT 'triggered',
  attribute       TEXT,            -- ex: "temperature", "co2"
  trigger_count   INTEGER NOT NULL DEFAULT 1,
  last_value      DOUBLE PRECISION,
  unit            TEXT,
  -- Cycle de vie
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at        TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ,
  ack_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  resolve_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alarms_site_state_opened   ON alarms(site_id, state, opened_at DESC);
CREATE INDEX idx_alarms_rule_device_state   ON alarms(rule_id, device_id, state);
CREATE INDEX idx_alarms_tenant_state        ON alarms(tenant_id, state);
-- Unicité d'une alarme « ouverte » par (rule, device) — empêche les doublons
-- quand la même règle re-fire sur le même device.
CREATE UNIQUE INDEX idx_alarms_open_per_rule_device
  ON alarms(rule_id, device_id)
  WHERE state IN ('triggered', 'acknowledged');

CREATE TABLE alarm_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alarm_id        UUID NOT NULL REFERENCES alarms(id) ON DELETE CASCADE,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  state           alarm_state NOT NULL,
  severity        alarm_severity NOT NULL,
  description     TEXT,        -- ex: "Changement statut objet", "Acquittée par X"
  trigger_count   INTEGER,     -- snapshot du compteur au moment de l'évènement
  value           DOUBLE PRECISION,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_alarm_events_alarm_ts ON alarm_events(alarm_id, ts DESC);

CREATE TABLE alarm_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alarm_id   UUID NOT NULL REFERENCES alarms(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,             -- copie pour conserver la lisibilité après suppression user
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alarm_comments_alarm_ts ON alarm_comments(alarm_id, created_at DESC);
