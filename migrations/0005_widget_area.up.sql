-- Ajoute le type "area" (aire colorée — courbe avec dégradé) à l'enum widget_type.
-- ALTER TYPE ... ADD VALUE doit être en dehors de toute transaction côté Postgres
-- (golang-migrate gère ça avec un fichier séparé).
ALTER TYPE widget_type ADD VALUE IF NOT EXISTS 'area';
