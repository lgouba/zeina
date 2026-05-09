DROP TABLE IF EXISTS user_activation_codes;
DROP TYPE IF EXISTS activation_purpose;

-- On rend password_hash NOT NULL à nouveau (les users sans password sont
-- supprimés ou doivent être réinitialisés avant la down migration).
DELETE FROM users WHERE password_hash IS NULL OR password_hash = '';
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;

ALTER TABLE users DROP COLUMN status;
DROP TYPE IF EXISTS user_status;
