import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap, FeatureGroup,
} from "react-leaflet";
import L, { type LatLngBoundsExpression, type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import { useNavigate, useParams } from "react-router-dom";
import type { DeviceListItem, Site, Zone, ZoneKind } from "../types/api";

// ---------------------------------------------------------------------------
// Couleurs par type de zone — alignées avec ZonesPage pour la cohérence
// visuelle côté UI.
// ---------------------------------------------------------------------------
const KIND_COLOR: Record<ZoneKind, string> = {
  geographic:     "#10b981",
  building_group: "#8b5cf6",
  building:       "#0ea5e9",
  floor:          "#f59e0b",
  room:           "#f97316",
};

// ---------------------------------------------------------------------------
// Fix du bug Leaflet + bundler : les icônes par défaut ne s'affichent pas
// car les URLs sont construites dynamiquement et cassent en build prod.
// On les pointe vers le CDN unpkg (idem version que la lib).
// ---------------------------------------------------------------------------
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface Props {
  site: Site;
  zones: Zone[];
  devices?: DeviceListItem[];
  /** Hauteur CSS du conteneur (défaut 480 px). */
  height?: number | string;
  /** ID de zone en mode édition — affiche la barre de tracé pour celle-ci. */
  drawingZoneID?: string | null;
  /** Callback quand l'utilisateur termine de tracer un polygone. */
  onPolygonDrawn?: (geojson: object) => void;
  /** Cache la barre d'outils par défaut, utile pour les widgets read-only. */
  readOnly?: boolean;
}

/**
 * SiteMap — carte Leaflet pour visualiser les zones (polygones GeoJSON) et
 * les équipements (marqueurs) d'un site. Mode édition optionnel pour tracer
 * un polygone qui sera renvoyé via `onPolygonDrawn`.
 *
 * Le composant gère lui-même la centerage : zone avec géométrie > lat/lng du
 * site > bbox des devices > vue mondiale.
 */
export function SiteMap({ site, zones, devices = [], height = 480, drawingZoneID, onPolygonDrawn, readOnly }: Props) {
  // Position de base — fallback monde entier si rien de défini.
  const center: LatLngTuple = useMemo(() => {
    if (site.lat != null && site.lng != null) return [site.lat, site.lng];
    return [12.3714, -1.5197]; // Ouagadougou par défaut
  }, [site.lat, site.lng]);

  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 relative">
      <MapContainer
        center={center}
        zoom={17}
        style={{ height, width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Polygones des zones — colorés par type */}
        {zones.filter((z) => z.geometry).map((z) => (
          <GeoJSON
            key={z.id + JSON.stringify(z.geometry)}
            data={z.geometry as GeoJSON.GeoJsonObject}
            style={() => ({
              color: KIND_COLOR[z.kind],
              weight: 2,
              fillColor: KIND_COLOR[z.kind],
              fillOpacity: 0.15,
            })}
            onEachFeature={(_, layer) => {
              layer.bindTooltip(`<strong>${z.name}</strong><br><span style="font-size:10px;opacity:0.7">${z.kind}</span>`, { sticky: true });
            }}
          />
        ))}

        {/* Clusters d'équipements regroupés par zone. Un seul badge cliquable
            par zone au lieu de N pins empilés au même endroit. */}
        {devices.length > 0 && site.lat != null && site.lng != null && (
          <DeviceZoneClusters devices={devices} zones={zones} fallback={[site.lat, site.lng]} />
        )}

        {/* Auto-fit sur la bbox des polygones + site */}
        <AutoFitBounds zones={zones} site={site} />

        {/* Outil de tracé — uniquement quand drawingZoneID est défini */}
        {!readOnly && drawingZoneID && onPolygonDrawn && (
          <DrawControl onPolygonDrawn={onPolygonDrawn} />
        )}
      </MapContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AutoFitBounds — cadre la vue UNE SEULE FOIS sur les géométries au mount.
// Une fois fait, on laisse l'utilisateur naviguer / zoomer librement sans
// reset à chaque re-render parent (changement de zones, refresh d'état, etc.).
// ---------------------------------------------------------------------------
function AutoFitBounds({ zones, site }: { zones: Zone[]; site: Site }) {
  const map = useMap();
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current) return;
    const layers: L.Layer[] = [];
    for (const z of zones) {
      if (z.geometry) {
        try {
          layers.push(L.geoJSON(z.geometry as GeoJSON.GeoJsonObject));
        } catch { /* ignore */ }
      }
    }
    if (layers.length > 0) {
      const group = L.featureGroup(layers);
      const b = group.getBounds();
      if (b.isValid()) {
        map.fitBounds(b as LatLngBoundsExpression, { padding: [40, 40], maxZoom: 19 });
        fittedRef.current = true;
        return;
      }
    }
    if (site.lat != null && site.lng != null) {
      map.setView([site.lat, site.lng], 17);
      fittedRef.current = true;
    }
  }, [zones, site.lat, site.lng, map]);
  return null;
}

// ---------------------------------------------------------------------------
// DeviceZoneClusters — groupe les équipements par zone et affiche UN badge
// cliquable par zone au lieu de N pins empilés. Le badge montre le nombre
// d'équipements dans la zone, son popup liste tous les devices avec leur
// statut et un lien vers leur fiche.
// ---------------------------------------------------------------------------
function DeviceZoneClusters({ devices, zones, fallback }: {
  devices: DeviceListItem[]; zones: Zone[]; fallback: LatLngTuple;
}) {
  const navigate = useNavigate();
  const { id: siteId } = useParams<{ id: string }>();

  // Index des zones pour récupérer la geometry rapidement.
  const zoneByID = useMemo(() => {
    const m = new Map<string, Zone>();
    for (const z of zones) m.set(z.id, z);
    return m;
  }, [zones]);

  // Groupe les devices par zone_id.
  const groups = useMemo(() => {
    const m = new Map<string, DeviceListItem[]>();
    for (const d of devices) {
      const arr = m.get(d.zone_id) || [];
      arr.push(d);
      m.set(d.zone_id, arr);
    }
    return m;
  }, [devices]);

  return (
    <>
      {Array.from(groups.entries()).map(([zoneID, devs], idx) => {
        // Position du badge : centroïde de la zone si polygone tracé, sinon
        // léger offset autour du centre du site pour ne pas superposer les
        // clusters de plusieurs zones non géolocalisées.
        const z = zoneByID.get(zoneID);
        let pos: LatLngTuple = fallback;
        const centroid = z?.geometry ? polygonCentroid(z.geometry) : null;
        if (centroid) {
          pos = centroid;
        } else {
          const angle = (idx / Math.max(groups.size, 1)) * 2 * Math.PI;
          const r = 0.0005; // ~55 m
          pos = [fallback[0] + r * Math.cos(angle), fallback[1] + r * Math.sin(angle)];
        }

        const icon = L.divIcon({
          className: "zeina-device-cluster",
          html: `
            <div class="zeina-cluster-pin">
              <span class="zeina-cluster-count">${devs.length}</span>
              <span class="zeina-cluster-label">${escapeHtml(z?.name || "Sans zone")}</span>
            </div>
          `,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });

        return (
          <Marker key={zoneID} position={pos} icon={icon}>
            <Popup>
              <div className="text-xs space-y-1.5 min-w-[200px]">
                <div className="font-semibold text-sm">{z?.name || "Sans zone"}</div>
                <div className="text-slate-500">{devs.length} équipement{devs.length > 1 ? "s" : ""}</div>
                <div className="border-t border-slate-200 pt-1.5 space-y-1 max-h-48 overflow-auto">
                  {devs.map((d) => (
                    <button key={d.id}
                      onClick={() => navigate(`/sites/${siteId}/devices/${d.id}`)}
                      className="w-full text-left flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-100">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        d.status === "online" ? "bg-emerald-500"
                        : d.status === "offline" ? "bg-red-500"
                        : "bg-amber-500"
                      }`} />
                      <span className="flex-1 truncate font-medium">{d.name || d.slug}</span>
                      <span className="text-[10px] text-slate-400">{d.type}</span>
                    </button>
                  ))}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

// polygonCentroid — moyenne des sommets de l'anneau extérieur. Suffit pour
// positionner un badge au milieu d'une zone, pas besoin du vrai centroïde
// géométrique.
function polygonCentroid(geom: unknown): LatLngTuple | null {
  if (!geom || typeof geom !== "object") return null;
  const g = geom as { type?: string; coordinates?: unknown };
  let ring: number[][] | null = null;
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
    ring = (g.coordinates as number[][][])[0] || null;
  } else if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    ring = (g.coordinates as number[][][][])[0]?.[0] || null;
  }
  if (!ring || ring.length === 0) return null;
  let cx = 0, cy = 0;
  for (const p of ring) { cx += p[0]; cy += p[1]; }
  cx /= ring.length; cy /= ring.length;
  return [cy, cx]; // Leaflet veut [lat, lng], GeoJSON donne [lng, lat]
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c
  ));
}

// ---------------------------------------------------------------------------
// DrawControl — barre de dessin Leaflet-draw qui n'autorise que les polygones.
// Émet `onPolygonDrawn` au moment du clic « Terminer ».
// ---------------------------------------------------------------------------
function DrawControl({ onPolygonDrawn }: { onPolygonDrawn: (gj: object) => void }) {
  const map = useMap();
  const fgRef = useRef<L.FeatureGroup>(new L.FeatureGroup());

  useEffect(() => {
    const fg = fgRef.current;
    map.addLayer(fg);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drawControl = new (L.Control as any).Draw({
      position: "topright",
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: "#0ea5e9", weight: 2 },
        },
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup: fg, remove: true },
    });
    map.addControl(drawControl);

    // Active automatiquement l'outil polygone — l'utilisateur peut directement
    // cliquer sur la carte pour poser des sommets, sans devoir cliquer
    // d'abord sur l'icône pentagone de la barre d'outils. Plus intuitif
    // quand on arrive ici depuis "Ajouter une zone" en mode Carte.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const polygonDraw = new (L as any).Draw.Polygon(map, drawControl.options.draw.polygon);
    polygonDraw.enable();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onCreated = (e: any) => {
      fg.clearLayers(); // une seule géométrie par zone
      fg.addLayer(e.layer);
      onPolygonDrawn(e.layer.toGeoJSON().geometry);
      // Réactive l'outil pour que l'utilisateur puisse tracer à nouveau s'il
      // se trompe (chaque tracé écrase le précédent).
      polygonDraw.enable();
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onEdited = (e: any) => {
      e.layers.eachLayer((layer: L.Layer) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onPolygonDrawn((layer as any).toGeoJSON().geometry);
      });
    };

    map.on("draw:created", onCreated);
    map.on("draw:edited", onEdited);
    return () => {
      polygonDraw.disable();
      map.off("draw:created", onCreated);
      map.off("draw:edited", onEdited);
      map.removeControl(drawControl);
      map.removeLayer(fg);
    };
  }, [map, onPolygonDrawn]);

  return <FeatureGroup ref={fgRef as never} />;
}

// Hook utilitaire pour la page Zones : retourne un setter de geometry pour
// la zone en cours d'édition. Évite la duplication d'API call dans plusieurs
// composants.
export function useZoneGeometry() {
  const [drawing, setDrawing] = useState<string | null>(null);
  return { drawing, setDrawing };
}
