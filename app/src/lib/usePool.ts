"use client";

/**
 * `usePool(seedKey)` / `usePoolMembers(seedKey)` — the app's read API for
 * devnet pool state.
 *
 * Since the poolStore refactor these are THIN SELECTORS over one shared
 * store (`poolStore.ts`): every mounted hook — the 14 on /home, the pair
 * per /grupos card — reads from a single sync loop that costs exactly TWO
 * RPC calls per tick (`getMultipleAccountsInfo` for all pools + one
 * program-wide member scan). Mounting more hooks adds zero RPC.
 *
 * The public contract is unchanged from the per-hook fetch era:
 *   - status: "loading" (nothing known yet) | "ok" (live chain data,
 *     possibly cache-seeded stale-while-revalidate) | "fallback" (pool
 *     absent or RPC failed with nothing cached — callers show fixtures);
 *   - `refresh()` — eager re-read after a write. Now refreshes the whole
 *     store (2 calls), which is still cheaper than one old roster scan;
 *   - `refreshMs` — treated as a REQUEST: the store runs at the fastest
 *     cadence any mounted subscriber asked for (floor 15s);
 *   - `enabled=false` (usePoolMembers) — returns the inert loading shape,
 *     exactly like the never-fetched state it used to be.
 */

import { useMemo } from "react";

import type { RawMemberView, RawPoolView } from "@roundfi/sdk";

import type { DevnetPoolKey } from "./devnet";
import { usePoolStore, type PoolEntryStatus } from "./poolStore";

export type UsePoolStatus = PoolEntryStatus;

export interface UsePoolResult {
  status: UsePoolStatus;
  pool: RawPoolView | null;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePool(seedKey: DevnetPoolKey, refreshMs = 30_000): UsePoolResult {
  const { state, refresh } = usePoolStore(refreshMs);
  const entry = state.pools[seedKey];
  return useMemo(() => ({ ...entry, refresh }), [entry, refresh]);
}

export type UsePoolMembersStatus = PoolEntryStatus;

export interface UsePoolMembersResult {
  status: UsePoolMembersStatus;
  members: RawMemberView[];
  error: string | null;
  refresh: () => Promise<void>;
}

// The shape a disabled hook used to sit in forever (no fetch ever fired).
const DISABLED_MEMBERS = {
  status: "loading" as UsePoolMembersStatus,
  members: [] as RawMemberView[],
  error: null,
};

export function usePoolMembers(
  seedKey: DevnetPoolKey,
  refreshMs = 30_000,
  enabled = true,
): UsePoolMembersResult {
  const { state, refresh } = usePoolStore(refreshMs);
  const entry = enabled ? state.members[seedKey] : DISABLED_MEMBERS;
  return useMemo(() => ({ ...entry, refresh }), [entry, refresh]);
}
