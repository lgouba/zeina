import { useEffect, useState } from "react";
import clsx from "clsx";
import { api } from "../../lib/api";
import { useLiveMeasurement } from "../../lib/liveStore";
import type { Widget, LatestReading } from "../../types/api";
import { getMeasurementMeta } from "./measurementMeta";

/**
 * GaugeWidget — jauge demi-cercle (SVG arc) avec valeur, unité, bornes
 * min / max et habillage thématique selon la mesure.
 */
export function GaugeWidget({ widget }: { widget: Widget }) {
  const cfg = widget.config as Record<string, string | number | undefined>;
  const deviceId = cfg.device_id as string;
  const measurement = cfg.measurement as string;
  const unit = (cfg.unit as string) || "";
  const min = Number(cfg.min ?? 0);
  const max = Number(cfg.max ?? 100);
  const siteSlug = cfg.site_slug as string;
  const deviceSlug = cfg.device_slug as string;

  const [initial, setInitial] = useState<LatestReading | undefined>();
  useEffect(() => {
    if (!deviceId || !measurement) return;
    api.get<LatestReading[]>(`/v1/devices/${deviceId}/latest`)
      .then((arr) => setInitial(arr.find((m) => m.measurement === measurement)))
      .catch(() => {});
  }, [deviceId, measurement]);

  const live = useLiveMeasurement(siteSlug || null, deviceSlug || null, measurement || null);
  const value = live?.value ?? initial?.value ?? min;
  const isLive = live?.value != null;

  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const angle = -90 + ratio * 180;

  const meta = getMeasurementMeta(measurement, unit);
  const Icon = meta.Icon;

  // Couleur de l'arc : reste cohérente avec le thème, vire au rouge en zone critique
  const arcStroke = ratio > 0.85 ? "#ef4444" : ratio > 0.6 ? "#f59e0b" : "currentColor";

  return (
    <div className={clsx(
      "relative h-full w-full p-5 rounded-xl overflow-hidden ring-1 ring-transparent transition flex flex-col",
      meta.cardGradient,
      meta.ringHover,
    )}>
      <Icon
        className={clsx("pointer-events-none absolute -right-4 -bottom-6 h-36 w-36", meta.watermark)}
        strokeWidth={1.2}
        aria-hidden
      />

      <div className="relative flex items-center gap-2.5 min-w-0">
        <div className={clsx("flex-shrink-0 rounded-lg p-2", meta.iconBg)}>
          <Icon className={clsx("h-4 w-4", meta.iconColor)} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold truncate">
            {widget.title}
          </div>
        </div>
        {isLive && (
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className={clsx("absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping", meta.liveDot)} />
            <span className={clsx("relative inline-flex h-2 w-2 rounded-full", meta.liveDot)} />
          </span>
        )}
      </div>

      <div className="relative flex-1 flex flex-col items-center justify-center min-h-0">
        <svg viewBox="0 0 200 120" className={clsx("w-full max-h-full", meta.iconColor)}>
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.15"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            d={describeArc(100, 100, 80, -90, angle)}
            fill="none"
            stroke={arcStroke}
            strokeWidth="14"
            strokeLinecap="round"
            style={{ transition: "all 0.6s cubic-bezier(0.22, 1, 0.36, 1)" }}
          />
          <circle cx="100" cy="100" r="5" fill="currentColor" />
        </svg>

        <div className="text-center -mt-6">
          <div className="flex items-baseline justify-center gap-1">
            <span className={clsx("text-3xl font-bold tabular-nums tracking-tight", meta.valueColor)}>
              {value.toFixed(1)}
            </span>
            {unit && <span className={clsx("text-sm font-semibold", meta.unitColor)}>{unit}</span>}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
            {min} – {max} {unit}
          </div>
        </div>
      </div>
    </div>
  );
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polar(cx, cy, r, endAngle);
  const end = polar(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}
function polar(cx: number, cy: number, r: number, angle: number) {
  const a = (angle - 0) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
