// Hook custom : connecte un WebSocket à l'API et délivre les messages parsés.
// Auto-reconnect avec backoff exponentiel borné. Stable entre re-renders.

import { useEffect, useRef, useState } from "react";
import { wsURL } from "../lib/api";
import { liveStore } from "../lib/liveStore";
import type { WSEnvelope } from "../types/api";

export type WSStatus = "connecting" | "open" | "closed";

export function useWebSocket(token: string | null, onMessage: (env: WSEnvelope) => void) {
  const [status, setStatus] = useState<WSStatus>("closed");
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!token) {
      liveStore.setStatus("closed");
      return;
    }
    let ws: WebSocket | null = null;
    let cancelled = false;
    let attempt = 0;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      liveStore.setStatus("connecting");
      ws = new WebSocket(wsURL(token));

      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
        liveStore.setStatus("open");
      };
      ws.onmessage = (evt) => {
        try {
          const env = JSON.parse(evt.data) as WSEnvelope;
          onMessageRef.current(env);
        } catch { /* ignore malformed */ }
      };
      ws.onerror = () => { /* close handler will retry */ };
      ws.onclose = () => {
        setStatus("closed");
        liveStore.setStatus("closed");
        if (cancelled) return;
        attempt += 1;
        const delay = Math.min(30_000, 500 * Math.pow(2, attempt));
        timeout = setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, [token]);

  return status;
}
