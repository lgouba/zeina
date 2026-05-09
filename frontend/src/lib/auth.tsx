import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { api, setAuthToken } from "./api";
import type { Feature, LoginResponse, MeResponse, PermissionLevel, SiteAccess, User } from "../types/api";

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  /** Snapshot des accès par site (rafraîchi après login + au mount). */
  sites: SiteAccess[];
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch /me — à appeler après ajout/suppression de membre. */
  refreshMe: () => Promise<void>;
  /** Accepter une session déjà obtenue (ex: après set-password). */
  acceptSession: (token: string, user: User, expiresAt: string) => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

const STORAGE_KEY = "zeina_session";

interface PersistedSession {
  token: string;
  user: User;
  expiresAt: string;
  sites?: SiteAccess[];
}

function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PersistedSession;
    if (new Date(s.expiresAt).getTime() < Date.now() + 5_000) return null;
    return s;
  } catch { return null; }
}
function saveSession(s: PersistedSession | null) {
  if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  else localStorage.removeItem(STORAGE_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = loadSession();
  const [user, setUser] = useState<User | null>(initial?.user ?? null);
  const [token, setToken] = useState<string | null>(initial?.token ?? null);
  const [sites, setSites] = useState<SiteAccess[]>(initial?.sites ?? []);
  const [loading, setLoading] = useState<boolean>(!initial);

  setAuthToken(token);

  const fetchMe = useCallback(async () => {
    const me = await api.get<MeResponse>("/v1/auth/me");
    setUser(me.user);
    setSites(me.sites);
    // Refresh la session locale pour conserver les permissions au reload.
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const s = JSON.parse(raw) as PersistedSession;
        saveSession({ ...s, user: me.user, sites: me.sites });
      } catch { /* ignore */ }
    }
  }, []);

  // Au mount, si on a une session locale, on rafraîchit /me en arrière-plan
  // pour récupérer les permissions à jour (ajout/retrait de membre, etc.).
  useEffect(() => {
    if (initial) {
      setLoading(false);
      // Rafraîchit en best-effort, ne bloque pas le rendu.
      fetchMe().catch(() => { /* token expiré → laissera l'auth retomber */ });
      return;
    }
    api.post<{ access_token: string; expires_at: string }>("/v1/auth/refresh")
      .then(() => { /* MVP : on attend un nouveau login */ })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const resp = await api.post<LoginResponse>("/v1/auth/login", { email, password });
    setUser(resp.user);
    setToken(resp.access_token);
    setAuthToken(resp.access_token);
    saveSession({ token: resp.access_token, user: resp.user, expiresAt: resp.expires_at });
    // Charge le snapshot des permissions
    try {
      const me = await api.get<MeResponse>("/v1/auth/me");
      setSites(me.sites);
      saveSession({ token: resp.access_token, user: me.user, expiresAt: resp.expires_at, sites: me.sites });
    } catch { /* on garde au moins le user */ }
  }, []);

  const logout = useCallback(async () => {
    try { await api.post("/v1/auth/logout"); } catch { /* ignore */ }
    setUser(null);
    setToken(null);
    setSites([]);
    setAuthToken(null);
    saveSession(null);
  }, []);

  const acceptSession = useCallback(async (tok: string, u: User, expiresAt: string) => {
    setUser(u);
    setToken(tok);
    setAuthToken(tok);
    saveSession({ token: tok, user: u, expiresAt });
    try {
      const me = await api.get<MeResponse>("/v1/auth/me");
      setSites(me.sites);
      saveSession({ token: tok, user: me.user, expiresAt, sites: me.sites });
    } catch { /* on garde au moins le user */ }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, token, loading, sites, login, logout, refreshMe: fetchMe, acceptSession }),
    [user, token, loading, sites, login, logout, fetchMe, acceptSession],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

// ---------------------------------------------------------------------------
// Hooks RBAC
// ---------------------------------------------------------------------------

const RANK: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2 };

/** Renvoie l'accès au site courant (résolu via :id de l'URL). */
export function useCurrentSiteAccess(): SiteAccess | null {
  const { sites } = useAuth();
  const { id } = useParams<{ id?: string }>();
  if (!id) return null;
  return sites.find((s) => s.site_id === id) ?? null;
}

/**
 * usePermission — niveau effectif sur la feature pour le site courant.
 * Renvoie "none" si l'utilisateur n'a pas accès au site, ou si la feature
 * n'est pas listée dans son rôle.
 */
export function usePermission(feature: Feature): PermissionLevel {
  const access = useCurrentSiteAccess();
  if (!access) return "none";
  return access.permissions[feature] ?? "none";
}

/** Helper booléen — write implique read. */
export function hasPermission(have: PermissionLevel, need: PermissionLevel): boolean {
  return RANK[have] >= RANK[need];
}

/** Hook : true si le user peut écrire la feature. */
export function useCanWrite(feature: Feature): boolean {
  return hasPermission(usePermission(feature), "write");
}

/** Hook : true si le user peut au moins lire la feature. */
export function useCanRead(feature: Feature): boolean {
  return hasPermission(usePermission(feature), "read");
}

/** Hook : true si le user est superadmin OU owner du tenant. */
export function useIsTenantAdmin(): boolean {
  const { user } = useAuth();
  return !!user && (user.is_superadmin || user.tenant_role === "owner");
}
