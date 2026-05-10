import { Info } from "lucide-react";
import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * Help — petit pictogramme info (?) avec une infobulle au survol.
 * Utilise du CSS pur pour la transition d'opacité ; pas de portail (l'infobulle
 * peut donc être rognée par un parent à `overflow: hidden` — à éviter).
 */
export function Help({ children, className, side = "top" }: {
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "right";
}) {
  return (
    <span className={clsx("group relative inline-flex align-middle", className)}>
      <Info className="h-3.5 w-3.5 text-slate-400 hover:text-brand-500 cursor-help shrink-0" />
      <span
        role="tooltip"
        className={clsx(
          "absolute z-[60] w-64 p-2.5 text-xs leading-snug rounded-lg",
          "bg-slate-900 text-slate-100 dark:bg-slate-800 dark:border dark:border-slate-700",
          "shadow-xl",
          "opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150",
          side === "top"    && "left-1/2 -translate-x-1/2 bottom-full mb-2",
          side === "bottom" && "left-1/2 -translate-x-1/2 top-full mt-2",
          side === "right"  && "left-full top-1/2 -translate-y-1/2 ml-2",
        )}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * Tip — wrappe un élément quelconque (bouton, badge, icône) avec une infobulle
 * qui apparaît au survol. Plus joli que `title=` natif, accessible (role=tooltip).
 *
 *   <Tip content="Renvoyer le code d'activation">
 *     <button>...</button>
 *   </Tip>
 *
 * Pas de portail : l'infobulle peut être rognée par un parent overflow:hidden.
 * Pour ces cas, préférer `title=` natif.
 */
export function Tip({ content, side = "top", children }: {
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={clsx(
          "absolute z-[60] w-max max-w-xs px-2.5 py-1.5 text-xs leading-snug rounded-md whitespace-nowrap",
          "bg-slate-900 text-slate-50 dark:bg-slate-700 dark:border dark:border-slate-600",
          "shadow-lg",
          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none transition-opacity duration-150 delay-300",
          side === "top"    && "left-1/2 -translate-x-1/2 bottom-full mb-2",
          side === "bottom" && "left-1/2 -translate-x-1/2 top-full mt-2",
          side === "left"   && "right-full top-1/2 -translate-y-1/2 mr-2",
          side === "right"  && "left-full top-1/2 -translate-y-1/2 ml-2",
        )}
      >
        {content}
      </span>
    </span>
  );
}
