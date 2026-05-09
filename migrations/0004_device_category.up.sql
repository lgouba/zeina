-- =============================================================================
-- ZEINA — Catégorie métier sur les équipements
--
-- Champ libre TEXT (pas un enum strict) pour souplesse — l'UI propose une
-- liste suggérée mais l'utilisateur peut renseigner ce qu'il veut.
--
-- Exemples : "Énergie", "Environnement", "Mouvement", "Éclairage",
--           "Sécurité", "Surveillance", "Eau".
-- =============================================================================

ALTER TABLE devices ADD COLUMN IF NOT EXISTS category TEXT;
COMMENT ON COLUMN devices.category IS
  'Catégorie métier libre (Énergie, Environnement, Mouvement, ...)';

CREATE INDEX IF NOT EXISTS idx_devices_category ON devices (category);
