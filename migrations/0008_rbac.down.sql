-- Rollback RBAC.

DROP INDEX IF EXISTS idx_rules_site_enabled;
ALTER TABLE rules DROP COLUMN IF EXISTS site_id;

DROP TABLE IF EXISTS site_members;
DROP TABLE IF EXISTS roles;

-- Restaure l'enum user_role et la colonne role pour rétro-compatibilité.
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'viewer');
ALTER TABLE users ADD COLUMN role user_role NOT NULL DEFAULT 'viewer';
UPDATE users SET role = 'admin' WHERE tenant_role = 'owner' OR is_superadmin = true;

ALTER TABLE users DROP COLUMN tenant_role;
ALTER TABLE users DROP COLUMN is_superadmin;
DROP TYPE tenant_role;
