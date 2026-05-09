// widgetTime.ts — modèle commun « période + fréquence » pour les widgets.
//
// Période → calcule un couple (from, to) à passer à l'API.
// Fréquence → mappe sur l'aggrégation backend (raw|1min|15min|1h|1d).

export type PeriodKey =
  | "today"
  | "yesterday"
  | "last_24h"
  | "current_week"
  | "last_7d"
  | "last_14d"
  | "last_30d"
  | "current_month"
  | "last_month"
  | "current_year"
  | "last_year"
  | "last_12_months";

export interface PeriodOption {
  key: PeriodKey;
  label: string;
}

export const PERIOD_OPTIONS: PeriodOption[] = [
  { key: "yesterday",      label: "Hier" },
  { key: "today",          label: "Aujourd'hui" },
  { key: "last_24h",       label: "Les 24 dernières heures" },
  { key: "current_week",   label: "Cette semaine" },
  { key: "last_7d",        label: "Les 7 derniers jours" },
  { key: "last_14d",       label: "Les 14 derniers jours" },
  { key: "last_30d",       label: "Les 30 derniers jours" },
  { key: "current_month",  label: "Le mois en cours" },
  { key: "last_month",     label: "Le dernier mois" },
  { key: "current_year",   label: "L'année en cours" },
  { key: "last_year",      label: "L'année dernière" },
  { key: "last_12_months", label: "Les 12 derniers mois" },
];

export const DEFAULT_PERIOD: PeriodKey = "last_24h";

const MS_DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // lundi = 0
  x.setDate(x.getDate() - day);
  return x;
}
function startOfMonth(d: Date): Date { const x = startOfDay(d); x.setDate(1); return x; }
function startOfYear(d: Date): Date { const x = startOfMonth(d); x.setMonth(0); return x; }

export function resolvePeriod(key: PeriodKey, now: Date = new Date()): { from: Date; to: Date } {
  const to = now;
  switch (key) {
    case "today":          return { from: startOfDay(now), to };
    case "yesterday": {
      const todayStart = startOfDay(now);
      const yStart = new Date(todayStart.getTime() - MS_DAY);
      return { from: yStart, to: todayStart };
    }
    case "last_24h":       return { from: new Date(now.getTime() - MS_DAY), to };
    case "current_week":   return { from: startOfWeek(now), to };
    case "last_7d":        return { from: new Date(now.getTime() - 7  * MS_DAY), to };
    case "last_14d":       return { from: new Date(now.getTime() - 14 * MS_DAY), to };
    case "last_30d":       return { from: new Date(now.getTime() - 30 * MS_DAY), to };
    case "current_month":  return { from: startOfMonth(now), to };
    case "last_month": {
      const monthStart = startOfMonth(now);
      const prevStart = new Date(monthStart);
      prevStart.setMonth(prevStart.getMonth() - 1);
      return { from: prevStart, to: monthStart };
    }
    case "current_year":   return { from: startOfYear(now), to };
    case "last_year": {
      const yearStart = startOfYear(now);
      const prevStart = new Date(yearStart);
      prevStart.setFullYear(prevStart.getFullYear() - 1);
      return { from: prevStart, to: yearStart };
    }
    case "last_12_months": {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 12);
      return { from, to };
    }
  }
}

// ---------------------------------------------------------------------------
// Fréquence — exposée à l'utilisateur, mappée sur l'aggrégation backend
// (CAGGs : measurements_1min / _15min / _1h / _1d ou raw pour brut).
// ---------------------------------------------------------------------------

export type FrequencyKey = "raw" | "1min" | "15min" | "1h" | "1d";

export interface FrequencyOption {
  key: FrequencyKey;
  label: string;
}

export const FREQUENCY_OPTIONS: FrequencyOption[] = [
  { key: "raw",   label: "Brut (chaque mesure)" },
  { key: "1min",  label: "1 minute" },
  { key: "15min", label: "15 minutes" },
  { key: "1h",    label: "1 heure" },
  { key: "1d",    label: "1 jour" },
];

export const DEFAULT_FREQUENCY: FrequencyKey = "15min";

/** Choisit une fréquence par défaut adaptée à la durée de la période. */
export function suggestFrequency(periodKey: PeriodKey): FrequencyKey {
  switch (periodKey) {
    case "today":
    case "yesterday":
    case "last_24h":       return "15min";
    case "current_week":
    case "last_7d":        return "1h";
    case "last_14d":
    case "last_30d":
    case "current_month":
    case "last_month":     return "1h";
    case "current_year":
    case "last_year":
    case "last_12_months": return "1d";
  }
}

export function periodLabel(key: PeriodKey): string {
  return PERIOD_OPTIONS.find((p) => p.key === key)?.label ?? key;
}

export function frequencyLabel(key: FrequencyKey): string {
  return FREQUENCY_OPTIONS.find((f) => f.key === key)?.label ?? key;
}
