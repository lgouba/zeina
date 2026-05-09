import {
  Droplets, Thermometer, Sun, Zap, Gauge, Activity,
  Battery, Plug, Power, Lightbulb, Cloud, Volume2, Waves, CircleDot,
  type LucideIcon,
} from "lucide-react";

/**
 * Métadonnées visuelles par type de mesure.
 *
 * Toutes les classes Tailwind sont écrites en clair (pas de concaténation
 * dynamique) pour que le JIT les conserve dans le bundle final.
 */

export interface MeasurementMeta {
  Icon: LucideIcon;
  label: string;          // libellé court FR
  iconColor: string;      // text-* pour l'icône en chip
  iconBg: string;         // bg-* pour le chip d'icône
  cardGradient: string;   // bg-gradient-to-br ... — fond complet
  watermark: string;      // text-* pour la grosse icône décorative
  valueColor: string;     // text-* pour le grand chiffre
  unitColor: string;      // text-* pour l'unité
  liveDot: string;        // bg-* pour le point "live"
  ringHover: string;      // ring-* au survol
  chartColor: string;     // hex — utilisé par recharts (line / area / bar)
  chartColorSoft: string; // hex — variante claire pour gradients
}

interface ThemeKey {
  base: string;            // sky | orange | emerald …
  // dégradé : on peut passer un second nom pour le côté "to-..."
  to?: string;
  chartColor: string;
  chartColorSoft: string;
}

function build(Icon: LucideIcon, label: string, t: ThemeKey): MeasurementMeta {
  const b = t.base;
  const to = t.to ?? b;
  // Tailwind JIT — on retourne des classes statiques par switch interne.
  return {
    Icon,
    label,
    iconColor: COLOR[b].iconColor,
    iconBg: COLOR[b].iconBg,
    cardGradient: GRADIENT[b][to] ?? GRADIENT[b][b],
    watermark: COLOR[b].watermark,
    valueColor: "text-slate-900 dark:text-white",
    unitColor: COLOR[b].unitColor,
    liveDot: COLOR[b].liveDot,
    ringHover: COLOR[b].ringHover,
    chartColor: t.chartColor,
    chartColorSoft: t.chartColorSoft,
  };
}

// Tables de classes Tailwind statiques par base
const COLOR: Record<string, {
  iconColor: string; iconBg: string; watermark: string;
  unitColor: string; liveDot: string; ringHover: string;
}> = {
  sky: {
    iconColor: "text-sky-600 dark:text-sky-300",
    iconBg: "bg-sky-500/15 dark:bg-sky-400/10",
    watermark: "text-sky-300/40 dark:text-sky-500/10",
    unitColor: "text-sky-600 dark:text-sky-300",
    liveDot: "bg-sky-500",
    ringHover: "hover:ring-sky-200 dark:hover:ring-sky-900/50",
  },
  orange: {
    iconColor: "text-orange-600 dark:text-orange-300",
    iconBg: "bg-orange-500/15 dark:bg-orange-400/10",
    watermark: "text-orange-300/40 dark:text-orange-500/10",
    unitColor: "text-orange-600 dark:text-orange-300",
    liveDot: "bg-orange-500",
    ringHover: "hover:ring-orange-200 dark:hover:ring-orange-900/50",
  },
  emerald: {
    iconColor: "text-emerald-600 dark:text-emerald-300",
    iconBg: "bg-emerald-500/15 dark:bg-emerald-400/10",
    watermark: "text-emerald-300/40 dark:text-emerald-500/10",
    unitColor: "text-emerald-600 dark:text-emerald-300",
    liveDot: "bg-emerald-500",
    ringHover: "hover:ring-emerald-200 dark:hover:ring-emerald-900/50",
  },
  amber: {
    iconColor: "text-amber-600 dark:text-amber-300",
    iconBg: "bg-amber-500/15 dark:bg-amber-400/10",
    watermark: "text-amber-300/40 dark:text-amber-500/10",
    unitColor: "text-amber-600 dark:text-amber-300",
    liveDot: "bg-amber-500",
    ringHover: "hover:ring-amber-200 dark:hover:ring-amber-900/50",
  },
  indigo: {
    iconColor: "text-indigo-600 dark:text-indigo-300",
    iconBg: "bg-indigo-500/15 dark:bg-indigo-400/10",
    watermark: "text-indigo-300/40 dark:text-indigo-500/10",
    unitColor: "text-indigo-600 dark:text-indigo-300",
    liveDot: "bg-indigo-500",
    ringHover: "hover:ring-indigo-200 dark:hover:ring-indigo-900/50",
  },
  fuchsia: {
    iconColor: "text-fuchsia-600 dark:text-fuchsia-300",
    iconBg: "bg-fuchsia-500/15 dark:bg-fuchsia-400/10",
    watermark: "text-fuchsia-300/40 dark:text-fuchsia-500/10",
    unitColor: "text-fuchsia-600 dark:text-fuchsia-300",
    liveDot: "bg-fuchsia-500",
    ringHover: "hover:ring-fuchsia-200 dark:hover:ring-fuchsia-900/50",
  },
  yellow: {
    iconColor: "text-yellow-600 dark:text-yellow-300",
    iconBg: "bg-yellow-500/15 dark:bg-yellow-400/10",
    watermark: "text-yellow-300/40 dark:text-yellow-500/10",
    unitColor: "text-yellow-600 dark:text-yellow-300",
    liveDot: "bg-yellow-500",
    ringHover: "hover:ring-yellow-200 dark:hover:ring-yellow-900/50",
  },
  violet: {
    iconColor: "text-violet-600 dark:text-violet-300",
    iconBg: "bg-violet-500/15 dark:bg-violet-400/10",
    watermark: "text-violet-300/40 dark:text-violet-500/10",
    unitColor: "text-violet-600 dark:text-violet-300",
    liveDot: "bg-violet-500",
    ringHover: "hover:ring-violet-200 dark:hover:ring-violet-900/50",
  },
  purple: {
    iconColor: "text-purple-600 dark:text-purple-300",
    iconBg: "bg-purple-500/15 dark:bg-purple-400/10",
    watermark: "text-purple-300/40 dark:text-purple-500/10",
    unitColor: "text-purple-600 dark:text-purple-300",
    liveDot: "bg-purple-500",
    ringHover: "hover:ring-purple-200 dark:hover:ring-purple-900/50",
  },
  teal: {
    iconColor: "text-teal-600 dark:text-teal-300",
    iconBg: "bg-teal-500/15 dark:bg-teal-400/10",
    watermark: "text-teal-300/40 dark:text-teal-500/10",
    unitColor: "text-teal-600 dark:text-teal-300",
    liveDot: "bg-teal-500",
    ringHover: "hover:ring-teal-200 dark:hover:ring-teal-900/50",
  },
  cyan: {
    iconColor: "text-cyan-600 dark:text-cyan-300",
    iconBg: "bg-cyan-500/15 dark:bg-cyan-400/10",
    watermark: "text-cyan-300/40 dark:text-cyan-500/10",
    unitColor: "text-cyan-600 dark:text-cyan-300",
    liveDot: "bg-cyan-500",
    ringHover: "hover:ring-cyan-200 dark:hover:ring-cyan-900/50",
  },
  slate: {
    iconColor: "text-slate-600 dark:text-slate-300",
    iconBg: "bg-slate-500/10 dark:bg-slate-400/10",
    watermark: "text-slate-200/70 dark:text-slate-700/30",
    unitColor: "text-slate-500 dark:text-slate-400",
    liveDot: "bg-slate-400",
    ringHover: "hover:ring-slate-200 dark:hover:ring-slate-700",
  },
};

const GRADIENT: Record<string, Record<string, string>> = {
  sky: {
    cyan: "bg-gradient-to-br from-sky-50 via-white to-cyan-50 dark:from-slate-900 dark:via-slate-900 dark:to-sky-950/40",
    sky: "bg-gradient-to-br from-sky-50 via-white to-sky-100 dark:from-slate-900 dark:via-slate-900 dark:to-sky-950/40",
  },
  orange: {
    rose: "bg-gradient-to-br from-orange-50 via-white to-rose-50 dark:from-slate-900 dark:via-slate-900 dark:to-orange-950/40",
    orange: "bg-gradient-to-br from-orange-50 via-white to-orange-100 dark:from-slate-900 dark:via-slate-900 dark:to-orange-950/40",
  },
  emerald: {
    teal: "bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/40",
    emerald: "bg-gradient-to-br from-emerald-50 via-white to-emerald-100 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/40",
  },
  amber: {
    yellow: "bg-gradient-to-br from-amber-50 via-white to-yellow-50 dark:from-slate-900 dark:via-slate-900 dark:to-amber-950/40",
    amber: "bg-gradient-to-br from-amber-50 via-white to-amber-100 dark:from-slate-900 dark:via-slate-900 dark:to-amber-950/40",
  },
  indigo: {
    blue: "bg-gradient-to-br from-indigo-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/40",
    indigo: "bg-gradient-to-br from-indigo-50 via-white to-indigo-100 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/40",
  },
  fuchsia: {
    pink: "bg-gradient-to-br from-fuchsia-50 via-white to-pink-50 dark:from-slate-900 dark:via-slate-900 dark:to-fuchsia-950/40",
    fuchsia: "bg-gradient-to-br from-fuchsia-50 via-white to-fuchsia-100 dark:from-slate-900 dark:via-slate-900 dark:to-fuchsia-950/40",
  },
  yellow: {
    amber: "bg-gradient-to-br from-yellow-50 via-white to-amber-50 dark:from-slate-900 dark:via-slate-900 dark:to-yellow-950/40",
    yellow: "bg-gradient-to-br from-yellow-50 via-white to-yellow-100 dark:from-slate-900 dark:via-slate-900 dark:to-yellow-950/40",
  },
  violet: {
    purple: "bg-gradient-to-br from-violet-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-900 dark:to-violet-950/40",
    violet: "bg-gradient-to-br from-violet-50 via-white to-violet-100 dark:from-slate-900 dark:via-slate-900 dark:to-violet-950/40",
  },
  purple: {
    fuchsia: "bg-gradient-to-br from-purple-50 via-white to-fuchsia-50 dark:from-slate-900 dark:via-slate-900 dark:to-purple-950/40",
    purple: "bg-gradient-to-br from-purple-50 via-white to-purple-100 dark:from-slate-900 dark:via-slate-900 dark:to-purple-950/40",
  },
  teal: {
    cyan: "bg-gradient-to-br from-teal-50 via-white to-cyan-50 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950/40",
    teal: "bg-gradient-to-br from-teal-50 via-white to-teal-100 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950/40",
  },
  cyan: {
    blue: "bg-gradient-to-br from-cyan-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-900 dark:to-cyan-950/40",
    cyan: "bg-gradient-to-br from-cyan-50 via-white to-cyan-100 dark:from-slate-900 dark:via-slate-900 dark:to-cyan-950/40",
  },
  slate: {
    slate: "bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/60",
  },
};

const FALLBACK: MeasurementMeta = build(Gauge, "Mesure", {
  base: "slate", chartColor: "#64748b", chartColorSoft: "#cbd5e1",
});

export function getMeasurementMeta(name?: string, unit?: string): MeasurementMeta {
  const key = (name || "").toLowerCase().trim();
  const u = (unit || "").toLowerCase().trim();

  // --- Environnement ---
  if (key === "humidity" || u === "%rh") {
    return build(Droplets, "Humidité",
      { base: "sky", to: "cyan", chartColor: "#0ea5e9", chartColorSoft: "#7dd3fc" });
  }
  if (key === "temperature" || u === "°c" || u === "c") {
    return build(Thermometer, "Température",
      { base: "orange", to: "rose", chartColor: "#f97316", chartColorSoft: "#fdba74" });
  }
  if (key === "co2" || u === "ppm") {
    return build(Cloud, "CO₂",
      { base: "emerald", to: "teal", chartColor: "#10b981", chartColorSoft: "#6ee7b7" });
  }
  if (key === "lux" || u === "lx") {
    return build(Sun, "Luminosité",
      { base: "amber", to: "yellow", chartColor: "#f59e0b", chartColorSoft: "#fcd34d" });
  }
  if (key === "pressure" || u === "hpa" || u === "bar") {
    return build(Gauge, "Pression",
      { base: "indigo", to: "blue", chartColor: "#6366f1", chartColorSoft: "#a5b4fc" });
  }
  if (key === "noise" || key === "sound" || u === "db") {
    return build(Volume2, "Bruit",
      { base: "fuchsia", to: "pink", chartColor: "#d946ef", chartColorSoft: "#f0abfc" });
  }

  // --- Énergie / Linky ---
  if (key === "pact" || key === "papp" || u === "w" || u === "va" || u === "kw") {
    return build(Zap, "Puissance",
      { base: "yellow", to: "amber", chartColor: "#eab308", chartColorSoft: "#fde047" });
  }
  if (key === "iinst" || u === "a") {
    return build(Activity, "Intensité",
      { base: "violet", to: "purple", chartColor: "#8b5cf6", chartColorSoft: "#c4b5fd" });
  }
  if (key === "urms" || u === "v") {
    return build(Plug, "Tension",
      { base: "purple", to: "fuchsia", chartColor: "#a855f7", chartColorSoft: "#d8b4fe" });
  }
  if (key === "base" || u === "wh" || u === "kwh") {
    return build(Battery, "Énergie",
      { base: "teal", to: "cyan", chartColor: "#14b8a6", chartColorSoft: "#5eead4" });
  }

  // --- Eau / débit ---
  if (key === "flow" || u === "l/min" || u === "m3/h" || u === "m³/h") {
    return build(Waves, "Débit",
      { base: "cyan", to: "blue", chartColor: "#06b6d4", chartColorSoft: "#67e8f9" });
  }

  // --- Présence / état ---
  if (key === "presence") {
    return build(CircleDot, "Présence",
      { base: "violet", to: "purple", chartColor: "#8b5cf6", chartColorSoft: "#c4b5fd" });
  }

  return FALLBACK;
}

/** Métadonnées dédiées aux actionneurs (StateWidget). */
export function getActuatorMeta(deviceSlug?: string, hint?: string): MeasurementMeta & { OnIcon: LucideIcon } {
  const slug = (deviceSlug || "").toLowerCase();
  const isLight = hint === "light" || slug.includes("light") || slug.includes("lamp");
  if (isLight) {
    const m = build(Lightbulb, "Éclairage",
      { base: "amber", to: "yellow", chartColor: "#f59e0b", chartColorSoft: "#fcd34d" });
    return { ...m, OnIcon: Lightbulb };
  }
  const m = build(Power, "Actionneur",
    { base: "emerald", to: "teal", chartColor: "#10b981", chartColorSoft: "#6ee7b7" });
  return { ...m, OnIcon: Power };
}
