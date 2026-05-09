-- Restore les anciennes permissions de l'Invité (read uniquement sur dashboard
-- et devices, none sur rules et members).
UPDATE roles
SET    permissions = jsonb_build_object(
           'dashboard', 'read',
           'devices',   'read',
           'rules',     'none',
           'members',   'none'
       ),
       description = 'Accès en lecture seule sur les dashboards et équipements.',
       updated_at  = now()
WHERE  is_system = true
  AND  name = 'Invité';
