import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, ShieldCheck, Trash2, Pencil, X, Lock, Building2 } from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../../lib/api";
import { Help } from "../../components/Tooltip";
import type { FeatureMeta, PermissionLevel, PermissionSet, Role } from "../../types/api";

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";

const LEVELS: PermissionLevel[] = ["none", "read", "write"];
const LEVEL_LABEL: Record<PermissionLevel, string> = {
  none:  "Aucun accès",
  read:  "Lecture",
  write: "Lecture + écriture",
};
const LEVEL_DESC: Record<PermissionLevel, string> = {
  none:  "La fonctionnalité est masquée pour l'utilisateur.",
  read:  "L'utilisateur consulte sans pouvoir modifier.",
  write: "L'utilisateur peut consulter et modifier.",
};

export function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [features, setFeatures] = useState<FeatureMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<Role[]>("/v1/roles"),
      api.get<FeatureMeta[]>("/v1/roles/features"),
    ])
      .then(([r, f]) => { setRoles(r); setFeatures(f); })
      .catch((e) => setError(e instanceof HttpError ? e.payload.message : String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  async function onDelete(r: Role) {
    if (r.is_system) return;
    if (!confirm(`Supprimer le rôle "${r.name}" ?`)) return;
    try {
      await api.del(`/v1/roles/${r.id}`);
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
            <ShieldCheck className="h-5 w-5 text-brand-500" /> Rôles & permissions
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Définissez quels utilisateurs voient quelles fonctionnalités sur chaque site.
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white">
          <Plus className="h-3.5 w-3.5" /> Nouveau rôle
        </button>
      </header>

      {error && <div className="mb-4 p-3 text-sm bg-red-500/10 text-red-700 dark:text-red-300 rounded">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Chargement…</div>
      ) : (
        <div className="space-y-3">
          {roles.map((r) => (
            <RoleCard key={r.id} role={r} features={features}
              onEdit={() => setEditing(r)} onDelete={() => onDelete(r)} />
          ))}
        </div>
      )}

      {creating && (
        <RoleEditor mode="create" features={features}
          onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />
      )}
      {editing && (
        <RoleEditor mode="edit" role={editing} features={features}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}

function RoleCard({ role, features, onEdit, onDelete }: {
  role: Role; features: FeatureMeta[]; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-brand-500/10 p-2 text-brand-500 dark:text-brand-300">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium">{role.name}</h3>
            {role.site_name ? (
              <span title={`Rôle propre au site ${role.site_name}`} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30">
                <Building2 className="h-3 w-3" /> {role.site_name}
              </span>
            ) : (
              <span title="Rôle disponible pour tous les sites du tenant" className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                Tous les sites
              </span>
            )}
            {role.is_system && (
              <span title="Rôle système non modifiable" className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                <Lock className="h-3 w-3" /> système
              </span>
            )}
          </div>
          {role.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{role.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {features.map((f) => {
              const lvl = role.permissions[f.code] ?? "none";
              return (
                <span key={f.code} className={clsx(
                  "inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border",
                  lvl === "write" && "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
                  lvl === "read"  && "bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300",
                  lvl === "none"  && "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500",
                )}>
                  <span>{f.label}</span>
                  <span className="font-semibold uppercase">{lvl === "none" ? "—" : lvl === "read" ? "lecture" : "écriture"}</span>
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onEdit} disabled={role.is_system} title={role.is_system ? "Rôle système" : "Modifier"}
            className="p-1.5 rounded-md text-slate-500 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={onDelete} disabled={role.is_system} title={role.is_system ? "Rôle système" : "Supprimer"}
            className="p-1.5 rounded-md text-slate-500 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Editor ---------------------------------------------------------------

function RoleEditor({ mode, role, features, onClose, onSaved }: {
  mode: "create" | "edit";
  role?: Role;
  features: FeatureMeta[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [perms, setPerms] = useState<PermissionSet>(role?.permissions || initPerms(features));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si features arrivent après le mount initial, on remplit les manquants à "none".
  const allPerms = useMemo<PermissionSet>(() => {
    const out: PermissionSet = { ...perms };
    for (const f of features) if (!out[f.code]) out[f.code] = "none";
    return out;
  }, [perms, features]);

  function setLevel(code: string, level: PermissionLevel) {
    setPerms((p) => ({ ...p, [code]: level }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError("Nom requis"); return; }
    setSubmitting(true);
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      permissions: allPerms,
    };
    try {
      if (mode === "create") {
        await api.post("/v1/roles", body);
      } else if (role) {
        await api.put(`/v1/roles/${role.id}`, body);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold">{mode === "create" ? "Nouveau rôle" : `Modifier "${role?.name}"`}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nom *">
              <input value={name} onChange={(e) => setName(e.target.value)} required
                placeholder="ex: Technicien terrain" className={inputCls} />
            </Field>
            <Field label="Description">
              <input value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="optionnel" className={inputCls} />
            </Field>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-2 flex items-center gap-1.5">
              Permissions par fonctionnalité
              <Help>
                <p>Pour chaque fonctionnalité, choisissez le niveau d'accès :</p>
                <p className="mt-1"><strong>Aucun</strong> — la fonctionnalité est masquée.</p>
                <p className="mt-1"><strong>Lecture</strong> — l'utilisateur consulte mais ne peut rien modifier.</p>
                <p className="mt-1"><strong>Lecture + écriture</strong> — l'utilisateur peut tout faire dans cette fonctionnalité.</p>
              </Help>
            </div>
            <div className="space-y-2">
              {features.map((f) => (
                <PermissionRow key={f.code}
                  feature={f}
                  level={(allPerms[f.code] as PermissionLevel) ?? "none"}
                  onChange={(l) => setLevel(f.code, l)} />
              ))}
            </div>
          </div>

          {error && <div className="text-sm text-red-500 bg-red-500/10 p-2.5 rounded">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white">Annuler</button>
          <button type="submit" disabled={submitting} className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50">
            {submitting ? "Enregistrement…" : mode === "create" ? "Créer le rôle" : "Enregistrer"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PermissionRow({ feature, level, onChange }: {
  feature: FeatureMeta; level: PermissionLevel; onChange: (l: PermissionLevel) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-sm font-medium">{feature.label}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">{feature.description}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {LEVELS.map((l) => (
          <label key={l} className={clsx(
            "cursor-pointer rounded-md border p-2 text-center text-xs transition",
            level === l
              ? "bg-brand-500/15 border-brand-500/50 text-brand-700 dark:text-brand-300 font-semibold"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400",
          )} title={LEVEL_DESC[l]}>
            <input type="radio" name={`perm-${feature.code}`} value={l}
              checked={level === l} onChange={() => onChange(l)} className="sr-only" />
            <div>{LEVEL_LABEL[l]}</div>
          </label>
        ))}
      </div>
    </div>
  );
}

function initPerms(features: FeatureMeta[]): PermissionSet {
  const out: PermissionSet = {};
  for (const f of features) out[f.code] = "none";
  return out;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{label}</span>
      {children}
    </label>
  );
}
