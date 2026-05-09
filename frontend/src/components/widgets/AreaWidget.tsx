import { useEffect, useMemo, useRef, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import clsx from "clsx";
import { api } from "../../lib/api";
import { liveStore } from "../../lib/liveStore";
import type { Widget, Series } from "../../types/api";
import { getMeasurementMeta } from "./measurementMeta";
import { WidgetTimeControls, readFrequency, readPeriod } from "./WidgetTimeControls";
import { resolvePeriod, type FrequencyKey, type PeriodKey } from "../../lib/widgetTime";

interface Point { ts: number; v: number; }

const MAX_POINTS = 500;

export function AreaWidget({ widget }: { widget: Widget }) {
  const cfg = widget.config as Record<string, unknown>;
  const deviceId = cfg.device_id as string;
  const measurement = cfg.measurement as string;
  const unit = cfg.unit as string | undefined;
  const siteSlug = cfg.site_slug as string;
  const deviceSlug = cfg.device_slug as string;

  const [period, setPeriod] = useState<PeriodKey>(readPeriod(cfg));
  const [frequency, setFrequency] = useState<FrequencyKey>(readFrequency(cfg));
  const range = useMemo(() => resolvePeriod(period), [period]);
  const isLivePeriod = useMemo(
    () => Math.abs(range.to.getTime() - Date.now()) < 60_000,
    [range],
  );

  const [data, setData] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const dataRef = useRef<Point[]>([]);
  dataRef.current = data;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = `/v1/devices/${deviceId}/measurements?measurement=${encodeURIComponent(measurement)}`
      + `&from=${range.from.toISOString()}&to=${range.to.toISOString()}&aggregation=${frequency}`;
    api.get<Series>(url)
      .then((s) => {
        if (cancelled) return;
        setData(s.points.map((p) => ({ ts: new Date(p.ts).getTime(), v: p.value })).slice(-MAX_POINTS));
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [deviceId, measurement, frequency, range.from, range.to]);

  useEffect(() => {
    if (!isLivePeriod) return;
    return liveStore.subscribeMeasurement(siteSlug, deviceSlug, measurement, (p) => {
      const next = [...dataRef.current, { ts: new Date(p.ts).getTime(), v: p.value }];
      const cutoff = range.from.getTime();
      while (next.length && next[0].ts < cutoff) next.shift();
      if (next.length > MAX_POINTS) next.splice(0, next.length - MAX_POINTS);
      setData(next);
    });
  }, [siteSlug, deviceSlug, measurement, isLivePeriod, range.from]);

  const meta = getMeasurementMeta(measurement, unit);
  const Icon = meta.Icon;
  const stats = useMemo(() => computeStats(data), [data]);
  const last = data.length ? data[data.length - 1].v : null;
  const gradId = `area-grad-${widget.id}`;

  return (
    <div className={clsx(
      "relative h-full w-full p-5 rounded-xl overflow-hidden ring-1 ring-transparent transition flex flex-col",
      meta.cardGradient,
      meta.ringHover,
    )}>
      <Icon
        className={clsx("pointer-events-none absolute -right-6 -bottom-8 h-44 w-44", meta.watermark)}
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
        <WidgetTimeControls
          widget={widget}
          period={period}
          frequency={frequency}
          showFrequency
          onChange={(n) => { setPeriod(n.period); if (n.frequency) setFrequency(n.frequency); }}
        />
      </div>

      {last != null && stats && (
        <div className="relative flex items-baseline gap-5 mt-3 flex-wrap">
          <div className="flex flex-col">
            <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">Actuel</div>
            <div className="flex items-baseline gap-0.5">
              <span className="tabular-nums font-bold leading-none text-2xl text-slate-900 dark:text-white">
                {last.toFixed(unit ? 1 : 2)}
              </span>
              {unit && <span className={clsx("text-[10px] font-semibold", meta.unitColor)}>{unit}</span>}
            </div>
          </div>
          <Stat label="Min" value={stats.min} unit={unit} color={meta.unitColor} />
          <Stat label="Max" value={stats.max} unit={unit} color={meta.unitColor} />
        </div>
      )}

      <div className="relative flex-1 min-h-0 mt-3 -mx-1">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">Chargement…</div>
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">Aucune donnée</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={meta.chartColor} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={meta.chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="currentColor" className="text-slate-300/60 dark:text-slate-700/40" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                tick={{ fill: "currentColor", fontSize: 10 }}
                className="text-slate-500 dark:text-slate-400"
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                tick={{ fill: "currentColor", fontSize: 10 }}
                className="text-slate-500 dark:text-slate-400"
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v) => formatCompact(v)}
              />
              <Tooltip
                contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 8, fontSize: 12, padding: "8px 10px" }}
                labelStyle={{ color: "#cbd5e1", fontWeight: 600, marginBottom: 2 }}
                itemStyle={{ color: "#fff" }}
                labelFormatter={(t) => new Date(t).toLocaleTimeString("fr-FR")}
                formatter={(v: number) => [`${v.toFixed(2)}${unit ? " " + unit : ""}`, "Valeur"]}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke={meta.chartColor}
                strokeWidth={2.2}
                fill={`url(#${gradId})`}
                isAnimationActive={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: meta.chartColor }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, color }: { label: string; value: number; unit?: string; color: string }) {
  return (
    <div className="flex flex-col">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{label}</div>
      <div className="flex items-baseline gap-0.5">
        <span className="tabular-nums font-bold leading-none text-base text-slate-700 dark:text-slate-200">
          {formatCompact(value)}
        </span>
        {unit && <span className={clsx("text-[10px] font-semibold", color)}>{unit}</span>}
      </div>
    </div>
  );
}

function computeStats(data: Point[]) {
  if (!data.length) return null;
  let min = Infinity, max = -Infinity, sum = 0;
  for (const d of data) {
    if (d.v < min) min = d.v;
    if (d.v > max) max = d.v;
    sum += d.v;
  }
  return { min, max, avg: sum / data.length };
}

function formatCompact(v: number): string {
  if (!isFinite(v)) return "–";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (abs >= 10_000)    return (v / 1_000).toFixed(0) + "k";
  if (abs >= 1_000)     return (v / 1_000).toFixed(1) + "k";
  if (abs >= 100)       return v.toFixed(0);
  if (abs >= 10)        return v.toFixed(1);
  return v.toFixed(2);
}

