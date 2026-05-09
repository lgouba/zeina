-- Rollback impossible proprement : Postgres ne supporte pas DROP VALUE sur un
-- enum. Pour un rollback réel il faudrait recréer l'enum sans 'area' et migrer
-- toutes les colonnes — coûteux. On laisse le no-op (les widgets de type
-- 'area' resteraient inutilisables après down si l'app ne les supporte plus).
SELECT 1;
