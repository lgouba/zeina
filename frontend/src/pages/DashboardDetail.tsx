import { useEffect, useState } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import { Plus, Trash2, MoreVertical, Lock, Unlock } from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../lib/api";
import { useAuth, useCanWrite } from "../lib/auth";
import { CreateWidgetModal } from "../components/CreateWidgetModal";
import { DashboardGrid } from "../components/DashboardGrid";
import type { DashboardDetail as TDashboard, Widget } from "../types/api";

const LOCK_STORAGE_KEY = "zeina_dashboard_locked";

export function DashboardDetail() {
  const { did, id: siteId } = useParams<{ did: string; id: string }>();
  const { token } = useAuth();
  const canWrite = useCanWrite("dashboard");
  const ctx = useOutletContext<{ reloadDashboards: () => void }>();
  const [dash, setDash] = useState<TDashboard | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Verrou par défaut = vrai (lecture seule). Persisté en localStorage par
  // dashboard pour que la préférence soit retrouvée au retour sur la page.
  const [locked, setLocked] = useState<boolean>(() => {
    if (!did) return true;
    const v = localStorage.getItem(`${LOCK_STORAGE_KEY}:${did}`);
    return v === null ? true : v === "1";
  });
  useEffect(() => {
    if (did) localStorage.setItem(`${LOCK_STORAGE_KEY}:${did}`, locked ? "1" : "0");
  }, [did, locked]);

  const reload = () => {
    if (!did || !token) return;
    setError(null);
    api.get<TDashboard>(`/v1/dashboards/${did}`).then(setDash)
      .catch((e) => setError(e instanceof HttpError ? e.payload.message : String(e)));
  };
  useEffect(reload, [did, token]);

  async function deleteWidget(w: Widget) {
    if (!confirm(`Supprimer le widget "${w.title}" ?`)) return;
    try {
      await api.del(`/v1/widgets/${w.id}`);
      reload();
      ctx?.reloadDashboards();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    }
  }

  async function deleteDashboard() {
    if (!dash) return;
    if (!confirm(`Supprimer le tableau de bord "${dash.name}" et tous ses widgets ?`)) return;
    try {
      await api.del(`/v1/dashboards/${dash.id}`);
      ctx?.reloadDashboards();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    }
  }

  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>;
  if (!dash) return <div className="p-8 text-sm text-slate-500 dark:text-slate-400">Chargement…</div>;

  return (
    <div className="p-6">
      <header className="flex items-start justify-between mb-5 gap-4">
        <div>
          {dash.description && <p className="text-sm text-slate-500 dark:text-slate-400">{dash.description}</p>}
          {!locked && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
              Édition active — glisse les widgets pour les déplacer, attrape le coin pour redimensionner.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 relative">
          {canWrite && (
            <>
              <button onClick={() => setLocked((l) => !l)}
                title={locked ? "Déverrouiller pour réorganiser" : "Verrouiller la disposition"}
                className={clsx(
                  "flex items-center gap-1.5 text-xs px-3 py-2 rounded-md transition",
                  locked
                    ? "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
                )}>
                {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                {locked ? "Verrouillé" : "Déverrouillé"}
              </button>
              <button onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white dark:text-slate-100">
                <Plus className="h-3.5 w-3.5" /> Widget
              </button>
              <button onClick={() => setMenuOpen((o) => !o)}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Plus d'actions">
                <MoreVertical className="h-4 w-4" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md shadow-2xl py-1 z-20">
                    <button onClick={() => { setMenuOpen(false); deleteDashboard(); }}
                      className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2">
                      <Trash2 className="h-3.5 w-3.5" />
                      Supprimer ce tableau de bord
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </header>

      {dash.widgets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">Ce tableau de bord est vide.</p>
          {canWrite && (
            <button onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white dark:text-slate-100">
              <Plus className="h-4 w-4" /> Ajouter un widget
            </button>
          )}
        </div>
      ) : (
        <DashboardGrid
          dashboardId={dash.id}
          widgets={dash.widgets}
          locked={locked || !canWrite}
          readOnly={!canWrite}
          onEdit={setEditingWidget}
          onDelete={deleteWidget}
        />
      )}

      {createOpen && siteId && did && (
        <CreateWidgetModal
          siteId={siteId}
          dashboardId={did}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); reload(); ctx?.reloadDashboards(); }}
        />
      )}
      {editingWidget && siteId && did && (
        <CreateWidgetModal
          siteId={siteId}
          dashboardId={did}
          editing={editingWidget}
          onClose={() => setEditingWidget(null)}
          onCreated={() => { setEditingWidget(null); reload(); }}
        />
      )}
    </div>
  );
}
