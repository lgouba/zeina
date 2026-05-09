import { useState } from "react";
import { Loader2, Power } from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../../lib/api";
import { useLiveState } from "../../lib/liveStore";
import type { Widget } from "../../types/api";
import { getActuatorMeta } from "./measurementMeta";

/**
 * StateWidget — affiche l'état d'un actionneur et expose deux boutons ON/OFF
 * pour le piloter via l'API (qui publie sur MQTT).
 */
export function StateWidget({ widget }: { widget: Widget }) {
  const cfg = widget.config as Record<string, string | undefined>;
  const deviceId = cfg.device_id as string;
  const siteSlug = cfg.site_slug as string;
  const deviceSlug = cfg.device_slug as string;

  const live = useLiveState(siteSlug || null, deviceSlug || null) as { state?: string } | undefined;
  const state: "on" | "off" | "?" = live?.state === "on" ? "on" : live?.state === "off" ? "off" : "?";

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(target: "on" | "off") {
    setError(null);
    setPending(target);
    try {
      await api.post(`/v1/devices/${deviceId}/command`, {
        action: "set",
        payload: { state: target },
      });
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally {
      setPending(null);
    }
  }

  const meta = getActuatorMeta(deviceSlug, cfg.icon as string | undefined);
  const Icon = meta.Icon;
  const isOn = state === "on";

  return (
    <div className={clsx(
      "relative h-full w-full p-5 rounded-xl overflow-hidden ring-1 ring-transparent transition flex flex-col",
      meta.cardGradient,
      meta.ringHover,
    )}>
      {/* Filigrane */}
      <Icon
        className={clsx("pointer-events-none absolute -right-4 -bottom-6 h-36 w-36", meta.watermark)}
        strokeWidth={1.2}
        aria-hidden
      />

      {/* Header */}
      <div className="relative flex items-center gap-2.5 min-w-0">
        <div className={clsx("flex-shrink-0 rounded-lg p-2", meta.iconBg)}>
          <Icon className={clsx("h-4 w-4", meta.iconColor)} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold truncate">
            {widget.title}
          </div>
        </div>
        {state !== "?" && (
          <span className={clsx(
            "flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
            isOn
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "bg-slate-500/10 text-slate-600 dark:text-slate-400",
          )}>
            {isOn ? "Allumé" : "Éteint"}
          </span>
        )}
      </div>

      {/* Visuel central */}
      <div className="relative flex-1 flex items-center justify-center my-2">
        <div className={clsx(
          "relative w-20 h-20 rounded-2xl flex items-center justify-center transition-all duration-300",
          isOn
            ? clsx(meta.iconBg, "shadow-lg")
            : "bg-slate-200/60 dark:bg-slate-800/60",
        )}>
          {isOn && (
            <span className={clsx(
              "absolute inset-0 rounded-2xl animate-pulse opacity-30",
              meta.liveDot,
            )} />
          )}
          <Icon
            className={clsx(
              "relative h-10 w-10 transition-colors",
              isOn ? meta.iconColor : "text-slate-400 dark:text-slate-600",
            )}
            strokeWidth={isOn ? 2.2 : 1.6}
          />
        </div>
      </div>

      {/* Boutons */}
      <div className="relative flex gap-2">
        <button
          onClick={() => send("off")}
          disabled={pending !== null || state === "off"}
          className={clsx(
            "no-drag flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5",
            "bg-white/80 dark:bg-slate-800/80 backdrop-blur",
            "border border-slate-200 dark:border-slate-700",
            "text-slate-700 dark:text-slate-200",
            "hover:bg-white dark:hover:bg-slate-800",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {pending === "off" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
          OFF
        </button>
        <button
          onClick={() => send("on")}
          disabled={pending !== null || state === "on"}
          className={clsx(
            "no-drag flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5",
            "text-white shadow-sm",
            "bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {pending === "on" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
          ON
        </button>
      </div>
      {error && <div className="relative text-[10px] text-red-500 dark:text-red-400 mt-2 text-center">{error}</div>}
    </div>
  );
}
