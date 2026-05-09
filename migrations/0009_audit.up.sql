-- =============================================================================
-- ZEINA — journal d'audit des actions sensibles
--
-- Captures non-falsifiable des opérations qui changent les permissions ou la
-- structure (création/suppression de site, attribution de rôle, etc.).
-- Append-only — pas d'UPDATE ni DELETE par l'application.
-- =============================================================================

CREATE TABLE audit_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email TEXT,                       -- snapshot, survit à la suppression du user
    action      TEXT NOT NULL,              -- ex: site.create, member.add, user.update, role.delete
    target_type TEXT,                       -- ex: site, user, role, member
    target_id   UUID,                       -- id de la ressource impactée
    target_name TEXT,                       -- snapshot lisible (nom du site, email du user, etc.)
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- payload contextuel (avant/après pour les updates)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant_time ON audit_events (tenant_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_events (actor_id);
CREATE INDEX idx_audit_target ON audit_events (target_type, target_id);
