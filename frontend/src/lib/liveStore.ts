// Petit store en mémoire des dernières mesures live, alimenté par le hook
// useWebSocket via Layout. Les composants enfants s'abonnent par device ID
// + measurement et re-rendent à chaque nouveau point.
//
// Volontairement simple (pas de zustand/redux) pour le MVP.

import { useEffect, useState } from "react";
import type { WSEnvelope } from "../types/api";

type Listener<T> = (v: T) => void;

interface MeasurementPoint {
  ts: string; value: number; quality: string;
}

interface LiveStore {
  handle(env: WSEnvelope): void;
  subscribeMeasurement(siteSlug: string, deviceSlug: string, measurement: string, fn: Listener<MeasurementPoint>): () => void;
  subscribeState(siteSlug: string, deviceSlug: string, fn: Listener<unknown>): () => void;
  getLatestMeasurement(siteSlug: string, deviceSlug: string, measurement: string): MeasurementPoint | undefined;
  getLatestState(siteSlug: string, deviceSlug: string): unknown | undefined;
}

function keyM(site: string, device: string, m: string) { return `m:${site}/${device}/${m}`; }
function keyS(site: string, device: string) { return `s:${site}/${device}`; }

type WSStatus = "open" | "closed" | "connecting";

class Store implements LiveStore {
  private measurements = new Map<string, MeasurementPoint>();
  private states = new Map<string, unknown>();
  private listeners = new Map<string, Set<Listener<any>>>();
  private wsStatus: WSStatus = "connecting";
  private statusListeners = new Set<(s: WSStatus) => void>();

  setStatus(s: WSStatus) {
    this.wsStatus = s;
    for (const cb of this.statusListeners) cb(s);
  }
  getStatus(): WSStatus { return this.wsStatus; }
  subscribeStatus(cb: (s: WSStatus) => void) { this.statusListeners.add(cb); }
  unsubscribeStatus(cb: (s: WSStatus) => void) { this.statusListeners.delete(cb); }

  handle(env: WSEnvelope) {
    if (env.type === "measurement") {
      const k = keyM(env.site, env.device, env.measurement);
      const p: MeasurementPoint = { ts: env.ts, value: env.value, quality: env.quality };
      this.measurements.set(k, p);
      this.notify(k, p);
    } else if (env.type === "state") {
      const k = keyS(env.site, env.device);
      this.states.set(k, env.state);
      this.notify(k, env.state);
    }
  }

  private notify(k: string, v: unknown) {
    const set = this.listeners.get(k);
    if (!set) return;
    for (const fn of set) fn(v);
  }

  private addListener(k: string, fn: Listener<any>): () => void {
    let set = this.listeners.get(k);
    if (!set) { set = new Set(); this.listeners.set(k, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  subscribeMeasurement(site: string, device: string, m: string, fn: Listener<MeasurementPoint>) {
    return this.addListener(keyM(site, device, m), fn);
  }
  subscribeState(site: string, device: string, fn: Listener<unknown>) {
    return this.addListener(keyS(site, device), fn);
  }
  getLatestMeasurement(site: string, device: string, m: string) {
    return this.measurements.get(keyM(site, device, m));
  }
  getLatestState(site: string, device: string) {
    return this.states.get(keyS(site, device));
  }
}

export const liveStore = new Store();

// --- Hooks helpers ---------------------------------------------------------

export function useLiveMeasurement(site: string | null, device: string | null, measurement: string | null) {
  const [pt, setPt] = useState<MeasurementPoint | undefined>(
    site && device && measurement ? liveStore.getLatestMeasurement(site, device, measurement) : undefined
  );
  useEffect(() => {
    if (!site || !device || !measurement) return;
    const cur = liveStore.getLatestMeasurement(site, device, measurement);
    if (cur) setPt(cur);
    return liveStore.subscribeMeasurement(site, device, measurement, setPt);
  }, [site, device, measurement]);
  return pt;
}

export function useLiveState(site: string | null, device: string | null) {
  const [v, setV] = useState<unknown | undefined>(
    site && device ? liveStore.getLatestState(site, device) : undefined
  );
  useEffect(() => {
    if (!site || !device) return;
    const cur = liveStore.getLatestState(site, device);
    if (cur !== undefined) setV(cur);
    return liveStore.subscribeState(site, device, setV);
  }, [site, device]);
  return v;
}
