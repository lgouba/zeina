import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Copy, Check, X, AlertTriangle, ChevronDown, ChevronRight, Plug, Box, Cpu,
  Globe2, Building2, Building, Layers, DoorOpen, MapPin, Pencil,
} from "lucide-react";
import clsx from "clsx";
import { api, HttpError } from "../lib/api";
import type { CreateDeviceInput, DeviceCreated, DeviceModel, ExternalVendor, Zone, ZoneKind } from "../types/api";

// Métadonnées d'affichage du chemin d'emplacement — alignées avec ZonesPage.
const ZONE_KIND_META: Record<ZoneKind, { label: string; icon: typeof Building2; accent: string }> = {
  geographic:     { label: "Zone géographique",   icon: Globe2,    accent: "text-emerald-600 dark:text-emerald-300 bg-emerald-500/10 ring-emerald-500/20" },
  building_group: { label: "Groupe de bâtiments", icon: Building2, accent: "text-violet-600 dark:text-violet-300 bg-violet-500/10 ring-violet-500/20" },
  building:       { label: "Bâtiment",            icon: Building,  accent: "text-sky-600 dark:text-sky-300 bg-sky-500/10 ring-sky-500/20" },
  floor:          { label: "Étage",               icon: Layers,    accent: "text-amber-600 dark:text-amber-300 bg-amber-500/10 ring-amber-500/20" },
  room:           { label: "Pièce",               icon: DoorOpen,  accent: "text-orange-600 dark:text-orange-300 bg-orange-500/10 ring-orange-500/20" },
};

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";

interface Props {
  siteId: string;
  onClose: () => void;
  onCreated: () => void;
  /** Zone pré-sélectionnée à l'ouverture (ex. quand on crée depuis l'arbre des zones). */
  initialZoneID?: string;
}

/**
 * CreateDeviceModal — flux centré sur la sélection d'un MODÈLE catalogue.
 *
 *   1. L'utilisateur choisit Marque → Modèle
 *   2. Les attributs (mesures) du modèle sont affichés en lecture seule
 *   3. Identité du device : nom, slug, zone
 *   4. (Optionnel) Intégration externe — vendor + DevEUI/external_id
 *   5. À la création, l'API auto-provisionne tous les attributs configurables
 *      du modèle dans measurements_metadata
 */
export function CreateDeviceModal({ siteId, onClose, onCreated, initialZoneID }: Props) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<DeviceModel | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string>("");

  const [form, setForm] = useState<CreateDeviceInput>({
    zone_id: initialZoneID || "",
    slug: "",   // sera laissé vide → l'API le génère
    name: "",
  });

  // Intégration externe
  const [extOpen, setExtOpen] = useState(false);
  const [extVendor, setExtVendor] = useState<ExternalVendor>("manual");
  const [extId, setExtId] = useState("");
  const [extInterval, setExtInterval] = useState(60);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DeviceCreated | null>(null);

  // Quand la zone est pré-sélectionnée (via l'arbre des zones), on affiche un
  // breadcrumb en lecture seule au lieu du dropdown. Ce flag passe à true si
  // l'utilisateur clique « Modifier » pour basculer sur le dropdown classique.
  const [editingLocation, setEditingLocation] = useState(false);
  const showLocationBreadcrumb = !!initialZoneID && !editingLocation;

  // Charger zones + catalogue
  useEffect(() => {
    api.get<Zone[]>(`/v1/sites/${siteId}/zones`).then((zs) => {
      setZones(zs);
      // Préfère la zone passée en prop, sinon la 1re du site, sinon vide.
      setForm((f) => {
        if (f.zone_id) return f; // déjà initialisé via initialZoneID
        if (zs.length > 0) return { ...f, zone_id: zs[0].id };
        return f;
      });
    }).catch(() => {});
    api.get<DeviceModel[]>(`/v1/device-models`).then(setModels).catch(() => {});
  }, [siteId]);

  // Quand on sélectionne un modèle, charger ses attributs
  useEffect(() => {
    if (!selectedModel) return;
    if (selectedModel.attributes) return; // déjà chargés
    api.get<DeviceModel>(`/v1/device-models/${selectedModel.id}`).then(setSelectedModel).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel?.id]);

  const brands = useMemo(() => Array.from(new Set(models.map((m) => m.brand))).sort(), [models]);
  const modelsForBrand = useMemo(() => {
    if (!selectedBrand) return [];
    return models.filter((m) => m.brand === selectedBrand);
  }, [models, selectedBrand]);

  const visibleAttrs = useMemo(
    () => (selectedModel?.attributes || []).filter((a) => a.configurable),
    [selectedModel]
  );

  function pickModel(m: DeviceModel) {
    setSelectedModel(m);
    setForm((f) => ({ ...f, model_id: m.id }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedModel) { setError("Sélectionne un modèle"); return; }
    if (!form.zone_id) { setError("Choisis une zone"); return; }
    if (!form.name?.trim()) { setError("Nom requis"); return; }
    setSubmitting(true);
    setError(null);
    try {
      // Slug omis volontairement → l'API le génère à partir du nom
      const payload: CreateDeviceInput = {
        zone_id: form.zone_id,
        slug: "",
        model_id: selectedModel.id,
      };
      if (form.name) payload.name = form.name;
      if (extVendor !== "manual" && extId.trim()) {
        payload.metadata = {
          external: {
            vendor: extVendor,
            external_id: extId.trim(),
            interval_s: extInterval,
          },
        };
      }
      const result = await api.post<DeviceCreated>(`/v1/sites/${siteId}/devices`, payload);
      setCreated(result);
    } catch (err) {
      setError(err instanceof HttpError ? err.payload.message : "Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold">{created ? "Équipement créé" : "Nouvel équipement"}</h2>
          <button onClick={() => { onClose(); if (created) onCreated(); }} className="text-slate-400 hover:text-slate-900 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {created ? <CreatedSummary created={created} onClose={() => { onClose(); onCreated(); }} /> : (
          <form onSubmit={onSubmit} className="p-5 space-y-5">
            {/* ------------ Étape 1 : choisir un modèle ------------ */}
            <Section title="Modèle catalogue" icon={<Box className="h-4 w-4" />}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Marque *">
                  <select value={selectedBrand} onChange={(e) => { setSelectedBrand(e.target.value); setSelectedModel(null); }}
                    className={inputCls}>
                    <option value="">— Choisir —</option>
                    {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </Field>
                <Field label="Modèle *">
                  <select value={selectedModel?.id || ""} onChange={(e) => {
                    const m = modelsForBrand.find((x) => x.id === e.target.value);
                    if (m) pickModel(m);
                  }} className={inputCls} disabled={!selectedBrand}>
                    <option value="">— Choisir —</option>
                    {modelsForBrand.map((m) => (
                      <option key={m.id} value={m.id}>{m.code} — {m.category}</option>
                    ))}
                  </select>
                </Field>
              </div>

              {selectedModel && (
                <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-3 text-xs">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{selectedModel.brand} {selectedModel.code}</div>
                    {selectedModel.protocol && <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{selectedModel.protocol}</span>}
                  </div>
                  {selectedModel.description && <div className="text-slate-500 dark:text-slate-400 mb-2">{selectedModel.description}</div>}
                  <div className="text-slate-500 dark:text-slate-400 mb-1">{visibleAttrs.length} attribut{visibleAttrs.length > 1 ? "s" : ""} qui seront automatiquement provisionnés :</div>
                  <div className="flex flex-wrap gap-1.5">
                    {visibleAttrs.map((a) => (
                      <span key={a.id} className="px-2 py-0.5 rounded bg-brand-500/10 text-brand-600 dark:text-brand-300 font-mono text-[10px]">
                        {a.name} <span className="text-slate-400">({a.unit})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            {/* ------------ Étape 2 : identité ------------ */}
            <Section title="Identité de l'équipement" icon={<Cpu className="h-4 w-4" />}>
              {showLocationBreadcrumb ? (
                <Field label="Emplacement *">
                  <ZoneLocationCard
                    path={zonePathTo(form.zone_id, zones)}
                    onChange={() => setEditingLocation(true)}
                  />
                </Field>
              ) : (
                <Field label="Emplacement *" hint="La zone affiche le chemin complet (Bâtiment › Étage › Pièce).">
                  <select value={form.zone_id} onChange={(e) => setForm((f) => ({ ...f, zone_id: e.target.value }))}
                    className={inputCls}>
                    <option value="">— Choisir —</option>
                    {hierarchicalZoneOptions(zones).map((opt) => (
                      <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Nom * (libellé humain)" hint="L'identifiant technique du device (slug) est généré automatiquement.">
                <input value={form.name || ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: AM308 Salle réunion" className={inputCls} required autoFocus />
              </Field>
            </Section>

            {/* ------------ Étape 3 : intégration externe (optionnel) ------------ */}
            <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
              <button type="button" onClick={() => setExtOpen((o) => !o)}
                className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition">
                {extOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <Plug className="h-3.5 w-3.5" />
                Intégration externe (optionnel)
              </button>
              {extOpen && (
                <div className="mt-3 space-y-3 pl-5 border-l-2 border-slate-200 dark:border-slate-800">
                  <Field label="Source">
                    <select value={extVendor} onChange={(e) => setExtVendor(e.target.value as ExternalVendor)}
                      className={inputCls}>
                      <option value="manual">Aucune (publication MQTT directe par le device)</option>
                      <option value="iotsens">IoTSens</option>
                      <option value="milesight">Milesight (LoRaWAN via ChirpStack)</option>
                      <option value="kerlink">Kerlink</option>
                    </select>
                  </Field>
                  {extVendor !== "manual" && (
                    <>
                      <Field label="Identifiant externe (DevEUI / vendor ID)" hint="ID du device dans la plateforme du constructeur">
                        <input value={extId} onChange={(e) => setExtId(e.target.value)}
                          placeholder="ex: 24E124707E096611" className={inputCls + " font-mono"} />
                      </Field>
                      <Field label="Intervalle de synchronisation (secondes)">
                        <input type="number" min={5} value={extInterval} onChange={(e) => setExtInterval(+e.target.value)}
                          className={inputCls} />
                      </Field>
                    </>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-md p-2.5">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose}
                className="px-3 py-2 text-sm rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">Annuler</button>
              <button type="submit" disabled={submitting || !selectedModel}
                className="px-4 py-2 text-sm rounded-md bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white">
                {submitting ? "Création…" : "Créer"}
              </button>
            </div>
          </form>
        )}
      </div>
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-400 mt-0.5 block">{hint}</span>}
    </label>
  );
}

function CreatedSummary({ created, onClose }: { created: DeviceCreated; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="p-5 space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2 text-xs">
        <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
        <div>
          <strong className="text-amber-700 dark:text-amber-200">Mot de passe MQTT à copier maintenant.</strong>
          <p className="text-amber-700/80 dark:text-amber-200/80 mt-0.5">Il ne sera plus jamais affiché. Stocker dans un gestionnaire de secrets pour la configuration du device hardware réel.</p>
        </div>
      </div>
      <Field label="Username MQTT">
        <input readOnly value={created.mqtt_username}
          className="block w-full rounded-md bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-mono" />
      </Field>
      <Field label="Mot de passe MQTT">
        <div className="flex gap-2">
          <input readOnly value={created.mqtt_password}
            className="flex-1 rounded-md bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-mono" />
          <button onClick={() => { navigator.clipboard.writeText(created.mqtt_password); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className={clsx("px-3 py-2 rounded-md text-white text-xs flex items-center gap-1",
              copied ? "bg-emerald-500" : "bg-brand-500 hover:bg-brand-400")}>
            {copied ? <><Check className="h-3.5 w-3.5" /> Copié</> : <><Copy className="h-3.5 w-3.5" /> Copier</>}
          </button>
        </div>
      </Field>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        Équipement <strong className="text-slate-700 dark:text-slate-200">{created.device.slug}</strong> créé en zone et provisionné.
      </div>
      <div className="flex justify-end pt-2">
        <button onClick={onClose}
          className="px-4 py-2 text-sm rounded-md bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200">
          Terminer
        </button>
      </div>
    </div>
  );
}

// Carte « Emplacement » utilisée quand la zone est déjà choisie (via l'arbre).
// Affiche le chemin sous forme de breadcrumb riche avec icônes par kind, plus
// un lien discret pour basculer sur le dropdown si l'utilisateur veut changer.
function ZoneLocationCard({ path, onChange }: { path: Zone[]; onChange: () => void }) {
  if (path.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-200">
        <span>Zone introuvable.</span>
        <button type="button" onClick={onChange} className="underline hover:no-underline">Choisir une zone</button>
      </div>
    );
  }
  const lastIdx = path.length - 1;
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
        <MapPin className="h-3 w-3" /> Emplacement
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
          {path.map((z, i) => {
            const m = ZONE_KIND_META[z.kind];
            const Ic = m.icon;
            const isLeaf = i === lastIdx;
            const textColor = m.accent.split(" ").find((c) => c.startsWith("text-")) || "text-slate-600";
            return (
              <span key={z.id} className="inline-flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-600 shrink-0" />}
                <span className={clsx(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 ring-1",
                  isLeaf ? m.accent : "bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-800 text-slate-600 dark:text-slate-300",
                )}>
                  <Ic className={clsx("h-3.5 w-3.5", isLeaf ? "" : textColor)} />
                  <span className={clsx("text-xs", isLeaf ? "font-semibold" : "")}>{z.name}</span>
                </span>
              </span>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-brand-500 dark:hover:text-brand-300 transition px-2 py-1 rounded-md hover:bg-white dark:hover:bg-slate-900"
          title="Changer d'emplacement">
          <Pencil className="h-3.5 w-3.5" /> Modifier
        </button>
      </div>
    </div>
  );
}

// Reconstitue le chemin racine→feuille pour la zone donnée.
function zonePathTo(zoneId: string, zones: Zone[]): Zone[] {
  if (!zoneId) return [];
  const byID = new Map<string, Zone>();
  zones.forEach((z) => byID.set(z.id, z));
  const leaf = byID.get(zoneId);
  if (!leaf) return [];
  const out: Zone[] = [leaf];
  let cur: Zone | undefined = leaf;
  while (cur?.parent_zone_id && byID.has(cur.parent_zone_id)) {
    cur = byID.get(cur.parent_zone_id);
    if (cur) out.unshift(cur);
  }
  return out;
}

// Aplati l'arbre des zones en options "Bât. A › Étage 1 › Salle 204" pour
// que l'utilisateur sache où il pose son équipement. Trie par chemin complet.
function hierarchicalZoneOptions(zones: Zone[]): { id: string; label: string }[] {
  const byID = new Map<string, Zone>();
  zones.forEach((z) => byID.set(z.id, z));
  function path(z: Zone): string[] {
    const out = [z.name];
    let cur: Zone | undefined = z;
    while (cur?.parent_zone_id && byID.has(cur.parent_zone_id)) {
      cur = byID.get(cur.parent_zone_id);
      if (cur) out.unshift(cur.name);
    }
    return out;
  }
  return zones
    .map((z) => ({ id: z.id, label: path(z).join(" › "), sortKey: path(z).join("/") }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "fr"))
    .map(({ id, label }) => ({ id, label }));
}
