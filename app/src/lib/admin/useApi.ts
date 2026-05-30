"use client";

/** Tiny same-origin GET hook for the admin console's own API (ADR 0009 §3 —
 *  the UI calls only /api/admin/*, never RPC/DB directly). Surfaces HTTP
 *  status so the page can show "session expired" (401) vs a real error.
 *
 *  Optional auto-refresh: pass `{ intervalMs }` and the hook will re-fetch
 *  every N ms while the tab is foregrounded (Page Visibility API). On
 *  becoming visible again, it fetches once immediately so a stale view is
 *  never shown after the user comes back. */

import { useCallback, useEffect, useState } from "react";

export interface ApiOptions {
  intervalMs?: number;
}

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  status: number | null;
  reload: () => void;
}

export function useApi<T>(url: string, options?: ApiOptions): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const intervalMs = options?.intervalMs ?? 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        setStatus(res.status);
        if (!res.ok) {
          setError(res.status === 401 ? "session_expired" : `http_${res.status}`);
          setData(null);
          return;
        }
        setData((await res.json()) as T);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "fetch_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, nonce]);

  useEffect(() => {
    if (intervalMs <= 0) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const isVisible = () =>
      typeof document === "undefined" || document.visibilityState !== "hidden";
    const start = () => {
      if (!timer) timer = setInterval(() => setNonce((n) => n + 1), intervalMs);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVis = () => {
      if (isVisible()) {
        setNonce((n) => n + 1);
        start();
      } else {
        stop();
      }
    };
    if (isVisible()) start();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
  }, [intervalMs]);

  return { data, loading, error, status, reload };
}
