import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { Activity, Building2, Cpu, LayoutDashboard, LogOut, Wifi, WifiOff, Settings, ChevronDown, Sun, Moon, Sparkles, Users, ShieldCheck, UserCog, History, Bell } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { useAuth, useCanRead, useIsTenantAdmin } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { useWebSocket } from "../hooks/useWebSocket";
import { liveStore } from "../lib/liveStore";
import { api } from "../lib/api";
import type { Site } from "../types/api";

/**
 * Layout principal — sidebar verticale fine à icônes (modules), header avec
 * sélecteur de site contextuel, contenu en flex 1.
 *
 * Theme : les classes light: sont les défauts, les classes dark: l'override
 * quand <html class="dark"> est présent (géré par ThemeProvider).
 */
export function Layout() {
  const { token } = useAuth();
  useWebSocket(token, (env) => liveStore.handle(env));
  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sidebar verticale fine, icônes uniquement, modules contextuels au site
// ----------------------------------------------------------------------------
function Sidebar() {
  const { id: siteId } = useParams<{ id?: string }>();
  const isAdmin = useIsTenantAdmin();
  // Les useCanRead s'auto-évaluent : "none" si pas de site courant.
  const canDashboards = useCanRead("dashboard");
  const canDevices    = useCanRead("devices");
  const canRules      = useCanRead("rules");

  return (
    <aside className="w-16 flex flex-col items-center py-4 bg-white border-r border-slate-200 dark:bg-slate-900 dark:border-slate-800">
      <div className="rounded-xl bg-brand-500/10 p-2 mb-6">
        <Activity className="h-6 w-6 text-brand-500 dark:text-brand-400" />
      </div>

      <nav className="flex-1 flex flex-col items-center gap-1.5">
        <SidebarLink to="/" icon={<Building2 className="h-5 w-5" />} label="Sites" exact />
        {siteId && (
          <>
            <div className="my-2 h-px w-8 bg-slate-200 dark:bg-slate-800" />
            {canDevices    && <SidebarLink to={`/sites/${siteId}/zones`}      icon={<Building2 className="h-5 w-5" />}       label="Zones du site" />}
            {canDevices    && <SidebarLink to={`/sites/${siteId}/devices`}    icon={<Cpu className="h-5 w-5" />}             label="Équipements" />}
            {canDashboards && <SidebarLink to={`/sites/${siteId}/dashboards`} icon={<LayoutDashboard className="h-5 w-5" />} label="Tableaux de bord" />}
            {canRules      && <SidebarLink to={`/sites/${siteId}/rules`}      icon={<Sparkles className="h-5 w-5" />}        label="Règles" />}
            {canRules      && <SidebarLink to={`/sites/${siteId}/alarms`}     icon={<Bell className="h-5 w-5" />}            label="Alarmes" />}
          </>
        )}
        {isAdmin && (
          <>
            <div className="my-2 h-px w-8 bg-slate-200 dark:bg-slate-800" />
            <SidebarLink to="/admin/audit" icon={<History className="h-5 w-5" />}      label="Journal d'audit" />
          </>
        )}
      </nav>

      <div className="mt-auto" />
      <SidebarLink to="/settings" icon={<Settings className="h-5 w-5" />} label="Paramètres" />
    </aside>
  );
}

function SidebarLink({ to, icon, label, exact }: { to: string; icon: ReactNode; label: string; exact?: boolean }) {
  return (
    <NavLink
      to={to}
      end={exact}
      title={label}
      className={({ isActive }) =>
        clsx(
          "group relative w-10 h-10 rounded-lg flex items-center justify-center transition",
          isActive
            ? "bg-brand-500/15 text-brand-600 dark:text-brand-300"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        )
      }
    >
      {icon}
      <span className="pointer-events-none absolute left-12 px-2 py-1 rounded-md bg-slate-900 text-white border border-slate-700 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition z-30 dark:bg-slate-800">
        {label}
      </span>
    </NavLink>
  );
}

// ----------------------------------------------------------------------------
// Header : logo + sélecteur de site + statut WS + toggle theme + utilisateur
// ----------------------------------------------------------------------------
function Header() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const status = useWebSocketStatus();

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="h-14 px-5 flex items-center gap-4 border-b border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/50 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-wide">ZEINA</span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase">Hyperviseur</span>
      </div>

      <SiteSelector />

      <div className="ml-auto flex items-center gap-3">
        <ConnectionPill status={status} />
        <SettingsMenu />
        <button onClick={toggle} title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
          className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="hidden sm:inline">{user?.email}</span>
          <button onClick={onLogout} title="Déconnexion"
            className="hover:text-slate-900 dark:hover:text-white transition">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

// ----------------------------------------------------------------------------
// SettingsMenu — dropdown ⚙️ regroupant les écrans d'administration des
// utilisateurs et des accès (anciennement dans la sidebar).
// ----------------------------------------------------------------------------
function SettingsMenu() {
  const { id: siteId } = useParams<{ id?: string }>();
  const isAdmin = useIsTenantAdmin();
  const canMembers = useCanRead("members");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Si rien à afficher (utilisateur sans accès admin et hors site avec membres),
  // on cache le bouton plutôt que de montrer un dropdown vide.
  const showMembers = !!siteId && canMembers;
  if (!isAdmin && !showMembers) return null;

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        title="Administration"
        className={clsx(
          "p-1.5 rounded-md transition",
          open
            ? "bg-brand-500/15 text-brand-600 dark:text-brand-300"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800",
        )}>
        <Settings className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-2xl py-1 z-20">
            {showMembers && (
              <SettingsItem icon={<Users className="h-4 w-4" />} label="Membres du site"
                onClick={() => go(`/sites/${siteId}/members`)} />
            )}
            {showMembers && isAdmin && <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />}
            {isAdmin && (
              <>
                <SettingsItem icon={<UserCog className="h-4 w-4" />}      label="Utilisateurs"        onClick={() => go("/admin/users")} />
                <SettingsItem icon={<ShieldCheck className="h-4 w-4" />}  label="Rôles & permissions" onClick={() => go("/admin/roles")} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SettingsItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
      <span className="text-slate-400 dark:text-slate-500">{icon}</span>
      {label}
    </button>
  );
}

function ConnectionPill({ status }: { status: "open" | "closed" | "connecting" }) {
  if (status === "open") {
    return <span className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-300"><Wifi className="h-3 w-3" /> Live</span>;
  }
  return <span className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-300"><WifiOff className="h-3 w-3" /> {status === "connecting" ? "Connexion…" : "Hors ligne"}</span>;
}

function useWebSocketStatus() {
  const [status, setStatus] = useState<"open" | "closed" | "connecting">("connecting");
  useEffect(() => {
    const cb = (s: typeof status) => setStatus(s);
    liveStore.subscribeStatus(cb);
    setStatus(liveStore.getStatus());
    return () => liveStore.unsubscribeStatus(cb);
  }, []);
  return status;
}

function SiteSelector() {
  const { id: currentSiteId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [sites, setSites] = useState<Site[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get<Site[]>("/v1/sites").then(setSites).catch(() => {});
  }, []);

  const current = sites.find((s) => s.id === currentSiteId);

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-sm transition">
        <Building2 className="h-3.5 w-3.5 text-slate-400" />
        <span className="font-medium">{current?.name || "Choisir un site"}</span>
        <ChevronDown className="h-3 w-3 text-slate-500" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-2xl py-1 z-20">
            <button onClick={() => { setOpen(false); navigate("/"); }}
              className="w-full text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              Tous les sites…
            </button>
            <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />
            {sites.map((s) => (
              <button key={s.id} onClick={() => { setOpen(false); navigate(`/sites/${s.id}/dashboards`); }}
                className={clsx("w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800",
                  s.id === currentSiteId && "text-brand-600 dark:text-brand-300")}>
                {s.name}
                <div className="text-[10px] text-slate-500">{s.address || s.slug}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
