DROP TRIGGER IF EXISTS users_sync_full_name_trg ON users;
DROP FUNCTION IF EXISTS users_sync_full_name();

ALTER TABLE users DROP COLUMN IF EXISTS phone;
ALTER TABLE users DROP COLUMN IF EXISTS job_title;
ALTER TABLE users DROP COLUMN IF EXISTS last_name;
ALTER TABLE users DROP COLUMN IF EXISTS first_name;
