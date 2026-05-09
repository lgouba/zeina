// ruleTemplates.ts — bibliothèque de modèles de règles prêts à l'emploi.
//
// Chaque template est une RuleDefinition partielle qu'on insère telle quelle
// dans le RuleModal. L'utilisateur peut ensuite ajuster les champs (device,
// seuils, destinataires) avant de sauver.
//
// Les `device_slug` sont laissés vides ("") — l'éditeur les remplira avec un
// device compatible du site (filtré par device.type) à l'ouverture.

import type { RuleDefinition } from "../types/api";

export interface RuleTemplate {
  id: string;
  category: "comfort" | "energy" | "presence" | "maintenance" | "safety";
  name: string;
  description: string;
  /** Type de device requis pour proposer ce template (ou null = tous). */
  preferredDeviceType?: string;
  definition: RuleDefinition;
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  // ───────────────────────── Confort QAI ─────────────────────────────
  {
    id: "co2-comfort",
    category: "comfort",
    name: "CO₂ — confort dépassé",
    description: "Alerte quand le CO₂ d'une salle dépasse 1000 ppm pendant 5 min (NF EN 16798-1, classe II).",
    preferredDeviceType: "environment",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "co2", op: ">", value: 1000, sustained_seconds: 300 },
      actions: [
        { type: "notify", level: "warning", message: "🌬️ {device.name} : CO₂ = {value} ppm en {zone.name} — pensez à aérer." },
      ],
      cooldown_seconds: 1800,
    },
  },
  {
    id: "co2-critical",
    category: "comfort",
    name: "CO₂ — niveau critique",
    description: "Notification critique quand le CO₂ dépasse 1500 ppm — indicateur d'air confiné.",
    preferredDeviceType: "environment",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "co2", op: ">", value: 1500, sustained_seconds: 120 },
      actions: [
        { type: "notify", level: "critical", message: "🚨 CO₂ critique en {zone.name} — {value} ppm. Aération immédiate." },
      ],
      cooldown_seconds: 900,
    },
  },
  {
    id: "humidity-low",
    category: "comfort",
    name: "Humidité — air trop sec",
    description: "Alerte si l'humidité descend sous 30 % pendant 30 min (inconfort respiratoire).",
    preferredDeviceType: "environment",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "humidity", op: "<", value: 30, sustained_seconds: 1800 },
      actions: [
        { type: "notify", level: "warning", message: "💧 Humidité basse en {zone.name} : {value} % — humidificateur conseillé." },
      ],
      cooldown_seconds: 3600,
    },
  },
  {
    id: "humidity-high",
    category: "comfort",
    name: "Humidité — risque moisissure",
    description: "Alerte si l'humidité dépasse 70 % pendant 1h (risque condensation/moisissure).",
    preferredDeviceType: "environment",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "humidity", op: ">", value: 70, sustained_seconds: 3600 },
      actions: [
        { type: "notify", level: "warning", message: "💦 Humidité élevée en {zone.name} : {value} %. Vérifier ventilation." },
      ],
      cooldown_seconds: 7200,
    },
  },
  {
    id: "temperature-overheating",
    category: "comfort",
    name: "Température — surchauffe",
    description: "Alerte si la température dépasse 28 °C pendant 30 min en heures ouvrées.",
    preferredDeviceType: "environment",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "temperature", op: ">", value: 28, sustained_seconds: 1800 },
      time_window: { days: [1,2,3,4,5], start_hour: 8, end_hour: 18, timezone: "Africa/Ouagadougou" },
      actions: [
        { type: "notify", level: "warning", message: "🌡️ Surchauffe {zone.name} : {value}°C — vérifier clim/ventilation." },
      ],
      cooldown_seconds: 1800,
    },
  },
  {
    id: "temperature-freezing",
    category: "comfort",
    name: "Température — risque gel",
    description: "Alerte si la température descend sous 5 °C (risque rupture canalisation).",
    preferredDeviceType: "environment",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "temperature", op: "<", value: 5, sustained_seconds: 600 },
      actions: [
        { type: "notify", level: "critical", message: "🥶 Risque de gel en {zone.name} : {value}°C." },
      ],
      cooldown_seconds: 1800,
    },
  },
  {
    id: "voc-poor-air",
    category: "comfort",
    name: "COV — air dégradé",
    description: "Alerte si l'indice COV dépasse 250 (qualité d'air dégradée).",
    preferredDeviceType: "environment",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "tvoc", op: ">", value: 250, sustained_seconds: 600 },
      actions: [
        { type: "notify", level: "warning", message: "🧪 Indice COV élevé en {zone.name} : {value}. Aération recommandée." },
      ],
      cooldown_seconds: 1800,
    },
  },

  // ───────────────────────── Présence / éclairage ────────────────────
  {
    id: "lights-off-when-empty",
    category: "presence",
    name: "Éteindre la lumière en absence",
    description: "Si plus aucune présence détectée → éteindre l'éclairage. Sustained 10 min.",
    preferredDeviceType: "presence",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "presence", op: "==", value: 0, sustained_seconds: 600 },
      actions: [
        { type: "set_actuator", device_slug: "", state: "off" },
        { type: "notify", level: "info", message: "💡 Lumière éteinte automatiquement en {zone.name} (absence prolongée)." },
      ],
      cooldown_seconds: 60,
    },
  },
  {
    id: "presence-after-hours",
    category: "presence",
    name: "Présence en dehors des heures ouvrées",
    description: "Notifier toute détection de présence en soirée / weekend (sécurité).",
    preferredDeviceType: "presence",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "presence", op: "==", value: 1 },
      time_window: { days: [0, 6], start_hour: 0, end_hour: 24, timezone: "Africa/Ouagadougou" },
      actions: [
        { type: "notify", level: "warning", message: "🚪 Présence détectée en {zone.name} le {date} à {time}." },
      ],
      cooldown_seconds: 900,
    },
  },

  // ───────────────────────── Énergie ─────────────────────────────────
  {
    id: "energy-spike",
    category: "energy",
    name: "Pic de consommation anormal",
    description: "Alerte si la puissance instantanée dépasse 5 kW.",
    preferredDeviceType: "linky",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "power", op: ">", value: 5000, sustained_seconds: 300 },
      actions: [
        { type: "notify", level: "warning", message: "⚡ Pic de consommation : {value} W sur {device.name}. Vérifier les charges." },
      ],
      cooldown_seconds: 1800,
    },
  },
  {
    id: "consumption-night",
    category: "energy",
    name: "Conso nocturne anormale",
    description: "Notification si conso > 1 kW entre 23h et 5h (équipement oublié).",
    preferredDeviceType: "linky",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "power", op: ">", value: 1000, sustained_seconds: 1800 },
      time_window: { start_hour: 23, end_hour: 5, timezone: "Africa/Ouagadougou" },
      actions: [
        { type: "notify", level: "warning", message: "🌙 Conso nocturne anormale sur {device.name} : {value} W à {time}." },
      ],
      cooldown_seconds: 3600,
    },
  },

  // ───────────────────────── Sécurité ────────────────────────────────
  {
    id: "water-leak",
    category: "safety",
    name: "Fuite d'eau détectée",
    description: "Notification critique dès que le capteur de fuite déclenche.",
    preferredDeviceType: "environment",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "water_leak", op: "==", value: 1 },
      actions: [
        { type: "notify", level: "critical", message: "💧 FUITE détectée en {zone.name} sur {device.name}. Couper l'eau." },
        { type: "email", recipients: ["maintenance@exemple.com"], subject: "[ZEINA] Fuite d'eau — {zone.name}", message: "Une fuite a été détectée à {timestamp} en {zone.name} (capteur {device.name}). Intervention immédiate.", level: "critical" },
      ],
      cooldown_seconds: 600,
    },
  },
  {
    id: "door-open-too-long",
    category: "safety",
    name: "Porte ouverte trop longtemps",
    description: "Alerte si une porte reste ouverte plus de 5 min.",
    preferredDeviceType: "environment",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "door_open", op: "==", value: 1, sustained_seconds: 300 },
      actions: [
        { type: "notify", level: "warning", message: "🚪 Porte ouverte > 5 min en {zone.name} ({device.name})." },
      ],
      cooldown_seconds: 600,
    },
  },

  // ───────────────────────── Maintenance ─────────────────────────────
  {
    id: "daily-summary",
    category: "maintenance",
    name: "Récap quotidien (cron 8h)",
    description: "Notification quotidienne à 8h du matin pour rappeler le check.",
    definition: {
      trigger: { type: "cron", schedule: "0 8 * * *" },
      actions: [
        { type: "notify", level: "info", message: "☕ Bonjour ! Pensez à vérifier le tableau de bord ZEINA — {date}." },
      ],
    },
  },
  {
    id: "battery-low",
    category: "maintenance",
    name: "Batterie capteur faible",
    description: "Alerte quand le niveau de batterie d'un capteur passe sous 20 %.",
    preferredDeviceType: "environment",
    definition: {
      trigger: { type: "threshold", device_slug: "", measurement: "battery", op: "<", value: 20 },
      actions: [
        { type: "notify", level: "warning", message: "🔋 Batterie faible sur {device.name} ({value} %) — prévoir remplacement." },
      ],
      cooldown_seconds: 86400,
    },
  },
];

export function templatesByCategory(): Record<RuleTemplate["category"], RuleTemplate[]> {
  const out: Record<string, RuleTemplate[]> = {};
  for (const t of RULE_TEMPLATES) {
    (out[t.category] ||= []).push(t);
  }
  return out as Record<RuleTemplate["category"], RuleTemplate[]>;
}

export const CATEGORY_LABELS: Record<RuleTemplate["category"], string> = {
  comfort: "Confort & QAI",
  energy: "Énergie",
  presence: "Présence & éclairage",
  safety: "Sécurité",
  maintenance: "Maintenance",
};

export const CATEGORY_EMOJIS: Record<RuleTemplate["category"], string> = {
  comfort: "🌿",
  energy: "⚡",
  presence: "🚶",
  safety: "🛡️",
  maintenance: "🔧",
};
