-- Layout (position + taille) d'un widget sur la grille du dashboard.
-- Format : {"x":0,"y":0,"w":4,"h":3} où x/y sont en colonnes/lignes de la
-- grille 12-cols et w/h en cellules.
ALTER TABLE dashboard_widgets ADD COLUMN IF NOT EXISTS layout JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN dashboard_widgets.layout IS
  'Position et taille du widget sur la grille react-grid-layout : {x,y,w,h}. Vide = layout calculé par défaut côté front.';
