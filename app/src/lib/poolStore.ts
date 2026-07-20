"use client";

/**
 * poolStore — ONE shared sync loop for every devnet pool the app shows.
 *
 * Before this store, each mounted hook fetched its own pool: /home mounted
 * 7× usePool + 7× usePoolMembers (14 RPC calls per 15s tick), and every
 * /grupos card mounted the same pair AGAIN on its own 30s cadence. The
 * roster scans (`getProgramAccounts`) are the slowest reads on the page,
 * so a cold first visit burned ~5s just fanning out.
 *
 * Now there is exactly ONE poll loop for the whole app, and it costs TWO
 * RPC calls per tick regardless of how many pools/cards are mounted:
 *   1. `fetchPoolsRaw`      — getMultipleAccountsInfo(all pool PDAs);
 *   2. `fetchAllPoolMembers` — one dataSize-only scan of every Member
 *      account the program owns (dozens of 187-byte accounts on devnet),
 *      grouped by pool client-side.
 *
 * usePool / usePoolMembers keep their exact public contract (status /
 * data / error / refresh) but are now thin `useSyncExternalStore`
 * selectors over this store — mounting more of them adds ZERO RPC.
 *
 * Freshness/consistency properties:
 *   - state is seeded synchronously from poolCache (PR #631), so pages
 *     still paint the last-known state instantly; the first batched sync
 *     replaces it — stale-while-revalidate end to end;
 *   - every successful sync writes back through poolCache, keeping the
 *     hydration path warm for the next navigation/reload;
 *   - a transient RPC failure KEEPS the last-known snapshot (records the
 *     error, never wipes) — same policy the per-hook loads had;
 *   - a pool account that genuinely disappeared → status "fallback" and
 *     its cache entry is dropped (no resurrection of closed pools);
 *   - `refresh()` (post-write eager re-read) coalesces: concurrent calls
 *     share one in-flight sync instead of stampeding the RPC.
 *
 * The loop runs only while at least one subscriber is mounted, at the
 * fastest cadence any subscriber asked for (min refreshMs, floor 15s —
 * the keyed Helius RPC has the headroom; public RPCs see 7× FEWER calls
 * than before even so).
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";

import {
  fetchAllPoolMembers,
  fetchPoolsRaw,
  type RawMemberView,
  type RawPoolView,
} from "@roundfi/sdk";

import { DEVNET_POOLS, DEVNET_PROGRAM_IDS, type DevnetPoolKey } from "./devnet";
import { cacheDelete, cacheGet, cacheSet } from "./poolCache";

export type PoolEntryStatus = "loading" | "ok" | "fallback";

export interface StorePoolEntry {
  status: PoolEntryStatus;
  pool: RawPoolView | null;
  error: string | null;
}

export interface StoreMembersEntry {
  status: PoolEntryStatus;
  members: RawMemberView[];
  error: string | null;
}

export interface PoolStoreState {
  pools: Record<DevnetPoolKey, StorePoolEntry>;
  members: Record<DevnetPoolKey, StoreMembersEntry>;
}

const POOL_KEYS = Object.keys(DEVNET_POOLS) as DevnetPoolKey[];
const MIN_REFRESH_MS = 15_000;

function cacheKeyFor(key: DevnetPoolKey): string {
  return `${key}:${DEVNET_POOLS[key].pda.toBase58()}`;
}

/** Pure: group the program-wide member scan by devnet pool key. Members of
 *  pools the app doesn't track (other seeds on the shared program) drop. */
export function groupMembersByPool(
  members: RawMemberView[],
  poolPdas: Record<DevnetPoolKey, string>,
): Record<DevnetPoolKey, RawMemberView[]> {
  const byPda = new Map<string, DevnetPoolKey>(
    (Object.entries(poolPdas) as [DevnetPoolKey, string][]).map(([k, pda]) => [pda, k]),
  );
  const out = {} as Record<DevnetPoolKey, RawMemberView[]>;
  for (const k of POOL_KEYS) out[k] = [];
  for (const m of members) {
    const key = byPda.get(m.pool.toBase58());
    if (key) out[key].push(m);
  }
  return out;
}

/** Initial state: seeded from poolCache so the first paint after mount is
 *  the last-known chain state, not a blank "loading". */
function seededState(): PoolStoreState {
  const pools = {} as PoolStoreState["pools"];
  const members = {} as PoolStoreState["members"];
  for (const key of POOL_KEYS) {
    const ck = cacheKeyFor(key);
    const cachedPool = cacheGet<RawPoolView>("pool", ck);
    const cachedMembers = cacheGet<RawMemberView[]>("members", ck);
    pools[key] = cachedPool
      ? { status: "ok", pool: cachedPool, error: null }
      : { status: "loading", pool: null, error: null };
    members[key] = cachedMembers
      ? { status: "ok", members: cachedMembers, error: null }
      : { status: "loading", members: [], error: null };
  }
  return { pools, members };
}

type Listener = () => void;

// setInterval exists in both universes (browser + node test imports); the
// handle type differs, so derive it. The loop itself only starts client-side.
type TimerHandle = ReturnType<typeof setInterval>;
const IS_BROWSER = !!(globalThis as { document?: unknown }).document;

class PoolStore {
  private state: PoolStoreState | null = null; // lazy — cache read on first use
  private listeners = new Set<Listener>();
  private connection: Connection | null = null;
  private timer: TimerHandle | null = null;
  private cadenceMs = MIN_REFRESH_MS;
  private inFlight: Promise<void> | null = null;
  private lastSyncAt = 0;

  getState(): PoolStoreState {
    if (!this.state) this.state = seededState();
    return this.state;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    this.ensureLoop();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopLoop();
    };
  };

  /** Latest adapter connection + fastest cadence any subscriber wants. */
  configure(connection: Connection, refreshMs: number): void {
    this.connection = connection;
    const wanted = Math.max(MIN_REFRESH_MS, refreshMs);
    if (wanted < this.cadenceMs) {
      this.cadenceMs = wanted;
      this.restartLoopIfRunning();
    }
    // A subscriber exists but the first sync never ran (configure can land
    // after subscribe) — kick it.
    if (this.listeners.size > 0 && this.lastSyncAt === 0 && !this.inFlight) {
      void this.sync();
    }
  }

  /** Eager re-read after a write. Coalesces concurrent callers. */
  refresh = async (): Promise<void> => {
    await this.sync();
  };

  private ensureLoop(): void {
    if (this.timer !== null) return;
    if (!IS_BROWSER) return;
    this.timer = setInterval(() => void this.sync(), this.cadenceMs);
    if (this.lastSyncAt === 0 && !this.inFlight) void this.sync();
  }

  private stopLoop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private restartLoopIfRunning(): void {
    if (this.timer === null) return;
    this.stopLoop();
    this.ensureLoop();
  }

  private emit(next: PoolStoreState): void {
    this.state = next;
    for (const l of this.listeners) l();
  }

  private async sync(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const connection = this.connection;
    if (!connection) return;
    this.inFlight = this.doSync(connection).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doSync(connection: Connection): Promise<void> {
    const prev = this.getState();
    try {
      // The whole app's read set in exactly two RPC calls.
      const pdas = POOL_KEYS.map((k) => DEVNET_POOLS[k].pda);
      const [poolViews, allMembers] = await Promise.all([
        fetchPoolsRaw(connection, pdas),
        fetchAllPoolMembers(connection, DEVNET_PROGRAM_IDS.core),
      ]);
      const grouped = groupMembersByPool(
        allMembers,
        Object.fromEntries(POOL_KEYS.map((k) => [k, DEVNET_POOLS[k].pda.toBase58()])) as Record<
          DevnetPoolKey,
          string
        >,
      );

      const pools = {} as PoolStoreState["pools"];
      const members = {} as PoolStoreState["members"];
      POOL_KEYS.forEach((key, i) => {
        const view = poolViews[i] ?? null;
        const ck = cacheKeyFor(key);
        if (view) {
          cacheSet("pool", ck, view);
          pools[key] = { status: "ok", pool: view, error: null };
        } else {
          // Account genuinely absent — mirror the old per-hook policy:
          // fall back AND drop the cache entry (closed/re-pinned pools
          // must not resurrect from cache on the next mount).
          cacheDelete("pool", ck);
          pools[key] = {
            status: "fallback",
            pool: null,
            error: `Pool ${key} not found at ${DEVNET_POOLS[key].pda.toBase58()}`,
          };
        }
        const roster = grouped[key];
        cacheSet("members", ck, roster);
        members[key] = { status: "ok", members: roster, error: null };
      });

      this.lastSyncAt = Date.now();
      this.emit({ pools, members });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Transient RPC failure: keep every last-known snapshot, record the
      // error; entries that never loaded fall back so mock fixtures show.
      const pools = {} as PoolStoreState["pools"];
      const members = {} as PoolStoreState["members"];
      for (const key of POOL_KEYS) {
        const p = prev.pools[key];
        pools[key] = p.pool
          ? { ...p, error: message }
          : { status: "fallback", pool: null, error: message };
        const m = prev.members[key];
        members[key] = m.members.length
          ? { ...m, error: message }
          : { status: "fallback", members: [], error: message };
      }
      this.emit({ pools, members });
    }
  }
}

const store = new PoolStore();

// Server snapshot: stable all-loading state (never touches localStorage).
let serverSnapshot: PoolStoreState | null = null;
function getServerSnapshot(): PoolStoreState {
  if (!serverSnapshot) {
    const pools = {} as PoolStoreState["pools"];
    const members = {} as PoolStoreState["members"];
    for (const key of POOL_KEYS) {
      pools[key] = { status: "loading", pool: null, error: null };
      members[key] = { status: "loading", members: [], error: null };
    }
    serverSnapshot = { pools, members };
  }
  return serverSnapshot;
}

/** Subscribe to the shared store. Every caller shares ONE sync loop. */
export function usePoolStore(refreshMs: number = MIN_REFRESH_MS): {
  state: PoolStoreState;
  refresh: () => Promise<void>;
} {
  const { connection } = useConnection();
  const state = useSyncExternalStore(store.subscribe, () => store.getState(), getServerSnapshot);
  useEffect(() => {
    store.configure(connection, refreshMs);
  }, [connection, refreshMs]);
  const refresh = useCallback(() => store.refresh(), []);
  return useMemo(() => ({ state, refresh }), [state, refresh]);
}
