import { useState } from "react";
import { Lightbulb, Power, Loader2 } from "lucide-react";
import clsx from "clsx";
import type { Device } from "../types/api";
import { useLiveState } from "../lib/liveStore";
import { api, HttpError } from "../lib/api";

interface Props {
  device: Device;
  siteSlug: string;
}

export function RelayCard({ device, siteSlug }: Props) {
  const live = useLiveState(siteSlug, device.slug) as { state?: string } | undefined;
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state: "on" | "off" | "?" = live?.state === "on" ? "on" : live?.state === "off" ? "off" : "?";

  async function send(target: "on" | "off") {
    setError(null);
    setPending(target);
    try {
      await api.post(`/v1/devices/${device.id}/command`, {
        action: "set",
        payload: { state: target },
      });
    } catch (e) {
      if (e instanceof HttpError) setError(e.payload.message);
      else setError("Erreur réseau");
    } finally {
      setPending(null);
    }
  }

  const isLight = device.slug.startsWith("relay-light");

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center gap-4">
      <div className={clsx(
        "rounded-lg p-3",
        state === "on" ? "bg-amber-500/15 text-amber-300" : "bg-slate-800 text-slate-500",
      )}>
        {isLight ? <Lightbulb className="h-5 w-5" /> : <Power className="h-5 w-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{device.name || device.slug}</div>
        <div className="text-xs text-slate-500 capitalize">État : <span className={state === "on" ? "text-amber-300" : "text-slate-400"}>{state}</span></div>
        {error && <div className="text-[11px] text-red-400 mt-1">{error}</div>}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => send("off")} disabled={pending !== null || state === "off"}
          className="px-2.5 py-1 text-xs rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition flex items-center gap-1">
          {pending === "off" && <Loader2 className="h-3 w-3 animate-spin" />}OFF
        </button>
        <button
          onClick={() => send("on")} disabled={pending !== null || state === "on"}
          className="px-2.5 py-1 text-xs rounded-md bg-brand-500 hover:bg-brand-400 disabled:opacity-40 transition flex items-center gap-1 text-white dark:text-slate-100">
          {pending === "on" && <Loader2 className="h-3 w-3 animate-spin" />}ON
        </button>
      </div>
    </div>
  );
}
