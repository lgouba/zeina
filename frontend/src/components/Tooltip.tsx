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
