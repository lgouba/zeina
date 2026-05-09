import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Plus, Search, RefreshCw, Trash2, Lightbulb, Thermometer, Activity, Cpu, Zap, Gauge,
  ChevronRight, ChevronDown, ChevronUp, Filter, EyeOff, ArrowDownUp,
} from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../lib/api";
import { useAuth, useCanWrite } from "../lib/auth";
import { CreateDeviceModal } from "../components/CreateDeviceModal";
import type { DeviceListItem } from "../types/api";

type ColumnKey = "name" | "zone" | "category" | "type" | "model" | "status" | "last_seen";
type SortDir = "asc" | "desc";

const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "name",      label: "Équipement" },
  { key: "zone",      label: "Zone" },
  { key: "category",  label: "Catégorie" },
  { key: "type",      label: "Type" },
  { key: "model",     label: "Modèle" },
  { key: "status",    label: "État" },
  { key: "last_seen", label: "Dernière info" },
];

function valueFor(d: DeviceListItem, k: ColumnKey): string {
  switch (k) {
    case "name":      return (d.name || d.slug || "").toLowerCase();
    case "zone":      return (d.zone_name || "").toLowerCase();
    case "category":  return (d.category || "").toLowerCase();
    case "type":      return d.type;
    case "model":     return (d.model || "").toLowerCase();
    case "status":    return d.status;
    case "last_seen": return d.last_seen_at || "";
  }
}

export function DevicesPage() {
  const { id: siteId } = useParams<{ id: string }>();
  const { token } = useAuth();
  const canWrite = useCanWrite("devices");
  const navigate = useNavigate();
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // Tri + filtres par colonne (modèle Pulsio).
  const [sortKey, setSortKey] = useState<ColumnKey | "">("");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [colFilters, setColFilters] = useState<Partial<Record<ColumnKey, string>>>({});
  const [hidden, setHidden] = useState<Set<ColumnKey>>(new Set());

  const reload = () => {
    if (!siteId || !token) return;
    setLoading(true);
    api.get<DeviceListItem[]>(`/v1/sites/${siteId}/devices`)
      .then(setDevices).finally(() => setLoading(false));
  };
  useEffect(reload, [siteId, token]);

  // Options dynamiques pour les dropdowns "select" : alimentées par les
  // valeurs présentes dans les devices chargés.
  const optionsByCol: Partial<Record<ColumnKey, string[]>> = useMemo(() => ({
    zone:     Array.from(new Set(devices.map((d) => d.zone_name).filter(Boolean))).sort(),
    category: Array.from(new Set(devices.map((d) => d.category).filter(Boolean) as string[])).sort(),
    type:     Array.from(new Set(devices.map((d) => d.type))).sort(),
    model:    Array.from(new Set(devices.map((d) => d.model).filter(Boolean) as string[])).sort(),
    status:   ["online", "offline", "provisioned", "disabled"],
  }), [devices]);

  // Liste finale après search + filtres par colonne + tri.
  const visible = useMemo(() => {
    let arr = devices;
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter((d) =>
        d.slug.toLowerCase().includes(q) ||
        (d.name?.toLowerCase().includes(q) ?? false) ||
        d.zone_name.toLowerCase().includes(q) ||
        (d.model?.toLowerCase().includes(q) ?? false));
    }
    for (const k of Object.keys(colFilters) as ColumnKey[]) {
      const v = (colFilters[k] || "").toLowerCase();
      if (!v) continue;
      arr = arr.filter((d) => valueFor(d, k).includes(v));
    }
    if (sortKey) {
      arr = [...arr].sort((a, b) => {
        const av = valueFor(a, sortKey);
        const bv = valueFor(b, sortKey);
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }
    return arr;
  }, [devices, search, colFilters, sortKey, sortDir]);

  const visibleCols = ALL_COLUMNS.filter((c) => !hidden.has(c.key));

  function setSort(k: ColumnKey, dir: SortDir) {
    setSortKey(k);
    setSortDir(dir);
  }
  function setFilter(k: ColumnKey, v: string) {
    setColFilters((prev) => ({ ...prev, [k]: v }));
  }
  function clearFilter(k: ColumnKey) {
    setColFilters((prev) => { const next = { ...prev }; delete next[k]; return next; });
  }
  function hideCol(k: ColumnKey) {
    setHidden((prev) => new Set(prev).add(k));
  }
  function showAllCols() {
    setHidden(new Set());
    setColFilters({});
    setSortKey("");
  }

  async function onDelete(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    if (!confirm(`Supprimer l'équipement "${name}" ?`)) return;
    try {
      await api.del(`/v1/devices/${id}`);
      reload();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    }
  }

  function openDevice(d: DeviceListItem) {
    navigate(`/sites/${siteId}/devices/${d.id}`);
  }

  const activeFiltersCount =
    Object.values(colFilters).filter((v) => v && v !== "").length +
    (sortKey ? 1 : 0) +
    hidden.size;

  return (
    <div className="p-6">
      <header className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold">Équipements</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{visible.length} équipement{visible.length > 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {activeFiltersCount > 0 && (
            <button onClick={showAllCols}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
              Réinitialiser ({activeFiltersCount})
            </button>
          )}
          <button onClick={reload}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300">
            <RefreshCw className="h-3.5 w-3.5" /> Actualiser
          </button>
          {canWrite && (
            <button onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white dark:text-slate-100">
              <Plus className="h-3.5 w-3.5" /> Nouvel équipement
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher slug, nom, zone…"
            className="pl-8 pr-3 py-2 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm w-72 focus:outline-none focus:border-brand-500" />
        </div>
        {hidden.size > 0 && (
          <ColumnsRestoreMenu hidden={hidden}
            onShow={(k) => setHidden((prev) => { const n = new Set(prev); n.delete(k); return n; })} />
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/80 text-xs uppercase text-slate-500 dark:text-slate-400">
            <tr>
              {visibleCols.map((c) => (
                <ColumnHeader key={c.key}
                  label={c.label}
                  colKey={c.key}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  filterValue={colFilters[c.key] || ""}
                  options={optionsByCol[c.key]}
                  onSort={(dir) => setSort(c.key, dir)}
                  onFilterChange={(v) => v ? setFilter(c.key, v) : clearFilter(c.key)}
                  onHide={() => hideCol(c.key)}
                />
              ))}
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {loading ? (
              <tr><td colSpan={visibleCols.length + 1} className="px-4 py-6 text-center text-slate-500 text-xs">Chargement…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={visibleCols.length + 1} className="px-4 py-6 text-center text-slate-500 text-xs italic">Aucun équipement</td></tr>
            ) : visible.map((d) => (
              <tr key={d.id} onClick={() => openDevice(d)}
                className="group hover:bg-slate-50 dark:hover:bg-slate-900/70 cursor-pointer transition">
                {visibleCols.map((c) => (
                  <td key={c.key} className="px-4 py-2.5">
                    {renderCell(d, c.key)}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    {canWrite && (
                      <button onClick={(e) => onDelete(e, d.id, d.name || d.slug)}
                        className="text-slate-500 hover:text-red-400 transition opacity-0 group-hover:opacity-100" title="Supprimer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-brand-400 transition" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && siteId && (
        <CreateDeviceModal siteId={siteId} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); reload(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rendu cellule par colonne (extrait pour rester lisible)
// ---------------------------------------------------------------------------
function renderCell(d: DeviceListItem, k: ColumnKey): React.ReactNode {
  switch (k) {
    case "name":
      return (
        <div className="flex items-center gap-2.5">
          <DeviceTypeIcon type={d.type} />
          <div>
            <div className="font-medium group-hover:text-brand-600 dark:group-hover:text-brand-300 transition">{d.name || d.slug}</div>
            <div className="text-[10px] text-slate-500 font-mono">{d.slug}</div>
          </div>
        </div>
      );
    case "zone":     return <span className="text-slate-700 dark:text-slate-300">{d.zone_name}</span>;
    case "category": return d.category ? <CategoryBadge name={d.category} /> : <span className="text-slate-600">—</span>;
    case "type":     return <span className="text-xs text-slate-500 dark:text-slate-400 capitalize">{d.type}</span>;
    case "model":    return <span className="text-xs text-slate-500 dark:text-slate-400">{d.model || "—"}</span>;
    case "status":   return <StatusPill status={d.status} />;
    case "last_seen":
      return <span className="text-xs text-slate-500">{d.last_seen_at ? new Date(d.last_seen_at).toLocaleString("fr-FR") : "—"}</span>;
  }
}

// ---------------------------------------------------------------------------
// ColumnHeader — bouton avec dropdown : tri ↑ / ↓, filtre (text ou select),
// masquer la colonne. Inspiré de Pulsio.
// ---------------------------------------------------------------------------
function ColumnHeader({
  label, colKey, sortKey, sortDir, filterValue, options,
  onSort, onFilterChange, onHide,
}: {
  label: string;
  colKey: ColumnKey;
  sortKey: ColumnKey | "";
  sortDir: SortDir;
  filterValue: string;
  options?: string[];
  onSort: (dir: SortDir) => void;
  onFilterChange: (v: string) => void;
  onHide: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);
  const isSorted = sortKey === colKey;
  const hasFilter = filterValue !== "";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <th ref={ref} className="px-4 py-2.5 text-left whitespace-nowrap font-semibold relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white transition select-none",
          (isSorted || hasFilter) && "text-brand-600 dark:text-brand-300",
        )}>
        <span>{label}</span>
        {isSorted && (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
        {hasFilter && <Filter className="h-3 w-3" />}
        <ChevronDown className={clsx("h-3 w-3 transition", open && "rotate-180", !isSorted && !hasFilter && "opacity-40")} />
      </button>
      {open && (
        <div className="absolute left-2 top-full mt-1 w-60 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl py-1 z-30 normal-case">
          <MenuItem icon={<ChevronUp className="h-3.5 w-3.5" />}
            label="Trier par ordre croissant"
            active={isSorted && sortDir === "asc"}
            onClick={() => { onSort("asc"); setOpen(false); }} />
          <MenuItem icon={<ChevronDown className="h-3.5 w-3.5" />}
            label="Trier par ordre décroissant"
            active={isSorted && sortDir === "desc"}
            onClick={() => { onSort("desc"); setOpen(false); }} />

          <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
            <Filter className="h-3 w-3" /> Filtrer
          </div>
          <div className="px-2 pb-2">
            {options ? (
              <select value={filterValue}
                onChange={(e) => onFilterChange(e.target.value)}
                className="w-full text-xs px-2 py-1.5 rounded bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-brand-500">
                <option value="">— Tous —</option>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input value={filterValue}
                onChange={(e) => onFilterChange(e.target.value)}
                placeholder="Contient…"
                className="w-full text-xs px-2 py-1.5 rounded bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-brand-500" />
            )}
            {hasFilter && (
              <button onClick={() => onFilterChange("")}
                className="mt-1 w-full text-[10px] text-slate-500 hover:text-red-500 text-left transition">
                ✕ Effacer le filtre
              </button>
            )}
          </div>

          <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />
          <MenuItem icon={<EyeOff className="h-3.5 w-3.5" />}
            label="Masquer la colonne"
            onClick={() => { onHide(); setOpen(false); }} />
        </div>
      )}
    </th>
  );
}

function MenuItem({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={clsx(
        "w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition normal-case",
        active && "text-brand-600 dark:text-brand-300 font-medium",
      )}>
      <span className="text-slate-400 dark:text-slate-500">{icon}</span>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ColumnsRestoreMenu — réafficher les colonnes masquées
// ---------------------------------------------------------------------------
function ColumnsRestoreMenu({ hidden, onShow }: {
  hidden: Set<ColumnKey>; onShow: (k: ColumnKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300">
        <ArrowDownUp className="h-3.5 w-3.5" /> {hidden.size} colonne{hidden.size > 1 ? "s" : ""} masquée{hidden.size > 1 ? "s" : ""}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-56 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl py-1 z-30">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500">Réafficher</div>
          {Array.from(hidden).map((k) => (
            <button key={k} onClick={() => { onShow(k); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              {ALL_COLUMNS.find((c) => c.key === k)?.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceTypeIcon({ type }: { type: string }) {
  const map: Record<string, { Icon: typeof Cpu; color: string }> = {
    environment: { Icon: Thermometer, color: "text-emerald-400 bg-emerald-500/10" },
    presence:    { Icon: Activity,    color: "text-violet-400 bg-violet-500/10" },
    actuator:    { Icon: Lightbulb,   color: "text-amber-400 bg-amber-500/10" },
    linky:       { Icon: Zap,         color: "text-yellow-400 bg-yellow-500/10" },
    meter:       { Icon: Gauge,       color: "text-blue-400 bg-blue-500/10" },
    gateway:     { Icon: Cpu,         color: "text-slate-400 bg-slate-700" },
  };
  const { Icon, color } = map[type] || map.gateway;
  return <div className={clsx("rounded-md p-1.5", color)}><Icon className="h-3.5 w-3.5" /></div>;
}

function CategoryBadge({ name }: { name: string }) {
  return <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">{name}</span>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    online:      "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    offline:     "bg-slate-700/50 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-700",
    disabled:    "bg-red-500/10 text-red-300 border-red-500/30",
    provisioned: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  };
  const label: Record<string, string> = {
    online: "En ligne", offline: "Hors ligne", disabled: "Désactivé", provisioned: "Provisionné",
  };
  return (
    <span className={clsx("text-[10px] px-2 py-0.5 rounded-md border", map[status] || map.offline)}>
      {label[status] || status}
    </span>
  );
}
