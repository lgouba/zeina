import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Bell, Check, Archive, ChevronLeft, MessageCircle, Loader2, MapPin,
  Cpu, Sparkles, Clock,
} from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../lib/api";
import { unitSymbol } from "../lib/units";
import { useCanWrite } from "../lib/auth";
import type { Alarm, AlarmComment, AlarmEvent, Site, Zone } from "../types/api";
import { SeverityBadge, StateBadge } from "./AlarmsPage";

const SiteMap = lazy(() => import("../components/SiteMap").then((m) => ({ default: m.SiteMap })));

/**
 * AlarmDetailPage — fiche détaillée d'une alarme. Inspirée du design Pulsio.
 *
 * Sections :
 *   - Header (sévérité, durée, état, statut + actions Prendre en compte / Acquitter)
 *   - Déclenchement initial (date, source, attribut, déclenchements…)
 *   - Localisation (mini-carte avec polygone de zone)
 *   - Commentaires (saisie libre)
 *   - Historique des évènements de l'alarme (timeline)
 */
export function AlarmDetailPage() {
  const { id: siteId, alarmId } = useParams<{ id: string; alarmId: string }>();
  const navigate = useNavigate();
  const canWrite = useCanWrite("rules");
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [events, setEvents] = useState<AlarmEvent[]>([]);
  const [comments, setComments] = useState<AlarmComment[]>([]);
  const [site, setSite] = useState<Site | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const reload = () => {
    if (!alarmId) return;
    Promise.all([
      api.get<Alarm>(`/v1/alarms/${alarmId}`),
      api.get<AlarmEvent[]>(`/v1/alarms/${alarmId}/events`),
      api.get<AlarmComment[]>(`/v1/alarms/${alarmId}/comments`).catch(() => []),
    ]).then(([a, e, c]) => {
      setAlarm(a); setEvents(e); setComments(c);
      // Charge site + zones pour la mini-carte
      if (siteId) {
        api.get<Site>(`/v1/sites/${siteId}`).then(setSite).catch(() => {});
        api.get<Zone[]>(`/v1/sites/${siteId}/zones`).then(setZones).catch(() => {});
      }
    }).finally(() => setLoading(false));
  };
  useEffect(reload, [alarmId, siteId]);

  async function transition(action: "acknowledge" | "resolve" | "archive") {
    if (!alarmId) return;
    setActing(true);
    try {
      await api.post(`/v1/alarms/${alarmId}/${action}`);
      reload();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    } finally {
      setActing(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-slate-500">Chargement…</div>;
  if (!alarm)  return <div className="p-6 text-sm text-slate-500">Alarme introuvable.</div>;

  const canPrendreEnCompte = alarm.state === "triggered";
  const canAcquitter       = alarm.state === "triggered" || alarm.state === "acknowledged";
  const canArchiver        = alarm.state !== "archived";
  const zoneForMap = zones.find((z) => z.id === alarm.zone_id);

  return (
    <div className="p-6">
      <button onClick={() => navigate(`/sites/${siteId}/alarms`)}
        className="mb-3 flex items-center gap-1 text-xs text-slate-500 hover:text-brand-500 transition">
        <ChevronLeft className="h-3.5 w-3.5" /> Retour à la liste
      </button>

      <header className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 mb-1">
            <Bell className="h-5 w-5 text-brand-500" /> {alarm.name}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Alarmes &gt; {alarm.label}
          </p>
        </div>
        {canWrite && (canPrendreEnCompte || canAcquitter || canArchiver) && (
          <div className="flex items-center gap-2">
            {canPrendreEnCompte && (
              <button onClick={() => transition("acknowledge")} disabled={acting}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white">
                {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Prendre en compte
              </button>
            )}
            {canAcquitter && (
              <button onClick={() => transition("resolve")} disabled={acting}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white">
                {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Acquitter
              </button>
            )}
            {canArchiver && (
              <button onClick={() => transition("archive")} disabled={acting}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">
                <Archive className="h-3.5 w-3.5" /> Archiver
              </button>
            )}
          </div>
        )}
      </header>

      {/* Bandeau infos générales */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 mb-5">
        <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 font-semibold">
          Informations générales
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Label</div>
            <span className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs font-medium">{alarm.label}</span>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Sévérité</div>
            <SeverityBadge severity={alarm.severity} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Durée</div>
            <div className="font-medium">{durationSince(alarm.opened_at)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">État</div>
            <StateBadge state={alarm.state} />
          </div>
          {alarm.status_text && (
            <div className="col-span-2 md:col-span-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Statut</div>
              <div className="text-slate-700 dark:text-slate-200">{alarm.status_text}</div>
            </div>
          )}
        </div>
      </section>

      {/* Grid 3 colonnes : déclenchement initial, localisation, commentaires */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        {/* Déclenchement initial */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 font-semibold">
            Déclenchement initial
          </h2>
          <dl className="space-y-2 text-sm">
            <DLRow label="Date"      value={new Date(alarm.opened_at).toLocaleDateString("fr-FR")} />
            <DLRow label="Heure"     value={new Date(alarm.opened_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} />
            <DLRow label="Déclencheur" value={
              <Link to={`/sites/${siteId}/rules`} className="text-brand-500 hover:underline inline-flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> {alarm.rule_name}
              </Link>
            } />
            <DLRow label="Type" value="Moteur de règles" />
            <DLRow label="Utilisateur assigné" value={alarm.ack_user_email || "—"} />
            {alarm.device_id && (
              <DLRow label="Source" value={
                <Link to={`/sites/${siteId}/devices/${alarm.device_id}`} className="text-brand-500 hover:underline inline-flex items-center gap-1">
                  <Cpu className="h-3 w-3" /> {alarm.device_name || alarm.device_slug}
                </Link>
              } />
            )}
            {alarm.attribute && <DLRow label="Attribut" value={<code className="font-mono text-[11px]">{alarm.attribute}</code>} />}
            <DLRow label="Déclenchements" value={<span className="font-bold">{alarm.trigger_count}</span>} />
          </dl>
        </section>

        {/* Localisation */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 font-semibold flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> Localisation
          </h2>
          {alarm.zone_name && (
            <div className="text-xs text-slate-600 dark:text-slate-300 mb-2">
              Zone : <strong>{alarm.zone_name}</strong>
            </div>
          )}
          {site && zoneForMap ? (
            <div className="rounded-lg overflow-hidden">
              <Suspense fallback={<div className="h-48 flex items-center justify-center text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Carte…</div>}>
                <SiteMap site={site} zones={[zoneForMap]} devices={[]} height={240} />
              </Suspense>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
              Pas de localisation cartographiée
            </div>
          )}
        </section>

        {/* Commentaires */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 font-semibold flex items-center gap-1.5">
            <MessageCircle className="h-3.5 w-3.5" /> Commentaires
          </h2>
          <CommentList alarmId={alarm.id} comments={comments} canWrite={canWrite} onAdded={reload} />
        </section>
      </div>

      {/* Historique des évènements */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <h2 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 font-semibold flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" /> Historique des évènements
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <Th label="Date / heure" />
                <Th label="État" />
                <Th label="Sévérité" />
                <Th label="Description" />
                <Th label="Déclenchements" />
                <Th label="Données" />
                <Th label="Utilisateur" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-2 py-2 whitespace-nowrap font-mono text-[11px]">
                    {new Date(e.ts).toLocaleString("fr-FR")}
                  </td>
                  <td className="px-2 py-2"><StateBadge state={e.state} /></td>
                  <td className="px-2 py-2"><SeverityBadge severity={e.severity} /></td>
                  <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{e.description || "—"}</td>
                  <td className="px-2 py-2 text-center">{e.trigger_count ?? "—"}</td>
                  <td className="px-2 py-2 font-mono text-[11px]">{e.value != null ? `${e.value}${unitSymbol(alarm.unit)}` : "—"}</td>
                  <td className="px-2 py-2 text-slate-500">{e.user_email || "—"}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={7} className="text-center py-6 text-slate-400">Aucun évènement</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DLRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 min-w-[110px]">{label}</dt>
      <dd className="text-slate-700 dark:text-slate-200 flex-1">{value}</dd>
    </div>
  );
}

function Th({ label }: { label: string }) {
  return <th className="text-left px-2 py-2 font-semibold whitespace-nowrap">{label}</th>;
}

function CommentList({ alarmId, comments, canWrite, onAdded }: {
  alarmId: string; comments: AlarmComment[]; canWrite: boolean; onAdded: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/v1/alarms/${alarmId}/comments`, { body: draft.trim() });
      setDraft("");
      onAdded();
    } catch (err) {
      alert(err instanceof HttpError ? err.payload.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {canWrite && (
        <form onSubmit={submit} className="mb-3">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
            placeholder="Ajouter un commentaire…"
            className="block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:border-brand-500" />
          <button type="submit" disabled={submitting || !draft.trim()}
            className={clsx("mt-1.5 text-xs px-3 py-1.5 rounded-md text-white",
              submitting || !draft.trim() ? "bg-slate-400 cursor-not-allowed" : "bg-brand-500 hover:bg-brand-400")}>
            {submitting ? "…" : "Publier"}
          </button>
        </form>
      )}
      {comments.length === 0 ? (
        <p className="text-xs text-slate-400 italic">Aucun commentaire</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-auto">
          {comments.map((c) => (
            <div key={c.id} className="rounded-md bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 p-2">
              <div className="text-[10px] text-slate-500 mb-0.5">
                {c.user_email || "—"} · {new Date(c.created_at).toLocaleString("fr-FR")}
              </div>
              <div className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
