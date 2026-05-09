import { useEffect, useMemo, useRef, useState } from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import { Pencil, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { WidgetRenderer } from "./widgets/WidgetRenderer";
import type { Widget, WidgetType } from "../types/api";

const ResponsiveGridLayout = WidthProvider(Responsive);

/**
 * DashboardGrid — wrapper react-grid-layout pour le dashboard ZEINA.
 *
 *   - 12 colonnes
 *   - Tailles par défaut intelligentes selon le type de widget
 *   - Drag/resize uniquement quand `locked === false`
 *   - Persist les changements (PUT /v1/dashboards/:id/layouts) avec debounce 800ms
 *   - Hover sur un widget → boutons crayon + corbeille (toujours actifs)
 */

interface Props {
  dashboardId: string;
  widgets: Widget[];
  locked: boolean;
  /** Si true, masque complètement les boutons d'édition/suppression. */
  readOnly?: boolean;
  onEdit: (w: Widget) => void;
  onDelete: (w: Widget) => void;
}

// --- Tailles par défaut par type (12-col grid, row height 80px) -----------
// Les valeurs sont choisies pour donner au widget l'espace minimum nécessaire
// à un affichage clair.
const DEFAULT_SIZE: Record<WidgetType, { w: number; h: number }> = {
  value: { w: 3, h: 3 },  // gros chiffre — petit carré
  state: { w: 3, h: 3 },  // bouton on/off — petit carré
  gauge: { w: 4, h: 4 },  // jauge — moyen
  line:  { w: 6, h: 4 },  // courbe — large pour bien voir
  area:  { w: 6, h: 4 },  // aire — large
  bar:   { w: 6, h: 4 },  // histogramme — large
  map:   { w: 8, h: 6 },  // carte — bien grand pour la lisibilité
};

const COLS = 12;
const ROW_HEIGHT = 80;
const SAVE_DEBOUNCE_MS = 800;

interface PositionedLayout extends Layout { i: string; }

export function DashboardGrid({ dashboardId, widgets, locked, readOnly, onEdit, onDelete }: Props) {
  // Construit la layout initiale : utilise widget.layout si présent, sinon
  // calcule un placement automatique en flow horizontal selon DEFAULT_SIZE.
  const initialLayout = useMemo(() => buildLayout(widgets), [widgets]);
  const [layout, setLayout] = useState<PositionedLayout[]>(initialLayout);

  // Re-sync quand la liste de widgets change (ajout/suppression)
  useEffect(() => {
    setLayout(buildLayout(widgets));
  }, [widgets]);

  // Debounced save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>(JSON.stringify(initialLayout));

  function scheduleSave(next: PositionedLayout[]) {
    const json = JSON.stringify(next.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })));
    if (json === lastSaved.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.put(`/v1/dashboards/${dashboardId}/layouts`, {
          layouts: next.map((l) => ({
            widget_id: l.i, x: l.x, y: l.y, w: l.w, h: l.h,
          })),
        });
        lastSaved.current = json;
      } catch (e) {
        console.error("save layout failed", e);
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function handleChange(next: Layout[]) {
    setLayout(next as PositionedLayout[]);
    if (!locked) scheduleSave(next as PositionedLayout[]);
  }

  return (
    <ResponsiveGridLayout
      className="layout"
      layouts={{ lg: layout, md: layout, sm: layout, xs: layout, xxs: layout }}
      breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
      cols={{ lg: COLS, md: COLS, sm: 8, xs: 4, xxs: 2 }}
      rowHeight={ROW_HEIGHT}
      isDraggable={!locked}
      isResizable={!locked}
      compactType="vertical"
      margin={[16, 16]}
      onLayoutChange={handleChange}
      draggableCancel=".no-drag"
    >
      {widgets.map((w) => (
        <div key={w.id} className="relative rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 transition group overflow-hidden shadow-sm hover:shadow-md dark:shadow-none">
          {!readOnly && (
            <div className="no-drag absolute top-2 right-2 flex items-center gap-1 z-20 opacity-0 group-hover:opacity-100 transition bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm px-1 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm">
              <button onClick={() => onEdit(w)}
                className="text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-300 transition p-1 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Modifier le widget">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => onDelete(w)}
                className="text-slate-600 dark:text-slate-300 hover:text-red-500 dark:hover:text-red-400 transition p-1 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Supprimer le widget">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="h-full">
            <WidgetRenderer widget={w} />
          </div>
        </div>
      ))}
    </ResponsiveGridLayout>
  );
}

// ---------------------------------------------------------------------------
// Placement automatique : utilise la layout stockée si présente, sinon
// applique la taille par défaut selon le type avec un flow horizontal simple.
// ---------------------------------------------------------------------------
function buildLayout(widgets: Widget[]): PositionedLayout[] {
  const out: PositionedLayout[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowMaxH = 0;

  for (const w of widgets) {
    const def = DEFAULT_SIZE[w.type] || { w: 4, h: 3 };
    const stored = w.layout || {};

    let x = stored.x;
    let y = stored.y;
    const W = stored.w ?? def.w;
    const H = stored.h ?? def.h;

    if (x === undefined || y === undefined) {
      // Pas de position stockée → placement auto en flow.
      if (cursorX + W > COLS) { cursorX = 0; cursorY += rowMaxH; rowMaxH = 0; }
      x = cursorX;
      y = cursorY;
      cursorX += W;
      rowMaxH = Math.max(rowMaxH, H);
    }
    out.push({ i: w.id, x, y, w: W, h: H, minW: 2, minH: 2 });
  }
  return out;
}
