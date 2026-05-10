import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Edit2, Check, X, Trash2,
  Cpu, Lightbulb, Activity, Thermometer, Zap, Gauge as GaugeIcon, Plug,
  Building2, MapPin, Hash, Clock, Copy, CheckCheck,
} from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { MiniMeasurementWidget } from "../components/MiniMeasurementWidget";
import { useConfirm } from "../components/ConfirmDialog";
import type { Device, MeasurementMeta, Site } from "../types/api";

interface ZoneRef {
  id: string;
  slug: string;
  name: string;
}

export function DeviceDetail() {
  const { id: siteId, deviceId } = useParams<{ id: string; deviceId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [device, setDevice] = useState<Device | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [zone, setZone] = useState<ZoneRef | null>(null);
  const [metas, setMetas] = useState<MeasurementMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Edition du nom
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  const reload = () => {
    if (!deviceId || !token) return;
    api.get<Device>(`/v1/devices/${deviceId}`).then((d) => {
      setDevice(d);
      setNameDraft(d.name || "");
    }).catch((e) => setError(e instanceof HttpError ? e.payload.message : String(e)));
    api.get<MeasurementMeta[]>(`/v1/devices/${deviceId}/measurements-metadata`).then(setMetas).catch(() => {});
  };
  useEffect(reload, [deviceId, token]);

  // Charger site + zones (pour breadcrumb + emplacement)
  useEffect(() => {
    if (!siteId || !token) return;
    api.get<Site>(`/v1/sites/${siteId}`).then(setSite).catch(() => {});
    api.get<ZoneRef[]>(`/v1/sites/${siteId}/zones`).then((zs) => {
      if (device) {
        const z = zs.find((z) => z.id === device.zone_id);
        if (z) setZone(z);
      }
    }).catch(() => {});
  }, [siteId, token, device]);

  async function saveName() {
    if (!device) return;
    setSavingName(true);
    try {
      await api.put(`/v1/devices/${device.id}`, { name: nameDraft });
      setEditingName(false);
      reload();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    } finally {
      setSavingName(false);
    }
  }

  const confirm = useConfirm();
  async function onDelete() {
    if (!device) return;
    const ok = await confirm({
      title: `Supprimer l'équipement « ${device.name || device.slug} » ?`,
      description: <>
        L'équipement sera retiré du site avec ses widgets associés.
        <br /><br />
        L'historique des mesures reste en base et n'est pas effacé.
      </>,
      danger: true,
      confirmLabel: "Supprimer l'équipement",
    });
    if (!ok) return;
    try {
      await api.del(`/v1/devices/${device.id}`);
      navigate(`/sites/${siteId}/devices`);
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    }
  }

  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>;
  if (!device) return <div className="p-8 text-sm text-slate-500 dark:text-slate-400">Chargement…</div>;

  const ext = (device as any).metadata?.external as
    | { vendor: string; external_id: string; interval_s?: number }
    | undefined;

  return (
    <div className="p-6 space-y-6">
      {/* --- Breadcrumb + retour --- */}
      <div className="flex items-center justify-between">
        <Link to={`/sites/${siteId}/devices`}
          className="text-xs text-slate-500 hover:text-slate-300 inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Retour aux équipements
        </Link>
        <button onClick={onDelete}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30">
          <Trash2 className="h-3.5 w-3.5" /> Supprimer l'équipement
        </button>
      </div>

      {/* --- Titre + édition du nom --- */}
      <div className="flex items-start gap-4">
        <DeviceTypeIcon type={device.type} large />
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                className="text-2xl font-semibold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1 focus:outline-none focus:border-brand-500"
                onKeyDown={(e) => e.key === "Enter" && saveName()} />
              <button onClick={saveName} disabled={savingName}
                className="p-1.5 rounded-md bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50">
                <Check className="h-4 w-4" />
              </button>
              <button onClick={() => { setEditingName(false); setNameDraft(device.name || ""); }}
                className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h1 className="text-2xl font-semibold tracking-tight">{device.name || device.slug}</h1>
              <button onClick={() => setEditingName(true)}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 opacity-0 group-hover:opacity-100 transition"
                title="Modifier le nom">
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="text-xs text-slate-500 font-mono mt-1">{device.slug}</div>
        </div>
      </div>

      {/* --- État de l'équipement --- */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-5">
        <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">État de l'équipement</h2>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-500" />
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Dernière communication</div>
              <div className="text-sm text-slate-800 dark:text-slate-200">
                {device.last_seen_at
                  ? new Date(device.last_seen_at).toLocaleString("fr-FR")
                  : <span className="text-slate-500 italic">jamais</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div>
              <div className="text-[10px] text-slate-500 uppercase">État équipement</div>
              <StatusBadge status={device.status} />
            </div>
          </div>
          {device.installed_at && (
            <div className="flex items-center gap-2">
              <div>
                <div className="text-[10px] text-slate-500 uppercase">Installé le</div>
                <div className="text-sm text-slate-800 dark:text-slate-200">{new Date(device.installed_at).toLocaleDateString("fr-FR")}</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* --- Infos générales + Emplacement --- */}
      <div className="grid lg:grid-cols-2 gap-5">
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-5">
          <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4">Informations générales</h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2.5 text-sm">
            <DT>Catégorie</DT>           <DD>{device.category || <em className="text-slate-600">—</em>}</DD>
            <DT>Type</DT>                <DD className="capitalize">{device.type}</DD>
            <DT>Modèle</DT>              <DD>{device.model || <em className="text-slate-600">—</em>}</DD>
            <DT>ID</DT>                  <DD><CopyableId value={device.id} /></DD>
            {metas.length > 0 && (
              <>
                <DT>Mesures</DT>
                <DD>
                  <ul className="space-y-1">
                    {metas.map((m) => (
                      <li key={m.measurement} className="flex items-center gap-2 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                        <span className="font-medium text-slate-800 dark:text-slate-200">{m.measurement}</span>
                        <span className="text-slate-500">({m.unit})</span>
                      </li>
                    ))}
                  </ul>
                </DD>
              </>
            )}
            {ext && (
              <>
                <DT>
                  <span className="flex items-center gap-1.5"><Plug className="h-3.5 w-3.5" /> Intégration</span>
                </DT>
                <DD>
                  <div className="text-sm">
                    <span className="text-slate-200 capitalize">{ext.vendor}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">{ext.external_id}</div>
                  {ext.interval_s && <div className="text-[10px] text-slate-500 mt-0.5">Sync toutes les {ext.interval_s}s</div>}
                </DD>
              </>
            )}
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-5">
          <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4">Emplacement</h2>
          {site && zone ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 text-brand-400" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{site.name}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {site.address || site.timezone}
                  </div>
                </div>
              </div>
              <div className="ml-2 pl-5 border-l-2 border-slate-200 dark:border-slate-800 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <Hash className="h-3 w-3 text-slate-500" />
                  Zone : <span className="font-medium">{zone.name}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                  <Cpu className="h-3 w-3" /> {device.slug}
                </div>
              </div>
              {site.lat != null && site.lng != null && (
                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Latitude</div>
                    <div className="text-slate-200 font-mono">{site.lat}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Longitude</div>
                    <div className="text-slate-200 font-mono">{site.lng}</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Chargement…</div>
          )}
        </section>
      </div>

      {/* --- Suivi des attributs : grille de mini-widgets --- */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4">Suivi des attributs</h2>
        {metas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
            Aucune mesure provisionnée pour cet équipement.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {site && metas.map((m) => (
              <MiniMeasurementWidget key={m.measurement}
                deviceId={device.id}
                siteSlug={site.slug}
                deviceSlug={device.slug}
                measurement={m.measurement}
                unit={m.unit} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// --- helpers visuels -------------------------------------------------------

function DT({ children }: { children: React.ReactNode }) {
  return <dt className="text-xs uppercase tracking-wider text-slate-500 self-center">{children}</dt>;
}
function DD({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dd className={clsx("text-slate-200", className)}>{children}</dd>;
}

function DeviceTypeIcon({ type, large }: { type: string; large?: boolean }) {
  const map: Record<string, { Icon: typeof Cpu; color: string }> = {
    environment: { Icon: Thermometer, color: "text-emerald-400 bg-emerald-500/10" },
    presence:    { Icon: Activity,    color: "text-violet-400 bg-violet-500/10" },
    actuator:    { Icon: Lightbulb,   color: "text-amber-400 bg-amber-500/10" },
    linky:       { Icon: Zap,         color: "text-yellow-400 bg-yellow-500/10" },
    meter:       { Icon: GaugeIcon,   color: "text-blue-400 bg-blue-500/10" },
    gateway:     { Icon: Cpu,         color: "text-slate-400 bg-slate-700" },
  };
  const { Icon, color } = map[type] || map.gateway;
  return (
    <div className={clsx("rounded-2xl flex items-center justify-center shrink-0", color, large ? "w-14 h-14" : "p-1.5")}>
      <Icon className={large ? "h-7 w-7" : "h-3.5 w-3.5"} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    online:      { label: "En ligne",     cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
    offline:     { label: "Hors ligne",   cls: "bg-slate-700/50 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-700" },
    disabled:    { label: "Désactivé",    cls: "bg-red-500/15 text-red-300 border-red-500/30" },
    provisioned: { label: "Provisionné",  cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  };
  const m = map[status] || map.offline;
  return (
    <span className={clsx("inline-block text-xs px-2.5 py-1 rounded-md border font-medium mt-0.5", m.cls)}>
      {m.label}
    </span>
  );
}

// CopyableId — pastille UUID monospace + bouton copier (feedback 1.5 s).
function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5 group">
      <code className="font-mono text-[11px] text-slate-700 dark:text-slate-300 select-all">{value}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        title="Copier l'identifiant"
        className="opacity-50 group-hover:opacity-100 transition text-slate-500 hover:text-brand-500 p-0.5 rounded"
      >
        {copied ? <CheckCheck className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}
