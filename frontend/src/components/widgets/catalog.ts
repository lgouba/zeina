// Catalogue des widgets ZEINA — organisation par famille métier (à la
// Pulsio). Chaque entrée du catalogue est un widget « prêt à l'emploi » qui
// pointe vers un type technique sous-jacent (`value`, `gauge`, `line`, etc.)
// avec ses defaults (mesure, unité, bornes, titre).
//
// Pour ajouter un nouveau widget : ajouter une entrée ici et le picker se
// met à jour automatiquement. Pas de couplage frontend ⇄ backend ailleurs.

import {
  Activity, AirVent, AlertTriangle, BatteryFull, Bell, Camera, Cloud, CloudRain,
  CloudSnow, DoorOpen, Droplets, Eye, Factory, FileBarChart, FlaskConical, Flame,
  Flower, Gauge, Lightbulb, LineChart, MapPin, MoveDown, Network, Plug, Radio,
  Recycle, ShieldAlert, Snowflake, Sun, Thermometer, Tornado, Trees, Trash2, Volume2,
  Waves, Wind, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";
import type { WidgetType } from "../../types/api";

// ---------------------------------------------------------------------------
// Familles
// ---------------------------------------------------------------------------

export type FamilyId =
  | "ambient"        // Ambiance & environnement
  | "energy"         // Gestion de l'électricité
  | "water"          // Gestion de l'eau
  | "gas"            // Gestion du gaz
  | "weather"        // Phénomènes météorologiques
  | "surveillance"   // Surveillance
  | "level"          // Niveau (cuves, bruit, neige…)
  | "remote_control" // Pilotage à distance
  | "generic";       // Générique (carte, graphique libre)

export interface Family {
  id: FamilyId;
  label: string;
  /** Pour l'icône d'en-tête de colonne dans le picker. */
  icon: LucideIcon;
  /** Couleur d'accent — clés Tailwind. */
  accent: string;
}

export const FAMILIES: Family[] = [
  { id: "ambient",        label: "Ambiance & environnement",  icon: Flower,     accent: "text-sky-500 dark:text-sky-300" },
  { id: "generic",        label: "Générique",                 icon: FileBarChart, accent: "text-slate-500 dark:text-slate-300" },
  { id: "water",          label: "Gestion de l'eau",          icon: Droplets,   accent: "text-cyan-500 dark:text-cyan-300" },
  { id: "energy",         label: "Gestion de l'électricité",  icon: Zap,        accent: "text-yellow-500 dark:text-yellow-300" },
  { id: "gas",            label: "Gestion du gaz",            icon: Flame,      accent: "text-orange-500 dark:text-orange-300" },
  { id: "level",          label: "Niveau",                    icon: MoveDown,   accent: "text-indigo-500 dark:text-indigo-300" },
  { id: "weather",        label: "Phénomènes météorologiques", icon: CloudRain, accent: "text-blue-500 dark:text-blue-300" },
  { id: "remote_control", label: "Pilotage à distance",       icon: Wrench,     accent: "text-emerald-500 dark:text-emerald-300" },
  { id: "surveillance",   label: "Surveillance",              icon: ShieldAlert, accent: "text-violet-500 dark:text-violet-300" },
];

// ---------------------------------------------------------------------------
// Entrées du catalogue
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  /** Identifiant stable pour le picker — slug ASCII. */
  id: string;
  family: FamilyId;
  label: string;
  description?: string;
  icon: LucideIcon;

  /** Type technique sous-jacent (un des 6 types reconnus par WidgetRenderer). */
  widgetType: WidgetType;

  /** Defaults pour pré-remplir le config du widget. */
  defaults: {
    measurement?: string;
    unit?: string;
    decimals?: number;
    min?: number;
    max?: number;
    windowMinutes?: number;
    aggregation?: string;
  };

  /** Filtre les devices proposés à l'étape 2. Vide = tous types. */
  deviceTypes?: string[];

  /** Tags pour la recherche. */
  tags?: string[];

  /** Marque les entrées non encore implémentées (placeholder UI). */
  comingSoon?: boolean;
}

// ---------------------------------------------------------------------------
// Définitions
// ---------------------------------------------------------------------------

export const CATALOG: CatalogEntry[] = [
  // --- Ambiance & environnement -------------------------------------------
  { id: "humidity",     family: "ambient", label: "Humidité",          icon: Droplets,    widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "humidity", unit: "%", decimals: 1 }, tags: ["humidity", "rh"] },
  { id: "temperature",  family: "ambient", label: "Température",       icon: Thermometer, widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "temperature", unit: "°C", decimals: 1 }, tags: ["temp", "celsius"] },
  { id: "co2",          family: "ambient", label: "Dioxyde de carbone (CO₂)",   icon: Cloud, widgetType: "gauge", deviceTypes: ["environment"],
    defaults: { measurement: "co2", unit: "ppm", min: 400, max: 2000 }, tags: ["co2", "air"] },
  { id: "vocs",         family: "ambient", label: "Composés organiques volatiles (COV)", icon: FlaskConical, widgetType: "gauge", deviceTypes: ["environment"],
    defaults: { measurement: "voc", unit: "ppb", min: 0, max: 1000 }, tags: ["voc", "cov", "air"] },
  { id: "no2",          family: "ambient", label: "Dioxyde d'azote (NO₂)",      icon: AirVent, widgetType: "gauge", deviceTypes: ["environment"],
    defaults: { measurement: "no2", unit: "µg/m³", min: 0, max: 200 }, tags: ["no2"] },
  { id: "ozone",        family: "ambient", label: "Ozone (O₃)",        icon: Sun,         widgetType: "gauge", deviceTypes: ["environment"],
    defaults: { measurement: "o3", unit: "µg/m³", min: 0, max: 240 } },
  { id: "ch2o",         family: "ambient", label: "Formaldéhyde (CH₂O)", icon: FlaskConical, widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "ch2o", unit: "µg/m³", decimals: 0 } },
  { id: "h2s",          family: "ambient", label: "Sulfure d'hydrogène (H₂S)", icon: FlaskConical, widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "h2s", unit: "ppm", decimals: 2 } },
  { id: "pm1",          family: "ambient", label: "Particules fines (PM1)",  icon: Wind, widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "pm1", unit: "µg/m³", decimals: 1 } },
  { id: "pm25",         family: "ambient", label: "Particules fines (PM2.5)", icon: Wind, widgetType: "gauge", deviceTypes: ["environment"],
    defaults: { measurement: "pm25", unit: "µg/m³", min: 0, max: 75 } },
  { id: "pm10",         family: "ambient", label: "Particules fines (PM10)", icon: Wind,  widgetType: "gauge", deviceTypes: ["environment"],
    defaults: { measurement: "pm10", unit: "µg/m³", min: 0, max: 150 } },
  { id: "pressure",     family: "ambient", label: "Pression atmosphérique",  icon: Gauge, widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "pressure", unit: "hPa", decimals: 0 } },
  { id: "luminosity",   family: "ambient", label: "Luminosité",        icon: Sun,         widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "lux", unit: "lx", decimals: 0 }, tags: ["lux", "lumière"] },

  // --- Générique ----------------------------------------------------------
  { id: "chart",        family: "generic", label: "Graphique",         icon: LineChart, widgetType: "line",
    defaults: { windowMinutes: 30 }, tags: ["chart", "courbe"] },
  { id: "history-bar",  family: "generic", label: "Histogramme",       icon: FileBarChart, widgetType: "bar",
    defaults: { aggregation: "1h", windowMinutes: 24 * 60 } },
  { id: "map",          family: "generic", label: "Carte",             icon: MapPin,    widgetType: "map",
    defaults: {}, tags: ["map", "geo"] },

  // --- Eau ----------------------------------------------------------------
  { id: "water-now",    family: "water",   label: "Consommation réelle",      icon: Droplets, widgetType: "value", deviceTypes: ["meter"],
    defaults: { measurement: "flow", unit: "L/min", decimals: 1 } },
  { id: "water-history", family: "water",  label: "Historique de consommation", icon: FileBarChart, widgetType: "bar", deviceTypes: ["meter"],
    defaults: { measurement: "flow", unit: "L/min", aggregation: "1h", windowMinutes: 24 * 60 } },
  { id: "water-index",  family: "water",   label: "Index de consommation",      icon: Gauge, widgetType: "value", deviceTypes: ["meter"],
    defaults: { measurement: "value", unit: "m³", decimals: 0 } },

  // --- Énergie / électricité ----------------------------------------------
  { id: "elec-now",     family: "energy",  label: "Consommation réelle",        icon: Zap, widgetType: "value", deviceTypes: ["linky"],
    defaults: { measurement: "pact", unit: "W", decimals: 0 } },
  { id: "elec-history", family: "energy",  label: "Historique de consommation", icon: FileBarChart, widgetType: "bar", deviceTypes: ["linky"],
    defaults: { measurement: "pact", unit: "W", aggregation: "1h", windowMinutes: 24 * 60 } },
  { id: "elec-index",   family: "energy",  label: "Index de consommation",      icon: Gauge, widgetType: "value", deviceTypes: ["linky"],
    defaults: { measurement: "base", unit: "Wh", decimals: 0 } },
  { id: "elec-current", family: "energy",  label: "Intensité",                  icon: Activity, widgetType: "value", deviceTypes: ["linky"],
    defaults: { measurement: "iinst", unit: "A", decimals: 1 } },
  { id: "elec-voltage", family: "energy",  label: "Tension",                    icon: Plug, widgetType: "value", deviceTypes: ["linky"],
    defaults: { measurement: "urms", unit: "V", decimals: 0 } },

  // --- Gaz ----------------------------------------------------------------
  { id: "gas-now",      family: "gas",     label: "Consommation réelle",        icon: Flame, widgetType: "value", deviceTypes: ["meter"],
    defaults: { measurement: "flow", unit: "m³/h", decimals: 2 }, comingSoon: true },
  { id: "gas-history",  family: "gas",     label: "Historique de consommation", icon: FileBarChart, widgetType: "bar", deviceTypes: ["meter"],
    defaults: { aggregation: "1h", windowMinutes: 24 * 60 }, comingSoon: true },
  { id: "gas-index",    family: "gas",     label: "Index de consommation",      icon: Gauge, widgetType: "value", deviceTypes: ["meter"],
    defaults: { measurement: "value", unit: "m³", decimals: 0 }, comingSoon: true },

  // --- Niveau (cuve, bruit, neige…) ---------------------------------------
  { id: "noise",        family: "level",   label: "Bruit",             icon: Volume2,    widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "noise", unit: "dB", decimals: 0 }, tags: ["bruit", "sound"] },
  { id: "tank",         family: "level",   label: "Cuve",              icon: Gauge,      widgetType: "gauge", deviceTypes: ["meter"],
    defaults: { measurement: "level", unit: "%", min: 0, max: 100 } },
  { id: "water-level",  family: "level",   label: "Eau",               icon: Waves,      widgetType: "gauge", deviceTypes: ["meter"],
    defaults: { measurement: "level", unit: "cm", min: 0, max: 200 } },
  { id: "snow-level",   family: "level",   label: "Neige",             icon: CloudSnow,  widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "snow", unit: "cm", decimals: 0 }, comingSoon: true },
  { id: "pav",          family: "level",   label: "Point d'apport volontaire", icon: Recycle, widgetType: "gauge", deviceTypes: ["meter"],
    defaults: { measurement: "fill", unit: "%", min: 0, max: 100 }, tags: ["dechet", "pav", "trash"] },

  // --- Météo --------------------------------------------------------------
  { id: "weather-card", family: "weather", label: "Météo",             icon: CloudRain, widgetType: "value", deviceTypes: ["environment"],
    defaults: {}, comingSoon: true, tags: ["weather", "meteo"] },
  { id: "flood-watch",  family: "weather", label: "Vigilance crues",   icon: Waves,     widgetType: "value",
    defaults: { measurement: "flood", unit: "" }, comingSoon: true },
  { id: "weather-watch", family: "weather", label: "Vigilance météorologique", icon: Tornado, widgetType: "value",
    defaults: {}, comingSoon: true },
  { id: "wind",         family: "weather", label: "Vent",              icon: Wind,      widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "wind", unit: "km/h", decimals: 1 }, comingSoon: true },
  { id: "rain",         family: "weather", label: "Pluie",             icon: CloudRain, widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "rain", unit: "mm/h", decimals: 1 }, comingSoon: true },

  // --- Pilotage à distance ------------------------------------------------
  { id: "heating",      family: "remote_control", label: "Chauffage",   icon: Flame,      widgetType: "state", deviceTypes: ["actuator"],
    defaults: {} },
  { id: "lighting",     family: "remote_control", label: "Éclairage public", icon: Lightbulb, widgetType: "state", deviceTypes: ["actuator"],
    defaults: {} },
  { id: "access-control", family: "remote_control", label: "Contrôle d'accès", icon: DoorOpen, widgetType: "state", deviceTypes: ["actuator"],
    defaults: {}, comingSoon: true },
  { id: "generic-actuator", family: "remote_control", label: "Équipement générique", icon: Plug, widgetType: "state", deviceTypes: ["actuator"],
    defaults: {} },
  { id: "rcard",        family: "remote_control", label: "R-Card",      icon: Radio,      widgetType: "state", deviceTypes: ["actuator"],
    defaults: {}, comingSoon: true },
  { id: "seal",         family: "remote_control", label: "Scellé",      icon: Network,    widgetType: "state", deviceTypes: ["actuator"],
    defaults: {}, comingSoon: true },

  // --- Surveillance -------------------------------------------------------
  { id: "alarm",        family: "surveillance", label: "Alarme",        icon: Bell,           widgetType: "state", deviceTypes: ["actuator", "presence"],
    defaults: {}, comingSoon: true },
  { id: "battery",      family: "surveillance", label: "Batterie",      icon: BatteryFull,    widgetType: "value",
    defaults: { measurement: "battery", unit: "%", decimals: 0 }, comingSoon: true },
  { id: "camera",       family: "surveillance", label: "Caméra",        icon: Camera,         widgetType: "value",
    defaults: {}, comingSoon: true },
  { id: "presence-watch", family: "surveillance", label: "Détection de présence", icon: Eye, widgetType: "state", deviceTypes: ["presence"],
    defaults: { measurement: "presence" } },
  { id: "custom-state", family: "surveillance", label: "État personnalisable", icon: AlertTriangle, widgetType: "value",
    defaults: {}, comingSoon: true },
  { id: "smoke",        family: "surveillance", label: "Fumée",          icon: Factory,       widgetType: "state", deviceTypes: ["presence"],
    defaults: { measurement: "smoke" }, comingSoon: true },
  { id: "tilt",         family: "surveillance", label: "Inclinaison",    icon: Activity,      widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "tilt", unit: "°", decimals: 1 }, comingSoon: true },
  { id: "flood",        family: "surveillance", label: "Inondation",     icon: Waves,         widgetType: "state", deviceTypes: ["presence"],
    defaults: { measurement: "flood" }, comingSoon: true },
  { id: "open-close",   family: "surveillance", label: "Ouverture-fermeture", icon: DoorOpen,  widgetType: "state", deviceTypes: ["presence"],
    defaults: { measurement: "contact" } },

  // --- Petits suppléments cachés (utiles mais hors layout) ----------------
  { id: "snowflake",    family: "weather", label: "Neige",              icon: Snowflake,     widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "snow_depth", unit: "cm" }, comingSoon: true },
  { id: "trash-pile",   family: "level",   label: "Poubelle",           icon: Trash2,        widgetType: "gauge", deviceTypes: ["meter"],
    defaults: { measurement: "fill", unit: "%", min: 0, max: 100 }, comingSoon: true },
  { id: "trees-canopy", family: "ambient", label: "Indice végétation",  icon: Trees,         widgetType: "value", deviceTypes: ["environment"],
    defaults: { measurement: "ndvi", decimals: 2 }, comingSoon: true },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function entriesByFamily(family: FamilyId): CatalogEntry[] {
  return CATALOG.filter((e) => e.family === family);
}

export function findEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id);
}

export function searchCatalog(q: string): CatalogEntry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return CATALOG;
  return CATALOG.filter((e) =>
    e.label.toLowerCase().includes(needle)
    || e.id.includes(needle)
    || (e.tags || []).some((t) => t.includes(needle))
  );
}
