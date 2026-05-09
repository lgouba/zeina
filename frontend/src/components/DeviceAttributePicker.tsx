import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { DeviceListItem, DeviceModel, DeviceModelAttribute } from "../types/api";

const inputCls = "block w-full rounded-md bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-brand-500";

export interface AttributeSelection {
  device: DeviceListItem;
  attribute: DeviceModelAttribute;
}

interface Props {
  /** Liste de tous les devices du site (déjà chargée par le parent). */
  devices: DeviceListItem[];
  /** Filtrer aux devices d'un certain type technique (ex: "actuator"). */
  filterDeviceType?: string;
  /** Sélection initiale (mode édition). */
  initialDeviceSlug?: string;
  initialMeasurement?: string;
  /** Callback à chaque changement complet (device + attribut sélectionnés). */
  onChange: (sel: AttributeSelection | null) => void;
  /** Pour rétrocompat : mode "actuator only" cache le picker d'attribut. */
  attributeOnly?: boolean;
}

/**
 * DeviceAttributePicker — sélecteur hiérarchique Pulsio-style :
 *
 *   Catégorie ─▶ Modèle ─▶ Équipement ─▶ Attribut
 *
 * À la sélection finale, propage le device complet + l'attribut (avec son
 * unité / bornes) au parent.
 */
export function DeviceAttributePicker({
  devices, filterDeviceType, initialDeviceSlug, initialMeasurement, onChange, attributeOnly,
}: Props) {
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [modelDetails, setModelDetails] = useState<Record<string, DeviceModel>>({});

  const [category, setCategory] = useState<string>("");
  const [modelId, setModelId] = useState<string>("");
  const [deviceSlug, setDeviceSlug] = useState<string>(initialDeviceSlug || "");
  const [attributeName, setAttributeName] = useState<string>(initialMeasurement || "");

  // Charge le catalogue de modèles
  useEffect(() => {
    api.get<DeviceModel[]>("/v1/device-models").then(setModels).catch(() => {});
  }, []);

  // Restaurer la sélection à partir de initialDeviceSlug
  useEffect(() => {
    if (!initialDeviceSlug || devices.length === 0 || models.length === 0) return;
    const d = devices.find((x) => x.slug === initialDeviceSlug);
    if (!d) return;
    if (d.model_id) {
      const m = models.find((x) => x.id === d.model_id);
      if (m) {
        setCategory(m.category);
        setModelId(m.id);
      }
    } else if (d.category) {
      setCategory(d.category);
    }
    setDeviceSlug(d.slug);
    if (initialMeasurement) setAttributeName(initialMeasurement);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDeviceSlug, devices.length, models.length]);

  // Charger les attributs du modèle sélectionné
  useEffect(() => {
    if (!modelId || modelDetails[modelId]) return;
    api.get<DeviceModel>(`/v1/device-models/${modelId}`).then((m) =>
      setModelDetails((prev) => ({ ...prev, [modelId]: m }))
    ).catch(() => {});
  }, [modelId, modelDetails]);

  // Données dérivées des sélections
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const m of models) set.add(m.category);
    // Inclure aussi les catégories utilisées par les devices sans modèle
    for (const d of devices) if (d.category) set.add(d.category);
    return Array.from(set).sort();
  }, [models, devices]);

  const modelsForCategory = useMemo(() => {
    if (!category) return [];
    return models.filter((m) => m.category === category);
  }, [models, category]);

  const devicesForSelection = useMemo(() => {
    let arr = devices;
    if (filterDeviceType) arr = arr.filter((d) => d.type === filterDeviceType);
    if (modelId) arr = arr.filter((d) => d.model_id === modelId);
    else if (category) arr = arr.filter((d) => d.category === category);
    return arr;
  }, [devices, category, modelId, filterDeviceType]);

  const selectedDevice = useMemo(
    () => devicesForSelection.find((d) => d.slug === deviceSlug),
    [devicesForSelection, deviceSlug]
  );

  const attributes = useMemo<DeviceModelAttribute[]>(() => {
    if (!selectedDevice) return [];
    if (selectedDevice.model_id) {
      const m = modelDetails[selectedDevice.model_id];
      if (m && m.attributes) return m.attributes.filter((a) => a.configurable);
    }
    return [];
  }, [selectedDevice, modelDetails]);

  // Propager au parent dès qu'on a device + attribut
  useEffect(() => {
    if (selectedDevice && attributeName) {
      const attr = attributes.find((a) => a.name === attributeName);
      if (attr) {
        onChange({ device: selectedDevice, attribute: attr });
        return;
      }
      // Pas dans les attributs du modèle — fallback : créer un faux attribut
      onChange({
        device: selectedDevice,
        attribute: {
          id: "fallback", name: attributeName, unit: "", position: 0, configurable: true,
        },
      });
      return;
    }
    onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice?.id, attributeName, attributes.length]);

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Catégorie">
        <select value={category} onChange={(e) => {
          setCategory(e.target.value);
          setModelId(""); setDeviceSlug(""); setAttributeName("");
        }} className={inputCls}>
          <option value="">— Choisir —</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>

      <Field label="Modèle">
        <select value={modelId} onChange={(e) => {
          setModelId(e.target.value); setDeviceSlug(""); setAttributeName("");
        }} className={inputCls} disabled={!category}>
          <option value="">— Tous —</option>
          {modelsForCategory.map((m) => (
            <option key={m.id} value={m.id}>{m.brand} {m.code}</option>
          ))}
        </select>
      </Field>

      <Field label="Équipement *">
        <select value={deviceSlug} onChange={(e) => {
          setDeviceSlug(e.target.value); setAttributeName("");
        }} className={inputCls} disabled={devicesForSelection.length === 0}>
          <option value="">{devicesForSelection.length === 0 ? "(aucun équipement)" : "— Choisir —"}</option>
          {devicesForSelection.map((d) => (
            <option key={d.id} value={d.slug}>{d.name || d.slug} — {d.zone_name}</option>
          ))}
        </select>
      </Field>

      {!attributeOnly && (
        <Field label="Attribut *">
          {attributes.length > 0 ? (
            <select value={attributeName} onChange={(e) => setAttributeName(e.target.value)} className={inputCls}>
              <option value="">— Choisir —</option>
              {attributes.map((a) => (
                <option key={a.id} value={a.name}>{a.name} {a.unit && `(${a.unit})`}</option>
              ))}
            </select>
          ) : (
            <input value={attributeName} onChange={(e) => setAttributeName(e.target.value)}
              placeholder="ex: temperature, co2, presence…"
              className={inputCls} disabled={!selectedDevice} />
          )}
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{label}</span>
      {children}
    </label>
  );
}
