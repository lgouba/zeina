-- =============================================================================
-- ZEINA — profil utilisateur enrichi (Pulsio-style)
--
-- Ajoute Prénom / Nom / Fonction / Téléphone aux comptes utilisateurs.
-- Migre les `full_name` existants en splittant sur le 1er espace.
-- `full_name` reste pour la rétrocompat (vues, exports), tenu à jour par
-- trigger sur INSERT/UPDATE dès que first_name ou last_name change.
-- =============================================================================

ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name  TEXT;
ALTER TABLE users ADD COLUMN job_title  TEXT;
ALTER TABLE users ADD COLUMN phone      TEXT;

-- Migration des full_name existants : tout avant le 1er espace = first_name,
-- le reste = last_name. Si pas d'espace, full_name → first_name.
UPDATE users
SET    first_name = CASE
                      WHEN position(' ' IN full_name) > 0 THEN split_part(full_name, ' ', 1)
                      ELSE full_name
                    END,
       last_name  = CASE
                      WHEN position(' ' IN full_name) > 0
                        THEN substring(full_name FROM position(' ' IN full_name) + 1)
                      ELSE NULL
                    END
WHERE  full_name IS NOT NULL AND full_name <> '';

-- Trigger : maintient full_name = trim(first_name || ' ' || last_name) à jour.
-- Permet aux callers legacy qui ne lisent que full_name de continuer à
-- fonctionner sans changement.
CREATE OR REPLACE FUNCTION users_sync_full_name() RETURNS trigger AS $$
BEGIN
    NEW.full_name = NULLIF(
        trim(both ' ' FROM concat_ws(' ', NEW.first_name, NEW.last_name)),
        ''
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_sync_full_name_trg
    BEFORE INSERT OR UPDATE OF first_name, last_name
    ON users
    FOR EACH ROW
    EXECUTE FUNCTION users_sync_full_name();
