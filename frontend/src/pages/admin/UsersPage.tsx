// Gestion des utilisateurs — layout Pulsio-style :
//
//   Liste compacte avec avatar (initiales), nom prénom + email, fonction,
//   téléphone, statut, rôle dans le tenant.
//
//   Modal Création / Édition en 3 cartes :
//     - Informations générales (avatar + identité + statut)
//     - Informations de contact (email + téléphone)
//     - Paramètres du compte (rôles : Site + Rôle)
//
// Le périmètre RBAC est volontairement simplifié côté UI :
//   - "Tous les sites" → tenant_role = owner (= accès implicite à tous)
//   - Un site spécifique → tenant_role = member + entrée dans site_members
//
// On laisse la gestion fine multi-sites à la page Membres du site.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Plus, UserCog, Trash2, Pencil, KeyRound, X, Crown, Send,
  CheckCircle2, Clock, Ban, Mail, User, Phone, Briefcase, Building2,
} from "lucide-react";
import { api, HttpError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Help } from "../../components/Tooltip";
import type { Role, Site, UserListItem } from "../../types/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const inputCls =
  "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";
const labelCls = "text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium mb-1 block";
const cardCls = "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5";
const cardTitleCls = "text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-4";

// Sentinel value pour "Tous les sites" dans le picker (équivalent owner).
const SITE_ALL = "__all__";

// ---------------------------------------------------------------------------
// Page principale
// ---------------------------------------------------------------------------

export function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const [resetting, setResetting] = useState<UserListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api
      .get<UserListItem[]>("/v1/users")
      .then(setUsers)
      .catch((e) => setError(e instanceof HttpError ? e.payload.message : String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  async function onDelete(u: UserListItem) {
    if (u.id === user?.id) return;
    if (!confirm(`Supprimer définitivement ${displayName(u)} (${u.email}) ?`)) return;
    try {
      await api.del(`/v1/users/${u.id}`);
      reload();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    }
  }

  return (
    <div className="p-6">
      <header className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <UserCog className="h-5 w-5 text-brand-500" /> Utilisateurs
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Gestion des comptes du tenant — un email d'activation est envoyé à chaque création.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white"
        >
          <Plus className="h-3.5 w-3.5" /> Nouvel utilisateur
        </button>
      </header>

      {error && (
        <div className="mb-4 p-3 text-sm bg-red-500/10 text-red-700 dark:text-red-300 rounded">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Chargement…</div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="text-left px-4 py-3">Utilisateur</th>
                <th className="text-left px-4 py-3">Fonction</th>
                <th className="text-left px-4 py-3">Téléphone</th>
                <th className="text-left px-4 py-3">Rôle</th>
                <th className="text-left px-4 py-3">Statut</th>
                <th className="text-left px-4 py-3">Dernière connexion</th>
                <th className="px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={displayName(u) || u.email} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-100 truncate">
                          {displayName(u) || "—"}
                          {u.is_superadmin && (
                            <span title="Superadmin" className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                              <Crown className="h-3 w-3" /> Super
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 truncate">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{u.job_title || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{u.phone || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {u.tenant_role === "owner" ? "Tous les sites" : "Affecté par site"}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString("fr-FR") : "Jamais"}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {u.status === "pending" ? (
                        <ResendActivationButton user={u} onSent={reload} />
                      ) : (
                        <IconButton title="Envoyer un mail de réinitialisation" onClick={() => setResetting(u)}>
                          <KeyRound className="h-4 w-4" />
                        </IconButton>
                      )}
                      <IconButton title="Modifier" onClick={() => setEditing(u)}>
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        title="Supprimer"
                        onClick={() => onDelete(u)}
                        disabled={u.id === user?.id}
                        danger
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                  Aucun utilisateur. Cliquez sur <strong>Nouvel utilisateur</strong> pour commencer.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <UserModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); reload(); }}
          canSetSuperadmin={!!user?.is_superadmin}
        />
      )}
      {editing && (
        <UserModal
          mode="edit"
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
          canSetSuperadmin={!!user?.is_superadmin}
        />
      )}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composants liste
// ---------------------------------------------------------------------------

function Avatar({ name }: { name: string }) {
  const initials = useMemo(() => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [name]);
  return (
    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-brand-400 to-indigo-500 text-white flex items-center justify-center text-xs font-semibold shrink-0">
      {initials}
    </div>
  );
}

function StatusBadge({ status }: { status: UserListItem["status"] }) {
  switch (status) {
    case "active":
      return <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" /> Actif
      </span>;
    case "pending":
      return <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
        <Clock className="h-3 w-3" /> En attente
      </span>;
    case "disabled":
      return <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-slate-500/15 text-slate-600 dark:text-slate-400">
        <Ban className="h-3 w-3" /> Désactivé
      </span>;
  }
}

function IconButton({
  children, title, onClick, disabled, danger,
}: {
  children: React.ReactNode; title: string; onClick: () => void;
  disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed ${
        danger ? "hover:text-red-500" : "hover:text-brand-500"
      }`}
    >
      {children}
    </button>
  );
}

function ResendActivationButton({ user, onSent }: { user: UserListItem; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function send() {
    if (busy) return;
    if (!confirm(`Renvoyer le code d'activation à ${user.email} ?`)) return;
    setBusy(true);
    try {
      await api.post(`/v1/users/${user.id}/resend-activation`);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
      onSent();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    } finally { setBusy(false); }
  }
  return (
    <IconButton title="Renvoyer le code d'activation par email" onClick={send} disabled={busy}>
      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Send className="h-4 w-4" />}
    </IconButton>
  );
}

// ---------------------------------------------------------------------------
// Modal unifié Création / Édition
// ---------------------------------------------------------------------------

interface UserModalProps {
  mode: "create" | "edit";
  user?: UserListItem;
  onClose: () => void;
  onSaved: () => void;
  canSetSuperadmin: boolean;
}

function UserModal({ mode, user: existing, onClose, onSaved, canSetSuperadmin }: UserModalProps) {
  // Identité
  const [firstName, setFirstName] = useState(existing?.first_name || "");
  const [lastName, setLastName] = useState(existing?.last_name || "");
  const [jobTitle, setJobTitle] = useState(existing?.job_title || "");
  const [email, setEmail] = useState(existing?.email || "");
  const [phone, setPhone] = useState(existing?.phone || "");

  // Statut (création : toujours "active" implicite ; en édition : modifiable)
  const [status, setStatus] = useState<UserListItem["status"]>(existing?.status || "active");

  // Rôle
  // - SITE_ALL = Tous les sites = tenant_role=owner
  // - id de site = membre du site avec le rôle choisi
  const [siteSelection, setSiteSelection] = useState<string>(
    existing && existing.tenant_role === "owner" ? SITE_ALL : ""
  );
  const [roleId, setRoleId] = useState<string>("");
  const [isSuperadmin, setIsSuperadmin] = useState(existing?.is_superadmin || false);

  // Données chargées
  const [sites, setSites] = useState<Site[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Charge la liste des sites une fois.
  useEffect(() => {
    api.get<Site[]>("/v1/sites").then(setSites).catch(() => {});
  }, []);

  // Recharge les rôles à chaque changement de site (filtre site_id côté API
  // → on ne propose que les rôles applicables à ce site).
  useEffect(() => {
    // Pas de site choisi → pas besoin du dropdown rôle (sera caché).
    if (!siteSelection || siteSelection === SITE_ALL) {
      setRoles([]);
      return;
    }
    api.get<Role[]>(`/v1/roles?site_id=${encodeURIComponent(siteSelection)}`)
      .then((r) => {
        setRoles(r);
        if (mode === "create") {
          // Préselection : "Invité" (rôle système le moins permissif), sinon
          // le premier de la liste.
          const guest = r.find((x) => x.name === "Invité") || r[0];
          setRoleId(guest ? guest.id : "");
        }
      })
      .catch(() => setRoles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteSelection]);

  // Quand on est en édition d'un membre, on ne sait pas a priori sur quel
  // site il est affecté (le picker simple n'est pas idéal pour le multi-site).
  // On le laisse à "" et on indique à l'utilisateur d'aller dans Membres du site.
  // Ce picker n'est utilisé que pour la création initiale + bascule owner ⇄ membre.

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null); setWarning(null);
    if (!email.trim()) { setError("L'email est obligatoire."); return; }
    if (!siteSelection) { setError("Choisissez un site (ou Tous les sites)."); return; }

    const tenantRole: "owner" | "member" = siteSelection === SITE_ALL ? "owner" : "member";

    setSubmitting(true);
    try {
      if (mode === "create") {
        const body = {
          email: email.trim(),
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          job_title: jobTitle.trim() || null,
          phone: phone.trim() || null,
          tenant_role: tenantRole,
          is_superadmin: canSetSuperadmin ? isSuperadmin : false,
        };
        const r = await api.post<{ user: { id: string }; activation_sent?: boolean }>("/v1/users", body);

        // Membre simple : créer l'affectation site
        if (tenantRole === "member" && roleId) {
          try {
            await api.post(`/v1/sites/${siteSelection}/members`, {
              user_id: r.user.id, role_id: roleId,
            });
          } catch (e) {
            const siteName = sites.find((s) => s.id === siteSelection)?.name || siteSelection;
            setWarning(`Utilisateur créé mais affectation au site « ${siteName} » échouée (${e instanceof HttpError ? e.payload.message : "erreur"}).`);
            return;
          }
        }
        if (r.activation_sent === false) {
          setWarning(`Utilisateur créé mais le mail d'activation n'a pas été envoyé. Utilisez « Renvoyer le code » dans la liste.`);
          return;
        }
        onSaved();
        return;
      }

      // mode === "edit"
      const body: Record<string, unknown> = {
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        job_title: jobTitle.trim() || null,
        phone: phone.trim() || null,
        tenant_role: tenantRole,
      };
      if (canSetSuperadmin) body.is_superadmin = isSuperadmin;
      if (existing && status !== existing.status) body.status = status;
      await api.put(`/v1/users/${existing!.id}`, body);
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  const fullPreview = `${firstName} ${lastName}`.trim() || (email || "Nouvel utilisateur");
  const showRolePicker = siteSelection !== SITE_ALL && siteSelection !== "";

  return (
    <Modal title={mode === "create" ? "Nouvel utilisateur" : `Modifier ${fullPreview}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        {/* Bandeau info pour la création */}
        {mode === "create" && (
          <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 bg-brand-500/10 border border-brand-500/20 rounded-md p-3">
            <Mail className="h-4 w-4 text-brand-500 shrink-0 mt-0.5" />
            <span>Un email d'activation contenant un code à 6 chiffres sera envoyé à l'utilisateur. Tant qu'il n'aura pas défini son mot de passe, son statut sera <strong>En attente</strong>.</span>
          </div>
        )}

        {/* 2 cartes côte à côte sur écran large */}
        <div className="grid lg:grid-cols-2 gap-4">
          {/* === Informations générales === */}
          <div className={cardCls}>
            <div className={cardTitleCls}>Informations générales</div>
            <div className="flex items-center gap-4 mb-4">
              <Avatar name={fullPreview} />
              <div className="text-sm text-slate-700 dark:text-slate-200">
                <div className="font-medium">{fullPreview}</div>
                {jobTitle && <div className="text-xs text-slate-500">{jobTitle}</div>}
              </div>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Prénom *" icon={<User className="h-3.5 w-3.5" />}>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)}
                    required className={inputCls} placeholder="Marie" />
                </Field>
                <Field label="Nom *" icon={<User className="h-3.5 w-3.5" />}>
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)}
                    required className={inputCls} placeholder="Dupont" />
                </Field>
              </div>
              <Field label="Fonction" icon={<Briefcase className="h-3.5 w-3.5" />}>
                <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)}
                  className={inputCls} placeholder="Responsable maintenance" />
              </Field>
              {mode === "edit" && (
                <Field label="Statut" hint="Désactivé bloque la connexion sans supprimer le compte.">
                  <select value={status} onChange={(e) => setStatus(e.target.value as UserListItem["status"])} className={inputCls}>
                    <option value="active">Actif</option>
                    <option value="pending">En attente</option>
                    <option value="disabled">Désactivé</option>
                  </select>
                </Field>
              )}
            </div>
          </div>

          {/* === Informations de contact === */}
          <div className={cardCls}>
            <div className={cardTitleCls}>Informations de contact</div>
            <div className="space-y-3">
              <Field label="Email *" icon={<Mail className="h-3.5 w-3.5" />}
                hint={mode === "create" ? "Servira à recevoir le code d'activation puis à se connecter." : undefined}>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
                  required disabled={mode === "edit"}
                  className={`${inputCls} ${mode === "edit" ? "opacity-60 cursor-not-allowed" : ""}`}
                  placeholder="marie.dupont@acme.fr" />
              </Field>
              <Field label="Téléphone" icon={<Phone className="h-3.5 w-3.5" />}
                hint="Pour les notifications SMS d'alerte (futur).">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel"
                  className={inputCls} placeholder="+226 70 12 34 56" />
              </Field>
            </div>
          </div>
        </div>

        {/* === Paramètres du compte === */}
        <div className={cardCls}>
          <div className={cardTitleCls}>Paramètres du compte</div>
          <div className="grid lg:grid-cols-2 gap-3">
            <Field label="Site *" icon={<Building2 className="h-3.5 w-3.5" />} tooltip={
              <>
                <p><strong>Tous les sites</strong> — l'utilisateur a accès à tout le tenant et peut tout gérer (équivalent « Owner du tenant »).</p>
                <p className="mt-1"><strong>Site spécifique</strong> — l'utilisateur n'a accès qu'à ce site, avec le rôle choisi à droite. D'autres affectations peuvent être ajoutées plus tard via <em>Membres du site</em>.</p>
              </>
            }>
              <select value={siteSelection} onChange={(e) => setSiteSelection(e.target.value)} className={inputCls}>
                <option value="">— Choisir —</option>
                <option value={SITE_ALL}>Tous les sites (administrateur)</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>

            {showRolePicker && (
              <Field label="Rôle *" hint="Liste éditable dans Administration → Rôles.">
                <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={inputCls}>
                  <option value="">— Choisir —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}{r.is_system ? " (système)" : ""}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          {mode === "edit" && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic mt-3">
              Pour gérer plusieurs affectations sur des sites différents, utilisez la page <strong>Membres du site</strong>.
            </p>
          )}

          {canSetSuperadmin && (
            <label className="flex items-start gap-2 mt-4 p-3 rounded-md bg-amber-500/10 border border-amber-500/30">
              <input type="checkbox" checked={isSuperadmin} onChange={(e) => setIsSuperadmin(e.target.checked)} className="mt-0.5" />
              <div>
                <div className="text-sm font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                  <Crown className="h-3.5 w-3.5" /> Superadmin
                </div>
                <div className="text-xs text-amber-700/80 dark:text-amber-200/80">
                  Bypass complet du contrôle d'accès — réservé à l'équipe technique.
                </div>
              </div>
            </label>
          )}
        </div>

        {warning && <div className="text-sm text-amber-700 dark:text-amber-300 bg-amber-500/10 p-2 rounded">{warning}</div>}
        {error && <div className="text-sm text-red-500 bg-red-500/10 p-2 rounded">{error}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose}
            className="px-3 py-2 text-sm rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white">
            Annuler
          </button>
          <button type="submit" disabled={submitting}
            className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50">
            {submitting ? "…" : mode === "create" ? "Créer l'utilisateur" : "Enregistrer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reset password — envoie un email de réinitialisation
// ---------------------------------------------------------------------------

function ResetPasswordModal({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const r = await api.post<{ email_sent?: boolean }>(`/v1/users/${user.id}/reset-password`);
      if (r.email_sent) setSent(true);
      else setError("L'envoi de l'email a échoué. Vérifiez la configuration SMTP côté serveur.");
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally { setSubmitting(false); }
  }

  return (
    <Modal title="Réinitialiser le mot de passe" onClose={onClose}>
      {sent ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-emerald-800 dark:text-emerald-200">Email envoyé</p>
              <p className="text-emerald-700 dark:text-emerald-300 mt-1">
                Un email contenant un code de réinitialisation a été envoyé à <strong>{user.email}</strong>. Le code expire dans 15 minutes.
              </p>
            </div>
          </div>
          <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 text-white">Terminé</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300 bg-brand-500/10 border border-brand-500/20 rounded-md p-3">
            <Mail className="h-4 w-4 text-brand-500 shrink-0 mt-0.5" />
            <span>Un email contenant un code à 6 chiffres sera envoyé à <strong>{user.email}</strong>. L'utilisateur pourra alors choisir un nouveau mot de passe.</span>
          </div>
          {error && <div className="text-sm text-red-500 bg-red-500/10 p-2 rounded">{error}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white">Annuler</button>
            <button type="submit" disabled={submitting} className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50">
              {submitting ? "Envoi…" : "Envoyer l'email"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Helpers communs
// ---------------------------------------------------------------------------

function displayName(u: UserListItem): string {
  const fn = (u.first_name || "").trim();
  const ln = (u.last_name || "").trim();
  const combined = `${fn} ${ln}`.trim();
  return combined || (u.full_name || "").trim();
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label, hint, tooltip, icon, children,
}: {
  label: string; hint?: string; tooltip?: React.ReactNode;
  icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={`${labelCls} flex items-center gap-1.5`}>
        {icon}
        {label}
        {tooltip && <Help>{tooltip}</Help>}
      </span>
      {children}
      {hint && <span className="text-[10px] text-slate-400 mt-1 block">{hint}</span>}
    </label>
  );
}
