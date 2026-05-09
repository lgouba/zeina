import { useEffect, useState, type FormEvent } from "react";
import { Plus, UserCog, Trash2, Pencil, KeyRound, X, Crown, Shield, Building2, Mail, Send, CheckCircle2, Clock, Ban } from "lucide-react";
import { api, HttpError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Help } from "../../components/Tooltip";
import type { Role, Site, UserListItem } from "../../types/api";

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";

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
    api.get<UserListItem[]>("/v1/users")
      .then(setUsers)
      .catch((e) => setError(e instanceof HttpError ? e.payload.message : String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  async function onDelete(u: UserListItem) {
    if (u.id === user?.id) return;
    if (!confirm(`Supprimer définitivement ${u.email} ?`)) return;
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
            Gestion des comptes du tenant. Les permissions par site se définissent via les <strong>Rôles</strong>.
          </p>
        </div>
        <button onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white">
          <Plus className="h-3.5 w-3.5" /> Nouvel utilisateur
        </button>
      </header>

      {error && <div className="mb-4 p-3 text-sm bg-red-500/10 text-red-700 dark:text-red-300 rounded">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Chargement…</div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Nom</th>
                <th className="text-left px-4 py-2">Rôle tenant</th>
                <th className="text-left px-4 py-2">Statut</th>
                <th className="text-left px-4 py-2">Dernière connexion</th>
                <th className="px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span>{u.email}</span>
                      {u.is_superadmin && (
                        <span title="Superadmin" className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                          <Crown className="h-3 w-3" /> Super
                        </span>
                      )}
                      {u.tenant_role === "owner" && !u.is_superadmin && (
                        <span title="Owner du tenant" className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-700 dark:text-violet-300">
                          <Shield className="h-3 w-3" /> Owner
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{u.full_name || "—"}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    {u.tenant_role === "owner" ? "Owner" : "Membre"}
                  </td>
                  <td className="px-4 py-2"><StatusBadge status={u.status} /></td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString("fr-FR") : "Jamais"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      {u.status === "pending" ? (
                        <ResendActivationButton user={u} onSent={reload} />
                      ) : (
                        <button onClick={() => setResetting(u)} title="Envoyer un mail de réinitialisation"
                          className="p-1.5 rounded-md text-slate-500 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                          <KeyRound className="h-4 w-4" />
                        </button>
                      )}
                      <button onClick={() => setEditing(u)} title="Modifier"
                        className="p-1.5 rounded-md text-slate-500 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => onDelete(u)} title="Supprimer"
                        disabled={u.id === user?.id}
                        className="p-1.5 rounded-md text-slate-500 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && <CreateUserModal onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload(); }} canSetSuperadmin={!!user?.is_superadmin} />}
      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} canSetSuperadmin={!!user?.is_superadmin} />}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
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
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={send} disabled={busy} title="Renvoyer le code d'activation par email"
      className="p-1.5 rounded-md text-slate-500 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50">
      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Send className="h-4 w-4" />}
    </button>
  );
}

// --------------------------------------------------------------------------

function CreateUserModal({ onClose, onSaved, canSetSuperadmin }: {
  onClose: () => void; onSaved: () => void; canSetSuperadmin: boolean;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [tenantRole, setTenantRole] = useState<"owner" | "member">("member");
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Pour la section "Affectations sur les sites"
  const [sites, setSites] = useState<Site[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  // Map site_id → role_id (vide = pas d'accès)
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      api.get<Site[]>("/v1/sites").catch(() => []),
      api.get<Role[]>("/v1/roles").catch(() => []),
    ]).then(([s, r]) => {
      setSites(s);
      setRoles(r);
      const invite = r.find((x) => x.name === "Invité");
      if (s.length === 1 && invite) {
        setAssignments({ [s[0].id]: invite.id });
      }
    });
  }, []);

  const showAssignments = tenantRole === "member" && !isSuperadmin;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null); setWarning(null);
    setSubmitting(true);
    try {
      const r = await api.post<{ user: { id: string }; activation_sent?: boolean }>("/v1/users", {
        email, full_name: fullName || undefined,
        tenant_role: tenantRole, is_superadmin: isSuperadmin,
      });

      // Affectations en série (peu nombreuses ; permet d'agréger les erreurs)
      const failures: string[] = [];
      if (showAssignments) {
        const userID = r.user.id;
        for (const [siteID, roleID] of Object.entries(assignments)) {
          if (!roleID) continue;
          try {
            await api.post(`/v1/sites/${siteID}/members`, { user_id: userID, role_id: roleID });
          } catch (e) {
            const siteName = sites.find((s) => s.id === siteID)?.name || siteID;
            failures.push(`${siteName} (${e instanceof HttpError ? e.payload.message : "erreur"})`);
          }
        }
      }
      if (failures.length > 0) {
        setWarning(`Utilisateur créé mais affectation(s) en échec : ${failures.join(", ")}`);
        return;
      }
      if (r.activation_sent === false) {
        setWarning(`Utilisateur créé mais l'envoi du mail d'activation a échoué. Utilise « Renvoyer le code » dans la liste.`);
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Nouvel utilisateur" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 bg-brand-500/10 border border-brand-500/20 rounded-md p-3">
          <Mail className="h-4 w-4 text-brand-500 shrink-0 mt-0.5" />
          <span>Un email d'activation contenant un code à 6 chiffres sera envoyé à l'utilisateur. Tant qu'il n'aura pas défini son mot de passe, son statut sera <strong>En attente</strong>.</span>
        </div>

          <Field label="Email *">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required
              placeholder="utilisateur@acme.com" className={inputCls} />
          </Field>
          <Field label="Nom complet">
            <input value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Marie Dupont" className={inputCls} />
          </Field>
          <Field label="Rôle tenant" tooltip={
            <>
              <p><strong>Membre</strong> — accès aux sites où il est invité, selon son rôle de site.</p>
              <p className="mt-1"><strong>Owner</strong> — accès à TOUT le tenant : tous les sites, gestion des utilisateurs et des rôles.</p>
            </>
          }>
            <select value={tenantRole} onChange={(e) => setTenantRole(e.target.value as "owner" | "member")} className={inputCls}>
              <option value="member">Membre</option>
              <option value="owner">Owner du tenant</option>
            </select>
          </Field>
          {canSetSuperadmin && (
            <label className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/30">
              <input type="checkbox" checked={isSuperadmin} onChange={(e) => setIsSuperadmin(e.target.checked)} className="mt-0.5" />
              <div>
                <div className="text-sm font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                  <Crown className="h-3.5 w-3.5" /> Superadmin
                </div>
                <div className="text-xs text-amber-700/80 dark:text-amber-200/80">Bypass complet du contrôle d'accès. Réservé à l'équipe technique.</div>
              </div>
            </label>
          )}

          {/* Affectations sur les sites — uniquement pour les membres simples */}
          {showAssignments && sites.length > 0 && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-950/50">
              <div className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-2 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" /> Affectations sur les sites
                <Help>
                  Pour chaque site, choisissez le rôle attribué à l'utilisateur — ou « Pas d'accès » s'il ne doit pas voir ce site. Les affectations peuvent être modifiées plus tard via <strong>Membres du site</strong>.
                </Help>
              </div>
              <div className="space-y-1.5">
                {sites.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{s.name}</span>
                    <select
                      value={assignments[s.id] || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAssignments((a) => {
                          const next = { ...a };
                          if (v) next[s.id] = v; else delete next[s.id];
                          return next;
                        });
                      }}
                      className="text-xs px-2 py-1 rounded bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 min-w-[12rem]"
                    >
                      <option value="">— Pas d'accès —</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}{r.is_system ? " (système)" : ""}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tenantRole === "owner" && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 italic">
              Un owner du tenant a accès à <strong>tous les sites</strong> automatiquement — pas besoin d'affectation.
            </div>
          )}

          {warning && <div className="text-sm text-amber-700 dark:text-amber-300 bg-amber-500/10 p-2 rounded">{warning}</div>}
          {error && <div className="text-sm text-red-500 bg-red-500/10 p-2 rounded">{error}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white">Annuler</button>
            <button type="submit" disabled={submitting}
              className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50">
              {submitting ? "Création…" : "Créer l'utilisateur"}
            </button>
          </div>
      </form>
    </Modal>
  );
}

function EditUserModal({ user, onClose, onSaved, canSetSuperadmin }: {
  user: UserListItem; onClose: () => void; onSaved: () => void; canSetSuperadmin: boolean;
}) {
  const [fullName, setFullName] = useState(user.full_name || "");
  const [tenantRole, setTenantRole] = useState<"owner" | "member">(user.tenant_role);
  const [isSuperadmin, setIsSuperadmin] = useState(user.is_superadmin);
  const [status, setStatus] = useState<UserListItem["status"]>(user.status);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.put(`/v1/users/${user.id}`, {
        full_name: fullName || null,
        tenant_role: tenantRole,
        is_superadmin: canSetSuperadmin ? isSuperadmin : undefined,
        status: status !== user.status ? status : undefined,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Modifier ${user.email}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nom complet">
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Rôle tenant">
          <select value={tenantRole} onChange={(e) => setTenantRole(e.target.value as "owner" | "member")} className={inputCls}>
            <option value="member">Membre</option>
            <option value="owner">Owner du tenant</option>
          </select>
        </Field>
        <Field label="Statut" hint="Désactiver bloque la connexion sans supprimer le compte.">
          <select value={status} onChange={(e) => setStatus(e.target.value as UserListItem["status"])} className={inputCls}>
            <option value="active">Actif</option>
            <option value="pending">En attente</option>
            <option value="disabled">Désactivé</option>
          </select>
        </Field>
        {canSetSuperadmin && (
          <label className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/30">
            <input type="checkbox" checked={isSuperadmin} onChange={(e) => setIsSuperadmin(e.target.checked)} className="mt-0.5" />
            <div>
              <div className="text-sm font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                <Crown className="h-3.5 w-3.5" /> Superadmin
              </div>
            </div>
          </label>
        )}
        {error && <div className="text-sm text-red-500 bg-red-500/10 p-2 rounded">{error}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white">Annuler</button>
          <button type="submit" disabled={submitting} className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50">
            {submitting ? "…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const r = await api.post<{ email_sent?: boolean }>(`/v1/users/${user.id}/reset-password`);
      if (r.email_sent) {
        setSent(true);
      } else {
        setError("L'envoi de l'email a échoué. Vérifie la configuration SMTP côté serveur.");
      }
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Réinitialiser le mot de passe`} onClose={onClose}>
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

// --- helpers ---------------------------------------------------------------

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, hint, tooltip, children }: { label: string; hint?: string; tooltip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
        {label}
        {tooltip && <Help>{tooltip}</Help>}
      </span>
      {children}
      {hint && <span className="text-[10px] text-slate-400 mt-0.5 block">{hint}</span>}
    </label>
  );
}

