import { useEffect, useRef, useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ChevronDown, BarChart3, LineChart as LineIcon } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { liveStore } from "../lib/liveStore";
import type { Series } from "../types/api";

interface Props {
  deviceId: string;
  siteSlug: string;
  deviceSlug: string;
  measurement: string;
  unit?: string;
}

type Period = "24h" | "7d" | "30d";
type Mode = "line" | "bar";

interface Point { ts: number; v: number; }

const PERIODS: { value: Period; label: string; minutes: number; aggregation: string }[] = [
  { value: "24h", label: "Dernières 24h",  minutes: 24 * 60,      aggregation: "15min" },
  { value: "7d",  label: "7 derniers jours", minutes: 7 * 24 * 60,  aggregation: "1h" },
  { value: "30d", label: "30 derniers jours", minutes: 30 * 24 * 60, aggregation: "1d" },
];

/**
 * Mini-widget par mesure utilisé dans la fiche équipement. Sélecteur de
 * période + bascule courbe / histogramme. Live append via WS quand on est
 * sur la fenêtre 24h ou agrégat compatible.
 */
export function MiniMeasurementWidget({ deviceId, siteSlug, deviceSlug, measurement, unit }: Props) {
  const [period, setPeriod] = useState<Period>("24h");
  const [mode, setMode] = useState<Mode>("line");
  const [data, setData] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const dataRef = useRef<Point[]>([]);
  dataRef.current = data;

  const cfg = PERIODS.find((p) => p.value === period)!;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const to = new Date();
    const from = new Date(to.getTime() - cfg.minutes * 60_000);
    api.get<Series>(`/v1/devices/${deviceId}/measurements?measurement=${encodeURIComponent(measurement)}&from=${from.toISOString()}&to=${to.toISOString()}&aggregation=${cfg.aggregation}`)
      .then((s) => {
        if (cancelled) return;
        const pts: Point[] = s.points.map((p) => ({ ts: new Date(p.ts).getTime(), v: p.value }));
        setData(pts);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [deviceId, measurement, period, cfg.minutes, cfg.aggregation]);

  // Live append : seulement si on est sur 24h (la fenêtre la plus courte)
  useEffect(() => {
    if (period !== "24h") return;
    return liveStore.subscribeMeasurement(siteSlug, deviceSlug, measurement, (p) => {
      const next = [...dataRef.current, { ts: new Date(p.ts).getTime(), v: p.value }];
      const cutoff = Date.now() - cfg.minutes * 60_000;
      while (next.length && next[0].ts < cutoff) next.shift();
      setData(next);
    });
  }, [siteSlug, deviceSlug, measurement, period, cfg.minutes]);

  const xFormatter = (t: number) => {
    const d = new Date(t);
    if (period === "30d") return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    if (period === "7d")  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit" });
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 font-medium truncate">{measurement}</div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => setMode((m) => m === "line" ? "bar" : "line")}
            className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 p-1" title="Basculer courbe / histogramme">
            {mode === "line" ? <BarChart3 className="h-3.5 w-3.5" /> : <LineIcon className="h-3.5 w-3.5" />}
          </button>
          <PeriodSelect value={period} onChange={setPeriod} />
        </div>
      </div>

      {loading ? (
        <div className="h-[150px] flex items-center justify-center text-xs text-slate-500">Chargement…</div>
      ) : data.length === 0 ? (
        <div className="h-[150px] flex items-center justify-center text-xs text-slate-500 italic">
          Pas de données sur cette période
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          {mode === "line" ? (
            <LineChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]}
                tickFormatter={xFormatter} tick={{ fill: "#64748b", fontSize: 9 }} minTickGap={40} />
              <YAxis tick={{ fill: "#64748b", fontSize: 9 }} width={36}
                unit={unit ? ` ${unit}` : undefined} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
                labelFormatter={(t) => new Date(t).toLocaleString("fr-FR")}
                formatter={(v: number) => [`${v.toFixed(2)}${unit ? " " + unit : ""}`, measurement]} />
              <Line type="monotone" dataKey="v" stroke="#0ea5e9" strokeWidth={1.8} dot={false} isAnimationActive={false} />
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]}
                tickFormatter={xFormatter} tick={{ fill: "#64748b", fontSize: 9 }} minTickGap={40} />
              <YAxis tick={{ fill: "#64748b", fontSize: 9 }} width={36}
                unit={unit ? ` ${unit}` : undefined} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
                labelFormatter={(t) => new Date(t).toLocaleString("fr-FR")}
                formatter={(v: number) => [`${v.toFixed(2)}${unit ? " " + unit : ""}`, measurement]} />
              <Bar dataKey="v" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  );
}

function PeriodSelect({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const [open, setOpen] = useState(false);
  const cur = PERIODS.find((p) => p.value === value)!;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700">
        {cur.label} <ChevronDown className="h-2.5 w-2.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md shadow-2xl py-1 z-20">
            {PERIODS.map((p) => (
              <button key={p.value} onClick={() => { onChange(p.value); setOpen(false); }}
                className={clsx("w-full text-left text-xs px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800",
                  p.value === value && "text-brand-300")}>
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
