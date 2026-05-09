-- =============================================================================
-- Exécuté UNE SEULE FOIS par l'image timescale/timescaledb au tout premier
-- démarrage (le script init n'est pas re-joué si le volume contient déjà
-- des données).
--
-- Active les extensions nécessaires sur la DB principale ZEINA.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
