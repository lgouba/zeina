-- =============================================================================
-- ZEINA — typage des zones (école → bâtiment → étage → pièce)
--
-- La table `zones` est déjà hiérarchique (`parent_zone_id`). On l'étend pour
-- permettre la classification métier : zone géographique, groupe de bâtiments,
-- bâtiment, étage, pièce. + un GeoJSON optionnel pour le tracé de polygone.
-- =============================================================================

CREATE TYPE zone_kind AS ENUM (
    'geographic',     -- ex: école, parc, campus
    'building_group', -- groupe de bâtiments (aile, secteur)
    'building',       -- bâtiment
    'floor',          -- étage
    'room'            -- pièce, salle, atelier — niveau le plus fin
);

ALTER TABLE zones ADD COLUMN kind zone_kind NOT NULL DEFAULT 'room';
ALTER TABLE zones ADD COLUMN description TEXT;
ALTER TABLE zones ADD COLUMN icon  TEXT;             -- nom d'icône lucide (optionnel)
ALTER TABLE zones ADD COLUMN color TEXT;             -- couleur d'accent (optionnel, hex)
ALTER TABLE zones ADD COLUMN geometry JSONB;         -- GeoJSON Polygon | MultiPolygon | Point — optionnel

-- Backfill : les zones existantes sont des "room" par défaut, sauf la racine
-- d'un site (parent_zone_id IS NULL) qu'on classe comme "building_group".
UPDATE zones SET kind = 'building_group' WHERE parent_zone_id IS NULL;

-- Garde-fous métier : on ne contraint pas la hiérarchie (room dans room ok),
-- la cohérence métier est assurée côté UI. Mais on bloque les cycles via
-- check ON DELETE déjà en place.
