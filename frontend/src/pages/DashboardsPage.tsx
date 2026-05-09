import { useEffect, useState } from "react";
import { useNavigate, useParams, NavLink, Outlet, useLocation } from "react-router-dom";
import { Plus, LayoutDashboard, X } from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { DashboardListItem } from "../types/api";

/**
 * DashboardsLayout — barre d'onglets horizontale en haut + contenu en
 * dessous. Quand aucun dashboard n'est sélectionné, on liste / propose la
 * création. Sinon on affiche le détail (widgets) via Outlet.
 */
export function DashboardsLayout() {
  const { id: siteId, did } = useParams<{ id: string; did?: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [dashboards, setDashboards] = useState<DashboardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const reload = () => {
    if (!siteId || !token) return;
    setLoading(true);
    api.get<DashboardListItem[]>(`/v1/sites/${siteId}/dashboards`)
      .then(setDashboards).finally(() => setLoading(false));
  };
  useEffect(reload, [siteId, token]);

  // Si on est sur /sites/:id/dashboards et qu'il y a au moins un dashboard,
  // on redirige vers le premier (UX façon Pulsio).
  useEffect(() => {
    const onIndex = location.pathname.endsWith("/dashboards") || location.pathname.endsWith("/dashboards/");
    if (onIndex && dashboards.length > 0) {
      navigate(`/sites/${siteId}/dashboards/${dashboards[0].id}`, { replace: true });
    }
  }, [dashboards, location.pathname, siteId, navigate]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {dashboards.map((d) => (
          <NavLink key={d.id} to={`/sites/${siteId}/dashboards/${d.id}`}
            className={({ isActive }) => clsx(
              "px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition",
              isActive ? "bg-brand-500/15 text-brand-300" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
            )}>
            {d.name}
            <span className="ml-1.5 text-[10px] text-slate-500">{d.widget_count}</span>
          </NavLink>
        ))}
        <button onClick={() => setCreateOpen(true)}
          className="ml-2 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300">
          <Plus className="h-3 w-3" /> Nouveau
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-8 text-sm text-slate-500 dark:text-slate-400">Chargement…</div>
        ) : dashboards.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : did ? (
          <Outlet context={{ reloadDashboards: reload }} />
        ) : null}
      </div>

      {createOpen && siteId && (
        <CreateDashboardModal siteId={siteId} onClose={() => setCreateOpen(false)}
          onCreated={(d) => { setCreateOpen(false); reload(); navigate(`/sites/${siteId}/dashboards/${d.id}`); }} />
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-16">
      <div className="rounded-full bg-slate-100 dark:bg-slate-800 p-4 mb-4">
        <LayoutDashboard className="h-8 w-8 text-slate-500" />
      </div>
      <h2 className="text-lg font-medium mb-1">Aucun tableau de bord</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 max-w-sm">
        Créez un tableau de bord pour assembler des widgets temps réel à partir des équipements du site.
      </p>
      <button onClick={onCreate}
        className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white dark:text-slate-100">
        <Plus className="h-4 w-4" /> Créer mon premier tableau de bord
      </button>
    </div>
  );
}

function CreateDashboardModal({ siteId, onClose, onCreated }: { siteId: string; onClose: () => void; onCreated: (d: DashboardListItem) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true); setError(null);
    try {
      const d = await api.post<DashboardListItem>(`/v1/sites/${siteId}/dashboards`,
        { name: name.trim(), description: description.trim() || undefined });
      onCreated({ ...d, widget_count: 0 });
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold">Nouveau tableau de bord</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs text-slate-500 dark:text-slate-400">Nom *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus
              className="mt-1 block w-full rounded-md bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500"
              placeholder="ex: Vue énergie" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500 dark:text-slate-400">Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="mt-1 block w-full rounded-md bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500" />
          </label>
          {error && <div className="text-sm text-red-400">{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">Annuler</button>
            <button type="submit" disabled={submitting} className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white dark:text-slate-100">
              {submitting ? "Création…" : "Créer"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
