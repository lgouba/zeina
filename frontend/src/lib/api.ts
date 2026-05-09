// Client HTTP minimal — ajoute le Bearer access token, gère les erreurs ApiError.

import type { ApiError } from "../types/api";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "";
// "" → utilise le proxy Vite en dev (/v1/...) ; en prod nginx, pareil.

// Token courant — mis à jour par AuthProvider de façon synchrone (pendant
// render) pour éviter les race conditions avec le useEffect des consommateurs.
let currentToken: string | null = null;
export function setAuthToken(t: string | null) { currentToken = t; }
export function getAuthToken(): string | null { return currentToken; }

export class HttpError extends Error {
  status: number;
  payload: ApiError;
  constructor(status: number, payload: ApiError) {
    super(payload.message);
    this.status = status;
    this.payload = payload;
  }
}

// Refresh en cours partagé entre tous les appels concurrents qui se sont pris
// un 401 — on ne rafraîchit qu'une seule fois.
let refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const r = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) return null;
      const json = (await r.json()) as { access_token?: string };
      if (!json.access_token) return null;
      currentToken = json.access_token;
      return json.access_token;
    } catch {
      return null;
    } finally {
      // Permet un nouveau refresh la prochaine fois (TTL passera de nouveau).
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (currentToken) headers["Authorization"] = `Bearer ${currentToken}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: "include", // pour le cookie refresh
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Auto-refresh sur 401 (sauf endpoints d'auth eux-mêmes pour éviter les boucles).
  if (res.status === 401 && !retried && !path.startsWith("/v1/auth/")) {
    const newTok = await tryRefresh();
    if (newTok) {
      return request<T>(method, path, body, true);
    }
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new HttpError(res.status, json as ApiError);
  }
  return json as T;
}

export const api = {
  get:    <T>(p: string) => request<T>("GET", p),
  post:   <T>(p: string, body?: unknown) => request<T>("POST", p, body),
  put:    <T>(p: string, body?: unknown) => request<T>("PUT", p, body),
  del:    <T>(p: string) => request<T>("DELETE", p),
};

export function wsURL(token: string): string {
  // En dev avec Vite proxy : ws://<host>:5173/v1/ws → proxifié vers API.
  // En prod nginx : même chemin, nginx gère l'upgrade.
  const url = (import.meta.env.VITE_WS_URL as string | undefined) ||
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/ws`;
  return `${url}?token=${encodeURIComponent(token)}`;
}
