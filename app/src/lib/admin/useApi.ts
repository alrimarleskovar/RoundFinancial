"use client";

/** Tiny same-origin GET hook for the admin console's own API (ADR 0009 §3 —
 *  the UI calls only /api/admin/*, never RPC/DB directly). Surfaces HTTP
 *  status so the page can show "session expired" (401) vs a real error. */

import { useCallback, useEffect, useState } from "react";

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  status: number | null;
  reload: () => void;
}

export function useApi<T>(url: string): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

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

  return { data, loading, error, status, reload };
}
