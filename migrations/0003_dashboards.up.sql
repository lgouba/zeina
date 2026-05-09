-- =============================================================================
-- ZEINA — Dashboards et Widgets
--
-- Un site peut héberger N dashboards. Chaque dashboard contient N widgets
-- positionnés par "position" croissant (rendu en grille flow par le frontend).
-- Le contenu d'un widget est libre dans `config` JSONB selon son `type`.
-- =============================================================================

CREATE TYPE widget_type AS ENUM (
    'value',     -- gros chiffre + unité, mis à jour live (WS)
    'line',      -- courbe temporelle (Recharts line)
    'bar',       -- histogramme par bucket (Recharts bar)
    'gauge',     -- jauge avec min/max
    'state'      -- état d'un actionneur on/off avec boutons
);

-- ----------------------------------------------------------------------------
CREATE TABLE dashboards (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dashboards_site ON dashboards (site_id);

-- ----------------------------------------------------------------------------
-- Widgets : config JSONB libre selon le type
--
--  value    : { device_id, measurement, unit, decimals?, title }
--  line     : { device_id, measurement, unit, window_minutes, aggregation, title }
--  bar      : { device_id, measurement, unit, window_minutes, aggregation, title }
--  gauge    : { device_id, measurement, unit, min, max, title }
--  state    : { device_id, title }                          -- relais on/off
-- ----------------------------------------------------------------------------
CREATE TABLE dashboard_widgets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id  UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    type          widget_type NOT NULL,
    title         TEXT NOT NULL,
    position      INTEGER NOT NULL DEFAULT 0,
    config        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_widgets_dashboard ON dashboard_widgets (dashboard_id, position);
