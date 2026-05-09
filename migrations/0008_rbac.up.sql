-- =============================================================================
-- ZEINA — RBAC (rôles, permissions, membres de site)
--
-- Modèle :
--   - users.is_superadmin : flag global, bypass complet du RBAC
--   - users.tenant_role   : 'owner' | 'member' (l'owner gère tenant + tous ses sites)
--   - roles               : rôles par tenant, réutilisables sur tous les sites
--                           ex: "Responsable de site", "Invité", + rôles custom
--   - site_members        : (site, user, role) — accès d'un user à un site
--
-- permissions JSONB stocke un objet {feature: level} où level ∈
-- {"none","read","write"} et "write" implique "read".
-- Fonctionnalités initiales : dashboard, devices, rules, members.
-- =============================================================================

-- 1. Flag superadmin
ALTER TABLE users ADD COLUMN is_superadmin BOOLEAN NOT NULL DEFAULT false;

-- 2. Nouvel enum tenant_role + colonne, migration des valeurs existantes
CREATE TYPE tenant_role AS ENUM ('owner', 'member');

ALTER TABLE users ADD COLUMN tenant_role tenant_role NOT NULL DEFAULT 'member';

-- L'admin existant devient owner du tenant ET superadmin global.
UPDATE users SET tenant_role = 'owner', is_superadmin = true WHERE role = 'admin';
-- managers et viewers deviennent simples membres (les permissions seront
-- portées par site_members.role_id).

ALTER TABLE users DROP COLUMN role;
DROP TYPE user_role;

-- 3. Rôles
CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    -- Exemple : {"dashboard":"write","devices":"read","rules":"none","members":"none"}
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_system   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_roles_tenant ON roles (tenant_id);

-- 4. Membres d'un site (qui a accès à quel site avec quel rôle)
CREATE TABLE site_members (
    site_id   UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id   UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    added_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (site_id, user_id)
);

CREATE INDEX idx_site_members_user ON site_members (user_id);

-- 4bis. Rules : ajouter site_id pour pouvoir gérer le RBAC par site.
-- Les règles existantes sont attachées au 1er site de leur tenant
-- (compatible avec le schéma actuel mono-site).
ALTER TABLE rules ADD COLUMN site_id UUID REFERENCES sites(id) ON DELETE CASCADE;
UPDATE rules r SET site_id = (
    SELECT s.id FROM sites s WHERE s.tenant_id = r.tenant_id ORDER BY s.created_at LIMIT 1
);
ALTER TABLE rules ALTER COLUMN site_id SET NOT NULL;
CREATE INDEX idx_rules_site_enabled ON rules (site_id, enabled);

-- 5. Seed des rôles système pour chaque tenant existant.
INSERT INTO roles (tenant_id, name, description, permissions, is_system)
SELECT t.id,
       'Responsable de site',
       'Accès complet au site : dashboards, équipements, règles, membres.',
       jsonb_build_object('dashboard','write','devices','write','rules','write','members','write'),
       true
FROM tenants t
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO roles (tenant_id, name, description, permissions, is_system)
SELECT t.id,
       'Invité',
       'Accès en lecture seule sur les dashboards et équipements.',
       jsonb_build_object('dashboard','read','devices','read','rules','none','members','none'),
       true
FROM tenants t
ON CONFLICT (tenant_id, name) DO NOTHING;
