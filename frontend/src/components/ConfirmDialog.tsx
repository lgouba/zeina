// ConfirmDialog — modal de confirmation réutilisable.
//
// Usage :
//   const confirm = useConfirm();
//   const ok = await confirm({
//     title: "Supprimer ce site ?",
//     description: <>Le site <strong>{name}</strong> et toutes ses données seront supprimés.</>,
//     danger: true,
//     confirmLabel: "Supprimer définitivement",
//     requireText: name,        // optionnel : tape le nom pour confirmer
//   });
//   if (!ok) return;
//
// L'API est volontairement promesse-based pour remplacer les `confirm()`
// natifs sans changer le flow async.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Info, ShieldAlert, X } from "lucide-react";
import clsx from "clsx";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style dangereux (rouge + icône AlertTriangle). Pour les suppressions. */
  danger?: boolean;
  /** Style avertissement (orange). Pour actions risquées non destructives. */
  warning?: boolean;
  /** Si défini, l'utilisateur doit retaper ce texte exactement pour activer Confirmer. */
  requireText?: string;
  /** Label pendant l'action (laisse Confirmer pendant l'await du caller). */
  loadingLabel?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(Ctx);
  if (!fn) throw new Error("useConfirm must be used within ConfirmProvider");
  return fn;
}

interface PendingState {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending({ opts, resolve });
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    if (!pending) return;
    pending.resolve(ok);
    setPending(null);
  }, [pending]);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog opts={pending.opts} onClose={close} />}
    </Ctx.Provider>
  );
}

function ConfirmDialog({ opts, onClose }: { opts: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus initial : l'input texte si requireText, sinon le bouton Annuler
  // (par défaut sécurisant — un Entrée sans intention déclenche Annuler).
  useEffect(() => {
    if (opts.requireText) inputRef.current?.focus();
    else cancelRef.current?.focus();
  }, [opts.requireText]);

  // Esc pour annuler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canConfirm = !opts.requireText || text === opts.requireText;
  const tone = opts.danger ? "danger" : opts.warning ? "warning" : "info";

  const Icon = tone === "danger" ? AlertTriangle : tone === "warning" ? ShieldAlert : Info;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(false); }}
    >
      <div
        className={clsx(
          "w-full max-w-md rounded-2xl shadow-2xl border overflow-hidden",
          "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800",
          "animate-zoom-in",
        )}
      >
        {/* Header avec icône en gradient */}
        <div className="relative px-6 pt-6 pb-4">
          <button
            onClick={() => onClose(false)}
            className="absolute top-3 right-3 p-1.5 rounded-md text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-3">
            <div className={clsx(
              "rounded-full p-2.5 ring-4 shrink-0",
              tone === "danger"  && "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/10",
              tone === "warning" && "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/10",
              tone === "info"    && "bg-brand-500/10 text-brand-600 dark:text-brand-400 ring-brand-500/10",
            )}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{opts.title}</h2>
              {opts.description && (
                <div className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {opts.description}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Champ requireText si demandé */}
        {opts.requireText && (
          <div className="px-6 pb-2">
            <div className="rounded-md bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 p-3">
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Pour confirmer, saisissez : <code className="font-mono text-slate-700 dark:text-slate-200">{opts.requireText}</code>
              </label>
              <input
                ref={inputRef}
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canConfirm) onClose(true);
                }}
                className="block w-full mt-1 rounded bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-brand-500"
                placeholder={opts.requireText}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex justify-end gap-2 px-6 py-4 bg-slate-50 dark:bg-slate-950/50 border-t border-slate-200 dark:border-slate-800">
          <button
            ref={cancelRef}
            onClick={() => onClose(false)}
            className="px-4 py-2 text-sm rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
          >
            {opts.cancelLabel || "Annuler"}
          </button>
          <button
            onClick={() => onClose(true)}
            disabled={!canConfirm}
            className={clsx(
              "px-4 py-2 text-sm rounded-md text-white font-medium transition disabled:opacity-40 disabled:cursor-not-allowed",
              tone === "danger"  && "bg-red-500 hover:bg-red-400",
              tone === "warning" && "bg-amber-500 hover:bg-amber-400",
              tone === "info"    && "bg-brand-500 hover:bg-brand-400",
            )}
          >
            {opts.confirmLabel || "Confirmer"}
          </button>
        </div>
      </div>
    </div>
  );
}
