-- =============================================================================
-- ZEINA — rôles scope-site (avec rétrocompat tenant-wide)
--
-- Avant : les rôles étaient au niveau tenant et réutilisables sur tous les
-- sites de ce tenant. La migration 0008 créait 2 rôles système par tenant
-- (Responsable de site, Invité).
--
-- Après :
--   - roles.site_id devient nullable (NULL = rôle tenant-wide réutilisable
--     sur n'importe quel site du tenant — modèle 0008)
--   - Pour chaque site existant on crée 2 rôles système site-scope
--     (Responsable de site = write partout, Invité = read sur dashboard+devices)
--   - Migration des site_members existants : les references aux 2 rôles
--     système tenant-wide sont remplacées par les nouveaux rôles site-scope
--   - Les anciens rôles système tenant-wide (Responsable de site, Invité,
--     site_id IS NULL, is_system=true) sont supprimés pour éviter les doublons
--     dans les dropdowns. Les rôles custom tenant-wide créés par les admins
--     restent en place.
--
-- Trigger SitesHandler.Create côté Go applique la même logique pour les
-- futurs sites créés.
-- =============================================================================

-- 1. Nouvelle colonne nullable.
ALTER TABLE roles ADD COLUMN site_id UUID REFERENCES sites(id) ON DELETE CASCADE;

-- 2. Drop l'ancien UNIQUE qui était (tenant_id, name) → remplacement par un
--    index unique qui scope aussi sur site_id (NULL → rôle tenant-wide unique
--    par nom dans son tenant ; NOT NULL → rôle scope-site unique par nom dans
--    son site).
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_tenant_id_name_key;

CREATE UNIQUE INDEX idx_roles_unique_tenant_site_name
    ON roles (tenant_id, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

CREATE INDEX idx_roles_site ON roles (site_id) WHERE site_id IS NOT NULL;

-- 3. Pour chaque site existant : créer les 2 rôles système site-scope.
INSERT INTO roles (tenant_id, site_id, name, description, permissions, is_system)
SELECT s.tenant_id, s.id,
       'Responsable de site',
       'Accès complet au site : dashboards, équipements, règles, membres.',
       jsonb_build_object('dashboard','write','devices','write','rules','write','members','write'),
       true
FROM sites s
ON CONFLICT DO NOTHING;

INSERT INTO roles (tenant_id, site_id, name, description, permissions, is_system)
SELECT s.tenant_id, s.id,
       'Invité',
       'Accès en lecture seule sur les dashboards et équipements.',
       jsonb_build_object('dashboard','read','devices','read','rules','none','members','none'),
       true
FROM sites s
ON CONFLICT DO NOTHING;

-- 4. Migrer les site_members qui pointent vers un rôle système tenant-wide
--    vers le rôle équivalent site-scope du site concerné.
--    On joint sur le NOM du rôle pour mapper l'ancien vers le nouveau.
UPDATE site_members sm
SET    role_id = new_role.id
FROM   roles old_role
JOIN   roles new_role
       ON new_role.tenant_id = old_role.tenant_id
       AND new_role.name = old_role.name
       AND new_role.is_system = true
WHERE  sm.role_id = old_role.id
  AND  old_role.is_system = true
  AND  old_role.site_id IS NULL
  AND  new_role.site_id = sm.site_id;

-- 5. Supprimer les anciens rôles système tenant-wide (sans site).
--    Les rôles CUSTOM tenant-wide (créés par admin, is_system=false) restent.
DELETE FROM roles
WHERE  is_system = true
  AND  site_id IS NULL;
