-- Rollback : on recrée les rôles système tenant-wide, on remappe les site_members,
-- puis on supprime les rôles site-scope. La colonne site_id et l'index sont retirés.

-- 1. Recréer les 2 rôles système tenant-wide (Responsable de site + Invité)
--    pour chaque tenant qui en a besoin.
INSERT INTO roles (tenant_id, name, description, permissions, is_system)
SELECT DISTINCT s.tenant_id,
       'Responsable de site',
       'Accès complet au site : dashboards, équipements, règles, membres.',
       jsonb_build_object('dashboard','write','devices','write','rules','write','members','write'),
       true
FROM   sites s
ON CONFLICT DO NOTHING;

INSERT INTO roles (tenant_id, name, description, permissions, is_system)
SELECT DISTINCT s.tenant_id,
       'Invité',
       'Accès en lecture seule sur les dashboards et équipements.',
       jsonb_build_object('dashboard','read','devices','read','rules','none','members','none'),
       true
FROM   sites s
ON CONFLICT DO NOTHING;

-- 2. Re-pointer les site_members vers le rôle tenant-wide (par nom).
UPDATE site_members sm
SET    role_id = tr.id
FROM   roles sr, roles tr
WHERE  sm.role_id = sr.id
  AND  sr.site_id IS NOT NULL
  AND  sr.is_system = true
  AND  tr.tenant_id = sr.tenant_id
  AND  tr.site_id IS NULL
  AND  tr.is_system = true
  AND  tr.name = sr.name;

-- 3. Supprimer les rôles site-scope.
DELETE FROM roles WHERE site_id IS NOT NULL;

-- 4. Restaurer la contrainte UNIQUE et drop la colonne.
DROP INDEX IF EXISTS idx_roles_site;
DROP INDEX IF EXISTS idx_roles_unique_tenant_site_name;
ALTER TABLE roles ADD CONSTRAINT roles_tenant_id_name_key UNIQUE (tenant_id, name);
ALTER TABLE roles DROP COLUMN site_id;
