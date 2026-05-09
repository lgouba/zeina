import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, MapPin, Plus, Pencil, Trash2, X } from "lucide-react";
import { api, HttpError } from "../lib/api";
import { useAuth, useIsTenantAdmin } from "../lib/auth";
import { Help } from "../components/Tooltip";
import type { Site, SiteSummary } from "../types/api";

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";

export function SitesHome() {
  const { user, token, refreshMe } = useAuth();
  const isAdmin = useIsTenantAdmin();
  const [sites, setSites] = useState<Site[]>([]);
  const [summaries, setSummaries] = useState<Record<string, SiteSummary>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);

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

  return (
    <div className="p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Bienvenue {user?.full_name || user?.email?.split("@")[0]}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Sélectionnez un site pour voir ses équipements et tableaux de bord.
        </p>
      </header>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs uppercase tracking-wider text-slate-500">Vos sites</h2>
          {isAdmin && (
            <button onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-brand-500 hover:bg-brand-400 text-white">
              <Plus className="h-3.5 w-3.5" /> Nouveau site
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">Chargement…</div>
        ) : sites.length === 0 ? (
          <EmptyState canCreate={isAdmin} onCreate={() => setCreating(true)} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sites.map((s) => (
              <SiteCard key={s.id} site={s} summary={summaries[s.id]}
                canManage={isAdmin}
                onEdit={() => setEditing(s)}
                onDelete={async () => {
                  if (!confirm(`Supprimer définitivement "${s.name}" et toutes ses données ?\nCette action est irréversible.`)) return;
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
      </section>

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
            <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5 truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{site.address || site.slug}</span>
            </div>
          </div>
        </div>
        {summary && (
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <Stat label="Équipements" value={`${summary.devices_online}/${summary.devices_total}`} />
            <Stat label="Conso 24h"   value={summary.energy_day_wh != null ? `${(summary.energy_day_wh / 1000).toFixed(2)} kWh` : "—"} />
            <Stat label="T° moy 1h"   value={summary.temperature_avg != null ? `${summary.temperature_avg.toFixed(1)}°C` : "—"} />
            <Stat label="Occupation"  value={summary.occupancy_ratio_24h != null ? `${(summary.occupancy_ratio_24h * 100).toFixed(0)}%` : "—"} />
          </div>
        )}
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="text-sm text-slate-900 dark:text-slate-100 font-medium">{value}</div>
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
  const [address, setAddress] = useState(site?.address || "");
  const [lat, setLat] = useState(site?.lat?.toString() || "");
  const [lng, setLng] = useState(site?.lng?.toString() || "");
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
      address: address.trim() || null,
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
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
          <Field label="Adresse">
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rue, ville, pays" className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude">
              <input value={lat} onChange={(e) => setLat(e.target.value)} type="number" step="any" placeholder="12.3714" className={inputCls} />
            </Field>
            <Field label="Longitude">
              <input value={lng} onChange={(e) => setLng(e.target.value)} type="number" step="any" placeholder="-1.5197" className={inputCls} />
            </Field>
          </div>
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
