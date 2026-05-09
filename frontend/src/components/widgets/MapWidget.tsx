import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import clsx from "clsx";
import { api } from "../../lib/api";
import type { DeviceListItem, Site, Widget, Zone, ZoneKind } from "../../types/api";

const SiteMap = lazy(() => import("../SiteMap").then((m) => ({ default: m.SiteMap })));

/**
 * MapWidget — affiche les zones (polygones) et équipements (marqueurs) du
 * site courant sur une carte Leaflet.
 *
 * Config attendue :
 *   - site_id     (obligatoire — posé par CreateWidgetModal)
 *   - kinds       (string[] optionnel) : filtre les zones affichées par type.
 *                 Si absent, on affiche tout.
 *   - show_devices (booléen, défaut true)
 */
export function MapWidget({ widget }: { widget: Widget }) {
  const cfg = widget.config as Record<string, unknown>;
  const siteID = cfg.site_id as string | undefined;
  const kinds = (cfg.kinds as string[] | undefined) ?? null;
  const showDevices = cfg.show_devices !== false;

  const [site, setSite] = useState<Site | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!siteID) { setError("Aucun site lié à ce widget"); setLoading(false); return; }
    setLoading(true);
    Promise.all([
      api.get<Site>(`/v1/sites/${siteID}`),
      api.get<Zone[]>(`/v1/sites/${siteID}/zones`),
      showDevices
        ? api.get<DeviceListItem[]>(`/v1/sites/${siteID}/devices`).catch(() => [])
        : Promise.resolve([]),
    ])
      .then(([s, z, d]) => { setSite(s); setZones(z); setDevices(d); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [siteID, showDevices]);

  // Filtre par type de zone si la config le précise.
  const filteredZones = useMemo(() => {
    if (!kinds || kinds.length === 0) return zones;
    const allowed = new Set<ZoneKind>(kinds as ZoneKind[]);
    return zones.filter((z) => allowed.has(z.kind));
  }, [zones, kinds]);

  return (
    <div className={clsx(
      "relative h-full w-full p-0 rounded-xl overflow-hidden flex flex-col",
      "ring-1 ring-transparent transition bg-white dark:bg-slate-900",
    )}>
      {/* Header compact */}
      <div className="absolute top-2 left-2 right-2 z-[400] flex items-center gap-2 pointer-events-none">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/90 dark:bg-slate-900/90 backdrop-blur shadow-sm">
          <MapPin className="h-3.5 w-3.5 text-brand-500" />
          <span className="text-[11px] font-semibold uppercase tracking-wider truncate">{widget.title}</span>
        </div>
      </div>

      {error ? (
        <div className="h-full flex items-center justify-center text-xs text-red-500 italic px-4 text-center">{error}</div>
      ) : loading || !site ? (
        <div className="h-full flex items-center justify-center text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carte…
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <Suspense fallback={
            <div className="h-full flex items-center justify-center text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carte…
            </div>
          }>
            <SiteMap site={site} zones={filteredZones} devices={devices} height="100%" readOnly />
          </Suspense>
        </div>
      )}
    </div>
  );
}
