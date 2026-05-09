import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import {
  Plus, Trash2, Pencil, Power, PowerOff, X, Activity, History,
  AlertCircle, CheckCircle2, Clock, Sparkles, Mail, MessageSquare,
  ChevronDown, ChevronRight,
} from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../lib/api";
import { useAuth, useCanWrite } from "../lib/auth";
import { DeviceAttributePicker } from "../components/DeviceAttributePicker";
import {
  CATEGORY_EMOJIS, CATEGORY_LABELS, templatesByCategory,
  type RuleTemplate,
} from "./ruleTemplates";
import { CronBuilder, describeCron } from "../components/CronBuilder";
import { Help } from "../components/Tooltip";
import type {
  Rule, RuleAction, RuleCondition, RuleDefinition, RuleExecution, RuleTimeWindow,
  RuleTrigger, RuleZoneScope, AggregateOp,
  Zone,
  CmpOp, DeviceListItem,
} from "../types/api";

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";

const OPS: CmpOp[] = [">", ">=", "<", "<=", "==", "!="];

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
      api.get<Rule[]>(`/v1/sites/${siteId}/rules`),
      api.get<DeviceListItem[]>(`/v1/sites/${siteId}/devices`),
      api.get<Zone[]>(`/v1/sites/${siteId}/zones`).catch(() => []),
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
  async function onDelete(r: Rule) {
    if (!confirm(`Supprimer la règle "${r.name}" ?`)) return;
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
        <RuleModal siteId={siteId} devices={devices} zones={zones}
          initialDefinition={prefillFromTemplate ?? undefined}
          initialName={prefillName}
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
        <RuleModal siteId={siteId} devices={devices} zones={zones} editing={editing}
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
  if (a.type === "webhook") return `webhook ${a.method || "POST"} → ${hostOf(a.url)}`;
  if (a.type === "alarm") return `🚨 alarme ${a.severity || "major"} — "${a.name}"`;
  return JSON.stringify(a);
}

// ----------------------------------------------------------------------------
// RuleModal — formulaire create + edit
// ----------------------------------------------------------------------------
function RuleModal({ siteId, devices, zones, editing, initialDefinition, initialName, onClose, onSaved }: {
  siteId: string; devices: DeviceListItem[]; zones: Zone[]; editing?: Rule;
  initialDefinition?: RuleDefinition; initialName?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const baseDef = editing?.definition || initialDefinition;
  const [name, setName] = useState(editing?.name || initialName || "");
  const [description, setDescription] = useState(editing?.description || "");
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [trigger, setTrigger] = useState<RuleTrigger>(baseDef?.trigger || {
    type: "threshold", device_slug: devices[0]?.slug, measurement: "temperature", op: ">", value: 25,
  });
  const [conditions, setConditions] = useState<RuleCondition[]>(baseDef?.conditions || []);
  const [conditionsOp, setConditionsOp] = useState<"AND" | "OR">(baseDef?.conditions_op || "AND");
  const [actions, setActions] = useState<RuleAction[]>(baseDef?.actions || [
    { type: "notify", level: "warning", message: "Seuil dépassé" },
  ]);
  const [cooldown, setCooldown] = useState<number>(baseDef?.cooldown_seconds ?? 300);
  const [timeWindow, setTimeWindow] = useState<RuleTimeWindow | undefined>(baseDef?.time_window);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actuators = useMemo(() => devices.filter((d) => d.type === "actuator"), [devices]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Nom requis"); return; }
    if (actions.length === 0) { setError("Au moins une action"); return; }
    setSubmitting(true); setError(null);

    const def: RuleDefinition = {
      trigger,
      conditions_op: conditionsOp,
      conditions,
      actions,
      cooldown_seconds: cooldown,
      time_window: timeWindow,
    };
    const body = { name: name.trim(), description: description.trim() || undefined, enabled, definition: def };

    try {
      if (editing) {
        await api.put(`/v1/rules/${editing.id}`, body);
      } else {
        await api.post(`/v1/sites/${siteId}/rules`, body);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold">{editing ? "Modifier la règle" : "Nouvelle règle"}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Identité */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nom *">
              <input value={name} onChange={(e) => setName(e.target.value)} required
                placeholder="ex: Alerte CO2 trop élevé" className={inputCls} />
            </Field>
            <Field label="État">
              <label className="flex items-center gap-2 mt-1">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span className="text-sm">Activée immédiatement</span>
              </label>
            </Field>
          </div>
          <Field label="Description">
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Optionnel" className={inputCls} />
          </Field>

          {/* Trigger */}
          <Section title="Quand (déclencheur)" icon={<Activity className="h-4 w-4" />}>
            <Field label="Type" tooltip={
              <>
                <p className="font-semibold mb-1">Quel évènement déclenche la règle ?</p>
                <p><span className="font-medium">Seuil</span> — quand une mesure dépasse ou passe sous une valeur (ex. CO₂ &gt; 1000 ppm).</p>
                <p className="mt-1"><span className="font-medium">Changement de valeur</span> — quand une mesure atteint exactement une valeur (ex. présence = 1).</p>
                <p className="mt-1"><span className="font-medium">Heure programmée</span> — à des moments planifiés (ex. tous les jours à 18h).</p>
                <p className="mt-1"><span className="font-medium">Agrégat rolling</span> — moyenne / somme / min / max / count sur une fenêtre temporelle (ex. moy CO₂ sur 1h).</p>
                <p className="mt-1"><span className="font-medium">Anomalie</span> — détecte un écart vs la baseline historique (sans seuil à régler).</p>
              </>
            }>
              <select value={trigger.type} onChange={(e) => {
                const tt = e.target.value as RuleTrigger["type"];
                setTrigger({
                  type: tt,
                  device_slug: tt !== "cron" ? (devices[0]?.slug || "") : undefined,
                  measurement: tt !== "cron" ? "temperature" : undefined,
                  op: (tt === "threshold" || tt === "aggregate") ? ">" : undefined,
                  value: (tt === "threshold" || tt === "aggregate") ? 25 : undefined,
                  schedule: tt === "cron" ? "0 18 * * 1-5" : undefined,
                  aggregate: tt === "aggregate" ? { op: "avg", window_minutes: 60 } : undefined,
                  anomaly: tt === "anomaly" ? { baseline_days: 14, sigma: 3 } : undefined,
                });
              }} className={inputCls}>
                <option value="threshold">📈 Seuil sur une mesure</option>
                <option value="value_change">🔄 Changement de valeur</option>
                <option value="cron">⏰ Heure programmée</option>
                <option value="aggregate">📊 Agrégat rolling (moy / somme / min / max…)</option>
                <option value="anomaly">🤖 Détection d'anomalie (baseline statistique)</option>
              </select>
            </Field>

            {/* Cibler : device unique vs toute une zone (n'apparaît pas pour cron) */}
            {trigger.type !== "cron" && (
              <Field label="Cibler" tooltip={
                <>
                  <p><span className="font-medium">Un équipement</span> — la règle ne surveille qu'un device précis.</p>
                  <p className="mt-1"><span className="font-medium">Toute une zone</span> — la règle s'applique à TOUS les devices de la zone qui ont la mesure. Idéal pour 1 règle qui couvre 50 salles.</p>
                </>
              }>
                <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <button type="button"
                    onClick={() => setTrigger({ ...trigger, zone_scope: undefined, device_slug: trigger.device_slug || devices[0]?.slug || "" })}
                    className={clsx("px-3 py-1.5 text-xs font-medium transition",
                      !trigger.zone_scope ? "bg-brand-500/15 text-brand-700 dark:text-brand-300" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800")}>
                    Un équipement
                  </button>
                  <button type="button"
                    onClick={() => setTrigger({ ...trigger, zone_scope: { zone_id: zones[0]?.id || "" }, device_slug: undefined })}
                    className={clsx("px-3 py-1.5 text-xs font-medium transition",
                      trigger.zone_scope ? "bg-brand-500/15 text-brand-700 dark:text-brand-300" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800")}>
                    Toute une zone
                  </button>
                </div>
              </Field>
            )}

            {/* Picker device unique */}
            {trigger.type !== "cron" && !trigger.zone_scope && (
              <DeviceAttributePicker
                devices={devices}
                initialDeviceSlug={trigger.device_slug}
                initialMeasurement={trigger.measurement}
                onChange={(sel) => {
                  if (sel) setTrigger({ ...trigger, device_slug: sel.device.slug, measurement: sel.attribute.name });
                }}
              />
            )}

            {/* Picker zone scope */}
            {trigger.type !== "cron" && trigger.zone_scope && (
              <ZoneScopePicker
                zones={zones}
                value={trigger.zone_scope}
                measurement={trigger.measurement || ""}
                onChange={(zs, measurement) => setTrigger({ ...trigger, zone_scope: zs, measurement })}
              />
            )}

            {trigger.type === "threshold" && (
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Opérateur" tooltip="Comparaison à effectuer entre la mesure et la valeur saisie. Ex. « &gt; » se déclenche quand la mesure dépasse la valeur.">
                  <select value={trigger.op || ">"} onChange={(e) => setTrigger({ ...trigger, op: e.target.value as CmpOp })} className={inputCls}>
                    {OPS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Valeur">
                  <input type="number" step="any" value={trigger.value ?? 0}
                    onChange={(e) => setTrigger({ ...trigger, value: +e.target.value })} className={inputCls} />
                </Field>
                <Field label="Soutenu (s)" hint="0 = immédiat" tooltip="Durée minimale (en secondes) pendant laquelle la condition doit rester vraie pour déclencher la règle. Évite les déclenchements sur des pics ponctuels.">
                  <input type="number" min={0} value={trigger.sustained_seconds || 0}
                    onChange={(e) => setTrigger({ ...trigger, sustained_seconds: +e.target.value })} className={inputCls} />
                </Field>
              </div>
            )}

            {trigger.type === "value_change" && (
              <Field label="Nouvelle valeur observée" hint="Le déclencheur s'active dès que la mesure atteint cette valeur"
                tooltip="Utile pour les capteurs binaires : présence = 1, porte ouverte, etc.">
                <input type="number" step="any" value={trigger.to ?? 0}
                  onChange={(e) => setTrigger({ ...trigger, to: +e.target.value })} className={inputCls} />
              </Field>
            )}

            {trigger.type === "aggregate" && (
              <div className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Fonction d'agrégation" tooltip="avg = moyenne · sum = somme · min/max = extrême · count = nombre de points reçus dans la fenêtre">
                    <select value={trigger.aggregate?.op || "avg"}
                      onChange={(e) => setTrigger({ ...trigger, aggregate: { ...(trigger.aggregate || { window_minutes: 60 }), op: e.target.value as AggregateOp } })}
                      className={inputCls}>
                      <option value="avg">📊 Moyenne (avg)</option>
                      <option value="sum">➕ Somme (sum)</option>
                      <option value="min">⬇️ Minimum (min)</option>
                      <option value="max">⬆️ Maximum (max)</option>
                      <option value="count">🔢 Nombre de points (count)</option>
                    </select>
                  </Field>
                  <Field label="Fenêtre (minutes)" hint="Durée de la fenêtre rolling sur laquelle l'agrégat est calculé">
                    <input type="number" min={1} value={trigger.aggregate?.window_minutes || 60}
                      onChange={(e) => setTrigger({ ...trigger, aggregate: { ...(trigger.aggregate || { op: "avg" }), window_minutes: +e.target.value } })}
                      className={inputCls} />
                  </Field>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Opérateur">
                    <select value={trigger.op || ">"} onChange={(e) => setTrigger({ ...trigger, op: e.target.value as CmpOp })} className={inputCls}>
                      {OPS.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </Field>
                  <Field label="Seuil">
                    <input type="number" step="any" value={trigger.value ?? 0}
                      onChange={(e) => setTrigger({ ...trigger, value: +e.target.value })} className={inputCls} />
                  </Field>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  Évalué automatiquement toutes les 30 s. Ex : <code className="font-mono">moy CO₂ sur 60 min &gt; 1200</code>.
                </p>
              </div>
            )}

            {trigger.type === "anomaly" && (
              <div className="space-y-3 rounded-lg border border-violet-300/60 dark:border-violet-700/40 bg-violet-500/5 p-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Baseline (jours)" tooltip="Nombre de jours d'historique utilisés pour calculer la baseline (moyenne + écart-type) à la même heure de la journée. 14 jours est un bon point de départ.">
                    <input type="number" min={1} max={90} value={trigger.anomaly?.baseline_days || 14}
                      onChange={(e) => setTrigger({ ...trigger, anomaly: { ...(trigger.anomaly || { sigma: 3 }), baseline_days: +e.target.value } })}
                      className={inputCls} />
                  </Field>
                  <Field label="Sensibilité (σ)" tooltip="Multiplicateur de l'écart-type. 3 = règle stricte (3-sigma, ~0,3 % de chance d'être normal). 2 = plus sensible. Plus la valeur est petite, plus la règle déclenche souvent.">
                    <input type="number" step="0.5" min={0.5} value={trigger.anomaly?.sigma || 3}
                      onChange={(e) => setTrigger({ ...trigger, anomaly: { ...(trigger.anomaly || { baseline_days: 14 }), sigma: +e.target.value } })}
                      className={inputCls} />
                  </Field>
                </div>
                <p className="text-[11px] text-violet-700 dark:text-violet-300 leading-snug">
                  🤖 Pas de seuil à régler — le moteur compare la valeur courante (moy 1 h) à la moyenne historique sur les <strong>{trigger.anomaly?.baseline_days || 14} derniers jours</strong> à la même heure. Déclenche si l'écart dépasse <strong>{trigger.anomaly?.sigma || 3} σ</strong>.
                </p>
              </div>
            )}

            {trigger.type === "cron" && (
              <CronBuilder
                value={trigger.schedule || "0 18 * * 1-5"}
                onChange={(expr) => setTrigger({ ...trigger, schedule: expr })}
              />
            )}
          </Section>

          {/* Conditions */}
          <Section title={`Conditions additionnelles (${conditionsOp})`} icon={<AlertCircle className="h-4 w-4" />}>
            <div className="flex items-center gap-2 mb-3 text-xs">
              <span className="text-slate-500">Opérateur entre conditions :</span>
              <select value={conditionsOp} onChange={(e) => setConditionsOp(e.target.value as "AND" | "OR")}
                className="text-xs px-2 py-1 rounded bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700">
                <option value="AND">AND (toutes vraies)</option>
                <option value="OR">OR (au moins une vraie)</option>
              </select>
            </div>
            {conditions.map((c, i) => (
              <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-3 relative">
                <button type="button" onClick={() => removeAt(setConditions, i)}
                  className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded">
                  <X className="h-3.5 w-3.5" />
                </button>
                <DeviceAttributePicker
                  devices={devices}
                  initialDeviceSlug={c.device_slug}
                  initialMeasurement={c.measurement}
                  onChange={(sel) => {
                    if (sel) updateAt(setConditions, i, { ...c, device_slug: sel.device.slug, measurement: sel.attribute.name });
                  }}
                />
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <Field label="Opérateur">
                    <select value={c.op}
                      onChange={(e) => updateAt(setConditions, i, { ...c, op: e.target.value as CmpOp })} className={inputCls}>
                      {OPS.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </Field>
                  <Field label="Valeur">
                    <input type="number" step="any" value={c.value}
                      onChange={(e) => updateAt(setConditions, i, { ...c, value: +e.target.value })} className={inputCls} />
                  </Field>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setConditions([...conditions, { device_slug: devices[0]?.slug || "", measurement: "presence", op: "==", value: 1 }])}
              className="text-xs text-brand-500 hover:text-brand-600 flex items-center gap-1">
              <Plus className="h-3 w-3" /> Ajouter une condition
            </button>
          </Section>

          {/* Actions */}
          <Section title="Actions à exécuter" icon={<CheckCircle2 className="h-4 w-4" />}>
            {actuators.length === 0 && (
              <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2">
                Aucun équipement de type « actuator » sur ce site — seules les actions « Notifier » seront utilisables.
              </div>
            )}
            {actions.map((a, i) => (
              <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-3 relative">
                <button type="button" onClick={() => removeAt(setActions, i)}
                  className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded">
                  <X className="h-3.5 w-3.5" />
                </button>

                <Field label={`Action ${i + 1} — Type`} tooltip={
                  <>
                    <p><span className="font-medium">Actionneur</span> — allume / éteint un équipement (lumière, relais, etc.).</p>
                    <p className="mt-1"><span className="font-medium">Notification</span> — bandeau visible dans l'application.</p>
                    <p className="mt-1"><span className="font-medium">Email</span> — message envoyé aux adresses saisies.</p>
                    <p className="mt-1"><span className="font-medium">SMS</span> — texto envoyé aux numéros saisis.</p>
                    <p className="mt-1 text-slate-300/80">Bientôt : choisir un utilisateur enregistré comme destinataire.</p>
                  </>
                }>
                  <select value={a.type} onChange={(e) => {
                    const t = e.target.value as RuleAction["type"];
                    if (t === "set_actuator") updateAt(setActions, i, { type: "set_actuator", device_slug: actuators[0]?.slug || "", state: "on" });
                    else if (t === "email") updateAt(setActions, i, { type: "email", recipients: [], subject: "", message: "", level: "warning" });
                    else if (t === "sms") updateAt(setActions, i, { type: "sms", recipients: [], message: "", level: "warning" });
                    else if (t === "webhook") updateAt(setActions, i, { type: "webhook", url: "", method: "POST", headers: {}, body: "", level: "warning" });
                    else if (t === "alarm") updateAt(setActions, i, { type: "alarm", severity: "major", label: "Dépassement de seuil", name: name.trim() || "{rule.name}", description: "", model: "Standard", status_text: "Comportement anormal" });
                    else updateAt(setActions, i, { type: "notify", level: "warning", message: "" });
                  }} className={inputCls}>
                    <option value="set_actuator">🔌 Piloter un actionneur</option>
                    <option value="notify">🔔 Notification dans l'app</option>
                    <option value="alarm">🚨 Créer une alarme</option>
                    <option value="email">📧 Envoyer un email</option>
                    <option value="sms">📱 Envoyer un SMS</option>
                    <option value="webhook">🔗 Webhook HTTP (Slack, Teams, n8n…)</option>
                  </select>
                </Field>

                {a.type === "set_actuator" ? (
                  <div className="mt-3 space-y-3">
                    <DeviceAttributePicker
                      devices={devices}
                      filterDeviceType="actuator"
                      attributeOnly
                      initialDeviceSlug={a.device_slug}
                      onChange={(sel) => {
                        if (sel) updateAt(setActions, i, { ...a, device_slug: sel.device.slug } as RuleAction);
                      }}
                    />
                    <Field label="Nouvel état">
                      <select value={a.state}
                        onChange={(e) => updateAt(setActions, i, { ...a, state: e.target.value } as RuleAction)}
                        className={inputCls}>
                        <option value="on">Allumer (on)</option>
                        <option value="off">Éteindre (off)</option>
                      </select>
                    </Field>
                  </div>
                ) : a.type === "email" ? (
                  <div className="mt-3 space-y-3">
                    <RecipientList
                      label="Destinataires"
                      placeholder="ex: marie@acme.com"
                      kind="email"
                      values={a.recipients}
                      onChange={(next) => updateAt(setActions, i, { ...a, recipients: next } as RuleAction)}
                    />
                    <Field label="Objet" tooltip="Ligne « Subject » du mail. Restez concis — le contenu détaillé va dans le message.">
                      <input value={a.subject}
                        onChange={(e) => updateAt(setActions, i, { ...a, subject: e.target.value } as RuleAction)}
                        placeholder="ex: [ZEINA] Seuil CO₂ dépassé" className={inputCls} />
                    </Field>
                    <Field label="Message">
                      <textarea value={a.message} rows={3}
                        onChange={(e) => updateAt(setActions, i, { ...a, message: e.target.value } as RuleAction)}
                        placeholder="Corps du mail envoyé aux destinataires" className={inputCls} />
                    </Field>
                    <TemplateVarsHint />
                  </div>
                ) : a.type === "sms" ? (
                  <div className="mt-3 space-y-3">
                    <RecipientList
                      label="Numéros de téléphone"
                      placeholder="ex: +22670123456"
                      kind="phone"
                      values={a.recipients}
                      onChange={(next) => updateAt(setActions, i, { ...a, recipients: next } as RuleAction)}
                    />
                    <Field label="Texte du SMS" hint="Privilégiez 160 caractères max — au-delà, votre opérateur peut facturer plusieurs SMS." tooltip="Le SMS sera envoyé tel quel. Aucun objet, juste le texte. Rappel : éviter les emojis (consommation de caractères × 4).">
                      <textarea value={a.message} rows={3}
                        onChange={(e) => updateAt(setActions, i, { ...a, message: e.target.value } as RuleAction)}
                        placeholder="ex: Alerte ZEINA — CO2 > 1000 ppm sur le siège" className={inputCls} />
                      <div className="text-[10px] text-slate-400 mt-0.5">{a.message.length} caractère{a.message.length > 1 ? "s" : ""}</div>
                    </Field>
                    <TemplateVarsHint />
                  </div>
                ) : a.type === "webhook" ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-[6rem_1fr] gap-3">
                      <Field label="Méthode">
                        <select value={a.method || "POST"}
                          onChange={(e) => updateAt(setActions, i, { ...a, method: e.target.value as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" } as RuleAction)}
                          className={inputCls}>
                          {["POST", "GET", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </Field>
                      <Field label="URL" tooltip="Slack: hooks.slack.com/services/… · Teams/Discord: webhook URL · n8n/Zapier/IFTTT: leur URL d'entrée. Variables {var} supportées.">
                        <input value={a.url} required
                          onChange={(e) => updateAt(setActions, i, { ...a, url: e.target.value } as RuleAction)}
                          placeholder="https://hooks.slack.com/services/T0/B0/XXXX" className={inputCls + " font-mono text-[12px]"} />
                      </Field>
                    </div>
                    <Field label="Body (JSON ou texte)" hint="Templating supporté. Pour Slack/Discord, payload JSON." tooltip="Slack ex.: {&quot;text&quot;: &quot;{rule.name} sur {device.name} : {value}{unit}&quot;}">
                      <textarea value={a.body || ""} rows={4}
                        onChange={(e) => updateAt(setActions, i, { ...a, body: e.target.value } as RuleAction)}
                        placeholder={`{"text":"🚨 {rule.name} → {device.name} : {measurement} = {value}{unit}"}`}
                        className={inputCls + " font-mono text-[12px]"} />
                    </Field>
                    <HeadersEditor
                      headers={a.headers || {}}
                      onChange={(next) => updateAt(setActions, i, { ...a, headers: next } as RuleAction)}
                    />
                    <TemplateVarsHint />
                  </div>
                ) : a.type === "alarm" ? (
                  <div className="mt-3 space-y-3 rounded-lg border border-rose-300/60 dark:border-rose-700/40 bg-rose-500/5 p-3">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <Field label="Sévérité *" tooltip="Mineur = surveillance. Majeur = action recommandée. Critique = action immédiate.">
                        <select value={a.severity || "major"}
                          onChange={(e) => updateAt(setActions, i, { ...a, severity: e.target.value as "minor" | "major" | "critical" } as RuleAction)}
                          className={inputCls}>
                          <option value="minor">⚠️ Mineur</option>
                          <option value="major">🟠 Majeur</option>
                          <option value="critical">🔴 Critique</option>
                        </select>
                      </Field>
                      <Field label="Modèle" hint="Catégorie technique (Standard par défaut)">
                        <input value={a.model || "Standard"}
                          onChange={(e) => updateAt(setActions, i, { ...a, model: e.target.value } as RuleAction)}
                          className={inputCls} />
                      </Field>
                    </div>
                    <Field label="Label" tooltip="Catégorie d'alarme affichée en pastille (ex: Dépassement de seuil, Panne, Incident)">
                      <input value={a.label || ""}
                        onChange={(e) => updateAt(setActions, i, { ...a, label: e.target.value } as RuleAction)}
                        placeholder="Dépassement de seuil"
                        className={inputCls} />
                    </Field>
                    <Field label="Nom de l'alarme *" hint="Apparaît dans la liste — supporte le templating">
                      <input value={a.name}
                        onChange={(e) => updateAt(setActions, i, { ...a, name: e.target.value } as RuleAction)}
                        placeholder="ex: CO₂ élevé en {zone.name}"
                        className={inputCls} />
                    </Field>
                    <Field label="Statut" hint="Texte court visible sur la fiche détail (ex: Comportement anormal)">
                      <input value={a.status_text || ""}
                        onChange={(e) => updateAt(setActions, i, { ...a, status_text: e.target.value } as RuleAction)}
                        placeholder="Comportement anormal"
                        className={inputCls} />
                    </Field>
                    <Field label="Description" hint="Optionnel">
                      <textarea value={a.description || ""} rows={2}
                        onChange={(e) => updateAt(setActions, i, { ...a, description: e.target.value } as RuleAction)}
                        placeholder="ex: La valeur {value}{unit} dépasse le seuil {threshold}{unit} sur {device.name}"
                        className={inputCls} />
                    </Field>
                    <p className="text-[11px] text-rose-700 dark:text-rose-300 leading-snug">
                      🚨 Une entrée sera créée dans <strong>Alarmes</strong>. Si l'alarme existe déjà pour ce device, le compteur s'incrémente et un évènement est ajouté à l'historique.
                    </p>
                    <TemplateVarsHint />
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-[8rem_1fr] gap-3">
                      <Field label="Niveau" tooltip={
                        <>
                          <p><span className="font-medium">Info</span> — message d'information.</p>
                          <p className="mt-1"><span className="font-medium">Warning</span> — alerte à surveiller.</p>
                          <p className="mt-1"><span className="font-medium">Critical</span> — situation urgente nécessitant une action immédiate.</p>
                        </>
                      }>
                        <select value={a.level || "warning"}
                          onChange={(e) => updateAt(setActions, i, { ...a, level: e.target.value as any } as RuleAction)}
                          className={inputCls}>
                          <option value="info">ℹ️ Info</option>
                          <option value="warning">⚠️ Warning</option>
                          <option value="critical">🚨 Critical</option>
                        </select>
                      </Field>
                      <Field label="Message">
                        <input value={a.message}
                          onChange={(e) => updateAt(setActions, i, { ...a, message: e.target.value } as RuleAction)}
                          placeholder="ex: 🚨 {device.name} en {zone.name} : {value}{unit}" className={inputCls} />
                      </Field>
                    </div>
                    <TemplateVarsHint />
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">Ajouter :</span>
              <AddActionButton label="🔔 Notification" onClick={() => setActions([...actions, { type: "notify", level: "warning", message: "" }])} />
              <AddActionButton label="🚨 Alarme" accent="rose"
                onClick={() => setActions([...actions, { type: "alarm", severity: "major", label: "Dépassement de seuil", name: name.trim() || "{rule.name}", description: "", model: "Standard", status_text: "Comportement anormal" }])} />
              <AddActionButton label="📧 Email" onClick={() => setActions([...actions, { type: "email", recipients: [], subject: "", message: "", level: "warning" }])} />
              <AddActionButton label="📱 SMS" onClick={() => setActions([...actions, { type: "sms", recipients: [], message: "", level: "warning" }])} />
              <AddActionButton label="🔗 Webhook" onClick={() => setActions([...actions, { type: "webhook", url: "", method: "POST", headers: {}, body: "", level: "warning" }])} />
              <AddActionButton label="🔌 Actionneur" onClick={() => setActions([...actions, { type: "set_actuator", device_slug: actuators[0]?.slug || "", state: "on" }])} />
            </div>
          </Section>

          {/* Cooldown */}
          <Section title="Anti-rebond" icon={<Clock className="h-4 w-4" />}>
            <Field label="Délai minimum entre 2 déclenchements (secondes)"
              hint="Empêche la règle de se redéclencher trop vite. 0 = pas de délai"
              tooltip="Une fois la règle déclenchée, elle ne pourra pas se redéclencher pendant ce délai. Pratique pour éviter les rafales de notifications quand la valeur oscille autour d'un seuil. 300 s = 5 min.">
              <input type="number" min={0} value={cooldown} onChange={(e) => setCooldown(+e.target.value)} className={inputCls} />
            </Field>
          </Section>

          {/* Time window — créneau actif */}
          <Section title="Créneau d'activité" icon={<Clock className="h-4 w-4" />}>
            <TimeWindowEditor value={timeWindow} onChange={setTimeWindow} />
          </Section>

          {error && <div className="text-sm text-red-500 bg-red-500/10 p-2.5 rounded">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">
            Annuler
          </button>
          <button type="submit" disabled={submitting}
            className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white">
            {submitting ? "Enregistrement…" : (editing ? "Enregistrer" : "Créer la règle")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-slate-200 dark:border-slate-800 rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5">
        {icon} {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
function Field({ label, hint, tooltip, children }: {
  label: string; hint?: string; tooltip?: React.ReactNode; children: React.ReactNode;
}) {
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
function AddActionButton({ label, onClick, accent }: {
  label: string; onClick: () => void; accent?: "rose";
}) {
  return (
    <button type="button" onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition",
        accent === "rose"
          ? "border-rose-300/60 dark:border-rose-700/40 bg-rose-500/5 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10"
          : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:bg-brand-500/5 hover:text-brand-600 dark:hover:text-brand-300",
      )}>
      <Plus className="h-3 w-3" /> {label}
    </button>
  );
}

function updateAt<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number, item: T) {
  setter((arr) => arr.map((x, j) => j === i ? item : x));
}
function removeAt<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number) {
  setter((arr) => arr.filter((_, j) => j !== i));
}

// --------------------------------------------------------------------------
// RecipientList — saisie multi-valeurs (email ou téléphone) sous forme de
// pastilles. Entrée + virgule + Tab valident le destinataire.
// Quand on aura le user management, on remplacera ce composant par un
// picker de comptes utilisateurs avec un fallback "saisie libre".
// --------------------------------------------------------------------------
function RecipientList({ label, placeholder, kind, values, onChange }: {
  label: string;
  placeholder: string;
  kind: "email" | "phone";
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const Icon = kind === "email" ? Mail : MessageSquare;

  function commit() {
    const v = draft.trim();
    if (!v) return;
    if (!validate(v, kind)) return;
    if (values.includes(v)) { setDraft(""); return; }
    onChange([...values, v]);
    setDraft("");
  }

  const draftValid = draft === "" || validate(draft, kind);

  return (
    <div>
      <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        {label}
        <Help>
          {kind === "email"
            ? "Saisissez une adresse e-mail puis Entrée. Vous pouvez en ajouter plusieurs."
            : "Saisissez un numéro au format international (ex: +22670123456) puis Entrée. Vous pouvez en ajouter plusieurs."}
          <p className="mt-1 text-slate-300/80">À venir : choisir un utilisateur ZEINA dans une liste.</p>
        </Help>
      </label>
      <div className={clsx(
        "min-h-[2.5rem] rounded-md border px-2 py-1.5 flex flex-wrap gap-1.5 items-center bg-white dark:bg-slate-950",
        draftValid ? "border-slate-300 dark:border-slate-700 focus-within:border-brand-500" : "border-red-400",
      )}>
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-brand-500/10 text-brand-700 dark:text-brand-300 border border-brand-500/30">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))}
              className="hover:text-red-500" title="Retirer">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
              if (draft.trim()) {
                e.preventDefault();
                commit();
              }
            } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={values.length === 0 ? placeholder : ""}
          inputMode={kind === "phone" ? "tel" : "email"}
          className="flex-1 min-w-[8rem] bg-transparent text-sm focus:outline-none"
        />
      </div>
      {!draftValid && (
        <div className="text-[10px] text-red-500 mt-0.5">
          {kind === "email" ? "Adresse email invalide" : "Numéro invalide — utilisez le format international (+...)"}
        </div>
      )}
      {values.length === 0 && (
        <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">Au moins un destinataire requis.</div>
      )}
    </div>
  );
}

function validate(v: string, kind: "email" | "phone"): boolean {
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  // Téléphone : format international préféré, on tolère 8-15 chiffres avec + optionnel
  return /^\+?[0-9](?:[0-9 .-]{6,18}[0-9])$/.test(v);
}

// ----------------------------------------------------------------------------
// ZoneScopePicker — sélecteur (zone + measurement + device_type optionnel)
// pour les triggers à scope zone. La mesure est saisie en texte libre car on
// n'a pas la liste exhaustive des mesures du site (chaque device a son propre
// catalogue).
// ----------------------------------------------------------------------------
const COMMON_MEASUREMENTS = [
  "temperature", "humidity", "co2", "tvoc", "pm25", "pm10",
  "power", "energy", "voltage", "current", "presence", "occupancy",
  "noise", "luminosity", "battery", "water_leak", "door_open",
];

function ZoneScopePicker({ zones, value, measurement, onChange }: {
  zones: Zone[];
  value: RuleZoneScope;
  measurement: string;
  onChange: (zs: RuleZoneScope, measurement: string) => void;
}) {
  const sortedZones = useMemo(() => {
    return zones.slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [zones]);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-3 space-y-3">
      <Field label="Zone *" tooltip="Tous les devices de cette zone qui exposent la mesure choisie seront surveillés. Chaque device a son propre cooldown.">
        <select value={value.zone_id} onChange={(e) => onChange({ ...value, zone_id: e.target.value }, measurement)}
          className={inputCls}>
          <option value="">— Choisir une zone —</option>
          {sortedZones.map((z) => (
            <option key={z.id} value={z.id}>{z.name} · {z.kind}</option>
          ))}
        </select>
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Mesure surveillée *">
          <input list="zone-scope-measurements" value={measurement}
            onChange={(e) => onChange(value, e.target.value)}
            placeholder="temperature, co2, humidity…"
            className={inputCls + " font-mono text-[12px]"} />
          <datalist id="zone-scope-measurements">
            {COMMON_MEASUREMENTS.map((m) => <option key={m} value={m} />)}
          </datalist>
        </Field>
        <Field label="Filtre type d'équipement" hint="Vide = tous les devices de la zone">
          <select value={value.device_type || ""}
            onChange={(e) => onChange({ ...value, device_type: e.target.value || undefined }, measurement)}
            className={inputCls}>
            <option value="">— Tous —</option>
            <option value="environment">environment</option>
            <option value="presence">presence</option>
            <option value="actuator">actuator</option>
            <option value="linky">linky</option>
            <option value="meter">meter</option>
            <option value="gateway">gateway</option>
          </select>
        </Field>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
        ✨ La règle s'appliquera automatiquement aux nouveaux devices ajoutés dans cette zone.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// TimeWindowEditor — créneau d'activité (jours + heures + fuseau)
// ----------------------------------------------------------------------------
const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function TimeWindowEditor({ value, onChange }: {
  value?: RuleTimeWindow; onChange: (v?: RuleTimeWindow) => void;
}) {
  const enabled = !!value;
  const w = value || {};
  const days = w.days || [];

  function patch(p: Partial<RuleTimeWindow>) {
    onChange({ ...w, ...p });
  }
  function toggleDay(d: number) {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    patch({ days: next });
  }

  if (!enabled) {
    return (
      <button type="button" onClick={() => onChange({ days: [1,2,3,4,5], start_hour: 8, end_hour: 18, timezone: "Africa/Ouagadougou" })}
        className="text-xs text-brand-500 hover:text-brand-600 flex items-center gap-1">
        <Plus className="h-3 w-3" /> Définir un créneau d'activité
      </button>
    );
  }
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1.5">Jours actifs</label>
        <div className="flex flex-wrap gap-1.5">
          {DAY_LABELS.map((lab, i) => (
            <button key={i} type="button" onClick={() => toggleDay(i)}
              className={clsx(
                "px-2.5 py-1 rounded-md text-xs font-medium border transition",
                days.length === 0 || days.includes(i)
                  ? "bg-brand-500/10 text-brand-700 dark:text-brand-300 border-brand-500/40"
                  : "bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700",
              )}>
              {lab}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-slate-400 mt-0.5 block">
          {days.length === 0 ? "Aucune sélection = tous les jours." : `${days.length} jour${days.length > 1 ? "s" : ""} actif${days.length > 1 ? "s" : ""}.`}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Début (h locale)">
          <input type="number" min={0} max={24} step={0.5}
            value={w.start_hour ?? 0}
            onChange={(e) => patch({ start_hour: +e.target.value })} className={inputCls} />
        </Field>
        <Field label="Fin (h locale)" hint={(w.end_hour ?? 0) < (w.start_hour ?? 0) ? "Traverse minuit" : undefined}>
          <input type="number" min={0} max={24} step={0.5}
            value={w.end_hour ?? 0}
            onChange={(e) => patch({ end_hour: +e.target.value })} className={inputCls} />
        </Field>
        <Field label="Fuseau" tooltip="Ex: Africa/Ouagadougou, Europe/Paris. Vide = UTC.">
          <input value={w.timezone || ""}
            onChange={(e) => patch({ timezone: e.target.value })}
            placeholder="Africa/Ouagadougou" className={inputCls + " font-mono text-[12px]"} />
        </Field>
      </div>
      <button type="button" onClick={() => onChange(undefined)}
        className="text-xs text-slate-500 hover:text-red-500 flex items-center gap-1">
        <X className="h-3 w-3" /> Retirer le créneau (toujours active)
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// TemplateVarsHint — bandeau qui liste les variables {var} dispo
// ----------------------------------------------------------------------------
const TEMPLATE_VARS: { name: string; desc: string }[] = [
  { name: "{rule.name}",    desc: "Nom de la règle" },
  { name: "{device.name}",  desc: "Nom de l'équipement (sinon slug)" },
  { name: "{device.slug}",  desc: "Identifiant technique" },
  { name: "{zone.name}",    desc: "Nom de la zone" },
  { name: "{site.name}",    desc: "Nom du site" },
  { name: "{measurement}",  desc: "Mesure (ex: temperature)" },
  { name: "{value}",        desc: "Valeur courante" },
  { name: "{threshold}",    desc: "Seuil de la règle" },
  { name: "{op}",           desc: "Opérateur (>, <, ==…)" },
  { name: "{unit}",         desc: "Unité" },
  { name: "{level}",        desc: "Niveau (info/warning/critical)" },
  { name: "{timestamp}",    desc: "Date+heure du déclenchement" },
  { name: "{date}",         desc: "Date (jj/mm/aaaa)" },
  { name: "{time}",         desc: "Heure (hh:mm:ss)" },
];

function TemplateVarsHint() {
  const [open, setOpen] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  // Mémorise le dernier champ texte/textarea actif (perdu lors du clic sur le
  // chip — onMouseDown.preventDefault l'empêche normalement, mais on garde
  // une trace pour le fallback).
  const lastFocusedRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
        // Ignore les inputs system (search, etc.) — on cible les textuels.
        if (t.type === "text" || t.type === "search" || t.type === "" || t.tagName === "TEXTAREA") {
          lastFocusedRef.current = t;
        }
      }
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  function insertVar(e: React.MouseEvent, varName: string) {
    e.preventDefault(); // empêche le bouton de voler le focus
    const el =
      (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)
        ? (document.activeElement as HTMLInputElement | HTMLTextAreaElement)
        : lastFocusedRef.current;

    if (!el) {
      // Fallback : copie dans le presse-papier
      navigator.clipboard.writeText(varName).catch(() => {});
      setFeedback(`${varName} copié dans le presse-papier — collez-le dans un champ`);
      setTimeout(() => setFeedback(null), 2200);
      return;
    }

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + varName + el.value.slice(end);

    // React possède la valeur via setState — on doit utiliser le setter natif
    // + dispatcher un évènement input pour que onChange soit appelé.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      const newPos = start + varName.length;
      // Restore le curseur après la valeur insérée
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(newPos, newPos);
      });
    }
    setFeedback(`${varName} inséré`);
    setTimeout(() => setFeedback(null), 1200);
  }

  return (
    <div className="text-[11px] text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-md p-2">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 hover:text-brand-500 transition w-full">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>Variables disponibles — <span className="text-slate-400">cliquez pour insérer dans le champ texte</span></span>
        {feedback && (
          <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400">{feedback}</span>
        )}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-1">
          {TEMPLATE_VARS.map((v) => (
            <button key={v.name}
              type="button"
              onMouseDown={(e) => insertVar(e, v.name)}
              title={v.desc}
              className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-brand-500/10 hover:text-brand-700 dark:hover:text-brand-300 transition text-left group">
              <code className="font-mono text-brand-600 dark:text-brand-300 shrink-0 text-[11px]">{v.name}</code>
              <span className="truncate text-[10px] text-slate-500 dark:text-slate-400 group-hover:text-brand-600 dark:group-hover:text-brand-300">{v.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// HeadersEditor — éditeur clé/valeur pour les headers HTTP du webhook
// ----------------------------------------------------------------------------
function HeadersEditor({ headers, onChange }: {
  headers: Record<string, string>; onChange: (next: Record<string, string>) => void;
}) {
  const entries = Object.entries(headers);
  function setKV(idx: number, k: string, v: string) {
    const e = entries.slice();
    e[idx] = [k, v];
    onChange(Object.fromEntries(e.filter(([key]) => key !== "")));
  }
  function add() { onChange({ ...headers, "": "" }); }
  function remove(idx: number) {
    const e = entries.slice();
    e.splice(idx, 1);
    onChange(Object.fromEntries(e));
  }
  return (
    <div>
      <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Headers HTTP (optionnels)</label>
      <div className="space-y-1.5">
        {entries.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input value={k} onChange={(e) => setKV(i, e.target.value, v)} placeholder="Authorization"
              className={inputCls + " flex-1 font-mono text-[12px]"} />
            <span className="text-slate-400 text-xs">:</span>
            <input value={v} onChange={(e) => setKV(i, k, e.target.value)} placeholder="Bearer …"
              className={inputCls + " flex-[2] font-mono text-[12px]"} />
            <button type="button" onClick={() => remove(i)}
              className="p-1 text-slate-400 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        <button type="button" onClick={add}
          className="text-xs text-brand-500 hover:text-brand-600 flex items-center gap-1">
          <Plus className="h-3 w-3" /> Ajouter un header
        </button>
      </div>
    </div>
  );
}

// hostOf — extrait l'hôte d'une URL pour l'afficher en summary (sans tokens).
function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u || "?";
  }
}

// ----------------------------------------------------------------------------
// ExecutionsModal — historique
// ----------------------------------------------------------------------------
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
