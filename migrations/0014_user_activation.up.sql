-- =============================================================================
-- ZEINA — gestion d'activation des comptes utilisateurs
--
-- Avant : un user créé par admin recevait un mot de passe temporaire affiché
-- une fois côté UI ; pas de notion de statut.
--
-- Après :
--   - users.status (pending | active | disabled)
--     • pending  : créé par admin, attend l'activation via code email
--     • active   : a fini son onboarding (password défini)
--     • disabled : désactivé manuellement (login bloqué)
--   - users.password_hash devient NULLABLE (un user pending n'a pas encore de pw)
--   - user_activation_codes : codes 6 chiffres bcrypt-hashés, expire 15 min,
--     5 tentatives max, single-use. Sert pour first_login ET password_reset.
-- =============================================================================

-- 1. Nouveau enum + colonne status (les users existants ont déjà un password,
--    on les passe en 'active' rétroactivement).
CREATE TYPE user_status AS ENUM ('pending', 'active', 'disabled');

ALTER TABLE users ADD COLUMN status user_status NOT NULL DEFAULT 'active';

UPDATE users SET status = 'active' WHERE password_hash IS NOT NULL AND password_hash <> '';

-- 2. password_hash devient nullable (un user pending n'en a pas encore).
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 3. Table des codes d'activation / réinitialisation
CREATE TYPE activation_purpose AS ENUM ('first_login', 'password_reset');

CREATE TABLE user_activation_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,                       -- bcrypt du code 6 chiffres
    purpose     activation_purpose NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pour la lookup verify-code on cherche le dernier code actif d'un user
-- pour un purpose donné.
CREATE INDEX idx_activation_codes_lookup
    ON user_activation_codes (user_id, purpose, used_at, expires_at);

-- Cleanup régulier (peut être un cron ou pg_cron plus tard) — pas de TRIGGER
-- ici pour rester simple, on filtre juste sur expires_at à la lecture.
