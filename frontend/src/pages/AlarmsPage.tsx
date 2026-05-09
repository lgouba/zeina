import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bell, Search, ChevronUp, ChevronDown, AlertTriangle, AlertCircle, AlertOctagon, Check, X } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { unitSymbol } from "../lib/units";
import type { Alarm, AlarmCounts, AlarmSeverity, AlarmState } from "../types/api";

/**
 * AlarmsPage — liste des alarmes du site avec onglets de filtrage par état,
 * compteurs, recherche et tableau triable. Click sur une ligne → /alarms/:id.
 *
 * Inspiration : page Alarmes de Pulsio (cf. screenshot fourni).
 */

type StateTab = "active" | "triggered" | "acknowledged" | "resolved" | "archived" | "all";

const TABS: { key: StateTab; label: string }[] = [
  { key: "active",       label: "Actives" },
  { key: "triggered",    label: "Déclenchée" },
  { key: "acknowledged", label: "Prise en compte" },
  { key: "resolved",     label: "Acquittée" },
  { key: "archived",     label: "Archivée" },
  { key: "all",          label: "Toutes" },
];

export function AlarmsPage() {
  const { id: siteId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [counts, setCounts] = useState<AlarmCounts | null>(null);
  const [tab, setTab] = useState<StateTab>("active");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<keyof Alarm>("opened_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const reload = () => {
    if (!siteId) return;
    setLoading(true);
    Promise.all([
      api.get<Alarm[]>(`/v1/sites/${siteId}/alarms?state=${tab}&limit=500`),
      api.get<AlarmCounts>(`/v1/sites/${siteId}/alarms/counts`),
    ])
      .then(([as, cs]) => { setAlarms(as); setCounts(cs); })
      .finally(() => setLoading(false));
  };
  useEffect(reload, [siteId, tab]);

  // Auto-refresh léger (toutes les 30s) pour voir les nouvelles alarmes en
  // quasi temps-réel sans WS dédié pour le moment.
  useEffect(() => {
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, tab]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let arr = alarms;
    if (needle) {
      arr = arr.filter((a) =>
        (a.name + " " + a.rule_name + " " + (a.device_name || "") + " " + (a.zone_name || "")).toLowerCase().includes(needle)
      );
    }
    return [...arr].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [alarms, search, sortKey, sortDir]);

  function toggleSort(k: keyof Alarm) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  return (
    <div className="p-6">
      <header className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bell className="h-5 w-5 text-brand-500" /> Alarmes
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {counts ? `${counts.active} active${counts.active > 1 ? "s" : ""}` : "…"} —
            historique complet des incidents déclenchés par les règles.
          </p>
        </div>
        <div className="relative">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, règle, équipement…"
            className="pl-8 pr-3 py-2 text-sm rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-brand-500 w-72" />
        </div>
      </header>

      {/* Onglets de filtre */}
      <div className="flex flex-wrap items-center gap-1 mb-4 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => {
          const c = counts ? countFor(counts, t.key) : null;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={clsx(
                "px-3 py-2 text-sm font-medium border-b-2 transition -mb-px",
                tab === t.key
                  ? "border-brand-500 text-brand-600 dark:text-brand-300"
                  : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white",
              )}>
              {t.label}
              {c != null && (
                <span className={clsx(
                  "ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded text-[10px] font-semibold",
                  tab === t.key ? "bg-brand-500 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
                )}>{c}</span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center">
          <Bell className="h-8 w-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            {search ? `Aucune alarme ne correspond à « ${search} ».` :
             tab === "active" ? "Aucune alarme active. 🎉" : "Aucune alarme dans cet état."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <Th label="Date / heure"   sortKey="opened_at"      cur={sortKey} dir={sortDir} onSort={toggleSort} />
                  <Th label="Durée"          />
                  <Th label="Label"          sortKey="label"          cur={sortKey} dir={sortDir} onSort={toggleSort} />
                  <Th label="Nom"            sortKey="name"           cur={sortKey} dir={sortDir} onSort={toggleSort} />
                  <Th label="État"           sortKey="state"          cur={sortKey} dir={sortDir} onSort={toggleSort} />
                  <Th label="Sévérité"       sortKey="severity"       cur={sortKey} dir={sortDir} onSort={toggleSort} />
                  <Th label="Données"        />
                  <Th label="Source"         />
                  <Th label="Décl."          sortKey="trigger_count"  cur={sortKey} dir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((a) => (
                  <tr key={a.id}
                    onClick={() => navigate(`/sites/${siteId}/alarms/${a.id}`)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="text-slate-700 dark:text-slate-200 font-medium">{formatDate(a.opened_at)}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">{formatTime(a.opened_at)}</div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {durationSince(a.opened_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 font-medium">
                        {a.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-slate-800 dark:text-slate-100 font-medium">{a.name}</div>
                      {a.status_text && (
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">{a.status_text}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5"><StateBadge state={a.state} /></td>
                    <td className="px-3 py-2.5"><SeverityBadge severity={a.severity} /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-xs">
                      {a.last_value != null ? `${a.last_value}${unitSymbol(a.unit)}` : "–"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs text-slate-700 dark:text-slate-200">{a.device_name || a.device_slug || "—"}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">{a.zone_name || ""}</div>
                    </td>
                    <td className="px-3 py-2.5 text-center font-semibold text-slate-700 dark:text-slate-200">{a.trigger_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function countFor(c: AlarmCounts, key: StateTab): number {
  switch (key) {
    case "active":       return c.active;
    case "triggered":    return c.triggered;
    case "acknowledged": return c.acknowledged;
    case "resolved":     return c.resolved;
    case "archived":     return c.archived;
    case "all":          return c.all;
  }
}

function Th({ label, sortKey, cur, dir, onSort }: {
  label: string; sortKey?: keyof Alarm; cur?: keyof Alarm; dir?: "asc" | "desc"; onSort?: (k: keyof Alarm) => void;
}) {
  const sortable = !!sortKey && !!onSort;
  return (
    <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap select-none">
      {sortable ? (
        <button onClick={() => sortKey && onSort && onSort(sortKey)}
          className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-white transition">
          {label}
          {cur === sortKey && (dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
        </button>
      ) : label}
    </th>
  );
}

export function SeverityBadge({ severity }: { severity: AlarmSeverity }) {
  const map: Record<AlarmSeverity, { label: string; classes: string; icon: React.ReactNode }> = {
    minor:    { label: "MINEUR",   classes: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/30",  icon: <AlertCircle className="h-3 w-3" /> },
    major:    { label: "MAJEUR",   classes: "bg-amber-500/15  text-amber-700  dark:text-amber-300  border-amber-500/40",   icon: <AlertTriangle className="h-3 w-3" /> },
    critical: { label: "CRITIQUE", classes: "bg-red-500/15    text-red-700    dark:text-red-300    border-red-500/40",     icon: <AlertOctagon  className="h-3 w-3" /> },
  };
  const m = map[severity];
  return (
    <span className={clsx("inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold tracking-wider", m.classes)}>
      {m.icon}{m.label}
    </span>
  );
}

export function StateBadge({ state }: { state: AlarmState }) {
  const map: Record<AlarmState, { label: string; classes: string; icon: React.ReactNode }> = {
    triggered:    { label: "Déclenchée",     classes: "bg-rose-500/10    text-rose-700    dark:text-rose-300    border-rose-500/30",    icon: <AlertOctagon className="h-3 w-3" /> },
    acknowledged: { label: "Prise en compte", classes: "bg-amber-500/10   text-amber-700   dark:text-amber-300   border-amber-500/30",   icon: <Check className="h-3 w-3" /> },
    resolved:     { label: "Acquittée",      classes: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", icon: <Check className="h-3 w-3" /> },
    archived:     { label: "Archivée",       classes: "bg-slate-500/10   text-slate-700   dark:text-slate-300   border-slate-500/30",   icon: <X className="h-3 w-3" /> },
  };
  const m = map[state];
  return (
    <span className={clsx("inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium", m.classes)}>
      {m.icon}{m.label}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function durationSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days}j ${hours}h ${mins}min`;
  if (hours > 0) return `${hours}h ${mins}min`;
  if (mins > 0) return `${mins} min`;
  return `${sec}s`;
}
