// RuleGraphEditor — éditeur visuel de règles construit sur xyflow.
//
// Topologie supportée en V1 :
//
//     [Trigger]  →  [Condition?]  →  [Action 1, 2, 3, …]
//
//   - 1 seul Trigger (point de départ obligatoire)
//   - 0 ou 1 Condition (optionnelle ; sortie true / false)
//   - N Actions branchées soit en sortie directe du Trigger,
//     soit en sortie "true" ou "false" de la Condition
//
// Logique d'ajout par clic palette (pas de drag-drop libre — simplifie
// énormément la V1 et garantit un graph valide par construction).
//
// Sérialisation : compileGraph côté frontend produit { nodes, edges } envoyé
// au backend qui le compile en RuleDefinition pour le moteur.

import { useMemo, useState, useCallback } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  Handle, Position, useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Activity, Sparkles, Bell, Mail, MessageSquare, Webhook, ToggleRight, AlertCircle,
  Plus, Trash2, X, Check, Save, Building2,
} from "lucide-react";
import clsx from "clsx";
import { useConfirm } from "./ConfirmDialog";
import type { DeviceListItem, Zone, RuleDefinition } from "../types/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GraphNodeType =
  | "trigger"
  | "condition"
  | "action_notify"
  | "action_email"
  | "action_sms"
  | "action_alarm"
  | "action_webhook"
  | "action_actuator";

export interface GraphNodeData extends Record<string, unknown> {
  /** Libellé court affiché sur la card du nœud (auto-calculé). */
  label?: string;
}

export interface GraphDoc {
  nodes: { id: string; type: GraphNodeType; data: GraphNodeData; position?: { x: number; y: number } }[];
  edges: { id: string; source: string; target: string; sourceHandle?: string }[];
}

interface Props {
  initial?: GraphDoc;
  initialDefinition?: RuleDefinition; // legacy : reconstruction du graph depuis la définition
  devices: DeviceListItem[];
  zones: Zone[];
  onSubmit: (graph: GraphDoc) => Promise<void>;
  onCancel: () => void;
  ruleName: string;
  ruleEnabled: boolean;
  onNameChange: (n: string) => void;
  onEnabledChange: (e: boolean) => void;
}

// ---------------------------------------------------------------------------
// Métadonnées par type
// ---------------------------------------------------------------------------

const NODE_META: Record<GraphNodeType, {
  label: string;
  short: string;
  icon: typeof Activity;
  color: string; // tailwind base
  isAction: boolean;
}> = {
  trigger:         { label: "Déclencheur",     short: "Trigger",   icon: Activity,       color: "violet",   isAction: false },
  condition:       { label: "Condition",       short: "Condition", icon: Sparkles,       color: "amber",    isAction: false },
  action_notify:   { label: "Notification",    short: "Notif",     icon: Bell,           color: "sky",      isAction: true  },
  action_email:    { label: "Envoyer un email", short: "Email",     icon: Mail,           color: "blue",     isAction: true  },
  action_sms:      { label: "Envoyer un SMS",  short: "SMS",       icon: MessageSquare,  color: "indigo",   isAction: true  },
  action_alarm:    { label: "Créer une alarme", short: "Alarme",    icon: AlertCircle,    color: "red",      isAction: true  },
  action_webhook:  { label: "Webhook",         short: "Webhook",   icon: Webhook,        color: "teal",     isAction: true  },
  action_actuator: { label: "Actionneur",      short: "Actionneur",icon: ToggleRight,    color: "emerald",  isAction: true  },
};

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export function RuleGraphEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <RuleGraphEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function RuleGraphEditorInner({
  initial, initialDefinition, devices, zones, onSubmit, onCancel,
  ruleName, ruleEnabled, onNameChange, onEnabledChange,
}: Props) {
  const confirm = useConfirm();

  // Construit le graph initial depuis la prop ou depuis une RuleDefinition legacy.
  const seeded = useMemo<GraphDoc>(() => {
    if (initial && initial.nodes.length > 0) return initial;
    if (initialDefinition) return graphFromDefinition(initialDefinition);
    return defaultGraph(devices);
  }, [initial, initialDefinition, devices]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>(
    seeded.nodes.map((n, i) => ({
      id: n.id,
      type: "zeinaBlock",
      data: { ...n.data, _kind: n.type },
      position: n.position || { x: 100 + i * 240, y: 120 + (i % 2) * 80 },
    })),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    seeded.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle,
      animated: true, style: { stroke: "#94a3b8", strokeWidth: 2 },
    })),
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedNode = nodes.find((n) => n.id === selectedId);

  // Helpers d'ajout / suppression de nodes
  const addBlock = useCallback((type: GraphNodeType) => {
    setError(null);
    const id = newID(type);
    const triggerNode = nodes.find((n) => (n.data as any)._kind === "trigger");
    const conditionNode = nodes.find((n) => (n.data as any)._kind === "condition");
    let position = { x: 200, y: 200 };
    let parentId: string | null = null;
    let sourceHandle: string | undefined;

    if (type === "trigger") {
      if (triggerNode) {
        setError("Une règle ne peut avoir qu'un seul bloc Déclencheur.");
        return;
      }
      position = { x: 80, y: 200 };
    } else if (type === "condition") {
      if (!triggerNode) {
        setError("Ajoute d'abord un bloc Déclencheur avant la Condition.");
        return;
      }
      if (conditionNode) {
        setError("Une règle ne peut avoir qu'un seul bloc Condition.");
        return;
      }
      parentId = triggerNode.id;
      position = { x: triggerNode.position.x + 280, y: triggerNode.position.y };
    } else {
      // Actions : se branchent sur la condition (true) si elle existe, sinon sur le trigger.
      const parent = conditionNode || triggerNode;
      if (!parent) {
        setError("Ajoute d'abord un bloc Déclencheur avant les actions.");
        return;
      }
      parentId = parent.id;
      sourceHandle = conditionNode ? "true" : undefined;
      // Empile les actions sur l'axe Y
      const actionCount = nodes.filter((n) => NODE_META[(n.data as any)._kind as GraphNodeType]?.isAction).length;
      position = {
        x: parent.position.x + 280,
        y: parent.position.y + (actionCount * 110) - 50,
      };
    }

    setNodes((nds) => [
      ...nds,
      {
        id, type: "zeinaBlock",
        data: defaultDataFor(type, devices),
        position,
      },
    ]);

    if (parentId) {
      setEdges((eds) => [
        ...eds,
        {
          id: `${parentId}->${id}${sourceHandle ? "_" + sourceHandle : ""}`,
          source: parentId, target: id,
          sourceHandle,
          animated: true,
          style: { stroke: sourceHandle === "false" ? "#ef4444" : "#94a3b8", strokeWidth: 2 },
        },
      ]);
    }
    setSelectedId(id);
  }, [nodes, devices, setNodes, setEdges]);

  const removeNode = useCallback(async (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const kind = (node.data as any)._kind as GraphNodeType;
    const ok = await confirm({
      title: `Supprimer le bloc « ${NODE_META[kind].label} » ?`,
      description: <>Le bloc et toutes ses connexions seront retirés.</>,
      danger: true,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
  }, [nodes, confirm, setNodes, setEdges]);

  const updateNodeData = useCallback((id: string, patch: Partial<GraphNodeData>) => {
    setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
  }, [setNodes]);

  // Toggle de la branche d'une edge (true ↔ false) — pour rebrancher une action
  // sur l'autre sortie de la condition.
  const toggleEdgeBranch = useCallback((edgeId: string) => {
    setEdges((eds) => eds.map((e) => {
      if (e.id !== edgeId) return e;
      const newHandle = e.sourceHandle === "false" ? "true" : "false";
      return {
        ...e,
        sourceHandle: newHandle,
        style: { stroke: newHandle === "false" ? "#ef4444" : "#94a3b8", strokeWidth: 2 },
      };
    }));
  }, [setEdges]);

  // Validation
  const validation = useMemo(() => {
    const errs: string[] = [];
    const hasTrigger = nodes.some((n) => (n.data as any)._kind === "trigger");
    const actions = nodes.filter((n) => NODE_META[(n.data as any)._kind as GraphNodeType]?.isAction);
    if (!hasTrigger) errs.push("Aucun bloc Déclencheur — toute règle doit avoir un point de départ.");
    if (actions.length === 0) errs.push("Aucune action — connectez au moins une action en sortie.");
    if (!ruleName.trim()) errs.push("Le nom de la règle est manquant.");
    // Bloc déconnecté
    const reachable = new Set<string>();
    const trig = nodes.find((n) => (n.data as any)._kind === "trigger");
    if (trig) {
      const queue = [trig.id];
      while (queue.length) {
        const cur = queue.shift()!;
        reachable.add(cur);
        for (const e of edges) if (e.source === cur && !reachable.has(e.target)) queue.push(e.target);
      }
    }
    for (const n of nodes) {
      if (!reachable.has(n.id)) {
        const kind = (n.data as any)._kind as GraphNodeType;
        errs.push(`Le bloc « ${NODE_META[kind]?.label || kind} » n'est pas connecté.`);
      }
    }
    return errs;
  }, [nodes, edges, ruleName]);

  // Save
  async function save() {
    if (validation.length > 0) {
      setError(validation[0]);
      return;
    }
    const graph = serializeGraph(nodes, edges);
    setSubmitting(true); setError(null);
    try {
      await onSubmit(graph);
    } catch (e: any) {
      setError(e?.payload?.message || e?.message || "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-950 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button onClick={onCancel}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
          <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Identification</span>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500 dark:text-slate-400">STATUT</span>
            <button onClick={() => onEnabledChange(!ruleEnabled)}
              className={clsx(
                "relative inline-flex h-5 w-9 items-center rounded-full transition",
                ruleEnabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700",
              )}>
              <span className={clsx(
                "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition",
                ruleEnabled ? "translate-x-5" : "translate-x-1",
              )} />
            </button>
            <span className={ruleEnabled ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-400"}>
              {ruleEnabled ? "Active" : "Inactive"}
            </span>
          </label>
          <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-3">Nom *</span>
          <input value={ruleName} onChange={(e) => onNameChange(e.target.value)}
            placeholder="ex: Alerte CO2 trop élevé"
            className="flex-1 max-w-md rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            Annuler
          </button>
          <button onClick={save} disabled={submitting || validation.length > 0}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-md bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> {submitting ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Palette */}
        <aside className="w-56 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 overflow-y-auto">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-2">
            Blocs
          </div>
          <div className="space-y-1.5">
            {(["trigger", "condition"] as GraphNodeType[]).map((t) => (
              <PaletteButton key={t} type={t} onAdd={addBlock} />
            ))}
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mt-3 mb-1.5">Actions</div>
            {(["action_notify", "action_email", "action_sms", "action_alarm", "action_webhook", "action_actuator"] as GraphNodeType[]).map((t) => (
              <PaletteButton key={t} type={t} onAdd={addBlock} />
            ))}
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1 relative min-w-0">
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            onEdgeClick={(_, e) => { if (e.sourceHandle) toggleEdgeBranch(e.id); }}
            nodeTypes={NODE_TYPES}
            fitView fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.4} maxZoom={1.5}
          >
            <Background gap={16} color="#cbd5e1" />
            <Controls position="top-right" />
            <MiniMap pannable zoomable position="bottom-right"
              nodeColor={(n) => {
                const k = (n.data as any)._kind as GraphNodeType;
                return tailwindToHex(NODE_META[k]?.color || "slate");
              }} />
          </ReactFlow>

          {/* Bandeau erreurs */}
          {validation.length > 0 && (
            <div className="absolute top-3 left-3 right-3 max-w-md bg-amber-500/15 border border-amber-500/40 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-200">
              <div className="font-medium flex items-center gap-1.5 mb-1">
                <AlertCircle className="h-4 w-4" /> La règle est invalide
              </div>
              <ul className="text-xs list-disc list-inside space-y-0.5">
                {validation.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}
                {validation.length > 3 && <li className="italic">… et {validation.length - 3} autre(s)</li>}
              </ul>
            </div>
          )}
        </div>

        {/* Panneau config */}
        {selectedNode ? (
          <ConfigPanel
            node={selectedNode}
            devices={devices}
            zones={zones}
            onChange={(patch) => updateNodeData(selectedNode.id, patch)}
            onDelete={() => removeNode(selectedNode.id)}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <aside className="w-80 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-sm text-slate-500 dark:text-slate-400">
            <div className="text-[11px] uppercase tracking-wider font-semibold mb-2">Configuration</div>
            <p>Sélectionnez un bloc pour le configurer, ou ajoutez-en un depuis la palette à gauche.</p>
            <div className="mt-4 text-xs space-y-1">
              <p className="font-medium text-slate-700 dark:text-slate-300">Astuce</p>
              <p>Cliquez sur une flèche entre un Condition et une action pour basculer entre la branche <span className="text-emerald-600">vrai</span> et la branche <span className="text-red-500">faux</span>.</p>
            </div>
          </aside>
        )}
      </div>

      {error && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-md bg-red-500/15 border border-red-500/40 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

function PaletteButton({ type, onAdd }: { type: GraphNodeType; onAdd: (t: GraphNodeType) => void }) {
  const m = NODE_META[type];
  const Icon = m.icon;
  return (
    <button onClick={() => onAdd(type)}
      className={clsx(
        "w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm border transition",
        "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950",
        "hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-brand-300",
      )}>
      <span className={clsx("rounded p-1", colorBg(m.color))}>
        <Icon className={clsx("h-3.5 w-3.5", colorText(m.color))} />
      </span>
      <span className="flex-1 text-left text-slate-700 dark:text-slate-200">{m.label}</span>
      <Plus className="h-3 w-3 text-slate-400" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Custom node : ZeinaBlock
// ---------------------------------------------------------------------------

const NODE_TYPES = { zeinaBlock: ZeinaBlock };

function ZeinaBlock({ data, selected }: NodeProps<Node<GraphNodeData & { _kind?: GraphNodeType }>>) {
  const kind = data._kind as GraphNodeType;
  const m = NODE_META[kind];
  if (!m) return null;
  const Icon = m.icon;
  const summary = summarizeNode(kind, data);

  const isCondition = kind === "condition";
  const isAction = m.isAction;

  return (
    <div className={clsx(
      "rounded-xl border-2 bg-white dark:bg-slate-900 shadow-sm min-w-[200px] max-w-[260px] transition",
      selected
        ? `border-${m.color}-500 ring-2 ring-${m.color}-200 dark:ring-${m.color}-900/40`
        : "border-slate-200 dark:border-slate-800",
    )}>
      {/* Handle entrée (sauf trigger qui n'a pas de parent) */}
      {kind !== "trigger" && (
        <Handle type="target" position={Position.Left} className="!bg-slate-400 !border-0 !w-2 !h-2" />
      )}

      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <span className={clsx("rounded p-1.5", colorBg(m.color))}>
          <Icon className={clsx("h-3.5 w-3.5", colorText(m.color))} />
        </span>
        <span className={clsx("text-[11px] uppercase tracking-wider font-semibold", colorText(m.color))}>
          {m.short}
        </span>
      </div>
      <div className="px-3 py-2 text-xs text-slate-700 dark:text-slate-200 break-words">
        {summary}
      </div>

      {/* Handles sortie : pour Condition, 2 handles (true/false) ; sinon 1 */}
      {isCondition ? (
        <>
          <Handle id="true" type="source" position={Position.Right}
            style={{ top: "35%", background: "#10b981", border: 0, width: 10, height: 10 }} />
          <Handle id="false" type="source" position={Position.Right}
            style={{ top: "70%", background: "#ef4444", border: 0, width: 10, height: 10 }} />
          <div className="absolute right-1 top-[28%] text-[9px] font-semibold text-emerald-600">✓</div>
          <div className="absolute right-1 top-[63%] text-[9px] font-semibold text-red-500">✗</div>
        </>
      ) : !isAction ? (
        <Handle type="source" position={Position.Right} className="!bg-slate-400 !border-0 !w-2 !h-2" />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panneau config : édition des champs du bloc sélectionné
// ---------------------------------------------------------------------------

function ConfigPanel({
  node, devices, zones, onChange, onDelete, onClose,
}: {
  node: Node<GraphNodeData>;
  devices: DeviceListItem[];
  zones: Zone[];
  onChange: (patch: Partial<GraphNodeData>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const kind = (node.data as any)._kind as GraphNodeType;
  const m = NODE_META[kind];
  const Icon = m.icon;
  const data = node.data as any;

  return (
    <aside className="w-80 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className={clsx("rounded p-1.5", colorBg(m.color))}>
            <Icon className={clsx("h-3.5 w-3.5", colorText(m.color))} />
          </span>
          <span className="text-sm font-medium truncate">{m.label}</span>
        </div>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
        {kind === "trigger" && <TriggerForm data={data} devices={devices} zones={zones} onChange={onChange} />}
        {kind === "condition" && <ConditionForm data={data} devices={devices} onChange={onChange} />}
        {kind === "action_notify" && <NotifyForm data={data} onChange={onChange} />}
        {kind === "action_email" && <EmailForm data={data} onChange={onChange} />}
        {kind === "action_sms" && <SmsForm data={data} onChange={onChange} />}
        {kind === "action_alarm" && <AlarmForm data={data} onChange={onChange} />}
        {kind === "action_webhook" && <WebhookForm data={data} onChange={onChange} />}
        {kind === "action_actuator" && <ActuatorForm data={data} devices={devices} onChange={onChange} />}
      </div>

      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800">
        <button onClick={onDelete}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-md text-red-600 dark:text-red-400 hover:bg-red-500/10 border border-red-500/30">
          <Trash2 className="h-3.5 w-3.5" /> Supprimer ce bloc
        </button>
      </div>
    </aside>
  );
}

// --- Forms par type --------------------------------------------------------

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-400 mt-0.5 block">{hint}</span>}
    </label>
  );
}

function TriggerForm({ data, devices, zones, onChange }: any) {
  const triggerType = data.type || "threshold";
  return (
    <>
      <Field label="Type">
        <select value={triggerType} onChange={(e) => onChange({ type: e.target.value })} className={inputCls}>
          <option value="threshold">📈 Seuil sur une mesure</option>
          <option value="cron">⏰ Heure programmée</option>
        </select>
      </Field>
      {triggerType === "threshold" && (
        <>
          <Field label="Équipement">
            <select value={data.device_slug || ""} onChange={(e) => onChange({ device_slug: e.target.value })} className={inputCls}>
              <option value="">— Choisir —</option>
              {devices.map((d: DeviceListItem) => (
                <option key={d.id} value={d.slug}>{d.name || d.slug}{d.zone_name && ` (${d.zone_name})`}</option>
              ))}
            </select>
          </Field>
          <Field label="Mesure">
            <input value={data.measurement || ""} onChange={(e) => onChange({ measurement: e.target.value })}
              placeholder="ex: temperature" className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Opérateur">
              <select value={data.op || ">"} onChange={(e) => onChange({ op: e.target.value })} className={inputCls}>
                {[">", ">=", "<", "<=", "==", "!="].map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Valeur">
              <input type="number" value={data.value ?? 0} onChange={(e) => onChange({ value: +e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Soutenu (s)" hint="Durée minimum au-dessus du seuil avant déclenchement. 0 = immédiat.">
            <input type="number" min={0} value={data.sustained_seconds ?? 0}
              onChange={(e) => onChange({ sustained_seconds: +e.target.value })} className={inputCls} />
          </Field>
        </>
      )}
      {triggerType === "cron" && (
        <Field label="Expression cron" hint="Format : 'm h jm M js' — ex: '0 18 * * 1-5' = à 18h en semaine">
          <input value={data.schedule || ""} onChange={(e) => onChange({ schedule: e.target.value })}
            placeholder="0 18 * * 1-5" className={`${inputCls} font-mono`} />
        </Field>
      )}
      <Field label="Mode de déclenchement"
        hint="Edge = 1 fois par incident (auto-résolu au retour normal). Level = répète tant que vrai.">
        <select value={data.retrigger_mode || "edge"} onChange={(e) => onChange({ retrigger_mode: e.target.value })} className={inputCls}>
          <option value="edge">🎯 Une fois par incident (recommandé)</option>
          <option value="level">🔁 Déclencher en boucle</option>
        </select>
      </Field>
      {data.retrigger_mode === "level" && (
        <Field label="Délai entre 2 déclenchements (secondes)">
          <input type="number" min={0} value={data.cooldown_seconds ?? 300}
            onChange={(e) => onChange({ cooldown_seconds: +e.target.value })} className={inputCls} />
        </Field>
      )}
      {/* zones unused here mais maintient la signature */}
      {void zones}
    </>
  );
}

function ConditionForm({ data, devices, onChange }: any) {
  const conditions: any[] = data.conditions || [];
  const op = data.conditions_op || "AND";
  function setConds(next: any[]) { onChange({ conditions: next }); }
  return (
    <>
      <Field label="Opérateur entre conditions">
        <select value={op} onChange={(e) => onChange({ conditions_op: e.target.value })} className={inputCls}>
          <option value="AND">Toutes vraies (AND)</option>
          <option value="OR">Au moins une vraie (OR)</option>
        </select>
      </Field>
      {conditions.map((c, i) => (
        <div key={i} className="rounded-md bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 p-2 space-y-2">
          <div className="flex items-center gap-2">
            <select value={c.device_slug || ""} onChange={(e) => setConds(conditions.map((x, j) => j === i ? { ...x, device_slug: e.target.value } : x))} className="flex-1 text-xs rounded bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-2 py-1">
              <option value="">Équipement…</option>
              {devices.map((d: DeviceListItem) => <option key={d.id} value={d.slug}>{d.name || d.slug}</option>)}
            </select>
            <button onClick={() => setConds(conditions.filter((_, j) => j !== i))}
              className="p-1 text-red-500 hover:bg-red-500/10 rounded"><Trash2 className="h-3 w-3" /></button>
          </div>
          <div className="flex gap-1.5">
            <input value={c.measurement || ""} onChange={(e) => setConds(conditions.map((x, j) => j === i ? { ...x, measurement: e.target.value } : x))}
              placeholder="mesure" className="flex-1 text-xs rounded bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-2 py-1" />
            <select value={c.op || "=="} onChange={(e) => setConds(conditions.map((x, j) => j === i ? { ...x, op: e.target.value } : x))}
              className="text-xs rounded bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-1 py-1">
              {[">", ">=", "<", "<=", "==", "!="].map((o) => <option key={o}>{o}</option>)}
            </select>
            <input type="number" value={c.value ?? 0} onChange={(e) => setConds(conditions.map((x, j) => j === i ? { ...x, value: +e.target.value } : x))}
              className="w-16 text-xs rounded bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-2 py-1" />
          </div>
        </div>
      ))}
      <button onClick={() => setConds([...conditions, { device_slug: "", measurement: "", op: ">", value: 0 }])}
        className="w-full text-xs px-2 py-1.5 rounded border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
        <Plus className="inline h-3 w-3 mr-1" /> Ajouter une condition
      </button>
    </>
  );
}

function NotifyForm({ data, onChange }: any) {
  return (
    <>
      <Field label="Niveau">
        <select value={data.level || "warning"} onChange={(e) => onChange({ level: e.target.value })} className={inputCls}>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </Field>
      <Field label="Message">
        <textarea value={data.message || ""} onChange={(e) => onChange({ message: e.target.value })}
          rows={3} className={inputCls} placeholder="Variables : {device.name}, {value}, {threshold}…" />
      </Field>
    </>
  );
}

function EmailForm({ data, onChange }: any) {
  return (
    <>
      <Field label="Destinataires" hint="Séparés par des virgules">
        <input value={(data.recipients || []).join(", ")} onChange={(e) => onChange({ recipients: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          placeholder="alerts@example.com" className={inputCls} />
      </Field>
      <Field label="Objet">
        <input value={data.subject || ""} onChange={(e) => onChange({ subject: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Message">
        <textarea value={data.message || ""} onChange={(e) => onChange({ message: e.target.value })}
          rows={4} className={inputCls} placeholder="Variables : {device.name}, {value}, {unit}…" />
      </Field>
    </>
  );
}

function SmsForm({ data, onChange }: any) {
  return (
    <>
      <Field label="Numéros" hint="Format international, séparés par virgules">
        <input value={(data.recipients || []).join(", ")} onChange={(e) => onChange({ recipients: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          placeholder="+33612345678" className={inputCls} />
      </Field>
      <Field label="Message">
        <textarea value={data.message || ""} onChange={(e) => onChange({ message: e.target.value })} rows={3} maxLength={160} className={inputCls} />
      </Field>
    </>
  );
}

function AlarmForm({ data, onChange }: any) {
  return (
    <>
      <Field label="Sévérité">
        <select value={data.severity || "major"} onChange={(e) => onChange({ severity: e.target.value })} className={inputCls}>
          <option value="minor">Mineur</option>
          <option value="major">Majeur</option>
          <option value="critical">Critique</option>
        </select>
      </Field>
      <Field label="Label">
        <input value={data.label || ""} onChange={(e) => onChange({ label: e.target.value })}
          placeholder="ex: Dépassement de seuil" className={inputCls} />
      </Field>
      <Field label="Nom de l'alarme">
        <input value={data.name || ""} onChange={(e) => onChange({ name: e.target.value })}
          placeholder="ex: {rule.name}" className={inputCls} />
      </Field>
      <Field label="Description">
        <textarea value={data.description || ""} onChange={(e) => onChange({ description: e.target.value })} rows={3} className={inputCls} />
      </Field>
    </>
  );
}

function WebhookForm({ data, onChange }: any) {
  return (
    <>
      <Field label="URL">
        <input value={data.url || ""} onChange={(e) => onChange({ url: e.target.value })}
          placeholder="https://hooks.example.com/…" className={inputCls} />
      </Field>
      <Field label="Méthode">
        <select value={data.method || "POST"} onChange={(e) => onChange({ method: e.target.value })} className={inputCls}>
          {["POST", "PUT", "PATCH", "GET"].map((m) => <option key={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="Body JSON">
        <textarea value={data.body || ""} onChange={(e) => onChange({ body: e.target.value })}
          rows={4} className={`${inputCls} font-mono text-xs`} />
      </Field>
    </>
  );
}

function ActuatorForm({ data, devices, onChange }: any) {
  const actuators = devices.filter((d: DeviceListItem) => d.type === "actuator");
  return (
    <>
      <Field label="Actionneur">
        <select value={data.device_slug || ""} onChange={(e) => onChange({ device_slug: e.target.value })} className={inputCls}>
          <option value="">— Choisir —</option>
          {actuators.map((d: DeviceListItem) => <option key={d.id} value={d.slug}>{d.name || d.slug}</option>)}
        </select>
      </Field>
      <Field label="État">
        <select value={data.state || "on"} onChange={(e) => onChange({ state: e.target.value })} className={inputCls}>
          <option value="on">Allumer (on)</option>
          <option value="off">Éteindre (off)</option>
          <option value="toggle">Basculer (toggle)</option>
        </select>
      </Field>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers de rendu
// ---------------------------------------------------------------------------

function summarizeNode(kind: GraphNodeType, data: any): React.ReactNode {
  switch (kind) {
    case "trigger":
      if (data.type === "cron") return data.schedule ? <span className="font-mono text-[11px]">{data.schedule}</span> : <span className="text-slate-400">Heure programmée</span>;
      return data.device_slug && data.measurement
        ? <>{data.device_slug}.{data.measurement} <strong>{data.op}</strong> {data.value}</>
        : <span className="text-slate-400">Configurer le seuil…</span>;
    case "condition":
      return (data.conditions || []).length > 0
        ? `${(data.conditions || []).length} condition(s) (${data.conditions_op || "AND"})`
        : <span className="text-slate-400">Configurer…</span>;
    case "action_notify":
      return data.message || <span className="text-slate-400">Message…</span>;
    case "action_email":
      return data.recipients?.length ? `→ ${data.recipients.join(", ")}` : <span className="text-slate-400">Destinataires…</span>;
    case "action_sms":
      return data.recipients?.length ? `→ ${data.recipients.join(", ")}` : <span className="text-slate-400">Numéros…</span>;
    case "action_alarm":
      return data.label || <span className="text-slate-400">Alarme…</span>;
    case "action_webhook":
      return data.url || <span className="text-slate-400">URL…</span>;
    case "action_actuator":
      return data.device_slug ? `${data.device_slug} → ${data.state || "on"}` : <span className="text-slate-400">Actionneur…</span>;
  }
}

function defaultDataFor(type: GraphNodeType, devices: DeviceListItem[]): GraphNodeData & { _kind: GraphNodeType } {
  const base: any = { _kind: type };
  switch (type) {
    case "trigger":
      return { ...base, type: "threshold", device_slug: devices[0]?.slug || "", measurement: "temperature", op: ">", value: 25, retrigger_mode: "edge", cooldown_seconds: 300 };
    case "condition":
      return { ...base, conditions_op: "AND", conditions: [] };
    case "action_notify":
      return { ...base, level: "warning", message: "Seuil dépassé sur {device.name}" };
    case "action_email":
      return { ...base, recipients: [], subject: "Alerte ZEINA", message: "L'équipement {device.name} a dépassé le seuil ({value} {unit})." };
    case "action_sms":
      return { ...base, recipients: [], message: "Alerte {device.name} : {value} {unit}" };
    case "action_alarm":
      return { ...base, severity: "major", label: "Dépassement de seuil", name: "{rule.name}", description: "" };
    case "action_webhook":
      return { ...base, url: "", method: "POST", body: "", headers: {} };
    case "action_actuator":
      return { ...base, device_slug: devices.find((d) => d.type === "actuator")?.slug || "", state: "on" };
  }
}

function newID(type: GraphNodeType): string {
  return `${type}_${Math.random().toString(36).slice(2, 8)}`;
}

function colorBg(c: string): string {
  return `bg-${c}-500/10`;
}
function colorText(c: string): string {
  return `text-${c}-600 dark:text-${c}-400`;
}
function tailwindToHex(c: string): string {
  const m: Record<string, string> = {
    violet: "#8b5cf6", amber: "#f59e0b", sky: "#0ea5e9", blue: "#3b82f6",
    indigo: "#6366f1", red: "#ef4444", teal: "#14b8a6", emerald: "#10b981", slate: "#94a3b8",
  };
  return m[c] || "#94a3b8";
}

// ---------------------------------------------------------------------------
// Sérialisation graph ↔ definition legacy
// ---------------------------------------------------------------------------

function serializeGraph(nodes: Node<GraphNodeData>[], edges: Edge[]): GraphDoc {
  return {
    nodes: nodes.map((n) => {
      const { _kind, ...clean } = n.data as any;
      return {
        id: n.id,
        type: _kind,
        data: clean,
        position: { x: n.position.x, y: n.position.y },
      };
    }),
    edges: edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle || undefined,
    })),
  };
}

function defaultGraph(devices: DeviceListItem[]): GraphDoc {
  const triggerID = newID("trigger");
  return {
    nodes: [
      { id: triggerID, type: "trigger", data: defaultDataFor("trigger", devices), position: { x: 80, y: 200 } },
    ],
    edges: [],
  };
}

// graphFromDefinition — reconstruit un graph approximatif depuis une
// RuleDefinition legacy. Permet d'ouvrir des règles V0 dans l'éditeur visuel.
function graphFromDefinition(def: RuleDefinition): GraphDoc {
  const triggerID = newID("trigger");
  const conditionID = (def.conditions && def.conditions.length > 0) ? newID("condition") : null;
  const nodes: GraphDoc["nodes"] = [
    { id: triggerID, type: "trigger",
      data: { ...(def.trigger as any), retrigger_mode: def.retrigger_mode, cooldown_seconds: def.cooldown_seconds },
      position: { x: 80, y: 200 } },
  ];
  const edges: GraphDoc["edges"] = [];
  if (conditionID) {
    nodes.push({ id: conditionID, type: "condition",
      data: { conditions_op: def.conditions_op, conditions: def.conditions },
      position: { x: 360, y: 200 } });
    edges.push({ id: `${triggerID}->${conditionID}`, source: triggerID, target: conditionID });
  }
  const parentID = conditionID || triggerID;
  (def.actions || []).forEach((a, i) => {
    const t = `action_${a.type === "set_actuator" ? "actuator" : a.type}` as GraphNodeType;
    if (!NODE_META[t]) return;
    const id = newID(t);
    nodes.push({ id, type: t, data: { ...a } as any, position: { x: parentID === triggerID ? 360 : 640, y: 60 + i * 130 } });
    edges.push({
      id: `${parentID}->${id}`, source: parentID, target: id,
      sourceHandle: conditionID ? ((a as any).branch || "true") : undefined,
    });
  });
  return { nodes, edges };
}

// Empty Building2 import use to keep the icon imported (silence linter)
void Building2; void Check;
