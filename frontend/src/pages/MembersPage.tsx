import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Plus, Trash2, Users, X, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../lib/api";
import { useAuth, useCanWrite } from "../lib/auth";
import { Help } from "../components/Tooltip";
import { useConfirm } from "../components/ConfirmDialog";
import type { Role, SiteMember, UserListItem } from "../types/api";

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";

export function MembersPage() {
  const { id: siteId } = useParams<{ id: string }>();
  const { refreshMe } = useAuth();
  const canWrite = useCanWrite("members");
  const [members, setMembers] = useState<SiteMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    if (!siteId) return;
    setLoading(true);
    api.get<SiteMember[]>(`/v1/sites/${siteId}/members`)
      .then(setMembers)
      .catch((e) => setError(e instanceof HttpError ? e.payload.message : String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [siteId]);

  const confirm = useConfirm();
  async function onRemove(m: SiteMember) {
    if (!siteId) return;
    const ok = await confirm({
      title: `Retirer ${m.full_name || m.email} du site ?`,
      description: <>
        Le compte <strong>{m.email}</strong> ne sera plus retiré du site mais reste actif sur la plateforme.
        <br /><br />
        Tu peux le ré-ajouter à tout moment depuis cette page.
      </>,
      warning: true,
      confirmLabel: "Retirer du site",
    });
    if (!ok) return;
    try {
      await api.del(`/v1/sites/${siteId}/members/${m.user_id}`);
      reload();
      // Si le user retiré est l'utilisateur courant, /me change.
      void refreshMe();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    }
  }

  async function onChangeRole(m: SiteMember, roleID: string) {
    if (!siteId) return;
    try {
      await api.put(`/v1/sites/${siteId}/members/${m.user_id}`, { role_id: roleID });
      reload();
      void refreshMe();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    }
  }

  return (
    <div className="p-6">
      <header className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-500" /> Membres du site
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {members.length} membre{members.length > 1 ? "s" : ""} actif{members.length > 1 ? "s" : ""}.
            {!canWrite && " (lecture seule)"}
          </p>
        </div>
        {canWrite && (
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white">
            <Plus className="h-3.5 w-3.5" /> Ajouter un membre
          </button>
        )}
      </header>

      {error && <div className="mb-4 p-3 text-sm bg-red-500/10 text-red-700 dark:text-red-300 rounded">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Chargement…</div>
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center">
          <Users className="h-8 w-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-4">Aucun membre n'est encore attribué à ce site.</p>
          {canWrite && (
            <button onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white">
              <Plus className="h-4 w-4" /> Ajouter le premier membre
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="text-left px-4 py-2">Utilisateur</th>
                <th className="text-left px-4 py-2">Rôle sur le site</th>
                <th className="text-left px-4 py-2">Permissions</th>
                <th className="text-left px-4 py-2">Ajouté le</th>
                <th className="px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {members.map((m) => (
                <MemberRow key={m.user_id} member={m} canWrite={canWrite}
                  onRemove={() => onRemove(m)}
                  onChangeRole={(rid) => onChangeRole(m, rid)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && siteId && (
        <AddMemberModal siteID={siteId} existingIDs={members.map((m) => m.user_id)}
          onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); void refreshMe(); }} />
      )}
    </div>
  );
}

function MemberRow({ member, canWrite, onRemove, onChangeRole }: {
  member: SiteMember; canWrite: boolean;
  onRemove: () => void; onChangeRole: (roleID: string) => void;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  useEffect(() => {
    api.get<Role[]>("/v1/roles").then(setRoles).catch(() => {});
  }, []);
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
      <td className="px-4 py-2">
        <div>{member.email}</div>
        {member.full_name && <div className="text-xs text-slate-500">{member.full_name}</div>}
      </td>
      <td className="px-4 py-2">
        {canWrite && roles.length > 0 ? (
          <select value={member.role_id} onChange={(e) => onChangeRole(e.target.value)}
            className="text-xs px-2 py-1 rounded bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700">
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-brand-500/10 text-brand-700 dark:text-brand-300">
            <ShieldCheck className="h-3 w-3" /> {member.role_name}
          </span>
        )}
      </td>
      <td className="px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {Object.entries(member.permissions).map(([k, v]) => (
            <span key={k} className={clsx(
              "text-[10px] px-1.5 py-0.5 rounded",
              v === "write" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
              v === "read"  && "bg-sky-500/15 text-sky-700 dark:text-sky-300",
              v === "none"  && "bg-slate-100 dark:bg-slate-800 text-slate-500",
            )}>{k}: {v === "none" ? "—" : v}</span>
          ))}
        </div>
      </td>
      <td className="px-4 py-2 text-xs text-slate-500">{new Date(member.added_at).toLocaleDateString("fr-FR")}</td>
      <td className="px-2 py-2">
        {canWrite && (
          <button onClick={onRemove} title="Retirer du site"
            className="p-1.5 rounded-md text-slate-500 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </td>
    </tr>
  );
}

function AddMemberModal({ siteID, existingIDs, onClose, onSaved }: {
  siteID: string; existingIDs: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [userID, setUserID] = useState<string>("");
  const [roleID, setRoleID] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<UserListItem[]>("/v1/users"), api.get<Role[]>("/v1/roles")])
      .then(([u, r]) => {
        setUsers(u); setRoles(r);
        // Préselectionne "Invité" si présent.
        const invite = r.find((x) => x.name === "Invité");
        if (invite) setRoleID(invite.id);
      })
      .catch((e) => setError(e instanceof HttpError ? e.payload.message : String(e)));
  }, []);

  const available = useMemo(
    () => users.filter((u) => !existingIDs.includes(u.id) && !u.is_superadmin && u.tenant_role !== "owner"),
    [users, existingIDs],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!userID || !roleID) { setError("Choisissez un utilisateur et un rôle"); return; }
    setSubmitting(true); setError(null);
    try {
      await api.post(`/v1/sites/${siteID}/members`, { user_id: userID, role_id: roleID });
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold">Ajouter un membre</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Utilisateur *" tooltip="Liste des comptes du tenant qui ne sont pas déjà membres de ce site. Les owners et superadmins ont un accès implicite et n'apparaissent pas ici.">
            <select value={userID} onChange={(e) => setUserID(e.target.value)} required className={inputCls}>
              <option value="">— Choisir —</option>
              {available.map((u) => (
                <option key={u.id} value={u.id}>{u.email}{u.full_name ? ` (${u.full_name})` : ""}</option>
              ))}
            </select>
            {available.length === 0 && (
              <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                Tous les utilisateurs disponibles sont déjà membres. Créez d'abord un nouveau compte dans <strong>Utilisateurs</strong>.
              </div>
            )}
          </Field>
          <Field label="Rôle sur le site *">
            <select value={roleID} onChange={(e) => setRoleID(e.target.value)} required className={inputCls}>
              <option value="">— Choisir —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.is_system ? " (système)" : ""}</option>
              ))}
            </select>
          </Field>
          {error && <div className="text-sm text-red-500 bg-red-500/10 p-2 rounded">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white">Annuler</button>
          <button type="submit" disabled={submitting || !userID || !roleID}
            className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50">
            {submitting ? "Ajout…" : "Ajouter"}
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
