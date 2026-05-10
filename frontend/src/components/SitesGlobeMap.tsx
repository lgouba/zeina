// SitesGlobeMap — carte hero "tous les sites" en haut de SitesHome.
//
// Marqueurs custom (DivIcon) avec le nom du site visible en permanence, pulse
// animée si le site a une alarme active, badge nombre d'équipements.
// Tuiles CartoDB Voyager (clair) / Dark Matter (sombre) → rendu moderne sans
// dépendance commerciale (souverain, libre).

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L, { type LatLngBoundsExpression, type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../lib/theme";
import type { Site, SiteSummary } from "../types/api";

interface Props {
  sites: Site[];
  summaries: Record<string, SiteSummary>;
  /** Hauteur du conteneur. Défaut 480 px. */
  height?: number | string;
}

export function SitesGlobeMap({ sites, summaries, height = 520 }: Props) {
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

  return (
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

      {sites.some((s) => s.lat == null || s.lng == null) && (
        <div className="absolute bottom-4 left-4 z-[400] bg-amber-500/90 backdrop-blur-md text-white text-xs px-3 py-2 rounded-lg shadow-lg max-w-xs pointer-events-none">
          ⚠ Certains sites n'ont pas de coordonnées GPS et n'apparaissent pas sur la carte.
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
