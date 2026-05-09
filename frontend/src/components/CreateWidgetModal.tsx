import { useEffect, useMemo, useState } from "react";
import {
  X, ArrowRight, Search, Lock, ChevronDown, ChevronRight,
  Building2, Building, Globe2, Layers, DoorOpen, Cpu, Check,
} from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../lib/api";
import { unitSymbol } from "../lib/units";
import type { DeviceListItem, MeasurementMeta, Site, CreateWidgetInput, Zone, ZoneKind } from "../types/api";
import {
  CATALOG, FAMILIES, entriesByFamily, searchCatalog,
  type CatalogEntry,
} from "./widgets/catalog";

const ZONE_KIND_ICON: Record<ZoneKind, typeof Building2> = {
  geographic: Globe2, building_group: Building2, building: Building, floor: Layers, room: DoorOpen,
};

interface Props {
  siteId: string;
  dashboardId: string;
  onClose: () => void;
  onCreated: () => void;
  /**
   * Si fourni, la modal s'ouvre en mode édition : pas d'étape 1 (catalogue),
   * directement à l'étape 2 (config). Le widget_type n'est pas modifiable.
   */
  editing?: import("../types/api").Widget;
}

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";

export function CreateWidgetModal({ siteId, dashboardId, onClose, onCreated, editing }: Props) {
  const cfg = (editing?.config || {}) as Record<string, unknown>;

  // L'entrée de catalogue choisie. En édition on tente de retrouver l'entrée
  // d'origine via le measurement stocké, sinon on tombe sur null et l'UI
  // affiche les champs génériques.
  const initialEntry = useMemo<CatalogEntry | null>(() => {
    if (!editing) return null;
    const meas = cfg.measurement as string | undefined;
    if (!meas) return null;
    return CATALOG.find((e) => e.widgetType === editing.type && e.defaults.measurement === meas) || null;
  }, [editing, cfg.measurement]);

  const [step, setStep] = useState<1 | 2>(editing ? 2 : 1);
  const [entry, setEntry] = useState<CatalogEntry | null>(initialEntry);
  const [search, setSearch] = useState("");

  // État de configuration (étape 2)
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [site, setSite] = useState<Site | null>(null);
  const [device, setDevice] = useState<DeviceListItem | null>(null);
  // Métadonnées des attributs du device sélectionné (mesure → unité, min, max)
  const [deviceMetas, setDeviceMetas] = useState<MeasurementMeta[]>([]);
  const [measurement, setMeasurement] = useState<string>((cfg.measurement as string) || "");
  const [unit, setUnit] = useState<string>((cfg.unit as string) || "");
  const [title, setTitle] = useState(editing?.title || "");
  const [windowMinutes, setWindowMinutes] = useState((cfg.window_minutes as number) || 30);
  const [aggregation, setAggregation] = useState<string>((cfg.aggregation as string) || "1h");
  const [min, setMin] = useState<number>((cfg.min as number) ?? 0);
  const [max, setMax] = useState<number>((cfg.max as number) ?? 100);
  const [decimals, setDecimals] = useState<number>((cfg.decimals as number) ?? 1);

  // Spécifique au widget Carte
  const ALL_KINDS = ["geographic", "building_group", "building", "floor", "room"] as const;
  const initialKinds = (cfg.kinds as string[] | undefined) ?? Array.from(ALL_KINDS);
  const [mapKinds, setMapKinds] = useState<string[]>(initialKinds);
  const [mapShowDevices, setMapShowDevices] = useState<boolean>(cfg.show_devices !== false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DeviceListItem[]>(`/v1/sites/${siteId}/devices`).then((ds) => {
      setDevices(ds);
      if (editing && cfg.device_id) {
        const d = ds.find((x) => x.id === cfg.device_id);
        if (d) setDevice(d);
      }
    }).catch(() => {});
    api.get<Site>(`/v1/sites/${siteId}`).then(setSite).catch(() => {});
    api.get<Zone[]>(`/v1/sites/${siteId}/zones`).then(setZones).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // Auto-charge la liste des attributs du device sélectionné. Le sélecteur
  // de mesure et l'unité s'auto-remplissent à partir de cette liste —
  // priorité : default catalogue → mesure courante si encore valide → 1ère.
  useEffect(() => {
    if (!device) { setDeviceMetas([]); return; }
    api.get<MeasurementMeta[]>(`/v1/devices/${device.id}/measurements-metadata`)
      .then((metas) => {
        setDeviceMetas(metas);
        if (metas.length === 0) {
          setMeasurement("");
          setUnit("");
          return;
        }
        const wanted = entry?.defaults.measurement;
        const stillValid = metas.find((m) => m.measurement === measurement);
        const target = metas.find((m) => m.measurement === wanted) || stillValid || metas[0];
        setMeasurement(target.measurement);
        setUnit(target.unit ? unitSymbol(target.unit) : "");
      })
      .catch(() => setDeviceMetas([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id]);

  // Quand on choisit une entrée du catalogue → seed les defaults.
  function pickEntry(e: CatalogEntry) {
    if (e.comingSoon) return; // ignoré
    setEntry(e);
    setMeasurement(e.defaults.measurement || "");
    setUnit(e.defaults.unit || "");
    if (e.defaults.decimals !== undefined) setDecimals(e.defaults.decimals);
    if (e.defaults.min !== undefined) setMin(e.defaults.min);
    if (e.defaults.max !== undefined) setMax(e.defaults.max);
    if (e.defaults.windowMinutes !== undefined) setWindowMinutes(e.defaults.windowMinutes);
    if (e.defaults.aggregation !== undefined) setAggregation(e.defaults.aggregation);
    setStep(2);
  }

  // Filtre des devices à l'étape 2 selon l'entrée choisie.
  const candidateDevices = useMemo(() => {
    if (!entry) return devices;
    if (!entry.deviceTypes || entry.deviceTypes.length === 0) return devices;
    return devices.filter((d) => entry.deviceTypes!.includes(d.type));
  }, [entry, devices]);

  // Auto-prefill du titre quand device + entry sont là.
  useEffect(() => {
    if (entry && device && !title) {
      setTitle(`${entry.label} — ${device.name || device.slug}`);
    }
  }, [entry, device]); // eslint-disable-line

  async function submit() {
    if (!site) { setError("Site introuvable"); return; }
    const widgetType = entry?.widgetType ?? editing?.type;
    if (!widgetType) { setError("Type de widget introuvable"); return; }
    // map est site-scoped → pas besoin de device. Tous les autres widgets en
    // ont besoin pour identifier le flux de mesures.
    const needsDevice = widgetType !== "map";
    if (needsDevice && !device) { setError("Choisissez un équipement"); return; }

    setSubmitting(true); setError(null);
    try {
      const config: Record<string, unknown> = {
        site_id:   site.id,
        site_slug: site.slug,
      };
      if (device) {
        config.device_id   = device.id;
        config.device_slug = device.slug;
      }
      if (widgetType !== "state" && widgetType !== "map") {
        config.measurement = measurement;
        if (unit) config.unit = unit;
      }
      if (widgetType === "value") config.decimals = decimals;
      if (widgetType === "line" || widgetType === "area") {
        config.window_minutes = windowMinutes;
        config.aggregation = "raw";
      }
      if (widgetType === "bar") {
        config.window_minutes = windowMinutes;
        config.aggregation = aggregation;
      }
      if (widgetType === "gauge") {
        config.min = min;
        config.max = max;
      }
      if (widgetType === "map") {
        // Si l'utilisateur a tout coché, on omet le filtre pour rester
        // tolérant aux nouveaux kinds ajoutés plus tard.
        if (mapKinds.length > 0 && mapKinds.length < ALL_KINDS.length) {
          config.kinds = mapKinds;
        }
        config.show_devices = mapShowDevices;
      }
      // Trace l'origine catalogue — utile pour les outils d'audit / migrations.
      if (entry) config.catalog_id = entry.id;

      const payload: CreateWidgetInput = {
        type: widgetType,
        title: title || (entry ? entry.label : `${widgetType} ${device?.slug ?? site.slug}`),
        config,
      };
      if (editing) {
        await api.put(`/v1/widgets/${editing.id}`, { title: payload.title, config: payload.config });
      } else {
        await api.post(`/v1/dashboards/${dashboardId}/widgets`, payload);
      }
      onCreated();
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : String(e));
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col">
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold">{editing ? "Modifier le widget" : "Nouveau widget"}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {editing
                ? `Type technique : ${editing.type} (non modifiable)`
                : step === 1
                  ? "Étape 1 sur 2 — Sélectionner un widget"
                  : `Étape 2 sur 2 — Configurer ${entry ? `« ${entry.label} »` : "le widget"}`}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-auto">
          {step === 1 ? (
            <CatalogStep search={search} onSearch={setSearch} onPick={pickEntry} />
          ) : (
            <ConfigStep
              entry={entry}
              editing={!!editing}
              devices={candidateDevices}
              device={device}
              setDevice={setDevice}
              zones={zones}
              deviceMetas={deviceMetas}
              measurement={measurement}
              setMeasurement={setMeasurement}
              unit={unit}
              setUnit={setUnit}
              title={title}
              setTitle={setTitle}
              windowMinutes={windowMinutes}
              setWindowMinutes={setWindowMinutes}
              aggregation={aggregation}
              setAggregation={setAggregation}
              min={min}
              setMin={setMin}
              max={max}
              setMax={setMax}
              decimals={decimals}
              setDecimals={setDecimals}
              mapKinds={mapKinds}
              setMapKinds={setMapKinds}
              mapShowDevices={mapShowDevices}
              setMapShowDevices={setMapShowDevices}
              error={error}
            />
          )}
        </div>

        <footer className="flex justify-between items-center px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <button onClick={() => {
              if (step > 1 && !editing) {
                setStep(1);
              } else {
                onClose();
              }
            }}
            className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">
            {step > 1 && !editing ? "← Retour au catalogue" : "Annuler"}
          </button>
          {step === 2 && (
            <button onClick={submit} disabled={submitting || (entry?.widgetType !== "map" && !device)}
              className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white">
              {submitting ? (editing ? "Enregistrement…" : "Création…") : (editing ? "Enregistrer" : "Créer le widget")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Étape 1 — catalogue (style Pulsio, multi-colonnes par famille)
// ---------------------------------------------------------------------------

function CatalogStep({ search, onSearch, onPick }: {
  search: string;
  onSearch: (s: string) => void;
  onPick: (e: CatalogEntry) => void;
}) {
  const matched = useMemo(() => searchCatalog(search), [search]);
  const isSearching = search.trim().length > 0;
  const matchedIds = useMemo(() => new Set(matched.map((m) => m.id)), [matched]);

  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-5">
        <ArrowRight className="h-4 w-4 text-brand-500" />
        <h3 className="text-base font-semibold">Sélectionner un widget</h3>
        <div className="ml-auto relative">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Rechercher (humidité, conso, alarme…)"
            className="w-72 pl-8 pr-3 py-1.5 text-xs rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {isSearching && matched.length === 0 ? (
        <div className="text-center py-12 text-sm text-slate-500">Aucun widget pour « {search} ».</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-6">
          {FAMILIES.map((fam) => {
            const items = entriesByFamily(fam.id).filter((e) => !isSearching || matchedIds.has(e.id));
            if (items.length === 0) return null;
            const FamIcon = fam.icon;
            return (
              <div key={fam.id} className="min-w-0">
                <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                  <FamIcon className={clsx("h-3.5 w-3.5 shrink-0", fam.accent)} />
                  <h4 className="text-[10px] uppercase tracking-wider font-bold text-slate-700 dark:text-slate-300 leading-tight">
                    {fam.label}
                  </h4>
                </div>
                <ul className="space-y-0.5">
                  {items.map((it) => (
                    <li key={it.id}>
                      <button
                        onClick={() => onPick(it)}
                        disabled={it.comingSoon}
                        className={clsx(
                          "w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left transition text-sm",
                          it.comingSoon
                            ? "text-slate-400 dark:text-slate-600 cursor-not-allowed"
                            : "text-slate-700 dark:text-slate-200 hover:bg-brand-500/10 hover:text-brand-700 dark:hover:text-brand-300",
                        )}
                        title={it.comingSoon ? "Bientôt disponible" : (it.description || it.label)}
                      >
                        <it.icon className={clsx("h-3.5 w-3.5 shrink-0 mt-0.5", it.comingSoon ? "" : fam.accent)} />
                        <span className="flex-1 leading-snug break-words">{it.label}</span>
                        {it.comingSoon && <Lock className="h-3 w-3 shrink-0 mt-1 text-slate-400" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Étape 2 — configuration (device, mesure, options spécifiques)
// ---------------------------------------------------------------------------

interface ConfigProps {
  entry: CatalogEntry | null;
  editing: boolean;
  devices: DeviceListItem[];
  zones: Zone[];
  device: DeviceListItem | null;
  setDevice: (d: DeviceListItem | null) => void;
  deviceMetas: MeasurementMeta[];
  measurement: string;
  setMeasurement: (m: string) => void;
  unit: string;
  setUnit: (u: string) => void;
  title: string;
  setTitle: (t: string) => void;
  windowMinutes: number;
  setWindowMinutes: (n: number) => void;
  aggregation: string;
  setAggregation: (a: string) => void;
  min: number;
  setMin: (n: number) => void;
  max: number;
  setMax: (n: number) => void;
  decimals: number;
  setDecimals: (n: number) => void;
  // Options spécifiques au widget Carte
  mapKinds: string[];
  setMapKinds: (k: string[]) => void;
  mapShowDevices: boolean;
  setMapShowDevices: (b: boolean) => void;
  error: string | null;
}

function ConfigStep(p: ConfigProps) {
  const widgetType = p.entry?.widgetType;
  const showWindow = widgetType === "line" || widgetType === "area" || widgetType === "bar";
  const showAggregation = widgetType === "bar";
  const showGaugeBounds = widgetType === "gauge";
  const showDecimals = widgetType === "value";
  const showMeasurement = widgetType !== "state" && widgetType !== "map";

  return (
    <div className="p-5 space-y-5">
      {/* Bandeau récap de l'entrée choisie */}
      {p.entry && (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-3">
          <div className="rounded-lg bg-brand-500/10 p-2">
            <p.entry.icon className="h-5 w-5 text-brand-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">{p.entry.label}</div>
            <div className="text-[11px] text-slate-500">
              Affichage : <span className="font-mono">{widgetType}</span>
              {p.entry.defaults.measurement && (
                <span> · mesure : <span className="font-mono">{p.entry.defaults.measurement}</span></span>
              )}
              {p.entry.defaults.unit && (
                <span> · unité : <span className="font-mono">{p.entry.defaults.unit}</span></span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Le widget Carte est site-scoped — pas de device, pas de mesure. */}
      {p.entry?.widgetType === "map" && (
        <>
          <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-800 dark:text-sky-200">
            Ce widget affiche les zones et équipements du site sur une carte. Aucun
            équipement à choisir — la carte s'auto-centre sur la bbox des zones.
          </div>
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 block font-medium">
              Types de zones à afficher
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { id: "geographic",     label: "Zone géographique" },
                { id: "building_group", label: "Groupe de bâtiments" },
                { id: "building",       label: "Bâtiment" },
                { id: "floor",          label: "Étage" },
                { id: "room",           label: "Pièce" },
              ].map((k) => {
                const checked = p.mapKinds.includes(k.id);
                return (
                  <label key={k.id} className={clsx(
                    "flex items-center gap-2 px-2.5 py-2 rounded-md border cursor-pointer transition text-sm",
                    checked
                      ? "border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-300"
                      : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-300",
                  )}>
                    <input type="checkbox" checked={checked} onChange={() => {
                      if (checked) p.setMapKinds(p.mapKinds.filter((x) => x !== k.id));
                      else p.setMapKinds([...p.mapKinds, k.id]);
                    }} />
                    {k.label}
                  </label>
                );
              })}
            </div>
            {p.mapKinds.length === 0 && (
              <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                Au moins un type est nécessaire pour que la carte affiche quelque chose.
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={p.mapShowDevices}
              onChange={(e) => p.setMapShowDevices(e.target.checked)} />
            <span>Afficher les équipements en marqueurs sur la carte</span>
          </label>
        </>
      )}

      {/* Sélecteur d'équipement (caché pour le widget Carte) */}
      {p.entry?.widgetType !== "map" && (
      <Field label="Équipement *" hint={p.entry?.deviceTypes?.length ? `Filtré sur les types : ${p.entry.deviceTypes.join(", ")}` : ""}>
        {p.devices.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 dark:border-slate-700 p-3 text-sm text-slate-500 italic">
            Aucun équipement compatible sur ce site.
          </div>
        ) : (
          <DeviceTreePicker
            zones={p.zones} devices={p.devices}
            selected={p.device?.id || null}
            onSelect={(d) => p.setDevice(d)}
          />
        )}
      </Field>
      )}

      <Field label="Titre">
        <input value={p.title} onChange={(e) => p.setTitle(e.target.value)} className={inputCls} />
      </Field>

      {/* Options selon le widgetType */}
      <div className="grid grid-cols-2 gap-3">
        {showMeasurement && (
          <>
            <Field label="Attribut" hint={
              !p.device ? "Choisis d'abord un équipement"
              : p.deviceMetas.length === 0 ? "Aucun attribut déclaré pour ce device"
              : p.deviceMetas.length === 1 ? "Un seul attribut disponible — sélectionné automatiquement"
              : "Liste auto-chargée depuis le device sélectionné"
            }>
              <select value={p.measurement}
                disabled={!p.device || p.deviceMetas.length <= 1}
                onChange={(e) => {
                  p.setMeasurement(e.target.value);
                  const m = p.deviceMetas.find((x) => x.measurement === e.target.value);
                  if (m && m.unit) p.setUnit(unitSymbol(m.unit));
                }}
                className={clsx(inputCls, (!p.device || p.deviceMetas.length <= 1) && "opacity-70 cursor-not-allowed")}>
                {p.deviceMetas.length === 0 ? (
                  <option value="">—</option>
                ) : (
                  p.deviceMetas.map((m) => (
                    <option key={m.measurement} value={m.measurement}>{m.measurement}</option>
                  ))
                )}
              </select>
            </Field>
            <Field label="Unité" hint="Récupérée automatiquement depuis l'attribut.">
              <div className={clsx(inputCls, "flex items-center font-mono text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-900 cursor-default")}>
                {p.unit ? p.unit : <span className="text-slate-400 italic">—</span>}
              </div>
            </Field>
          </>
        )}
        {showDecimals && (
          <Field label="Décimales">
            <input type="number" min={0} max={4} value={p.decimals} onChange={(e) => p.setDecimals(+e.target.value)} className={inputCls} />
          </Field>
        )}
        {showWindow && (
          <Field label="Fenêtre (minutes)">
            <input type="number" min={1} value={p.windowMinutes} onChange={(e) => p.setWindowMinutes(+e.target.value)} className={inputCls} />
          </Field>
        )}
        {showAggregation && (
          <Field label="Agrégation">
            <select value={p.aggregation} onChange={(e) => p.setAggregation(e.target.value)} className={inputCls}>
              <option value="1min">1 min</option>
              <option value="15min">15 min</option>
              <option value="1h">1 h</option>
              <option value="1d">1 jour</option>
            </select>
          </Field>
        )}
        {showGaugeBounds && (
          <>
            <Field label="Min"><input type="number" value={p.min} onChange={(e) => p.setMin(+e.target.value)} className={inputCls} /></Field>
            <Field label="Max"><input type="number" value={p.max} onChange={(e) => p.setMax(+e.target.value)} className={inputCls} /></Field>
          </>
        )}
      </div>

      {p.error && <div className="text-sm text-red-500 bg-red-500/10 p-2 rounded">{p.error}</div>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-400 mt-0.5 block">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// DeviceTreePicker — arbre de zones + devices nichés. Reflète la structure
// de l'inventaire (cf. ZonesPage) : on déplie les zones, on clique sur un
// device pour le sélectionner. Les zones vides sont masquées pour ne montrer
// que les chemins menant à un device compatible.
// ---------------------------------------------------------------------------
interface DTNode {
  zone: Zone;
  children: DTNode[];
  devices: DeviceListItem[];
}

function DeviceTreePicker({ zones, devices, selected, onSelect }: {
  zones: Zone[]; devices: DeviceListItem[];
  selected: string | null;
  onSelect: (d: DeviceListItem) => void;
}) {
  const tree = useMemo(() => buildDeviceTree(zones, devices), [zones, devices]);
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 max-h-72 overflow-auto p-1">
      {tree.length === 0 ? (
        <div className="text-sm text-slate-500 italic p-3">Aucun équipement compatible.</div>
      ) : (
        tree.map((n) => <DTreeNode key={n.zone.id} node={n} depth={0} selected={selected} onSelect={onSelect} />)
      )}
    </div>
  );
}

function DTreeNode({ node, depth, selected, onSelect }: {
  node: DTNode; depth: number;
  selected: string | null;
  onSelect: (d: DeviceListItem) => void;
}) {
  // Auto-déplie quand l'arbre contient le device sélectionné — pratique en
  // édition pour montrer le contexte tout de suite.
  const containsSelected = useMemo(() => subtreeHasDevice(node, selected), [node, selected]);
  const [expanded, setExpanded] = useState(containsSelected || depth === 0);
  const Icon = ZONE_KIND_ICON[node.zone.kind];
  return (
    <div>
      <button type="button" onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}>
        <span className="text-slate-400 shrink-0">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <Icon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
        <span className="text-sm text-slate-700 dark:text-slate-200 truncate">{node.zone.name}</span>
        <span className="text-[10px] text-slate-400 ml-auto pl-2 shrink-0">
          {countDevicesInSubtree(node)}
        </span>
      </button>
      {expanded && (
        <>
          {node.devices.map((d) => {
            const isSel = d.id === selected;
            return (
              <button key={d.id} type="button" onClick={() => onSelect(d)}
                className={clsx(
                  "w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-sm transition",
                  isSel
                    ? "bg-brand-500/15 text-brand-700 dark:text-brand-300"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200",
                )}
                style={{ paddingLeft: `${depth * 14 + 24}px` }}>
                <Cpu className={clsx("h-3.5 w-3.5 shrink-0", isSel ? "text-brand-500" : "text-slate-400")} />
                <span className="truncate">{d.name || d.slug}</span>
                <span className="text-[10px] text-slate-400 ml-2 shrink-0">{d.type}</span>
                {isSel && <Check className="h-3.5 w-3.5 ml-auto text-brand-500" />}
              </button>
            );
          })}
          {node.children.map((c) => (
            <DTreeNode key={c.zone.id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
        </>
      )}
    </div>
  );
}

function buildDeviceTree(zones: Zone[], devices: DeviceListItem[]): DTNode[] {
  const byID = new Map<string, DTNode>();
  zones.forEach((z) => byID.set(z.id, { zone: z, children: [], devices: [] }));
  // Rattache devices à leur zone
  for (const d of devices) {
    const n = byID.get(d.zone_id);
    if (n) n.devices.push(d);
  }
  // Rattache zones enfants
  const roots: DTNode[] = [];
  zones.forEach((z) => {
    const n = byID.get(z.id)!;
    if (z.parent_zone_id && byID.has(z.parent_zone_id)) {
      byID.get(z.parent_zone_id)!.children.push(n);
    } else {
      roots.push(n);
    }
  });
  // Élague les branches qui ne contiennent aucun device compatible
  const prune = (n: DTNode): DTNode | null => {
    const kids = n.children.map(prune).filter(Boolean) as DTNode[];
    if (n.devices.length === 0 && kids.length === 0) return null;
    return { ...n, children: kids };
  };
  return roots.map(prune).filter(Boolean) as DTNode[];
}

function countDevicesInSubtree(n: DTNode): number {
  return n.devices.length + n.children.reduce((acc, c) => acc + countDevicesInSubtree(c), 0);
}

function subtreeHasDevice(n: DTNode, deviceID: string | null): boolean {
  if (!deviceID) return false;
  if (n.devices.some((d) => d.id === deviceID)) return true;
  return n.children.some((c) => subtreeHasDevice(c, deviceID));
}

