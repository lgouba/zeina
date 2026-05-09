-- Étend l'enum widget_type pour accepter 'map' — widget qui affiche les
-- zones et équipements d'un site sur une carte Leaflet.
ALTER TYPE widget_type ADD VALUE IF NOT EXISTS 'map';
