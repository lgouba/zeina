import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Plus, Trash2, Pencil, Power, PowerOff, X, History, Sparkles,
} from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../lib/api";
import { useAuth, useCanWrite } from "../lib/auth";
import {
  CATEGORY_EMOJIS, CATEGORY_LABELS, templatesByCategory,
  type RuleTemplate,
} from "./ruleTemplates";
import { describeCron } from "../components/CronBuilder";
import { useConfirm } from "../components/ConfirmDialog";
import { RuleGraphEditor, type GraphDoc } from "../components/RuleGraphEditor";
import type {
  Rule, RuleAction, RuleCondition, RuleDefinition, RuleExecution,
  RuleTrigger,
  Zone,
  DeviceListItem,
} from "../types/api";

export function RulesPage() {
  const { id: siteId } = useParams<{ id: string }>();
  const { token } = useAuth();
  const canWrite = useCanWrite("rules");
  const [rules, setRules] = useState<Rule[]>([]);
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [prefillFromTemplate, setPrefillFromTemplate] = useState<RuleDefinition | null>(null);
  const [prefillName, setPrefillName] = useState<string>("");
  const [editing, setEditing] = useState<Rule | null>(null);
  const [executionsFor, setExecutionsFor] = useState<Rule | null>(null);

  const reload = () => {
    if (!siteId || !token) return;
    setLoading(true);
    Promise.all([
      api.get<Rule[]>(`/v1/sites/${siteId}/rules`).catch((e) => { console.error("load rules:", e); return [] as Rule[]; }),
      api.get<DeviceListItem[]>(`/v1/sites/${siteId}/devices`).catch((e) => { console.error("load devices:", e); return [] as DeviceListItem[]; }),
      api.get<Zone[]>(`/v1/sites/${siteId}/zones`).catch((e) => { console.error("load zones:", e); return [] as Zone[]; }),
    ]).then(([r, d, z]) => { setRules(r); setDevices(d); setZones(z); }).finally(() => setLoading(false));
  };
  useEffect(reload, [siteId, token]);

  async function toggle(r: Rule) {
    try {
      await api.post(`/v1/rules/${r.id}/${r.enabled ? "disable" : "enable"}`);
      reload();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    }
  }
  const confirm = useConfirm();
  async function onDelete(r: Rule) {
    const ok = await confirm({
      title: `Supprimer la règle « ${r.name} » ?`,
      description: <>
        La règle ne sera plus évaluée. Les <strong>alarmes déjà déclenchées</strong> par cette règle restent visibles
        dans la page Alarmes pour l'historique.
        <br /><br />
        Si tu souhaites juste arrêter temporairement la règle, utilise le toggle <strong>Désactiver</strong> à la place.
      </>,
      danger: true,
      confirmLabel: "Supprimer la règle",
    });
    if (!ok) return;
    try {
      await api.del(`/v1/rules/${r.id}`);
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
            <Sparkles className="h-5 w-5 text-brand-500" /> Règles
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {rules.length} règle{rules.length > 1 ? "s" : ""} — déclenchent automatiquement des actions sur les équipements.
          </p>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button onClick={() => setTemplatesOpen(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">
              <Sparkles className="h-3.5 w-3.5" /> Modèles
            </button>
            <button onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white">
              <Plus className="h-3.5 w-3.5" /> Nouvelle règle
            </button>
          </div>
        )}
      </header>

      {loading ? (
        <div className="text-sm text-slate-500">Chargement…</div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center">
          <Sparkles className="h-8 w-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-4">Aucune règle configurée pour ce site.</p>
          {canWrite && (
            <button onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white">
              <Plus className="h-4 w-4" /> Créer ma première règle
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <RuleCard key={r.id} rule={r} devices={devices} canWrite={canWrite}
              onToggle={() => toggle(r)}
              onDelete={() => onDelete(r)}
              onEdit={() => setEditing(r)}
              onShowExecutions={() => setExecutionsFor(r)} />
          ))}
        </div>
      )}

      {createOpen && siteId && (
        <GraphEditorContainer
          siteId={siteId} devices={devices} zones={zones}
          initialName={prefillName}
          initialDefinition={prefillFromTemplate ?? undefined}
          onClose={() => { setCreateOpen(false); setPrefillFromTemplate(null); setPrefillName(""); }}
          onSaved={() => { setCreateOpen(false); setPrefillFromTemplate(null); setPrefillName(""); reload(); }} />
      )}
      {templatesOpen && (
        <TemplatesPicker
          devices={devices}
          onClose={() => setTemplatesOpen(false)}
          onPick={(tpl) => {
            // Pré-remplit le RuleModal avec la définition du template
            // (en remplaçant device_slug vide par un device compatible).
            const def = applyTemplateToDevices(tpl.definition, devices, tpl.preferredDeviceType);
            setPrefillFromTemplate(def);
            setPrefillName(tpl.name);
            setTemplatesOpen(false);
            setCreateOpen(true);
          }}
        />
      )}
      {editing && siteId && (
        <GraphEditorContainer
          siteId={siteId} devices={devices} zones={zones}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }} />
      )}
      {executionsFor && (
        <ExecutionsModal rule={executionsFor} onClose={() => setExecutionsFor(null)} />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// GraphEditorContainer — wrapper qui gère name/enabled/save autour du
// RuleGraphEditor visuel xyflow. Remplace l'ancien RuleModal long form.
// ----------------------------------------------------------------------------

function GraphEditorContainer({
  siteId, devices, zones, editing, initialName, initialDefinition, onClose, onSaved,
}: {
  siteId: string;
  devices: DeviceListItem[];
  zones: Zone[];
  editing?: Rule;
  initialName?: string;
  initialDefinition?: RuleDefinition;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name || initialName || "");
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);

  // Si editing : essaye de charger le graph existant, sinon reconstruit depuis la definition.
  // Note : Rule type a definition_graph optionnel ajouté côté backend.
  const initialGraph = (editing as any)?.definition_graph as GraphDoc | undefined;
  const initialDef = editing?.definition || initialDefinition;

  async function submit(graph: GraphDoc) {
    const body = {
      name: name.trim(),
      enabled,
      definition_graph: graph,
      // On laisse le backend compiler graph → definition. Pas de definition envoyée.
    };
    if (editing) {
      await api.put(`/v1/rules/${editing.id}`, body);
    } else {
      await api.post(`/v1/sites/${siteId}/rules`, body);
    }
    onSaved();
  }

  return (
    <RuleGraphEditor
      initial={initialGraph}
      initialDefinition={initialDef}
      devices={devices}
      zones={zones}
      ruleName={name}
      ruleEnabled={enabled}
      onNameChange={setName}
      onEnabledChange={setEnabled}
      onSubmit={submit}
      onCancel={onClose}
    />
  );
}

// ----------------------------------------------------------------------------
// RuleCard
// ----------------------------------------------------------------------------
function RuleCard({ rule, devices, canWrite, onToggle, onDelete, onEdit, onShowExecutions }: {
  rule: Rule; devices: DeviceListItem[]; canWrite: boolean;
  onToggle: () => void; onDelete: () => void; onEdit: () => void; onShowExecutions: () => void;
}) {
  const t = rule.definition.trigger;
  const cooldown = rule.definition.cooldown_seconds || 0;
  return (
    <div className={clsx(
      "rounded-xl border p-4 transition",
      rule.enabled
        ? "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50 opacity-70",
    )}>
      <div className="flex items-start gap-3">
        <div className={clsx(
          "rounded-lg p-2",
          rule.enabled ? "bg-brand-500/10 text-brand-500 dark:text-brand-400" : "bg-slate-200 dark:bg-slate-800 text-slate-500"
        )}>
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{rule.name}</h3>
            {rule.enabled ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Active</span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-500">Désactivée</span>
            )}
          </div>
          {rule.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{rule.description}</p>}

          <div className="mt-3 grid gap-2 text-xs">
            <DefRow label="SI" content={triggerSummary(t, devices)} />
            {rule.definition.conditions && rule.definition.conditions.length > 0 && (
              <DefRow label={rule.definition.conditions_op || "AND"} content={
                rule.definition.conditions.map((c) => conditionSummary(c, devices)).join(`  ${rule.definition.conditions_op || "AND"}  `)
              } />
            )}
            <DefRow label="ALORS" content={rule.definition.actions.map(actionSummary).join(" + ")} />
            {cooldown > 0 && (
              <DefRow label="DÉLAI" content={`${cooldown}s entre déclenchements`} />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onShowExecutions} title="Historique d'exécution"
            className="text-slate-500 dark:text-slate-400 hover:text-brand-500 dark:hover:text-brand-300 p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
            <History className="h-4 w-4" />
          </button>
          {canWrite && (
            <>
              <button onClick={onToggle} title={rule.enabled ? "Désactiver" : "Activer"}
                className={clsx(
                  "p-1.5 rounded-md transition",
                  rule.enabled
                    ? "text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                    : "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10",
                )}>
                {rule.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
              </button>
              <button onClick={onEdit} title="Modifier"
                className="text-slate-500 dark:text-slate-400 hover:text-brand-500 dark:hover:text-brand-300 p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={onDelete} title="Supprimer"
                className="text-slate-500 dark:text-slate-400 hover:text-red-500 p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DefRow({ label, content }: { label: string; content: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400 w-14 shrink-0">{label}</span>
      <span className="text-slate-700 dark:text-slate-300">{content}</span>
    </div>
  );
}

function deviceLabel(slug: string, devs: DeviceListItem[]) {
  const d = devs.find((x) => x.slug === slug);
  return d ? `${d.name || d.slug}` : slug;
}
function triggerSummary(t: RuleTrigger, devs: DeviceListItem[]): string {
  const target = t.zone_scope
    ? `zone:${t.zone_scope.zone_id.slice(0, 8)}…${t.zone_scope.device_type ? `/${t.zone_scope.device_type}` : ""}`
    : deviceLabel(t.device_slug || "", devs);
  if (t.type === "threshold") {
    const sus = (t.sustained_seconds || 0) > 0 ? ` pendant ${t.sustained_seconds}s` : "";
    return `${target}.${t.measurement} ${t.op} ${t.value}${sus}`;
  }
  if (t.type === "value_change") {
    return `${target}.${t.measurement} change vers ${t.to ?? "?"}`;
  }
  if (t.type === "cron") {
    return describeCron(t.schedule || "");
  }
  if (t.type === "aggregate") {
    const a = t.aggregate;
    return `${a?.op || "avg"}(${target}.${t.measurement}) sur ${a?.window_minutes || 60} min ${t.op} ${t.value}`;
  }
  if (t.type === "anomaly") {
    const an = t.anomaly;
    return `${target}.${t.measurement} : anomalie > ${an?.sigma || 3}σ vs baseline ${an?.baseline_days || 14} j`;
  }
  return JSON.stringify(t);
}
function conditionSummary(c: RuleCondition, devs: DeviceListItem[]): string {
  return `${deviceLabel(c.device_slug, devs)}.${c.measurement} ${c.op} ${c.value}`;
}
function actionSummary(a: RuleAction): string {
  if (a.type === "set_actuator") return `${a.device_slug} ← ${a.state}`;
  if (a.type === "notify") return `notifier "${a.message}"`;
  if (a.type === "email") return `email à ${a.recipients.join(", ")} — "${a.subject}"`;
  if (a.type === "sms") return `SMS à ${a.recipients.join(", ")} — "${a.message}"`;
  if (a.type === "webhook") return `webhook ${a.method || "POST"} → ${shortURL(a.url)}`;
  if (a.type === "alarm") return `🚨 alarme ${a.severity || "major"} — "${a.name}"`;
  return JSON.stringify(a);
}

// ----------------------------------------------------------------------------
// RuleModal — formulaire create + edit
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
function shortURL(u: string): string {
  try {
    const url = new URL(u);
    return url.host;
  } catch {
    return u || "?";
  }
}

function ExecutionsModal({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const [execs, setExecs] = useState<RuleExecution[] | null>(null);
  useEffect(() => {
    api.get<RuleExecution[]>(`/v1/rules/${rule.id}/executions?limit=100`).then(setExecs).catch(() => setExecs([]));
  }, [rule.id]);
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2"><History className="h-4 w-4" /> Historique d'exécution</h2>
            <p className="text-xs text-slate-500">{rule.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">
          {execs === null ? (
            <div className="text-sm text-slate-500">Chargement…</div>
          ) : execs.length === 0 ? (
            <div className="text-sm text-slate-500 italic text-center py-10">Cette règle ne s'est pas encore déclenchée.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-slate-500 uppercase tracking-wider">
                <tr><th className="text-left px-2 py-2">Quand</th><th className="text-left px-2 py-2">Résultat</th><th className="text-left px-2 py-2">Latence</th><th className="text-left px-2 py-2">Détail</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {execs.map((e) => (
                  <tr key={e.id}>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{new Date(e.triggered_at).toLocaleString("fr-FR")}</td>
                    <td className="px-2 py-2">
                      <span className={clsx("px-1.5 py-0.5 rounded text-[10px]",
                        e.result === "success" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" :
                        e.result === "partial" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" :
                        "bg-red-500/15 text-red-700 dark:text-red-300"
                      )}>{e.result}</span>
                    </td>
                    <td className="px-2 py-2 text-slate-500">{e.latency_ms}ms</td>
                    <td className="px-2 py-2 text-slate-500 font-mono text-[10px] truncate max-w-md">
                      {JSON.stringify(e.action_taken)}
                      {e.error_message && <span className="text-red-500 block">{e.error_message}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// TemplatesPicker — bibliothèque de modèles prêts à l'emploi
// ----------------------------------------------------------------------------
function TemplatesPicker({ devices, onClose, onPick }: {
  devices: DeviceListItem[];
  onClose: () => void;
  onPick: (t: RuleTemplate) => void;
}) {
  const grouped = templatesByCategory();
  const cats = Object.keys(grouped) as RuleTemplate["category"][];
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-500" /> Bibliothèque de modèles</h2>
            <p className="text-xs text-slate-500">Cliquez sur un modèle — la règle sera créée pré-remplie, à ajuster avant de sauver.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-5">
          {cats.map((cat) => (
            <div key={cat}>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 font-semibold">
                {CATEGORY_EMOJIS[cat]} {CATEGORY_LABELS[cat]}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {grouped[cat].map((t) => {
                  const compat = !t.preferredDeviceType || devices.some((d) => d.type === t.preferredDeviceType);
                  return (
                    <button key={t.id}
                      onClick={() => onPick(t)}
                      disabled={!compat}
                      title={!compat ? `Aucun équipement de type ${t.preferredDeviceType} dans ce site` : t.description}
                      className={clsx(
                        "text-left px-3 py-2.5 rounded-md border transition group",
                        compat
                          ? "border-slate-200 dark:border-slate-800 hover:border-brand-400 dark:hover:border-brand-500 hover:bg-brand-500/5"
                          : "border-slate-200 dark:border-slate-800 opacity-50 cursor-not-allowed",
                      )}>
                      <div className="text-sm font-medium text-slate-800 dark:text-slate-100 group-hover:text-brand-600 dark:group-hover:text-brand-300 transition">
                        {t.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                        {t.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// applyTemplateToDevices — remplit les device_slug vides du template avec
// un device compatible du site (filtré par type si renseigné).
function applyTemplateToDevices(def: RuleDefinition, devices: DeviceListItem[], preferredType?: string): RuleDefinition {
  const candidates = preferredType
    ? devices.filter((d) => d.type === preferredType)
    : devices;
  const fallback = candidates[0]?.slug || devices[0]?.slug || "";
  const next: RuleDefinition = JSON.parse(JSON.stringify(def));
  if (next.trigger && next.trigger.device_slug === "") next.trigger.device_slug = fallback;
  for (const a of next.actions) {
    if (a.type === "set_actuator" && (a as { device_slug: string }).device_slug === "") {
      (a as { device_slug: string }).device_slug = devices.find((d) => d.type === "actuator")?.slug || fallback;
    }
  }
  return next;
}
