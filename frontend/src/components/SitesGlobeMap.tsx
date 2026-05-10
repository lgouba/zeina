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
  /** Hauteur du conteneur. Défaut 520 px. */
  height?: number | string;
}

interface PlacedSite {
  site: Site;
  lat: number;
  lng: number;
  approximate: boolean; // true = position synthétique (pas de vraies coords)
}

export function SitesGlobeMap({ sites, summaries, height = 520 }: Props) {
  const { theme } = useTheme();
  const navigate = useNavigate();

  // Tuiles : Voyager (clair, vibrant) vs Dark Matter (sombre, élégant).
  const tileURL = theme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

  // Place TOUS les sites sur la carte. Pour ceux sans coords, on synthétise
  // une position autour du barycentre des sites géolocalisés (ou Ouagadougou
  // par défaut), avec une distribution circulaire pour éviter le pile-up. Ces
  // sites sont rendus avec un style "approximatif" pour rester honnête
  // visuellement.
  const placed: PlacedSite[] = useMemo(() => {
    const withCoords = sites.filter((s) => s.lat != null && s.lng != null);
    const synthCenter: LatLngTuple = withCoords.length > 0
      ? [
          withCoords.reduce((a, s) => a + (s.lat || 0), 0) / withCoords.length,
          withCoords.reduce((a, s) => a + (s.lng || 0), 0) / withCoords.length,
        ]
      : [12.3714, -1.5197]; // Ouagadougou

    const noCoord = sites.filter((s) => s.lat == null || s.lng == null);
    // Rayon d'environ 30-50 km pour bien séparer les markers approximatifs
    // sans qu'ils sortent du même cadre que les sites géolocalisés.
    const radius = 0.4;

    const real: PlacedSite[] = withCoords.map((s) => ({
      site: s, lat: s.lat as number, lng: s.lng as number, approximate: false,
    }));
    const synth: PlacedSite[] = noCoord.map((s, i) => {
      const angle = (i / Math.max(noCoord.length, 1)) * 2 * Math.PI;
      return {
        site: s,
        lat: synthCenter[0] + radius * Math.cos(angle),
        lng: synthCenter[1] + radius * Math.sin(angle),
        approximate: true,
      };
    });
    return [...real, ...synth];
  }, [sites]);

  const center: LatLngTuple = useMemo(() => {
    if (placed.length === 0) return [12.3714, -1.5197];
    return [
      placed.reduce((a, p) => a + p.lat, 0) / placed.length,
      placed.reduce((a, p) => a + p.lng, 0) / placed.length,
    ];
  }, [placed]);

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

        {placed.map((p) => (
          <SiteMarker
            key={p.site.id}
            site={p.site}
            summary={summaries[p.site.id]}
            approximate={p.approximate}
            position={[p.lat, p.lng]}
            onClick={() => navigate(`/sites/${p.site.id}/dashboards`)}
          />
        ))}

        <AutoFit placed={placed} />
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

      {/* Légende si certains sites sont en position approximative */}
      {placed.some((p) => p.approximate) && (
        <div className="absolute bottom-4 left-4 z-[400] pointer-events-none">
          <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 shadow-lg flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full bg-slate-400 border-2 border-dashed border-slate-500" />
            <span className="text-[11px] text-slate-600 dark:text-slate-300">
              Position approximative — renseignez l'adresse du site pour le géolocaliser
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marqueur custom : nom du site visible + pulse si alarmes actives.
// `approximate=true` → style "?", dashed border, opacité réduite : signale que
// la position affichée est synthétique (pas de vraies coords renseignées).
// ---------------------------------------------------------------------------
function SiteMarker({ site, summary, approximate, position, onClick }: {
  site: Site;
  summary?: SiteSummary;
  approximate: boolean;
  position: LatLngTuple;
  onClick: () => void;
}) {
  const hasAlarm = (summary?.alarms_total || 0) > 0;
  const devices = summary?.devices_total || 0;

  const classes = [
    "zeina-pin",
    hasAlarm ? "alarm" : "",
    approximate ? "approximate" : "",
  ].filter(Boolean).join(" ");

  const icon = useMemo(() => L.divIcon({
    className: "zeina-site-marker",
    html: `
      <div class="${classes}">
        <div class="zeina-pin-label">
          ${hasAlarm ? '<span class="zeina-pulse"></span>' : ''}
          ${approximate ? '<span class="zeina-pin-approx">?</span>' : ''}
          <span class="zeina-pin-name">${escapeHtml(site.name)}</span>
          ${devices > 0 ? `<span class="zeina-pin-badge">${devices}</span>` : ''}
        </div>
        <div class="zeina-pin-tip"></div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  }), [classes, site.name, devices, hasAlarm, approximate]);

  return (
    <Marker
      position={position}
      icon={icon}
      eventHandlers={{ click: onClick }}
    />
  );
}

// AutoFit — recadre la carte pour englober tous les sites (réels + synthétisés).
function AutoFit({ placed }: { placed: PlacedSite[] }) {
  const map = useMap();
  const lastSig = useRef<string>("");
  useEffect(() => {
    const sig = placed.map((p) => `${p.site.id}:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|");
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    if (placed.length === 0) return;
    if (placed.length === 1) {
      map.setView([placed[0].lat, placed[0].lng], placed[0].approximate ? 7 : 13);
      return;
    }
    const bounds = L.latLngBounds(placed.map((p) => [p.lat, p.lng] as LatLngTuple));
    map.fitBounds(bounds as LatLngBoundsExpression, { padding: [60, 60], maxZoom: 14 });
  }, [placed, map]);
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c
  ));
}
