import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Calendar, Clock, CheckCircle2 } from "lucide-react";
import { Help } from "./Tooltip";

/**
 * CronBuilder — éditeur de planning simplifié pour utilisateurs non-tech.
 *
 * Au lieu d'écrire une expression cron à la main, l'utilisateur :
 *   1. choisit un mode (quotidien / semaine / week-end / jours choisis / mensuel)
 *   2. règle l'heure et la minute
 *   3. (selon mode) coche les jours
 *
 * Le composant traduit les saisies en expression cron standard 5-champs et
 * affiche en temps réel une description en français pour vérification.
 *
 * Un mode « Personnalisé » reste dispo pour les utilisateurs avancés.
 */

type CronMode = "daily" | "weekdays" | "weekend" | "weekly" | "monthly" | "custom";

interface State {
  mode: CronMode;
  hour: number;
  minute: number;
  daysOfWeek: number[];   // 0 = dimanche … 6 = samedi
  dayOfMonth: number;     // 1-31
  customExpr: string;
}

const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const DAY_NAMES_LONG = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const MODES: { value: CronMode; label: string; tip: string }[] = [
  { value: "daily",    label: "Tous les jours", tip: "S'exécute chaque jour à l'heure choisie." },
  { value: "weekdays", label: "En semaine (lun-ven)", tip: "S'exécute du lundi au vendredi à l'heure choisie." },
  { value: "weekend",  label: "Week-end (sam-dim)",   tip: "S'exécute uniquement le samedi et le dimanche." },
  { value: "weekly",   label: "Jours choisis",        tip: "Sélectionnez vous-même les jours de la semaine concernés." },
  { value: "monthly",  label: "Une fois par mois",    tip: "S'exécute le N de chaque mois (par ex. le 1er)." },
  { value: "custom",   label: "Personnalisé (avancé)", tip: "Saisissez directement une expression cron 5 champs." },
];

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";

export function CronBuilder({ value, onChange }: { value: string; onChange: (expr: string) => void }) {
  const [state, setState] = useState<State>(() => parse(value));

  // Si le `value` externe change (ex. switch de type de trigger), on resync.
  useEffect(() => {
    setState(parse(value));
  }, [value]);

  // Quand le state interne change → on remonte la nouvelle expression cron.
  function update(next: Partial<State>) {
    const merged = { ...state, ...next };
    setState(merged);
    onChange(serialize(merged));
  }

  const description = useMemo(() => describe(state), [state]);

  const showTimePicker = state.mode !== "custom";
  const showDaysPicker = state.mode === "weekly";
  const showDayOfMonth = state.mode === "monthly";

  return (
    <div className="space-y-4">
      {/* Mode picker */}
      <div>
        <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5 font-medium">
          <Calendar className="h-3.5 w-3.5" /> Quand cette règle doit-elle se déclencher ?
          <Help>
            Choisissez la fréquence souhaitée. La plupart des cas se règlent en deux clics — utilisez « Personnalisé »
            uniquement si vous savez écrire une expression cron.
          </Help>
        </label>
        <select
          value={state.mode}
          onChange={(e) => update({ mode: e.target.value as CronMode })}
          className={inputCls}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Time picker */}
      {showTimePicker && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5 font-medium">
              <Clock className="h-3.5 w-3.5" /> Heure
            </label>
            <select value={state.hour} onChange={(e) => update({ hour: +e.target.value })} className={inputCls}>
              {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                <option key={h} value={h}>{pad(h)} h</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5 font-medium">
              Minute
              <Help>
                Choisissez la minute exacte du déclenchement. Pour exécuter toutes les 5 ou 15 minutes,
                passez en mode « Personnalisé ».
              </Help>
            </label>
            <select value={state.minute} onChange={(e) => update({ minute: +e.target.value })} className={inputCls}>
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <option key={m} value={m}>{pad(m)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Days of week (mode weekly) */}
      {showDaysPicker && (
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5 font-medium">
            Jours de la semaine
            <Help>Cliquez sur un jour pour l'inclure / l'exclure. Au moins un jour doit être sélectionné.</Help>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {/* Affiche Lundi en premier (1..6, 0) — convention FR */}
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const active = state.daysOfWeek.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? state.daysOfWeek.filter((x) => x !== d)
                      : [...state.daysOfWeek, d];
                    update({ daysOfWeek: next });
                  }}
                  className={clsx(
                    "px-3 py-1.5 text-xs font-semibold rounded-md transition border",
                    active
                      ? "bg-brand-500 text-white border-brand-500 shadow-sm"
                      : "bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-brand-400 hover:text-brand-500",
                  )}
                >
                  {DAY_LABELS[d]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Day of month (mode monthly) */}
      {showDayOfMonth && (
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5 font-medium">
            Jour du mois
            <Help>
              Choisissez un numéro de 1 à 31. Si le mois ne contient pas le jour choisi
              (ex. 31 février), la règle ne se déclenche pas ce mois-là.
            </Help>
          </label>
          <select
            value={state.dayOfMonth}
            onChange={(e) => update({ dayOfMonth: +e.target.value })}
            className={inputCls}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}{d === 1 ? "er" : ""} du mois</option>
            ))}
          </select>
        </div>
      )}

      {/* Custom expression */}
      {state.mode === "custom" && (
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5 font-medium">
            Expression cron
            <Help>
              Format 5 champs : <code className="font-mono">minute heure jour-du-mois mois jour-de-semaine</code>.
              Exemples :<br />
              <span className="font-mono">*/15 * * * *</span> → toutes les 15 minutes<br />
              <span className="font-mono">0 9-18 * * 1-5</span> → toutes les heures pleines, 9h-18h, lun-ven
            </Help>
          </label>
          <input
            value={state.customExpr}
            onChange={(e) => update({ customExpr: e.target.value })}
            placeholder="0 18 * * 1-5"
            className={inputCls + " font-mono"}
          />
        </div>
      )}

      {/* Live preview */}
      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10 p-3">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
        <div className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed">
          <div className="font-medium">{description}</div>
          {state.mode !== "custom" && (
            <div className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70 font-mono mt-1">
              cron : {serialize(state)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cron <-> state helpers
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function defaults(expr: string): State {
  return {
    mode: "daily",
    hour: 18,
    minute: 0,
    daysOfWeek: [1, 2, 3, 4, 5],
    dayOfMonth: 1,
    customExpr: expr || "0 18 * * 1-5",
  };
}

export function parse(expr: string): State {
  const base = defaults(expr);
  const parts = (expr || "").trim().split(/\s+/);
  if (parts.length !== 5) return { ...base, mode: "custom" };

  const [m, h, dom, mon, dow] = parts;
  const minute = parseInt(m, 10);
  const hour = parseInt(h, 10);
  if (isNaN(minute) || isNaN(hour) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return { ...base, mode: "custom" };
  }
  // Daily
  if (dom === "*" && mon === "*" && dow === "*") {
    return { ...base, mode: "daily", hour, minute };
  }
  // Weekdays
  if (dom === "*" && mon === "*" && dow === "1-5") {
    return { ...base, mode: "weekdays", hour, minute };
  }
  // Weekend
  if (dom === "*" && mon === "*" && (dow === "0,6" || dow === "6,0" || dow === "0,7" || dow === "6,7")) {
    return { ...base, mode: "weekend", hour, minute };
  }
  // Weekly avec liste de jours
  if (dom === "*" && mon === "*" && dow !== "*" && /^[0-9](,[0-9])*$/.test(dow)) {
    const days = dow.split(",").map((s) => parseInt(s, 10)).filter((n) => n >= 0 && n <= 6);
    if (days.length > 0) {
      return { ...base, mode: "weekly", hour, minute, daysOfWeek: days };
    }
  }
  // Monthly
  if (dow === "*" && mon === "*" && /^\d+$/.test(dom)) {
    const d = parseInt(dom, 10);
    if (d >= 1 && d <= 31) {
      return { ...base, mode: "monthly", hour, minute, dayOfMonth: d };
    }
  }
  return { ...base, mode: "custom" };
}

export function serialize(state: State): string {
  const m = state.minute;
  const h = state.hour;
  switch (state.mode) {
    case "daily":    return `${m} ${h} * * *`;
    case "weekdays": return `${m} ${h} * * 1-5`;
    case "weekend":  return `${m} ${h} * * 0,6`;
    case "weekly": {
      const days = [...state.daysOfWeek].sort((a, b) => a - b);
      if (days.length === 0) return `${m} ${h} * * *`; // safety
      return `${m} ${h} * * ${days.join(",")}`;
    }
    case "monthly":  return `${m} ${h} ${state.dayOfMonth} * *`;
    case "custom":   return state.customExpr.trim();
  }
}

/** Description en français lisible d'une expression cron. */
export function describeCron(expr: string): string {
  return describe(parse(expr));
}

function describe(state: State): string {
  if (state.mode === "custom") {
    return state.customExpr.trim() ? `Expression cron : ${state.customExpr}` : "Saisissez une expression cron";
  }
  const time = `${pad(state.hour)}h${pad(state.minute)}`;
  switch (state.mode) {
    case "daily":    return `S'exécutera tous les jours à ${time}.`;
    case "weekdays": return `S'exécutera du lundi au vendredi à ${time}.`;
    case "weekend":  return `S'exécutera le samedi et le dimanche à ${time}.`;
    case "weekly": {
      if (state.daysOfWeek.length === 0) return "Aucun jour sélectionné — choisissez au moins un jour.";
      const days = [...state.daysOfWeek].sort((a, b) => {
        const ord = (d: number) => (d === 0 ? 7 : d); // Lundi en tête
        return ord(a) - ord(b);
      });
      const names = days.map((d) => DAY_NAMES_LONG[d]);
      const list = names.length === 1
        ? `le ${names[0]}`
        : `le ${names.slice(0, -1).join(", le ")} et le ${names[names.length - 1]}`;
      return `S'exécutera ${list} à ${time}.`;
    }
    case "monthly": {
      const d = state.dayOfMonth;
      const ord = d === 1 ? "1ᵉʳ" : `${d}`;
      return `S'exécutera le ${ord} de chaque mois à ${time}.`;
    }
  }
}
