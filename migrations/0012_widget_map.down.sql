-- Postgres ne supporte pas le retrait d'une valeur d'enum sans recréer le
-- type. Down volontairement no-op : on accepte la valeur 'map' comme
-- définitive une fois mergée.
SELECT 1;
