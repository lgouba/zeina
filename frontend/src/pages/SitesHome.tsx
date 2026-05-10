import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, Plus, Pencil, Trash2, X, Cpu, Sparkles, Bell, LayoutDashboard, Network, LayoutGrid } from "lucide-react";
import { api, HttpError } from "../lib/api";
import { useAuth, useIsTenantAdmin } from "../lib/auth";
import { Help } from "../components/Tooltip";
import { useConfirm } from "../components/ConfirmDialog";
import { SitesConstellation } from "../components/SitesConstellation";
import type { Site, SiteSummary } from "../types/api";

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";

type ViewMode = "constellation" | "grid";
const VIEW_KEY = "zeina_sites_view";

export function SitesHome() {
  const { user, token, refreshMe } = useAuth();
  const isAdmin = useIsTenantAdmin();
  const confirm = useConfirm();
  const [sites, setSites] = useState<Site[]>([]);
  const [summaries, setSummaries] = useState<Record<string, SiteSummary>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY) as ViewMode | null;
      return v === "grid" ? "grid" : "constellation";
    } catch { return "constellation"; }
  });

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ } }, [view]);

  const reload = () => {
    if (!token) return;
    setLoading(true);
    api.get<Site[]>("/v1/sites").then((s) => {
      setSites(s);
      setLoading(false);
      Promise.all(s.map((site) =>
        api.get<SiteSummary>(`/v1/sites/${site.id}/summary`)
          .then((sum) => [site.id, sum] as const).catch(() => null)
      )).then((results) => {
        const map: Record<string, SiteSummary> = {};
        for (const r of results) if (r) map[r[0]] = r[1];
        setSummaries(map);
      });
    }).catch(() => setLoading(false));
  };
  useEffect(reload, [token]);

  // Stats globales : agrégat sur tous les sites pour la bande "vue d'ensemble".
  const totals = useMemo(() => {
    const t = { devices: 0, rules: 0, alarms: 0, widgets: 0 };
    for (const id in summaries) {
      const s = summaries[id];
      t.devices += s.devices_total;
      t.rules += s.rules_total;
      t.alarms += s.alarms_total;
      t.widgets += s.widgets_total;
    }
    return t;
  }, [summaries]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Hero compact : titre + stats inline + bouton sur une seule ligne */}
      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-500/10 via-cyan-500/5 to-emerald-500/10 dark:from-indigo-500/20 dark:via-cyan-500/10 dark:to-emerald-500/15 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="zeina-blob absolute -top-32 -left-20 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="zeina-blob absolute -bottom-20 right-10 w-80 h-80 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none"
          style={{ animationDelay: "6s" }} />

        <div className="relative px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 font-semibold leading-none mb-0.5">
              Hyperviseur ZEINA
            </p>
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-transparent leading-tight">
              Bonjour {user?.full_name?.split(" ")[0] || user?.email?.split("@")[0]}
            </h1>
          </div>

          {sites.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <GlobalStat icon={<Building2 className="h-3.5 w-3.5" />} label="Sites"        value={sites.length}      color="indigo" />
              <GlobalStat icon={<Cpu className="h-3.5 w-3.5" />}       label="Équipements" value={totals.devices}    color="cyan" />
              <GlobalStat icon={<Sparkles className="h-3.5 w-3.5" />}  label="Règles"      value={totals.rules}      color="emerald" />
              <GlobalStat icon={<Bell className="h-3.5 w-3.5" />}      label="Alarmes"     value={totals.alarms}     color={totals.alarms > 0 ? "rose" : "slate"} />
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
              <ViewToggle active={view === "constellation"} onClick={() => setView("constellation")} icon={<Network className="h-3.5 w-3.5" />} label="Réseau" />
              <ViewToggle active={view === "grid"} onClick={() => setView("grid")} icon={<LayoutGrid className="h-3.5 w-3.5" />} label="Grille" />
            </div>
            {isAdmin && (
              <button onClick={() => setCreating(true)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-br from-brand-500 to-cyan-500 hover:from-brand-400 hover:to-cyan-400 text-white text-sm font-medium shadow-lg shadow-brand-500/30 transition">
                <Plus className="h-3.5 w-3.5" /> Nouveau site
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body : remplit l'espace restant exactement, sans scroll */}
      <div className="flex-1 min-h-0 p-4">
        {loading ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">Chargement…</div>
        ) : sites.length === 0 ? (
          <EmptyState canCreate={isAdmin} onCreate={() => setCreating(true)} />
        ) : view === "constellation" ? (
          <div className="h-full">
            <SitesConstellation sites={sites} summaries={summaries} />
          </div>
        ) : (
          <div className="h-full overflow-auto grid gap-4 sm:grid-cols-2 lg:grid-cols-3 content-start">
            {sites.map((s) => (
              <SiteCard key={s.id} site={s} summary={summaries[s.id]}
                canManage={isAdmin}
                onEdit={() => setEditing(s)}
                onDelete={async () => {
                  const ok = await confirm({
                    title: `Supprimer le site « ${s.name} » ?`,
                    description: <>
                      Cette action supprimera <strong>définitivement</strong> le site et l'intégralité de ses données :
                      zones, équipements, règles, dashboards, alarmes, historique des mesures et affectations des utilisateurs.
                      <br /><br />
                      Cette action est <strong>irréversible</strong>.
                    </>,
                    danger: true,
                    confirmLabel: "Supprimer définitivement",
                    requireText: s.name,
                  });
                  if (!ok) return;
                  try {
                    await api.del(`/v1/sites/${s.id}`);
                    reload();
                    void refreshMe();
                  } catch (e) {
                    alert(e instanceof HttpError ? e.payload.message : String(e));
                  }
                }} />
            ))}
          </div>
        )}
      </div>

      {creating && (
        <SiteFormModal mode="create"
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); reload(); void refreshMe(); }} />
      )}
      {editing && (
        <SiteFormModal mode="edit" site={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); void refreshMe(); }} />
      )}
    </div>
  );
}

function ViewToggle({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
        active
          ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-sm"
          : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
      }`}>
      {icon} {label}
    </button>
  );
}

function GlobalStat({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: number;
  color: "indigo" | "cyan" | "emerald" | "rose" | "slate";
}) {
  const colorMap: Record<string, string> = {
    indigo:  "from-indigo-500/20 to-indigo-500/5 text-indigo-600 dark:text-indigo-300 border-indigo-500/20",
    cyan:    "from-cyan-500/20 to-cyan-500/5 text-cyan-600 dark:text-cyan-300 border-cyan-500/20",
    emerald: "from-emerald-500/20 to-emerald-500/5 text-emerald-600 dark:text-emerald-300 border-emerald-500/20",
    rose:    "from-rose-500/20 to-rose-500/5 text-rose-600 dark:text-rose-300 border-rose-500/30",
    slate:   "from-slate-500/10 to-slate-500/5 text-slate-600 dark:text-slate-300 border-slate-500/20",
  };
  return (
    <div className={`relative rounded-xl border bg-gradient-to-br ${colorMap[color]} backdrop-blur-sm px-4 py-2 flex items-center justify-between gap-3`}>
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="text-[11px] uppercase tracking-wider font-semibold opacity-80 truncate">{label}</span>
      </div>
      <div className="text-xl font-bold tabular-nums text-slate-900 dark:text-white shrink-0">{value}</div>
    </div>
  );
}

function EmptyState({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center">
      <Building2 className="h-8 w-8 text-slate-400 mx-auto mb-3" />
      <p className="text-sm text-slate-500 mb-4">
        {canCreate ? "Aucun site n'est encore configuré pour ce tenant." : "Aucun site ne vous est attribué — contactez un administrateur."}
      </p>
      {canCreate && (
        <button onClick={onCreate}
          className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white">
          <Plus className="h-4 w-4" /> Créer le premier site
        </button>
      )}
    </div>
  );
}

function SiteCard({ site, summary, canManage, onEdit, onDelete }: {
  site: Site; summary?: SiteSummary; canManage: boolean;
  onEdit: () => void; onDelete: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="relative group rounded-2xl border border-slate-200 bg-white hover:border-brand-500/50 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-900/80 p-5 transition cursor-pointer"
      onClick={() => navigate(`/sites/${site.id}/dashboards`)}>
      {canManage && (
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 rounded-md bg-white/90 dark:bg-slate-800/90 backdrop-blur text-slate-500 hover:text-brand-500 border border-slate-200 dark:border-slate-700"
            title="Modifier">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 rounded-md bg-white/90 dark:bg-slate-800/90 backdrop-blur text-slate-500 hover:text-red-500 border border-slate-200 dark:border-slate-700"
            title="Supprimer">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <Link to={`/sites/${site.id}/dashboards`} className="block" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-brand-500/10 p-2.5 text-brand-500 dark:text-brand-400">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate text-slate-900 dark:text-slate-100">{site.name}</div>
            <div className="text-xs text-slate-500 mt-0.5 truncate font-mono">{site.slug}</div>
          </div>
        </div>
        {summary && (
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <Stat icon={<Cpu className="h-3.5 w-3.5" />}             label="Équipements" value={summary.devices_total} />
            <Stat icon={<Sparkles className="h-3.5 w-3.5" />}        label="Règles"      value={summary.rules_total} />
            <Stat icon={<Bell className="h-3.5 w-3.5" />}            label="Alarmes"     value={summary.alarms_total} />
            <Stat icon={<LayoutDashboard className="h-3.5 w-3.5" />} label="Widgets"     value={summary.widgets_total} />
          </div>
        )}
      </Link>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-slate-400 dark:text-slate-500 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] text-slate-500">{label}</div>
        <div className="text-sm text-slate-900 dark:text-slate-100 font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// Modal de création / édition de site
// -------------------------------------------------------------------------
function SiteFormModal({ mode, site, onClose, onSaved }: {
  mode: "create" | "edit"; site?: Site;
  onClose: () => void; onSaved: () => void;
}) {
  const [slug, setSlug] = useState(site?.slug || "");
  const [name, setName] = useState(site?.name || "");
  const [timezone, setTimezone] = useState(site?.timezone || "Africa/Ouagadougou");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // slugDirty : passe à true dès que l'admin modifie manuellement le champ
  // slug. Tant que false, le slug se régénère automatiquement à chaque
  // frappe dans Nom. En édition on n'auto-remplit pas (slug verrouillé).
  const [slugDirty, setSlugDirty] = useState(mode === "edit");

  // Auto-slug à partir du nom (uniquement en création).
  function autoSlug(n: string) {
    return n.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove accents
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError("Nom requis"); return; }
    setSubmitting(true);
    const body: Record<string, unknown> = {
      name: name.trim(),
      timezone: timezone || "Africa/Ouagadougou",
    };
    if (mode === "create") {
      body.slug = (slug || autoSlug(name)).trim();
    }
    try {
      if (mode === "create") {
        await api.post("/v1/sites", body);
      } else if (site) {
        await api.put(`/v1/sites/${site.id}`, body);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold">{mode === "create" ? "Nouveau site" : `Modifier ${site?.name}`}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Nom *">
            <input value={name} onChange={(e) => {
              const v = e.target.value;
              setName(v);
              // Tant que l'admin n'a pas touché Slug manuellement, on le
              // synchronise sur le nom.
              if (mode === "create" && !slugDirty) {
                setSlug(autoSlug(v));
              }
            }} required placeholder="ex: Agence Bobo-Dioulasso" className={inputCls} />
          </Field>
          {mode === "create" && (
            <Field label="Slug *" tooltip={
              <>
                <p>Identifiant court utilisé dans les topics MQTT et les URL : <code className="font-mono">qlab/&lt;tenant&gt;/&lt;slug&gt;/...</code></p>
                <p className="mt-1">Uniquement minuscules, chiffres et tirets. Ne peut plus changer après création.</p>
                <p className="mt-1">Auto-généré depuis le nom — éditable si vous voulez l'imposer.</p>
              </>
            }>
              <input value={slug} onChange={(e) => {
                setSlug(e.target.value.toLowerCase());
                setSlugDirty(true);
              }} required
                placeholder="agence-bobo" className={inputCls + " font-mono"} />
              <div className="text-[10px] text-slate-400 mt-0.5">
                {slug
                  ? <>qlab/&lt;tenant&gt;/<span className="text-slate-500">{slug}</span>/…</>
                  : "Auto-généré à partir du nom."}
              </div>
            </Field>
          )}
          <Field label="Fuseau horaire">
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Africa/Ouagadougou" className={inputCls} />
          </Field>

          {mode === "create" && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-sky-500/5 border border-sky-500/20 rounded p-2.5">
              ℹ️ À la création, vous serez automatiquement ajouté au site avec le rôle <strong>Responsable de site</strong>.
            </div>
          )}
          {error && <div className="text-sm text-red-500 bg-red-500/10 p-2 rounded">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white">Annuler</button>
          <button type="submit" disabled={submitting}
            className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50">
            {submitting ? "…" : mode === "create" ? "Créer le site" : "Enregistrer"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, tooltip, children }: { label: string; tooltip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
        {label}
        {tooltip && <Help>{tooltip}</Help>}
      </span>
      {children}
    </label>
  );
}
