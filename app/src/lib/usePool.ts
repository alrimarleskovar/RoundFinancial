"use client";

/**
 * `usePool(seedKey)` — React hook that reads a deployed devnet pool's
 * on-chain state via the wallet adapter's Connection and decodes it
 * with the IDL-free `fetchPoolRaw` helper from `@roundfi/sdk`.
 *
 * The hook is intentionally read-only and fallback-friendly: if the
 * RPC is down, the pool doesn't exist, or the user is on a different
 * cluster, it returns `{ status: "fallback", pool: null }` so callers
 * can fall back to mock fixtures cleanly.
 *
 * Refreshes every `refreshMs` ms (default 30s — pools advance only on
 * cycle / claim boundaries; aggressive polling is wasted RPC).
 */

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";

import { fetchPoolRaw, type RawPoolView } from "@roundfi/sdk";

import { DEVNET_POOLS, type DevnetPoolKey } from "./devnet";

export type UsePoolStatus = "loading" | "ok" | "fallback";

export interface UsePoolResult {
  status: UsePoolStatus;
  pool: RawPoolView | null;
  error: string | null;
}

export function usePool(seedKey: DevnetPoolKey, refreshMs = 30_000): UsePoolResult {
  const { connection } = useConnection();
  const [state, setState] = useState<UsePoolResult>({
    status: "loading",
    pool: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const target = DEVNET_POOLS[seedKey];

    async function load() {
      try {
        const view = await fetchPoolRaw(connection, target.pda);
        if (cancelled) return;
        if (!view) {
          setState({
            status: "fallback",
            pool: null,
            error: `Pool ${seedKey} not found at ${target.pda.toBase58()}`,
          });
          return;
        }
        setState({ status: "ok", pool: view, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "fallback", pool: null, error: message });
      }
    }

    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [connection, seedKey, refreshMs]);

  return state;
}
