import { useEffect, useRef, useState } from "react";
import { ChevronDown, Calendar, Clock } from "lucide-react";
import clsx from "clsx";
import { api } from "../../lib/api";
import {
  DEFAULT_FREQUENCY, DEFAULT_PERIOD, FREQUENCY_OPTIONS, PERIOD_OPTIONS,
  type FrequencyKey, type PeriodKey,
  frequencyLabel, periodLabel, suggestFrequency,
} from "../../lib/widgetTime";
import type { Widget } from "../../types/api";

/**
 * WidgetTimeControls — pills compactes affichées en haut à droite du widget.
 * - Toujours : sélecteur de période
 * - Optionnel : sélecteur de fréquence (graphes uniquement, pas les valeurs)
 *
 * Persiste les changements via PUT /v1/widgets/:id et notifie le parent via
 * onChange pour que la vue se rafraîchisse immédiatement.
 */
export function WidgetTimeControls({
  widget, period, frequency, showFrequency, onChange,
}: {
  widget: Widget;
  period: PeriodKey;
  frequency?: FrequencyKey;
  showFrequency: boolean;
  /** Callback notifié *avant* la persistance pour optimistic update. */
  onChange: (next: { period: PeriodKey; frequency?: FrequencyKey }) => void;
}) {
  async function persist(nextPeriod: PeriodKey, nextFreq: FrequencyKey | undefined) {
    onChange({ period: nextPeriod, frequency: nextFreq });
    try {
      const cfg = { ...widget.config, period: nextPeriod };
      if (showFrequency) (cfg as Record<string, unknown>).frequency = nextFreq;
      await api.put(`/v1/widgets/${widget.id}`, { config: cfg });
    } catch (e) {
      // Silencieux — le widget continue d'afficher la valeur optimiste.
      console.error("save widget time config", e);
    }
  }

  return (
    <div className="no-drag flex flex-wrap items-center gap-1 justify-end">
      <Pill
        icon={<Calendar className="h-3 w-3" />}
        label={periodLabel(period)}
        title="Choisir la période"
        options={PERIOD_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
        selected={period}
        onPick={(k) => {
          const nextP = k as PeriodKey;
          // Suggère une fréquence cohérente quand la période change.
          const nextF = showFrequency ? suggestFrequency(nextP) : undefined;
          persist(nextP, nextF);
        }}
      />
      {showFrequency && (
        <Pill
          icon={<Clock className="h-3 w-3" />}
          label={frequencyLabel(frequency || DEFAULT_FREQUENCY)}
          title="Choisir la fréquence d'agrégation"
          options={FREQUENCY_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
          selected={frequency || DEFAULT_FREQUENCY}
          onPick={(k) => persist(period, k as FrequencyKey)}
        />
      )}
    </div>
  );
}

function Pill({ icon, label, title, options, selected, onPick }: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  options: { key: string; label: string }[];
  selected: string;
  onPick: (k: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title={title}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium
          bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm
          text-slate-600 dark:text-slate-300
          ring-1 ring-slate-200 dark:ring-slate-700
          hover:ring-brand-400 dark:hover:ring-brand-500
          hover:text-brand-600 dark:hover:text-brand-300 transition">
        <span className="text-slate-400 dark:text-slate-500">{icon}</span>
        <span className="truncate max-w-[140px]">{label}</span>
        <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-[200px] rounded-md
          bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700
          shadow-2xl py-1 max-h-72 overflow-auto">
          {options.map((o) => (
            <button
              key={o.key}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onPick(o.key); }}
              className={clsx(
                "w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800",
                o.key === selected && "bg-brand-500/10 text-brand-600 dark:text-brand-300 font-medium",
              )}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Lit la période depuis la config du widget, avec fallback. */
export function readPeriod(cfg: Record<string, unknown>): PeriodKey {
  const v = cfg.period;
  if (typeof v === "string" && PERIOD_OPTIONS.some((o) => o.key === v)) return v as PeriodKey;
  return DEFAULT_PERIOD;
}

/** Lit la fréquence depuis la config du widget, avec fallback. */
export function readFrequency(cfg: Record<string, unknown>): FrequencyKey {
  const v = cfg.frequency;
  if (typeof v === "string" && FREQUENCY_OPTIONS.some((o) => o.key === v)) return v as FrequencyKey;
  return DEFAULT_FREQUENCY;
}
