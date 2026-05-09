import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import clsx from "clsx";
import { api } from "../../lib/api";
import type { Widget, Series } from "../../types/api";
import { getMeasurementMeta } from "./measurementMeta";
import { WidgetTimeControls, readFrequency, readPeriod } from "./WidgetTimeControls";
import { resolvePeriod, type FrequencyKey, type PeriodKey } from "../../lib/widgetTime";

interface Bucket { label: string; v: number; }

/**
 * BarWidget — agrégat par bucket sur une période. Utilise les continuous
 * aggregates Timescale (raw / 1min / 15min / 1h / 1d).
 */
export function BarWidget({ widget }: { widget: Widget }) {
  const cfg = widget.config as Record<string, unknown>;
  const deviceId = cfg.device_id as string;
  const measurement = cfg.measurement as string;
  const unit = cfg.unit as string | undefined;

  const [period, setPeriod] = useState<PeriodKey>(readPeriod(cfg));
  const [frequency, setFrequency] = useState<FrequencyKey>(readFrequency(cfg));
  const range = useMemo(() => resolvePeriod(period), [period]);
  const isLivePeriod = useMemo(
    () => Math.abs(range.to.getTime() - Date.now()) < 60_000,
    [range],
  );

  const [data, setData] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!deviceId || !measurement) return;
    setLoading(true);
    const fetchOnce = () => {
      const r = resolvePeriod(period);
      const url = `/v1/devices/${deviceId}/measurements?measurement=${encodeURIComponent(measurement)}`
        + `&from=${r.from.toISOString()}&to=${r.to.toISOString()}&aggregation=${frequency}`;
      return api.get<Series>(url).then((s) => {
        const fmt = pickFormatter(frequency);
        const buckets: Bucket[] = s.points.map((p) => ({
          label: fmt(new Date(p.ts)),
          v: p.value,
        }));
        setData(buckets);
        setLoading(false);
      }).catch(() => setLoading(false));
    };
    fetchOnce();
    if (!isLivePeriod) return;
    const t = setInterval(fetchOnce, 60_000);
    return () => clearInterval(t);
  }, [deviceId, measurement, period, frequency, isLivePeriod]);

  const meta = getMeasurementMeta(measurement, unit);
  const Icon = meta.Icon;

  const stats = useMemo(() => computeStats(data), [data]);
  const gradId = `bar-grad-${widget.id}`;

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

      {/* Header */}
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

      {/* Stats row */}
      {stats && (
        <div className="relative flex items-baseline gap-5 mt-3 flex-wrap">
          <Stat label="Min" value={stats.min} unit={unit} color={meta.unitColor} />
          <Stat label="Moy" value={stats.avg} unit={unit} color={meta.unitColor} primary />
          <Stat label="Max" value={stats.max} unit={unit} color={meta.unitColor} />
        </div>
      )}

      {/* Chart */}
      <div className="relative flex-1 min-h-0 mt-3 -mx-1">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">Chargement…</div>
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">Aucune donnée</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={meta.chartColor} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={meta.chartColor} stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="currentColor" className="text-slate-300/60 dark:text-slate-700/40" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "currentColor", fontSize: 10 }}
                className="text-slate-500 dark:text-slate-400"
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
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
                cursor={{ fill: meta.chartColor, fillOpacity: 0.08 }}
                contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 8, fontSize: 12, padding: "8px 10px" }}
                labelStyle={{ color: "#cbd5e1", fontWeight: 600, marginBottom: 2 }}
                itemStyle={{ color: "#fff" }}
                formatter={(v: number) => [`${v.toFixed(2)}${unit ? " " + unit : ""}`, "Valeur"]}
              />
              <Bar dataKey="v" fill={`url(#${gradId})`} radius={[6, 6, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, color, primary }: {
  label: string; value: number; unit?: string; color: string; primary?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{label}</div>
      <div className="flex items-baseline gap-0.5">
        <span className={clsx(
          "tabular-nums font-bold leading-none",
          primary ? "text-2xl text-slate-900 dark:text-white" : "text-base text-slate-700 dark:text-slate-200",
        )}>
          {formatCompact(value)}
        </span>
        {unit && (
          <span className={clsx("text-[10px] font-semibold", color)}>{unit}</span>
        )}
      </div>
    </div>
  );
}

function computeStats(data: Bucket[]) {
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

function pickFormatter(agg: string) {
  if (agg === "1d") return (d: Date) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  if (agg === "1h") return (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

