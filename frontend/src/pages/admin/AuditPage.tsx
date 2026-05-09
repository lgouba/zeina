import { useEffect, useMemo, useState } from "react";
import { History, RefreshCw, Filter, Building2, UserCog, ShieldCheck, Users, FileText } from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../../lib/api";
import type { AuditEvent } from "../../types/api";

// Métadonnées d'affichage par catégorie d'action.
// On garde une map plate pour rester simple — chaque clé = action exacte.
const ACTION_META: Record<string, { label: string; icon: typeof Building2; color: string }> = {
  "site.create":   { label: "Site créé",                icon: Building2,   color: "text-emerald-600 dark:text-emerald-300 bg-emerald-500/10" },
  "site.update":   { label: "Site modifié",             icon: Building2,   color: "text-sky-600 dark:text-sky-300 bg-sky-500/10" },
  "site.delete":   { label: "Site supprimé",            icon: Building2,   color: "text-red-600 dark:text-red-300 bg-red-500/10" },
  "user.create":   { label: "Utilisateur créé",         icon: UserCog,     color: "text-emerald-600 dark:text-emerald-300 bg-emerald-500/10" },
  "user.update":   { label: "Utilisateur modifié",      icon: UserCog,     color: "text-sky-600 dark:text-sky-300 bg-sky-500/10" },
  "user.delete":   { label: "Utilisateur supprimé",     icon: UserCog,     color: "text-red-600 dark:text-red-300 bg-red-500/10" },
  "user.reset_password": { label: "Mot de passe réinitialisé", icon: UserCog, color: "text-amber-600 dark:text-amber-300 bg-amber-500/10" },
  "role.create":   { label: "Rôle créé",                icon: ShieldCheck, color: "text-emerald-600 dark:text-emerald-300 bg-emerald-500/10" },
  "role.update":   { label: "Rôle modifié",             icon: ShieldCheck, color: "text-sky-600 dark:text-sky-300 bg-sky-500/10" },
  "role.delete":   { label: "Rôle supprimé",            icon: ShieldCheck, color: "text-red-600 dark:text-red-300 bg-red-500/10" },
  "member.add":    { label: "Membre ajouté à un site",  icon: Users,       color: "text-emerald-600 dark:text-emerald-300 bg-emerald-500/10" },
  "member.update": { label: "Rôle d'un membre changé",  icon: Users,       color: "text-sky-600 dark:text-sky-300 bg-sky-500/10" },
  "member.remove": { label: "Membre retiré d'un site",  icon: Users,       color: "text-red-600 dark:text-red-300 bg-red-500/10" },
};

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "",         label: "Toutes les actions" },
  { value: "site.create", label: "Sites — création" },
  { value: "site.delete", label: "Sites — suppression" },
  { value: "user.create", label: "Utilisateurs — création" },
  { value: "user.delete", label: "Utilisateurs — suppression" },
  { value: "user.reset_password", label: "Utilisateurs — reset password" },
  { value: "role.create", label: "Rôles — création" },
  { value: "role.update", label: "Rôles — modification" },
  { value: "role.delete", label: "Rôles — suppression" },
  { value: "member.add",    label: "Membres — ajout" },
  { value: "member.update", label: "Membres — changement de rôle" },
  { value: "member.remove", label: "Membres — retrait" },
];

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(100);

  const reload = () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (filter) qs.set("action", filter);
    qs.set("limit", String(limit));
    api.get<AuditEvent[]>(`/v1/audit?${qs.toString()}`)
      .then(setEvents)
      .catch((e) => setError(e instanceof HttpError ? e.payload.message : String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [filter, limit]);

  return (
    <div className="p-6">
      <header className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <History className="h-5 w-5 text-brand-500" /> Journal d'audit
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Historique des actions sensibles : création/suppression de sites, gestion des utilisateurs et des rôles, attributions de membres.
          </p>
        </div>
        <button onClick={reload} title="Actualiser"
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700">
          <RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} /> Actualiser
        </button>
      </header>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Filter className="h-3.5 w-3.5" />
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700">
            {FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Limite :</span>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
            className="text-xs px-2 py-1.5 rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700">
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
          </select>
        </div>
        <span className="text-[11px] text-slate-400 ml-auto">{events.length} événement{events.length > 1 ? "s" : ""}</span>
      </div>

      {error && <div className="mb-4 p-3 text-sm bg-red-500/10 text-red-700 dark:text-red-300 rounded">{error}</div>}

      {loading && events.length === 0 ? (
        <div className="text-sm text-slate-500">Chargement…</div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center">
          <History className="h-8 w-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Aucun événement d'audit pour ce filtre.</p>
        </div>
      ) : (
        <ol className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-3 space-y-3">
          {events.map((ev) => <EventRow key={ev.id} event={ev} />)}
        </ol>
      )}
    </div>
  );
}

function EventRow({ event }: { event: AuditEvent }) {
  const meta = ACTION_META[event.action] || { label: event.action, icon: FileText, color: "text-slate-600 bg-slate-500/10" };
  const Icon = meta.icon;
  const detail = useMemo(() => describeMetadata(event), [event]);

  return (
    <li className="ml-6 relative">
      <span className={clsx("absolute -left-[34px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-slate-50 dark:ring-slate-950", meta.color)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium">{meta.label}{event.target_name ? <span className="text-slate-500 dark:text-slate-400 font-normal"> — {event.target_name}</span> : null}</div>
          <time className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
            {new Date(event.created_at).toLocaleString("fr-FR")}
          </time>
        </div>
        <div className="mt-1 text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
          <span>par</span>
          {event.actor_email ? (
            <span className="font-mono">{event.actor_email}</span>
          ) : (
            <span className="italic text-slate-400">inconnu</span>
          )}
        </div>
        {detail && <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono">{detail}</div>}
      </div>
    </li>
  );
}

function describeMetadata(ev: AuditEvent): string | null {
  const md = ev.metadata || {};
  switch (ev.action) {
    case "site.create":
      return md.slug ? `slug: ${md.slug}` : null;
    case "user.create":
      return `tenant_role: ${md.tenant_role}${md.is_superadmin ? " · superadmin" : ""}`;
    case "user.update":
      return `tenant_role: ${md.tenant_role}${md.is_superadmin ? " · superadmin" : ""}`;
    case "user.reset_password":
      return md.generated ? "mot de passe temporaire généré" : "mot de passe défini par l'admin";
    case "role.create":
    case "role.update": {
      const perms = md.permissions as Record<string, string> | undefined;
      if (!perms) return null;
      return Object.entries(perms).map(([k, v]) => `${k}:${v}`).join(" · ");
    }
    case "member.add":
    case "member.update":
      return md.role_name ? `rôle: ${md.role_name}` : null;
    default:
      return null;
  }
}
