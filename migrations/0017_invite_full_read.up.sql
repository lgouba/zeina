-- =============================================================================
-- ZEINA — élargir les permissions du rôle "Invité"
--
-- Avant : Invité avait dashboard:read + devices:read + rules:none + members:none.
-- Après : read sur les 4 features → l'Invité peut consulter dashboards,
-- équipements/zones, règles/alarmes et la liste des membres du site, sans
-- jamais pouvoir modifier quoi que ce soit.
--
-- Ne touche que les rôles is_system='Invité' — les rôles custom restent
-- intacts.
-- =============================================================================

UPDATE roles
SET    permissions = jsonb_build_object(
           'dashboard', 'read',
           'devices',   'read',
           'rules',     'read',
           'members',   'read'
       ),
       description = 'Accès en lecture seule à toutes les fonctionnalités du site.',
       updated_at  = now()
WHERE  is_system = true
  AND  name = 'Invité';
