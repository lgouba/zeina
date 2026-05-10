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
import { MapPin, Loader2, HelpCircle } from "lucide-react";
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

      {/* Compteur global — overlay flottant top-left */}
      <div className="absolute top-4 left-4 z-[400] pointer-events-none">
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

      {/* Sites sans coords — overlay flottant en bas, intégré à la carte */}
      {noCoordSites.length > 0 && (
        <FloatingNoCoordStack
          sites={noCoordSites}
          summaries={summaries}
          canGeocode={!!canGeocode}
          onGeocoded={onGeocoded}
        />
      )}
    </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// FloatingNoCoordStack — bandeau flottant en bas de la carte qui affiche
// les sites sans coords sous forme de chips compactes. Cohérent visuellement
// avec les pins de la carte : même look, même interactivité.
// ---------------------------------------------------------------------------
function FloatingNoCoordStack({ sites, summaries, canGeocode, onGeocoded }: {
  sites: Site[]; summaries: Record<string, SiteSummary>;
  canGeocode: boolean; onGeocoded?: () => void;
}) {
  return (
    <div className="absolute bottom-4 left-4 right-4 z-[400] flex justify-center">
      <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-2 shadow-xl max-w-full flex items-center gap-2 overflow-x-auto">
        <div className="shrink-0 flex items-center gap-1.5 pr-2 mr-1 border-r border-slate-200 dark:border-slate-700">
          <HelpCircle className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold whitespace-nowrap">
            Sans coords
          </span>
        </div>
        {sites.map((s) => (
          <NoCoordChip key={s.id} site={s} summary={summaries[s.id]}
            canGeocode={canGeocode} onGeocoded={onGeocoded} />
        ))}
      </div>
    </div>
  );
}

function NoCoordChip({ site, summary, canGeocode, onGeocoded }: {
  site: Site; summary?: SiteSummary;
  canGeocode: boolean; onGeocoded?: () => void;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const devices = summary?.devices_total || 0;

  async function geocode(e: React.MouseEvent) {
    e.stopPropagation();
    setLoading(true); setError(null);
    try {
      await api.post(`/v1/sites/${site.id}/geocode`, {});
      onGeocoded?.();
    } catch (err) {
      setError(err instanceof HttpError ? err.payload.message : "Erreur");
      setTimeout(() => setError(null), 4000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative shrink-0 group">
      <button
        onClick={() => navigate(`/sites/${site.id}/dashboards`)}
        title={site.address || "Aucune adresse renseignée"}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
          bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700
          text-slate-700 dark:text-slate-200 hover:from-brand-500 hover:to-cyan-500 hover:text-white
          border border-dashed border-slate-300 dark:border-slate-600 hover:border-solid hover:border-transparent
          transition shadow-sm whitespace-nowrap">
        <span className="truncate max-w-[140px]">{site.name}</span>
        {devices > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-300/60 dark:bg-slate-600/60 group-hover:bg-white/25 tabular-nums">
            {devices}
          </span>
        )}
      </button>
      {canGeocode && site.address && (
        <button
          onClick={geocode}
          disabled={loading}
          title="Calculer les coordonnées GPS à partir de l'adresse"
          className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-amber-500 hover:bg-amber-400 text-white text-[10px] flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition disabled:opacity-50">
          {loading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <MapPin className="h-2.5 w-2.5" />}
        </button>
      )}
      {error && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap">
          {error}
        </div>
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
