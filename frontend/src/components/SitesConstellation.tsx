// SitesConstellation — vue stylée "réseau de sites" sans dépendance
// géographique. Les sites sont représentés comme des orbes lumineux disposés
// en cercle autour d'un hub central, reliés par des lignes animées suggérant
// des flux de données.
//
// Pourquoi pas une carto GPS : nos clients (écoles, mairies, sites industriels
// en Afrique de l'Ouest entre autres) ne connaissent pas et ne renseignent
// pas les coordonnées GPS. Cette vue est purement visuelle / décorative —
// elle reste impressionnante en démo sans demander de saisie pénible.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Maximize2, Minimize2 } from "lucide-react";
import clsx from "clsx";
import type { Site, SiteSummary } from "../types/api";

interface Props {
  sites: Site[];
  summaries: Record<string, SiteSummary>;
  /** Hauteur du conteneur. Défaut 560 px. */
  height?: number;
}

export function SitesConstellation({ sites, summaries, height = 560 }: Props) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: height });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Suit la taille du container (largeur + hauteur) pour adapter le layout :
  // en mode plein écran le navigateur écrase la hauteur à 100vh, on doit
  // détecter ça pour repositionner les orbes.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Sync l'état plein écran avec l'API native (Échap, F11, etc.).
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current?.requestFullscreen().catch(() => {});
    }
  };

  const positions = useMemo(() => computePositions(sites, size.w, size.h), [sites, size]);
  const stars = useMemo(() => generateStars(60, size.w, size.h), [size]);

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-xl"
      style={{ height }}
    >
      {/* Couche 1 : fond gradient sombre avec aurore */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#1e293b_0%,_#020617_70%)]" />
      <div className="absolute inset-0 opacity-60">
        <div className="zeina-blob absolute -top-32 -left-20 w-[420px] h-[420px] bg-indigo-600/30 rounded-full blur-3xl" />
        <div className="zeina-blob absolute -bottom-32 -right-20 w-[380px] h-[380px] bg-cyan-500/30 rounded-full blur-3xl"
          style={{ animationDelay: "6s" }} />
        <div className="zeina-blob absolute top-1/3 left-1/2 w-[280px] h-[280px] bg-emerald-500/20 rounded-full blur-3xl"
          style={{ animationDelay: "12s" }} />
      </div>

      {/* Couche 2 : étoiles scintillantes */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
        {stars.map((s, i) => (
          <circle
            key={i}
            cx={s.x} cy={s.y} r={s.r}
            fill="white" opacity={s.opacity}
            className="zeina-star"
            style={{ animationDelay: `${s.delay}s`, animationDuration: `${s.duration}s` }}
          />
        ))}

        {/* Couche 3 : lignes de connexion du hub vers chaque orbe.
            Gradient radial userSpaceOnUse → s'applique même aux lignes
            verticales (bounding-box plat). */}
        <defs>
          <radialGradient id="zeinaConnLine" gradientUnits="userSpaceOnUse"
            cx={size.w / 2} cy={size.h / 2} r={Math.min(size.w, size.h) * 0.5}>
            <stop offset="0%"  stopColor="#06b6d4" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#6366f1" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.15" />
          </radialGradient>
        </defs>
        {positions.map((p, i) => (
          <line
            key={p.site.id}
            x1={size.w / 2} y1={size.h / 2}
            x2={p.x} y2={p.y}
            stroke="url(#zeinaConnLine)"
            strokeWidth={1.5}
            strokeDasharray="6 8"
            className="zeina-connection"
            style={{ animationDelay: `${(i % 4) * 0.5}s` }}
          />
        ))}
      </svg>

      {/* Couche 4 : hub central */}
      <div className="absolute" style={{ left: size.w / 2, top: size.h / 2, transform: "translate(-50%, -50%)" }}>
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-indigo-500 rounded-full blur-2xl opacity-50 animate-pulse" />
          <div className="relative w-20 h-20 bg-gradient-to-br from-slate-900 to-slate-800 border border-cyan-400/30 rounded-full flex items-center justify-center shadow-2xl">
            <div className="absolute inset-1.5 rounded-full bg-gradient-to-br from-cyan-400/20 to-indigo-500/20" />
            <span className="relative text-2xl font-bold bg-gradient-to-br from-cyan-300 to-indigo-300 bg-clip-text text-transparent tracking-tighter">
              Z
            </span>
          </div>
          <div className="mt-2 text-center">
            <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300/80 font-semibold">
              Hyperviseur
            </div>
          </div>
        </div>
      </div>

      {/* Couche 5 : orbes des sites */}
      {positions.map((p) => (
        <SiteOrb
          key={p.site.id}
          site={p.site}
          summary={summaries[p.site.id]}
          x={p.x}
          y={p.y}
          onClick={() => navigate(`/sites/${p.site.id}/dashboards`)}
        />
      ))}

      {/* Compteur global, top-left */}
      <div className="absolute top-4 left-4 z-10 pointer-events-none">
        <div className="bg-slate-900/70 backdrop-blur-md border border-cyan-500/20 rounded-xl px-4 py-2.5 shadow-2xl">
          <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/80 font-semibold">
            Vue globale
          </div>
          <div className="text-2xl font-bold text-white tabular-nums leading-tight">
            {sites.length}
          </div>
          <div className="text-[11px] text-slate-400">
            site{sites.length > 1 ? "s" : ""} actif{sites.length > 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Bouton plein écran, top-right */}
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? "Quitter le plein écran (Échap)" : "Afficher en plein écran"}
        className="absolute top-4 right-4 z-10 p-2 rounded-lg bg-slate-900/70 backdrop-blur-md border border-cyan-500/20 text-cyan-300/80 hover:text-white hover:border-cyan-400/50 shadow-2xl transition">
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orbe d'un site : glow + cercle + label en dessous
// ---------------------------------------------------------------------------
function SiteOrb({ site, summary, x, y, onClick }: {
  site: Site;
  summary?: SiteSummary;
  x: number;
  y: number;
  onClick: () => void;
}) {
  const hasAlarm = (summary?.alarms_total || 0) > 0;
  const devices = summary?.devices_total || 0;

  return (
    <button
      onClick={onClick}
      className="absolute group focus:outline-none"
      style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
    >
      <div className="relative">
        {/* Halo de glow */}
        <div className={clsx(
          "absolute inset-0 rounded-full blur-2xl opacity-50 group-hover:opacity-90 transition",
          hasAlarm
            ? "bg-gradient-to-br from-red-500 to-orange-500"
            : "bg-gradient-to-br from-cyan-400 to-indigo-500",
        )} />
        {/* Anneau pulse si alarme */}
        {hasAlarm && (
          <div className="absolute inset-0 rounded-full border-2 border-red-400/50 animate-ping" />
        )}
        {/* Orbe principale */}
        <div className={clsx(
          "relative w-16 h-16 rounded-full flex items-center justify-center shadow-2xl ring-2 transition transform group-hover:scale-110",
          hasAlarm
            ? "bg-gradient-to-br from-red-500 to-orange-500 ring-red-300/30"
            : "bg-gradient-to-br from-cyan-400 to-indigo-500 ring-cyan-300/30",
        )}>
          <Building2 className="h-7 w-7 text-white drop-shadow-lg" />
          {devices > 0 && (
            <span className="absolute -bottom-1 -right-1 min-w-[20px] h-5 px-1.5 bg-slate-900 border border-cyan-400/40 rounded-full text-[10px] font-bold text-cyan-300 flex items-center justify-center tabular-nums">
              {devices}
            </span>
          )}
        </div>
      </div>
      {/* Label */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 whitespace-nowrap">
        <div className="text-sm font-semibold text-white drop-shadow-lg group-hover:text-cyan-200 transition">
          {site.name}
        </div>
        {summary && (
          <div className="text-[11px] text-slate-400 mt-0.5 flex items-center justify-center gap-2">
            <span>{summary.rules_total} règle{summary.rules_total > 1 ? "s" : ""}</span>
            {hasAlarm && (
              <span className="text-red-400 font-medium">· {summary.alarms_total} alarme{summary.alarms_total > 1 ? "s" : ""}</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Layout : distribue les sites sur un ou deux cercles concentriques autour
// du centre. Garde de la marge en bas pour les labels.
// ---------------------------------------------------------------------------
function computePositions(sites: Site[], w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const usableR = Math.min(w, h) * 0.35;
  const N = sites.length;

  if (N === 0) return [];

  if (N === 1) {
    // Un seul site : positionné légèrement en haut pour laisser de la place
    // au hub central.
    return [{ site: sites[0], x: cx, y: cy - usableR * 0.6 }];
  }

  // Jusqu'à 8 sites : un seul cercle. Au-delà : deux cercles concentriques.
  if (N <= 8) {
    const startAngle = -Math.PI / 2; // commence en haut
    return sites.map((s, i) => {
      const angle = startAngle + (i / N) * 2 * Math.PI;
      return {
        site: s,
        x: cx + usableR * Math.cos(angle),
        y: cy + usableR * Math.sin(angle),
      };
    });
  }

  // N > 8 : ring externe + ring interne, alternés.
  const outerCount = Math.ceil(N * 0.6);
  const innerCount = N - outerCount;
  const outerR = usableR;
  const innerR = usableR * 0.55;
  const out: { site: Site; x: number; y: number }[] = [];
  for (let i = 0; i < outerCount; i++) {
    const angle = -Math.PI / 2 + (i / outerCount) * 2 * Math.PI;
    out.push({
      site: sites[i],
      x: cx + outerR * Math.cos(angle),
      y: cy + outerR * Math.sin(angle),
    });
  }
  for (let i = 0; i < innerCount; i++) {
    const angle = -Math.PI / 2 + Math.PI / innerCount + (i / innerCount) * 2 * Math.PI;
    out.push({
      site: sites[outerCount + i],
      x: cx + innerR * Math.cos(angle),
      y: cy + innerR * Math.sin(angle),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Étoiles décoratives en fond : positions et timings aléatoires fixes par
// rendu (seedés sur la taille). Évite les sauts visuels au resize.
// ---------------------------------------------------------------------------
function generateStars(count: number, w: number, h: number) {
  // Pseudo-random déterministe pour éviter les sauts visuels — seed sur la taille.
  let seed = Math.floor(w + h);
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: count }, () => ({
    x: rnd() * w,
    y: rnd() * h,
    r: 0.5 + rnd() * 1.5,
    opacity: 0.2 + rnd() * 0.7,
    delay: rnd() * 5,
    duration: 2 + rnd() * 4,
  }));
}
