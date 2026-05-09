import { useEffect, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api } from "../lib/api";
import { liveStore } from "../lib/liveStore";
import type { Series } from "../types/api";

interface Props {
  deviceId: string;
  siteSlug: string;
  deviceSlug: string;
  measurement: string;
  unit?: string;
  windowMinutes?: number;
}

interface Point { ts: number; v: number; }

const MAX_POINTS = 500;

export function MeasurementChart({ deviceId, siteSlug, deviceSlug, measurement, unit, windowMinutes = 60 }: Props) {
  const [data, setData] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const dataRef = useRef<Point[]>([]);
  dataRef.current = data;

  // Charge l'historique initial via REST
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const to = new Date();
    const from = new Date(to.getTime() - windowMinutes * 60_000);
    api.get<Series>(`/v1/devices/${deviceId}/measurements?measurement=${encodeURIComponent(measurement)}&from=${from.toISOString()}&to=${to.toISOString()}&aggregation=raw`)
      .then((s) => {
        if (cancelled) return;
        const pts: Point[] = s.points.map((p) => ({ ts: new Date(p.ts).getTime(), v: p.value }));
        setData(pts.slice(-MAX_POINTS));
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [deviceId, measurement, windowMinutes]);

  // Append des points reçus via WebSocket
  useEffect(() => {
    return liveStore.subscribeMeasurement(siteSlug, deviceSlug, measurement, (p) => {
      const next = [...dataRef.current, { ts: new Date(p.ts).getTime(), v: p.value }];
      // Garde uniquement les points dans la fenêtre temporelle
      const cutoff = Date.now() - windowMinutes * 60_000;
      while (next.length > 0 && next[0].ts < cutoff) next.shift();
      if (next.length > MAX_POINTS) next.splice(0, next.length - MAX_POINTS);
      setData(next);
    });
  }, [siteSlug, deviceSlug, measurement, windowMinutes]);

  if (loading) return <div className="text-xs text-slate-500">Chargement…</div>;
  if (data.length === 0) return <div className="text-xs text-slate-500">Aucune donnée sur la fenêtre</div>;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
        <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]}
          tickFormatter={(t) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          tick={{ fill: "#64748b", fontSize: 10 }} />
        <YAxis tick={{ fill: "#64748b", fontSize: 10 }} width={40}
          unit={unit ? ` ${unit}` : undefined} />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: "#94a3b8" }}
          formatter={(v: number) => [`${v.toFixed(2)}${unit ? " " + unit : ""}`, measurement]}
          labelFormatter={(t) => new Date(t).toLocaleTimeString("fr-FR")}
        />
        <Line type="monotone" dataKey="v" stroke="#0ea5e9" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
