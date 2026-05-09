import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { api } from "../../lib/api";
import { useLiveMeasurement } from "../../lib/liveStore";
import type { LatestReading, Series, Widget } from "../../types/api";
import { getMeasurementMeta } from "./measurementMeta";
import { WidgetTimeControls, readPeriod } from "./WidgetTimeControls";
import { resolvePeriod, suggestFrequency, type PeriodKey } from "../../lib/widgetTime";

export function ValueWidget({ widget }: { widget: Widget }) {
  const cfg = widget.config as Record<string, unknown>;
  const deviceId = cfg.device_id as string;
  const measurement = cfg.measurement as string;
  const unit = (cfg.unit as string) || "";
  const decimals = (cfg.decimals as number) ?? 1;
  const siteSlug = cfg.site_slug as string;
  const deviceSlug = cfg.device_slug as string;

  const [period, setPeriod] = useState<PeriodKey>(readPeriod(cfg));
  // Détecte si la période se termine "maintenant" → on autorise l'update live.
  const range = useMemo(() => resolvePeriod(period), [period]);
  const isLivePeriod = useMemo(
    () => Math.abs(range.to.getTime() - Date.now()) < 60_000,
    [range],
  );

  // Dernière valeur dans la période (peut être passée).
  const [periodValue, setPeriodValue] = useState<{ value: number; ts: string } | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!deviceId || !measurement) return;
    setLoading(true);
    const agg = suggestFrequency(period);
    const url = `/v1/devices/${deviceId}/measurements?measurement=${encodeURIComponent(measurement)}`
      + `&from=${range.from.toISOString()}&to=${range.to.toISOString()}&aggregation=${agg}`;
    let cancelled = false;
    api.get<Series>(url)
      .then((s) => {
        if (cancelled) return;
        const last = s.points.length ? s.points[s.points.length - 1] : null;
        setPeriodValue(last ? { value: last.value, ts: last.ts } : undefined);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [deviceId, measurement, period, range.from, range.to]);

  // Fallback : si la période inclut "maintenant" et qu'il n'y a aucune mesure
  // historique remontée, on tape /latest pour avoir au moins le live.
  const [fallback, setFallback] = useState<LatestReading | undefined>();
  useEffect(() => {
    if (!isLivePeriod || !deviceId || !measurement) return;
    api.get<LatestReading[]>(`/v1/devices/${deviceId}/latest`)
      .then((arr) => setFallback(arr.find((m) => m.measurement === measurement)))
      .catch(() => {});
  }, [deviceId, measurement, isLivePeriod]);

  const live = useLiveMeasurement(
    isLivePeriod ? siteSlug : null,
    isLivePeriod ? deviceSlug : null,
    isLivePeriod ? measurement : null,
  );

  const value = isLivePeriod
    ? (live?.value ?? periodValue?.value ?? fallback?.value)
    : periodValue?.value;
  const ts = isLivePeriod
    ? (live?.ts || periodValue?.ts || fallback?.ts)
    : periodValue?.ts;
  const isLive = isLivePeriod && live?.value != null;

  // Petit flash sur la valeur quand elle change
  const [flash, setFlash] = useState(false);
  const lastValue = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (value == null) return;
    if (lastValue.current !== undefined && lastValue.current !== value) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(t);
    }
    lastValue.current = value as number;
  }, [value]);

  const meta = getMeasurementMeta(measurement, unit);
  const Icon = meta.Icon;

  return (
    <div className={clsx(
      "relative h-full w-full p-5 rounded-xl overflow-hidden flex flex-col",
      "ring-1 ring-transparent transition",
      meta.cardGradient,
      meta.ringHover,
    )}>
      <Icon
        className={clsx("pointer-events-none absolute -right-4 -bottom-6 h-36 w-36", meta.watermark)}
        strokeWidth={1.2}
        aria-hidden
      />

      <div className="relative flex items-start gap-2.5 min-w-0">
        <div className={clsx("flex-shrink-0 rounded-lg p-2", meta.iconBg)}>
          <Icon className={clsx("h-4 w-4", meta.iconColor)} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold truncate">
            {widget.title}
          </div>
        </div>
        {isLive && (
          <div className="flex-shrink-0 flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className={clsx("absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping", meta.liveDot)} />
              <span className={clsx("relative inline-flex h-2 w-2 rounded-full", meta.liveDot)} />
            </span>
          </div>
        )}
      </div>

      <div className="relative mt-2">
        <WidgetTimeControls
          widget={widget}
          period={period}
          showFrequency={false}
          onChange={(n) => setPeriod(n.period)}
        />
      </div>

      <div className="relative mt-auto pt-4">
        {loading && value == null ? (
          <div className="text-sm text-slate-400 dark:text-slate-500 italic">Chargement…</div>
        ) : value != null ? (
          <>
            <div className={clsx(
              "flex items-baseline gap-1.5 transition-all duration-500",
              flash && "scale-[1.03]",
            )}>
              <span className={clsx(
                "text-5xl font-bold tracking-tight tabular-nums leading-none",
                meta.valueColor,
              )}>
                {Number(value).toFixed(decimals)}
              </span>
              {unit && (
                <span className={clsx("text-lg font-semibold", meta.unitColor)}>
                  {unit}
                </span>
              )}
            </div>
            {ts && (
              <div className="mt-3 text-[10px] text-slate-500 dark:text-slate-400 font-medium tracking-wide">
                {new Date(ts).toLocaleString("fr-FR")}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-slate-400 dark:text-slate-500 italic">Aucune donnée sur la période.</div>
        )}
      </div>
    </div>
  );
}
