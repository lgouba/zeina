-- =============================================================================
-- ZEINA — éditeur de règles visuel (V1)
--
-- Avant : `rules.definition` JSONB stocke {trigger, conditions, actions} en
-- format linéaire — édité via un long formulaire.
--
-- Après : on ajoute `rules.definition_graph` JSONB NULL qui stocke le
-- format graph {nodes, edges} utilisé par l'éditeur visuel xyflow.
--
-- Le format legacy `definition` reste autoritaire pour le moteur
-- (rules-engine ne change pas) — le backend convertit le graph en
-- definition au moment du save (cf. handlers/rules.go).
--
-- Pourquoi 2 colonnes : on garde le legacy pour ne pas migrer le moteur
-- d'un coup. Le graph est juste le « source code visuel » de l'utilisateur,
-- compilé vers definition pour exécution.
-- =============================================================================

ALTER TABLE rules ADD COLUMN definition_graph JSONB;

-- Index pour les règles qui ont un graph (debug / migration future).
CREATE INDEX idx_rules_has_graph ON rules ((definition_graph IS NOT NULL))
WHERE definition_graph IS NOT NULL;
