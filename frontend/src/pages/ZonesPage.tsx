import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronDown, ChevronRight, Plus, Pencil, Trash2, X, Search, Map as MapIcon, List, Pen, Save, Loader2,
  Globe2, Building2, Building, Layers, DoorOpen, MoreVertical, Cpu,
  Thermometer, Activity, Lightbulb, Zap, Gauge,
} from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../lib/api";
import { useCanWrite } from "../lib/auth";
import { Help } from "../components/Tooltip";
import { CreateDeviceModal } from "../components/CreateDeviceModal";
import type { DeviceListItem, DeviceType, Site, Zone, ZoneKind } from "../types/api";

// Mapping device.type → icône + accent. Aligné avec DevicesPage.
const DEVICE_TYPE_META: Record<DeviceType, { icon: typeof Cpu; accent: string }> = {
  environment: { icon: Thermometer, accent: "text-emerald-600 dark:text-emerald-300 bg-emerald-500/10" },
  presence:    { icon: Activity,    accent: "text-violet-600 dark:text-violet-300 bg-violet-500/10" },
  actuator:    { icon: Lightbulb,   accent: "text-amber-600 dark:text-amber-300 bg-amber-500/10" },
  linky:       { icon: Zap,         accent: "text-yellow-600 dark:text-yellow-300 bg-yellow-500/10" },
  meter:       { icon: Gauge,       accent: "text-sky-600 dark:text-sky-300 bg-sky-500/10" },
  gateway:     { icon: Cpu,         accent: "text-slate-600 dark:text-slate-300 bg-slate-500/10" },
};

const DEVICE_STATUS_DOT: Record<string, string> = {
  online:      "bg-emerald-500",
  offline:     "bg-slate-400 dark:bg-slate-600",
  disabled:    "bg-red-500",
  provisioned: "bg-amber-500",
};

// Lazy-load la carte — Leaflet pèse ~150 kB, on évite de payer le coût
// quand l'utilisateur reste en vue Liste.
const SiteMap = lazy(() => import("../components/SiteMap").then((m) => ({ default: m.SiteMap })));

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";

// ---------------------------------------------------------------------------
// Métadonnées d'affichage par type de zone — icône + couleur d'accent +
// libellé court FR + description.
// ---------------------------------------------------------------------------
const KIND_META: Record<ZoneKind, { label: string; description: string; icon: typeof Building2; accent: string }> = {
  geographic:     { label: "Zone géographique", description: "Site, école, parc, campus…", icon: Globe2,    accent: "text-emerald-600 dark:text-emerald-300 bg-emerald-500/10" },
  building_group: { label: "Groupe de bâtiments", description: "Aile, secteur, regroupement",  icon: Building2, accent: "text-violet-600 dark:text-violet-300 bg-violet-500/10" },
  building:       { label: "Bâtiment",          description: "Bâtiment unique",                 icon: Building,  accent: "text-sky-600 dark:text-sky-300 bg-sky-500/10" },
  floor:          { label: "Étage",             description: "Niveau dans un bâtiment",         icon: Layers,    accent: "text-amber-600 dark:text-amber-300 bg-amber-500/10" },
  room:           { label: "Pièce",             description: "Pièce, salle, atelier",           icon: DoorOpen,  accent: "text-orange-600 dark:text-orange-300 bg-orange-500/10" },
};

const KIND_ORDER: ZoneKind[] = ["geographic", "building_group", "building", "floor", "room"];

// ---------------------------------------------------------------------------
// Règles de containment — synchronisées avec services/api/internal/handlers/
// zones.go (allowedParents). `null` représente la racine du site.
//
//   geographic     : root uniquement
//   building_group : dans geographic
//   building       : dans geographic ou building_group
//   floor          : dans building uniquement
//   room           : partout sauf dans une autre room
// ---------------------------------------------------------------------------
const ALLOWED_PARENTS: Record<ZoneKind, (ZoneKind | null)[]> = {
  geographic:     [null],
  building_group: ["geographic"],
  building:       ["geographic", "building_group"],
  floor:          ["building"],
  room:           ["geographic", "building_group", "building", "floor"],
};

function canHaveAsParent(child: ZoneKind, parent: ZoneKind | null): boolean {
  return ALLOWED_PARENTS[child].includes(parent);
}

/** Liste des kinds qui peuvent être créés sous un parent donné (ou racine). */
function kindsAllowedUnder(parent: ZoneKind | null): ZoneKind[] {
  return KIND_ORDER.filter((k) => canHaveAsParent(k, parent));
}

// ---------------------------------------------------------------------------
// Page principale
// ---------------------------------------------------------------------------
export function ZonesPage() {
  const { id: siteId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canWrite = useCanWrite("devices"); // RBAC : la gestion de zones suit devices
  const [zones, setZones] = useState<Zone[]>([]);
  const [site, setSite] = useState<Site | null>(null);
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const [creating, setCreating] = useState<{ kind: ZoneKind; parent?: Zone | null } | null>(null);
  const [editing, setEditing] = useState<Zone | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // Édition de la géométrie d'une zone existante via tracé carte.
  const [drawingZoneID, setDrawingZoneID] = useState<string | null>(null);
  const [pendingGeometry, setPendingGeometry] = useState<object | null>(null);
  const [savingGeometry, setSavingGeometry] = useState(false);

  // Création d'une nouvelle zone *par tracé carte* — on dessine d'abord, puis
  // on ouvre le formulaire pré-rempli avec la géométrie.
  const [mapAddKind, setMapAddKind] = useState<ZoneKind | null>(null);
  const [mapAddGeometry, setMapAddGeometry] = useState<object | null>(null);

  // Création d'un équipement directement depuis l'arbre — la zone cible est
  // pré-sélectionnée dans le modal de provisioning.
  const [addingDeviceInZone, setAddingDeviceInZone] = useState<Zone | null>(null);

  const reload = () => {
    if (!siteId) return;
    setLoading(true);
    Promise.all([
      api.get<Zone[]>(`/v1/sites/${siteId}/zones`),
      api.get<Site>(`/v1/sites/${siteId}`),
      api.get<DeviceListItem[]>(`/v1/sites/${siteId}/devices`).catch(() => []),
    ])
      .then(([z, s, d]) => { setZones(z); setSite(s); setDevices(d); })
      .catch((e) => setError(e instanceof HttpError ? e.payload.message : String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [siteId]);

  async function saveDrawnGeometry() {
    if (!drawingZoneID || !pendingGeometry) return;
    setSavingGeometry(true);
    try {
      await api.put(`/v1/zones/${drawingZoneID}`, { geometry: pendingGeometry });
      setDrawingZoneID(null);
      setPendingGeometry(null);
      reload();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    } finally {
      setSavingGeometry(false);
    }
  }

  const drawingZone = drawingZoneID ? zones.find((z) => z.id === drawingZoneID) : null;

  // Set des kinds déjà présents — sert à griser les options du menu "+ Ajouter"
  // quand aucun parent compatible n'existe encore.
  const existingKinds = useMemo(() => new Set(zones.map((z) => z.kind)), [zones]);

  // Construit l'arbre depuis la liste plate.
  const tree = useMemo(() => buildTree(zones), [zones]);

  // Index devices par zone_id pour rendu en feuilles sous chaque zone.
  const devicesByZone = useMemo(() => {
    const m = new Map<string, DeviceListItem[]>();
    devices.forEach((d) => {
      const arr = m.get(d.zone_id) || [];
      arr.push(d);
      m.set(d.zone_id, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => (a.name || a.slug).localeCompare(b.name || b.slug, "fr")));
    return m;
  }, [devices]);

  // Filtre l'arbre quand search est actif (matching récursif : un parent
  // reste visible si un descendant — zone OU équipement — matche).
  const visibleTree = useMemo(
    () => filterTree(tree, search.trim().toLowerCase(), devicesByZone),
    [tree, search, devicesByZone]
  );

  async function onDelete(z: Zone) {
    if (!confirm(`Supprimer la zone "${z.name}" ?`)) return;
    try {
      await api.del(`/v1/zones/${z.id}`);
      reload();
    } catch (e) {
      alert(e instanceof HttpError ? e.payload.message : String(e));
    }
  }

  return (
    <div className="p-6">
      <header className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-brand-500" /> Zones
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Arborescence du site : zones géographiques, bâtiments, étages, pièces.
            Les équipements y sont rattachés pour savoir <em>où</em> ils sont posés.
          </p>
        </div>
        {canWrite && (
          <AddMenu
            open={addMenuOpen}
            existingKinds={existingKinds}
            onToggle={() => setAddMenuOpen((o) => !o)}
            onClose={() => setAddMenuOpen(false)}
            onPick={(kind) => {
              setAddMenuOpen(false);
              if (view === "map") {
                // Mode carte → on bascule directement en tracé. La zone sera
                // créée via le formulaire ouvert après le double-clic final.
                setMapAddKind(kind);
                setMapAddGeometry(null);
                setDrawingZoneID(null);
                setPendingGeometry(null);
              } else {
                setCreating({ kind, parent: null });
              }
            }}
          />
        )}
      </header>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* Toggle Liste / Carte */}
        <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-800 overflow-hidden">
          <button onClick={() => setView("list")}
            className={clsx("flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition",
              view === "list" ? "bg-brand-500/15 text-brand-700 dark:text-brand-300" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800")}>
            <List className="h-3.5 w-3.5" /> Liste
          </button>
          <button onClick={() => setView("map")}
            className={clsx("flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition",
              view === "map" ? "bg-brand-500/15 text-brand-700 dark:text-brand-300" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800")}>
            <MapIcon className="h-3.5 w-3.5" /> Carte
          </button>
        </div>

        {view === "list" && (
          <div className="relative flex-1 max-w-md">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une zone…"
              className="w-full pl-8 pr-3 py-2 text-sm rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:outline-none focus:border-brand-500" />
          </div>
        )}
        <span className="text-[11px] text-slate-400 ml-auto">{zones.length} zone{zones.length > 1 ? "s" : ""}</span>
      </div>

      {error && <div className="mb-4 p-3 text-sm bg-red-500/10 text-red-700 dark:text-red-300 rounded">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Chargement…</div>
      ) : view === "map" ? (
        site ? (
          <>
            {/* Bandeau tracé : édition d'une zone existante */}
            {drawingZone && (
              <div className="mb-3 flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <div className="text-sm text-amber-800 dark:text-amber-200">
                  Tracé du contour de <strong>{drawingZone.name}</strong> — clic pour poser un sommet, double-clic pour terminer.
                  {pendingGeometry && <span className="ml-2 text-emerald-700 dark:text-emerald-300">Polygone prêt à enregistrer.</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => { setDrawingZoneID(null); setPendingGeometry(null); }}
                    className="text-xs px-3 py-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                    Annuler
                  </button>
                  <button onClick={saveDrawnGeometry} disabled={!pendingGeometry || savingGeometry}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white">
                    {savingGeometry ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    Enregistrer
                  </button>
                </div>
              </div>
            )}

            {/* Bandeau tracé : création d'une nouvelle zone */}
            {mapAddKind && !drawingZone && (
              <div className="mb-3 flex items-center justify-between gap-3 p-3 rounded-lg bg-sky-500/10 border border-sky-500/30">
                <div className="text-sm text-sky-800 dark:text-sky-200">
                  Trace le contour de la nouvelle zone — clic pour poser un sommet, double-clic pour terminer.
                  {mapAddGeometry && <span className="ml-2 text-emerald-700 dark:text-emerald-300">Polygone prêt — clique « Suivant ».</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => { setMapAddKind(null); setMapAddGeometry(null); }}
                    className="text-xs px-3 py-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                    Annuler
                  </button>
                  <button
                    onClick={() => setCreating({ kind: mapAddKind, parent: null })}
                    disabled={!mapAddGeometry}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-white">
                    Suivant — nommer la zone →
                  </button>
                  <button
                    onClick={() => setCreating({ kind: mapAddKind, parent: null })}
                    className="text-xs px-3 py-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    title="Créer sans tracé sur la carte">
                    Sauter le tracé
                  </button>
                </div>
              </div>
            )}

            <Suspense fallback={<div className="h-[480px] rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-center text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Chargement de la carte…</div>}>
              <SiteMap
                site={site}
                zones={zones}
                devices={devices}
                drawingZoneID={drawingZoneID || (mapAddKind ? "__new__" : null)}
                onPolygonDrawn={(g) => {
                  if (drawingZoneID) setPendingGeometry(g);
                  else if (mapAddKind) setMapAddGeometry(g);
                }}
                height={580}
              />
            </Suspense>
          </>
        ) : (
          <div className="text-sm text-slate-500">Site introuvable.</div>
        )
      ) : visibleTree.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center">
          <Building2 className="h-8 w-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-4">
            {search ? `Aucune zone ne correspond à « ${search} ».` : "Ce site n'a aucune zone configurée."}
          </p>
          {canWrite && !search && (
            <button onClick={() => setCreating({ kind: "building", parent: null })}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white">
              <Plus className="h-4 w-4" /> Créer la première zone
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2">
          {visibleTree.map((node) => (
            <ZoneNode key={node.zone.id} node={node} depth={0}
              canWrite={canWrite}
              devicesByZone={devicesByZone}
              onAddChild={(parent, kind) => setCreating({ kind, parent })}
              onAddDevice={(z) => setAddingDeviceInZone(z)}
              onEdit={setEditing}
              onDelete={onDelete}
              onDraw={(z) => { setView("map"); setDrawingZoneID(z.id); setPendingGeometry(null); }}
              onOpenDevice={(d) => navigate(`/sites/${siteId}/devices/${d.id}`)} />
          ))}
        </div>
      )}

      {creating && siteId && (
        <ZoneFormModal mode="create" siteId={siteId}
          initialKind={creating.kind} initialParent={creating.parent ?? null}
          initialGeometry={mapAddGeometry}
          allZones={zones}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            // Reset l'état de tracé carte si la création venait de là.
            setMapAddKind(null); setMapAddGeometry(null);
            reload();
          }} />
      )}
      {editing && siteId && (
        <ZoneFormModal mode="edit" siteId={siteId} zone={editing}
          allZones={zones}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }} />
      )}

      {addingDeviceInZone && siteId && (
        <CreateDeviceModal
          siteId={siteId}
          initialZoneID={addingDeviceInZone.id}
          onClose={() => setAddingDeviceInZone(null)}
          onCreated={() => { setAddingDeviceInZone(null); reload(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add menu (popover : Ajouter une zone géo / un groupe / un bâtiment / …)
// ---------------------------------------------------------------------------
function AddMenu({ open, onToggle, onClose, onPick, existingKinds }: {
  open: boolean; onToggle: () => void; onClose: () => void; onPick: (k: ZoneKind) => void;
  /** Set des kinds déjà présents dans le site — utilisé pour griser ceux dont le parent n'existe pas encore. */
  existingKinds: Set<ZoneKind>;
}) {
  return (
    <div className="relative">
      <button onClick={onToggle}
        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-brand-500 hover:bg-brand-400 text-white">
        <Plus className="h-3.5 w-3.5" /> Ajouter
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-2xl py-1 z-20">
            {KIND_ORDER.map((k) => {
              const m = KIND_META[k];
              // Possible si on peut être à la racine OU s'il existe au moins
              // un parent compatible déjà présent dans le site.
              const canRoot = canHaveAsParent(k, null);
              const compatibleParents = ALLOWED_PARENTS[k].filter((p): p is ZoneKind => p !== null);
              const hasParent = compatibleParents.some((p) => existingKinds.has(p));
              const enabled = canRoot || hasParent;
              return (
                <button key={k} onClick={() => enabled && onPick(k)}
                  disabled={!enabled}
                  className={clsx(
                    "w-full text-left px-3 py-2 flex items-center gap-2.5",
                    enabled ? "hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" : "opacity-40 cursor-not-allowed",
                  )}
                  title={enabled ? "" : "Crée d'abord un parent compatible"}>
                  <span className={clsx("rounded-md p-1.5", m.accent)}>
                    <m.icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{m.label}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{m.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree node (récursif)
// ---------------------------------------------------------------------------

interface TreeNode {
  zone: Zone;
  children: TreeNode[];
}

function ZoneNode({ node, depth, canWrite, devicesByZone, onAddChild, onAddDevice, onEdit, onDelete, onDraw, onOpenDevice }: {
  node: TreeNode; depth: number; canWrite: boolean;
  devicesByZone: Map<string, DeviceListItem[]>;
  onAddChild: (parent: Zone, kind: ZoneKind) => void;
  onAddDevice: (z: Zone) => void;
  onEdit: (z: Zone) => void;
  onDelete: (z: Zone) => void;
  onDraw: (z: Zone) => void;
  onOpenDevice: (d: DeviceListItem) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const m = KIND_META[node.zone.kind];
  const zoneDevices = devicesByZone.get(node.zone.id) || [];
  const hasChildren = node.children.length > 0 || zoneDevices.length > 0;

  return (
    <div>
      <div className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}>
        <button
          onClick={() => setExpanded((e) => !e)}
          disabled={!hasChildren}
          className={clsx("p-0.5 rounded text-slate-400", !hasChildren && "invisible")}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className={clsx("rounded-md p-1.5 shrink-0", m.accent)}>
          <m.icon className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate font-medium flex items-center gap-2">
            {node.zone.name}
            {zoneDevices.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-normal flex items-center gap-1">
                <Cpu className="h-2.5 w-2.5" />
                {zoneDevices.length}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            {m.label}
            {node.zone.description ? ` · ${node.zone.description}` : ""}
            {` · slug : ${node.zone.slug}`}
          </div>
        </div>
        {canWrite && (
          <div className="relative shrink-0 opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
            {kindsAllowedUnder(node.zone.kind).length > 0 && (
              <button onClick={() => onAddChild(node.zone, suggestChildKind(node.zone.kind))}
                title="Ajouter une sous-zone"
                className="p-1 rounded text-slate-500 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={() => onAddDevice(node.zone)}
              title="Ajouter un équipement dans cette zone"
              className="p-1 rounded text-slate-500 hover:text-emerald-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <Cpu className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => onDraw(node.zone)}
              title="Tracer le contour sur la carte"
              className="p-1 rounded text-slate-500 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <Pen className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => onEdit(node.zone)}
              title="Modifier"
              className="p-1 rounded text-slate-500 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setMenuOpen((o) => !o)}
              className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-2xl py-1 z-20">
                  {(() => {
                    const allowed = kindsAllowedUnder(node.zone.kind);
                    if (allowed.length === 0) return null;
                    return allowed.map((k) => (
                      <button key={k}
                        onClick={() => { setMenuOpen(false); onAddChild(node.zone, k); }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm flex items-center gap-2">
                        <span className={clsx("rounded p-1", KIND_META[k].accent)}>
                          {(() => { const I = KIND_META[k].icon; return <I className="h-3 w-3" />; })()}
                        </span>
                        Ajouter — {KIND_META[k].label}
                      </button>
                    ));
                  })()}
                  {kindsAllowedUnder(node.zone.kind).length > 0 && (
                    <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />
                  )}
                  <button onClick={() => { setMenuOpen(false); onAddDevice(node.zone); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-emerald-500/10 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                    <span className="rounded p-1 bg-emerald-500/15">
                      <Cpu className="h-3 w-3" />
                    </span>
                    Ajouter — Équipement
                  </button>
                  <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />
                  <button onClick={() => { setMenuOpen(false); onDelete(node.zone); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-red-500/10 text-sm text-red-600 dark:text-red-300 flex items-center gap-2">
                    <Trash2 className="h-3 w-3" /> Supprimer
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <ZoneNode key={child.zone.id} node={child} depth={depth + 1}
              canWrite={canWrite}
              devicesByZone={devicesByZone}
              onAddChild={onAddChild} onAddDevice={onAddDevice}
              onEdit={onEdit} onDelete={onDelete} onDraw={onDraw}
              onOpenDevice={onOpenDevice} />
          ))}
          {zoneDevices.map((d) => (
            <DeviceLeaf key={d.id} device={d} depth={depth + 1} onOpen={() => onOpenDevice(d)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceLeaf({ device, depth, onOpen }: {
  device: DeviceListItem; depth: number; onOpen: () => void;
}) {
  const meta = DEVICE_TYPE_META[device.type] ?? DEVICE_TYPE_META.gateway;
  const Ic = meta.icon;
  const dot = DEVICE_STATUS_DOT[device.status] || DEVICE_STATUS_DOT.offline;
  return (
    <button
      onClick={onOpen}
      className="group w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left"
      style={{ paddingLeft: `${depth * 20 + 8}px` }}
      title={`Ouvrir la fiche de ${device.name || device.slug}`}>
      <span className="p-0.5 invisible"><ChevronRight className="h-3.5 w-3.5" /></span>
      <span className={clsx("rounded-md p-1.5 shrink-0", meta.accent)}>
        <Ic className="h-3.5 w-3.5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate font-medium flex items-center gap-2">
          <span className={clsx("h-1.5 w-1.5 rounded-full shrink-0", dot)} title={device.status} />
          {device.name || device.slug}
        </div>
        <div className="text-[10px] text-slate-500 truncate font-mono">{device.slug}</div>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-700 opacity-0 group-hover:opacity-100 transition" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modal création / édition
// ---------------------------------------------------------------------------
function ZoneFormModal({ mode, siteId, zone, initialKind, initialParent, initialGeometry, allZones, onClose, onSaved }: {
  mode: "create" | "edit";
  siteId: string;
  zone?: Zone;
  initialKind?: ZoneKind;
  initialParent?: Zone | null;
  /** Géométrie GeoJSON pré-tracée sur la carte avant d'ouvrir le formulaire. */
  initialGeometry?: object | null;
  allZones: Zone[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(zone?.name || "");
  const [kind, setKind] = useState<ZoneKind>(zone?.kind || initialKind || "room");
  const [parentID, setParentID] = useState<string | null>(zone?.parent_zone_id || initialParent?.id || null);
  const [description, setDescription] = useState(zone?.description || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const m = KIND_META[kind];

  // Liste des kinds autorisés selon le parent actuellement sélectionné.
  const parentKind: ZoneKind | null = useMemo(() => {
    if (!parentID) return null;
    return allZones.find((z) => z.id === parentID)?.kind ?? null;
  }, [parentID, allZones]);
  const allowedKinds = useMemo(() => kindsAllowedUnder(parentKind), [parentKind]);

  // Si le kind sélectionné devient incompatible avec le parent, on bascule
  // sur le 1er kind autorisé pour rester cohérent.
  useEffect(() => {
    if (!allowedKinds.includes(kind) && allowedKinds.length > 0) {
      setKind(allowedKinds[0]);
    }
  }, [allowedKinds, kind]);

  // Liste des parents possibles : on filtre par compatibilité hiérarchique
  // (ALLOWED_PARENTS) ET on enlève la zone elle-même + ses descendants
  // (anti-cycle côté UI ; le backend revérifie).
  const parentOptions = useMemo(() => {
    let pool = allZones.filter((z) => canHaveAsParent(kind, z.kind));
    if (mode === "edit" && zone) {
      const blocked = new Set<string>([zone.id]);
      let added = true;
      while (added) {
        added = false;
        for (const z of allZones) {
          if (z.parent_zone_id && blocked.has(z.parent_zone_id) && !blocked.has(z.id)) {
            blocked.add(z.id);
            added = true;
          }
        }
      }
      pool = pool.filter((z) => !blocked.has(z.id));
    }
    return pool;
  }, [allZones, mode, zone, kind]);

  // Indique si la racine est une option autorisée pour ce kind.
  const canBeRoot = canHaveAsParent(kind, null);

  function autoSlug(n: string) {
    return n.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError("Nom requis"); return; }
    setSubmitting(true);
    const body: Record<string, unknown> = {
      name: name.trim(),
      kind,
      parent_zone_id: parentID,
      description: description.trim() || null,
      // Slug toujours auto-généré depuis le nom — pas de saisie utilisateur.
      ...(mode === "create" ? { slug: autoSlug(name) || `zone-${Date.now().toString(36)}` } : {}),
    };
    if (mode === "create" && initialGeometry) body.geometry = initialGeometry;
    try {
      if (mode === "create") {
        await api.post(`/v1/sites/${siteId}/zones`, body);
      } else if (zone) {
        await api.put(`/v1/zones/${zone.id}`, body);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[2000] flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className={clsx("rounded-md p-1.5", m.accent)}>
              <m.icon className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">
                {mode === "create" ? createTitle(kind) : `Modifier ${zone?.name}`}
              </h2>
              <p className="text-[10px] text-slate-500">{m.description}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Type *" tooltip={
            <>
              <p><strong>Zone géographique</strong> — école, parc, campus.</p>
              <p className="mt-1"><strong>Groupe de bâtiments</strong> — aile, secteur regroupant plusieurs bâtiments.</p>
              <p className="mt-1"><strong>Bâtiment</strong> — un bâtiment unique.</p>
              <p className="mt-1"><strong>Étage</strong> — un niveau dans un bâtiment.</p>
              <p className="mt-1"><strong>Pièce</strong> — salle, atelier, classe — niveau le plus fin.</p>
            </>
          }>
            <select value={kind} onChange={(e) => setKind(e.target.value as ZoneKind)} className={inputCls}>
              {allowedKinds.map((k) => (
                <option key={k} value={k}>{KIND_META[k].label}</option>
              ))}
            </select>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Filtré selon le parent : {parentKind ? KIND_META[parentKind].label : "racine du site"}.
            </span>
          </Field>

          <Field label="Nom *">
            <input value={name} onChange={(e) => setName(e.target.value)} required
              placeholder="ex: Salle de réunion 1er étage" className={inputCls} />
          </Field>

          <Field label="Parent" tooltip="Laisser vide pour une zone racine. Sinon, choisissez la zone qui contient celle-ci. Filtrée selon le type sélectionné.">
            <select value={parentID || ""} onChange={(e) => setParentID(e.target.value || null)} className={inputCls}>
              {canBeRoot && <option value="">— Aucun (racine du site) —</option>}
              {parentOptions.map((z) => (
                <option key={z.id} value={z.id}>{breadcrumb(z, allZones)}{` · ${KIND_META[z.kind].label}`}</option>
              ))}
            </select>
            {!canBeRoot && parentOptions.length === 0 && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 block">
                Aucun parent compatible — créez d'abord une {kind === "building" ? "zone géographique ou un groupe de bâtiments" : kind === "floor" ? "bâtiment" : "zone parente compatible"}.
              </span>
            )}
          </Field>

          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              placeholder="optionnel" className={inputCls} />
          </Field>

          {error && <div className="text-sm text-red-500 bg-red-500/10 p-2 rounded">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white">Annuler</button>
          <button type="submit" disabled={submitting}
            className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50">
            {submitting ? "…" : mode === "create" ? "Créer la zone" : "Enregistrer"}
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

// ---------------------------------------------------------------------------
// Helpers d'arbre
// ---------------------------------------------------------------------------

function buildTree(zones: Zone[]): TreeNode[] {
  const byID = new Map<string, TreeNode>();
  zones.forEach((z) => byID.set(z.id, { zone: z, children: [] }));
  const roots: TreeNode[] = [];
  zones.forEach((z) => {
    const node = byID.get(z.id)!;
    if (z.parent_zone_id && byID.has(z.parent_zone_id)) {
      byID.get(z.parent_zone_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  // Tri stable par kind puis nom à chaque niveau.
  const sortNodes = (ns: TreeNode[]) => {
    ns.sort((a, b) => {
      const ka = KIND_ORDER.indexOf(a.zone.kind);
      const kb = KIND_ORDER.indexOf(b.zone.kind);
      if (ka !== kb) return ka - kb;
      return a.zone.name.localeCompare(b.zone.name, "fr");
    });
    ns.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

function filterTree(nodes: TreeNode[], needle: string, devicesByZone?: Map<string, DeviceListItem[]>): TreeNode[] {
  if (!needle) return nodes;
  const matches = (n: TreeNode): TreeNode | null => {
    const childMatches = n.children.map(matches).filter(Boolean) as TreeNode[];
    const selfMatch = n.zone.name.toLowerCase().includes(needle) || n.zone.slug.includes(needle);
    const deviceMatch = (devicesByZone?.get(n.zone.id) || []).some(
      (d) => (d.name || "").toLowerCase().includes(needle) || d.slug.toLowerCase().includes(needle)
    );
    if (!selfMatch && !deviceMatch && childMatches.length === 0) return null;
    return { zone: n.zone, children: childMatches };
  };
  return nodes.map(matches).filter(Boolean) as TreeNode[];
}

function breadcrumb(z: Zone, all: Zone[]): string {
  const parts: string[] = [z.name];
  let cur = z;
  while (cur.parent_zone_id) {
    const p = all.find((x) => x.id === cur.parent_zone_id);
    if (!p) break;
    parts.unshift(p.name);
    cur = p;
  }
  return parts.join(" › ");
}

// createTitle — titre dynamique du modal de création selon le kind sélectionné.
// Articles français accordés en genre.
function createTitle(kind: ZoneKind): string {
  switch (kind) {
    case "geographic":     return "Création d'une zone géographique";
    case "building_group": return "Création d'un groupe de bâtiments";
    case "building":       return "Création d'un bâtiment";
    case "floor":          return "Création d'un étage";
    case "room":           return "Création d'une pièce";
  }
}

function suggestChildKind(parent: ZoneKind): ZoneKind {
  // Suggère le kind « naturel » d'un enfant — choisi parmi ceux autorisés.
  const allowed = kindsAllowedUnder(parent);
  switch (parent) {
    case "geographic":     return allowed.includes("building") ? "building" : allowed[0];
    case "building_group": return allowed.includes("building") ? "building" : allowed[0];
    case "building":       return allowed.includes("floor")    ? "floor"    : allowed[0];
    case "floor":          return "room";
    default:               return allowed[0] ?? "room";
  }
}
