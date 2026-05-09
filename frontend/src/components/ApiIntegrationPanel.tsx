import { useState } from "react";
import { Copy, Check, Terminal, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { Device, MeasurementMeta } from "../types/api";

interface Props {
  device: Device;
  metas: MeasurementMeta[];
}

/**
 * Panneau "Intégration API" — affiche les commandes curl prêtes à l'emploi
 * pour publier une mesure ou interroger le device via l'API REST. Pratique
 * pour les intégrations sans MQTT (Postman, scripts, webhooks).
 */
export function ApiIntegrationPanel({ device, metas }: Props) {
  const [open, setOpen] = useState(false);
  const baseUrl = window.location.origin; // ex: http://localhost:5173 (proxifie /v1/* vers l'API)

  const firstMeasurement = metas[0]?.measurement || "temperature";
  const firstUnit = metas[0]?.unit || "celsius";

  const samples: { label: string; method: string; cmd: string }[] = [
    {
      label: "Publier une mesure (POST)",
      method: "POST",
      cmd: `curl -X POST '${baseUrl}/v1/devices/${device.id}/measurements' \\
  -H 'Authorization: Bearer <YOUR_TOKEN>' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "measurement": "${firstMeasurement}",
    "value": 23.4,
    "unit": "${firstUnit}"
  }'`,
    },
    {
      label: "Lire les dernières valeurs",
      method: "GET",
      cmd: `curl '${baseUrl}/v1/devices/${device.id}/latest' \\
  -H 'Authorization: Bearer <YOUR_TOKEN>'`,
    },
    {
      label: "Lire la série temporelle (6 dernières heures)",
      method: "GET",
      cmd: `curl '${baseUrl}/v1/devices/${device.id}/measurements?measurement=${firstMeasurement}&aggregation=raw' \\
  -H 'Authorization: Bearer <YOUR_TOKEN>'`,
    },
  ];

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-4 flex items-center gap-3 hover:bg-slate-900 transition">
        {open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
        <Terminal className="h-4 w-4 text-brand-400" />
        <h2 className="text-xs uppercase tracking-wider text-slate-300 font-medium">Intégration API</h2>
        <span className="ml-auto text-[10px] text-slate-500">
          Publier / lire des mesures sans MQTT
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-slate-800">
          <p className="text-xs text-slate-400 mt-3">
            Endpoints REST disponibles pour cet équipement. Authentification :
            access token JWT (header <code className="text-slate-300">Authorization: Bearer ...</code>),
            obtenu via <code className="text-slate-300">POST /v1/auth/login</code>.
          </p>

          {samples.map((s, i) => <CurlBlock key={i} {...s} />)}

          <div className="rounded-md bg-slate-950 border border-slate-800 p-3 text-[11px] text-slate-400 leading-relaxed">
            <strong className="text-slate-300">Comportement</strong> — la mesure publiée via <code>POST /v1/devices/:id/measurements</code> est
            republiée sur le broker MQTT au format ZEINA, consommée par l'ingestor (TimescaleDB), puis diffusée en temps réel
            aux widgets via WebSocket. Le pipeline est strictement identique à une mesure venant d'un capteur réel.
          </div>
        </div>
      )}
    </section>
  );
}

function CurlBlock({ label, method, cmd }: { label: string; method: string; cmd: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="rounded-lg border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-950">
        <div className="flex items-center gap-2 text-xs">
          <span className={clsx(
            "px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold",
            method === "POST" ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-blue-500/15 text-blue-300",
          )}>{method}</span>
          <span className="text-slate-300">{label}</span>
        </div>
        <button onClick={copy}
          className="text-slate-500 hover:text-slate-200 flex items-center gap-1 text-[11px]">
          {copied ? <><Check className="h-3 w-3" /> Copié</> : <><Copy className="h-3 w-3" /> Copier</>}
        </button>
      </div>
      <pre className="text-[11px] font-mono text-slate-300 p-3 overflow-x-auto bg-slate-950/60 leading-relaxed whitespace-pre-wrap break-all">
{cmd}
      </pre>
    </div>
  );
}
