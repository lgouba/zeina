// SitesGlobeMap — carte hero "tous les sites" en haut de SitesHome.
//
// Marqueurs custom (DivIcon) avec le nom du site visible en permanence, pulse
// animée si le site a une alarme active, badge nombre d'équipements.
// Tuiles CartoDB Voyager (clair) / Dark Matter (sombre) → rendu moderne sans
// dépendance commerciale (souverain, libre).

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L, { type LatLngBoundsExpression, type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useNavigate } from "react-router-dom";
import { MapPin, Loader2, AlertTriangle } from "lucide-react";
import { api, HttpError } from "../lib/api";
import { useTheme } from "../lib/theme";
import type { Site, SiteSummary } from "../types/api";

interface Props {
  sites: Site[];
  summaries: Record<string, SiteSummary>;
  /** Hauteur du conteneur. Défaut 480 px. */
  height?: number | string;
  /** Si défini, autorise l'utilisateur à relancer le géocodage d'un site
   *  sans coordonnées via le panel "Non géolocalisés". */
  canGeocode?: boolean;
  /** Callback déclenché après un géocodage réussi pour rafraîchir la liste. */
  onGeocoded?: () => void;
}

export function SitesGlobeMap({ sites, summaries, height = 520, canGeocode, onGeocoded }: Props) {
  const { theme } = useTheme();
  const navigate = useNavigate();

  // Tuiles : Voyager (clair, vibrant) vs Dark Matter (sombre, élégant).
  const tileURL = theme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

  // Centre par défaut : si aucun site n'a de coords, on tombe sur Ouagadougou
  // (cohérent avec la timezone par défaut de l'app).
  const center: LatLngTuple = useMemo(() => {
    const withCoords = sites.filter((s) => s.lat != null && s.lng != null);
    if (withCoords.length === 0) return [12.3714, -1.5197];
    const avgLat = withCoords.reduce((a, s) => a + (s.lat || 0), 0) / withCoords.length;
    const avgLng = withCoords.reduce((a, s) => a + (s.lng || 0), 0) / withCoords.length;
    return [avgLat, avgLng];
  }, [sites]);

  const noCoordSites = useMemo(
    () => sites.filter((s) => s.lat == null || s.lng == null),
    [sites],
  );

  return (
    <>
    <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-xl">
      <MapContainer
        center={center}
        zoom={5}
        style={{ height, width: "100%" }}
        scrollWheelZoom
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap'
          url={tileURL}
          subdomains="abcd"
        />

        {sites.map((s) =>
          s.lat != null && s.lng != null ? (
            <SiteMarker
              key={s.id}
              site={s}
              summary={summaries[s.id]}
              onClick={() => navigate(`/sites/${s.id}/dashboards`)}
            />
          ) : null,
        )}

        <AutoFit sites={sites} />
      </MapContainer>

      {/* Légende + compteur, overlay flottant */}
      <div className="absolute top-4 left-4 z-[400] flex items-center gap-2 pointer-events-none">
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 shadow-lg">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
            Vue globale
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums leading-tight">
            {sites.length}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            site{sites.length > 1 ? "s" : ""} actif{sites.length > 1 ? "s" : ""}
          </div>
        </div>
      </div>

    </div>

    {noCoordSites.length > 0 && (
      <NonGeolocatedPanel sites={noCoordSites} canGeocode={!!canGeocode} onGeocoded={onGeocoded} />
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Panel "Non géolocalisés" — liste les sites sans coords + bouton géocoder
// ---------------------------------------------------------------------------
function NonGeolocatedPanel({ sites, canGeocode, onGeocoded }: {
  sites: Site[]; canGeocode: boolean; onGeocoded?: () => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {sites.length} site{sites.length > 1 ? "s" : ""} non géolocalisé{sites.length > 1 ? "s" : ""}
        </span>
        <span className="text-xs text-amber-700/80 dark:text-amber-400/80">
          — ils n'apparaissent pas sur la carte
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sites.map((s) => (
          <GeocodeRow key={s.id} site={s} canGeocode={canGeocode} onGeocoded={onGeocoded} />
        ))}
      </div>
    </div>
  );
}

function GeocodeRow({ site, canGeocode, onGeocoded }: {
  site: Site; canGeocode: boolean; onGeocoded?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function geocode() {
    setLoading(true); setError(null);
    try {
      await api.post(`/v1/sites/${site.id}/geocode`, {});
      onGeocoded?.();
    } catch (e) {
      setError(e instanceof HttpError ? e.payload.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/40 p-3 flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate text-slate-900 dark:text-slate-100">{site.name}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
          {site.address || <span className="italic">Aucune adresse renseignée</span>}
        </div>
        {error && <div className="text-[11px] text-red-500 mt-1">{error}</div>}
      </div>
      {canGeocode && site.address && (
        <button
          onClick={geocode}
          disabled={loading}
          title="Calculer les coordonnées GPS à partir de l'adresse"
          className="shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-amber-500 hover:bg-amber-400 text-white disabled:opacity-50">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
          {loading ? "…" : "Géocoder"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marqueur custom : nom du site visible + pulse si alarmes actives
// ---------------------------------------------------------------------------
function SiteMarker({ site, summary, onClick }: {
  site: Site;
  summary?: SiteSummary;
  onClick: () => void;
}) {
  const hasAlarm = (summary?.alarms_total || 0) > 0;
  const devices = summary?.devices_total || 0;

  // DivIcon : HTML custom rendu dans un div Leaflet. iconAnchor = [0, 0] et
  // on utilise une transform CSS pour ancrer la pointe en bas-centre.
  const icon = useMemo(() => L.divIcon({
    className: "zeina-site-marker",
    html: `
      <div class="zeina-pin ${hasAlarm ? "alarm" : ""}">
        <div class="zeina-pin-label">
          ${hasAlarm ? '<span class="zeina-pulse"></span>' : ''}
          <span class="zeina-pin-name">${escapeHtml(site.name)}</span>
          ${devices > 0 ? `<span class="zeina-pin-badge">${devices}</span>` : ''}
        </div>
        <div class="zeina-pin-tip"></div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  }), [site.name, devices, hasAlarm]);

  return (
    <Marker
      position={[site.lat as number, site.lng as number]}
      icon={icon}
      eventHandlers={{ click: onClick }}
    />
  );
}

// AutoFit — recadre la carte pour englober tous les sites.
function AutoFit({ sites }: { sites: Site[] }) {
  const map = useMap();
  const lastSig = useRef<string>("");
  useEffect(() => {
    const withCoords = sites.filter((s) => s.lat != null && s.lng != null);
    const sig = withCoords.map((s) => `${s.id}:${s.lat},${s.lng}`).join("|");
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    if (withCoords.length === 0) return;
    if (withCoords.length === 1) {
      map.setView([withCoords[0].lat as number, withCoords[0].lng as number], 13);
      return;
    }
    const bounds = L.latLngBounds(withCoords.map((s) => [s.lat as number, s.lng as number]));
    map.fitBounds(bounds as LatLngBoundsExpression, { padding: [60, 60], maxZoom: 14 });
  }, [sites, map]);
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c
  ));
}
