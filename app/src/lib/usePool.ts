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
 * cycle / claim boundaries; aggressive polling is wasted RPC). Callers
 * that just performed a write (contribute, claim_payout, …) can invoke
 * the returned `refresh()` to get an immediate re-fetch instead of
 * waiting up to a full poll interval.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";

import { fetchPoolMembers, fetchPoolRaw, type RawMemberView, type RawPoolView } from "@roundfi/sdk";

import { DEVNET_POOLS, DEVNET_PROGRAM_IDS, type DevnetPoolKey } from "./devnet";

export type UsePoolStatus = "loading" | "ok" | "fallback";

export interface UsePoolResult {
  status: UsePoolStatus;
  pool: RawPoolView | null;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePool(seedKey: DevnetPoolKey, refreshMs = 30_000): UsePoolResult {
  const { connection } = useConnection();
  const [state, setState] = useState<{
    status: UsePoolStatus;
    pool: RawPoolView | null;
    error: string | null;
  }>({
    status: "loading",
    pool: null,
    error: null,
  });
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    const target = DEVNET_POOLS[seedKey];
    try {
      const view = await fetchPoolRaw(connection, target.pda);
      if (cancelledRef.current) return;
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
      if (cancelledRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: "fallback", pool: null, error: message });
    }
  }, [connection, seedKey]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs]);

  return { ...state, refresh: load };
}

export type UsePoolMembersStatus = "loading" | "ok" | "fallback";

export interface UsePoolMembersResult {
  status: UsePoolMembersStatus;
  members: RawMemberView[];
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * `usePoolMembers(seedKey)` — enumerates every Member account attached to
 * the given devnet pool via `getProgramAccounts` (dataSize + memcmp on
 * the pool field). Refreshes on the same cadence as `usePool`, plus
 * exposes a `refresh()` callback for eager re-fetch after a write.
 *
 * Returns an empty list on RPC failure or when the pool has no members
 * yet (status="fallback") so callers can render a graceful empty state.
 */
export function usePoolMembers(seedKey: DevnetPoolKey, refreshMs = 30_000): UsePoolMembersResult {
  const { connection } = useConnection();
  const [state, setState] = useState<{
    status: UsePoolMembersStatus;
    members: RawMemberView[];
    error: string | null;
  }>({
    status: "loading",
    members: [],
    error: null,
  });
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    const target = DEVNET_POOLS[seedKey];
    try {
      const list = await fetchPoolMembers(connection, DEVNET_PROGRAM_IDS.core, target.pda);
      if (cancelledRef.current) return;
      setState({ status: "ok", members: list, error: null });
    } catch (err) {
      if (cancelledRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: "fallback", members: [], error: message });
    }
  }, [connection, seedKey]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs]);

  return { ...state, refresh: load };
}
