"use client";

/**
 * `usePoolRadar` — scans EVERY devnet pool at once and surfaces, per pool,
 * whether a permissionless crank is pending: a live contemplated member who
 * never claimed (`crank_payout`) or a member behind on contributions
 * (`settle_default`). This lets `/admin/cranker` answer "where is action
 * needed?" at a glance, instead of the operator opening each pool one by one.
 *
 * Fetch-only and wall-clock-independent: the hook returns the raw pool
 * essentials plus the two candidate summaries; the grace countdown and
 * eligibility (which depend on `now`) are derived by the caller against a
 * 1s-ticking clock. That keeps the 30s fetch poll decoupled from the 1s
 * countdown — the radar re-fetches rarely but the timers stay smooth.
 *
 * The eligibility rules mirror the two modals exactly:
 *   - payout: pool Active, `current_cycle < cycles_total`, the member at
 *     `slot == current_cycle` exists and is neither paid-out nor defaulted.
 *   - settle: `current_cycle > 0` and some member is behind
 *     (`contributions_paid < current_cycle`) and not defaulted.
 * The grace gate (`now >= next_cycle_at + GRACE_PERIOD_SECS`) is applied by the
 * caller — the same shared constant both modals use.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";

import { fetchPoolMembers, fetchPoolRaw } from "@roundfi/sdk";

import { DEVNET_POOLS, DEVNET_PROGRAM_IDS, type DevnetPoolKey } from "./devnet";

export type PoolRadarStatus = "forming" | "active" | "completed" | "liquidated" | "closed";

export interface PoolRadarEntry {
  key: DevnetPoolKey;
  /** Stable on-chain identity. A pool has NO on-chain name — its seed id and
   *  (authority, seed_id) PDA are the only things that say *which* pool a row
   *  is, so the radar surfaces them instead of leaning on the contemplated
   *  member's wallet address. Both come from `DEVNET_POOLS[key]` with no RPC,
   *  so they're set even on a failed scan. */
  seedId: bigint;
  pda: PublicKey;
  /** false when the RPC read / decode failed for this pool. */
  ok: boolean;
  status: PoolRadarStatus | null;
  currentCycle: number | null;
  cyclesTotal: number | null;
  nextCycleAt: bigint | null;
  creditAmount: bigint | null;
  /** The contemplated member (slot == current_cycle) who hasn't claimed yet
   *  and isn't defaulted — the `crank_payout` target. null when none. */
  payoutTarget: { wallet: PublicKey; slotIndex: number } | null;
  /** Count of members behind on contributions and not defaulted — the
   *  `settle_default` candidates. 0 when none. */
  settleCandidates: number;
}

export interface UsePoolRadarResult {
  entries: PoolRadarEntry[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const POOL_KEYS = Object.keys(DEVNET_POOLS) as DevnetPoolKey[];

function emptyEntry(key: DevnetPoolKey): PoolRadarEntry {
  return {
    key,
    seedId: DEVNET_POOLS[key].seedId,
    pda: DEVNET_POOLS[key].pda,
    ok: false,
    status: null,
    currentCycle: null,
    cyclesTotal: null,
    nextCycleAt: null,
    creditAmount: null,
    payoutTarget: null,
    settleCandidates: 0,
  };
}

async function scanPool(connection: Connection, key: DevnetPoolKey): Promise<PoolRadarEntry> {
  const target = DEVNET_POOLS[key];
  try {
    const [pool, members] = await Promise.all([
      fetchPoolRaw(connection, target.pda),
      fetchPoolMembers(connection, DEVNET_PROGRAM_IDS.core, target.pda),
    ]);
    if (!pool) return emptyEntry(key);

    const active = pool.status === "active";
    const inRange = pool.currentCycle < pool.cyclesTotal;
    const contemplated =
      active && inRange
        ? members.find((m) => m.slotIndex === pool.currentCycle && !m.paidOut && !m.defaulted)
        : undefined;
    const settleCandidates =
      pool.currentCycle > 0
        ? members.filter((m) => !m.defaulted && m.contributionsPaid < pool.currentCycle).length
        : 0;

    return {
      key,
      seedId: target.seedId,
      pda: target.pda,
      ok: true,
      status: pool.status,
      currentCycle: pool.currentCycle,
      cyclesTotal: pool.cyclesTotal,
      nextCycleAt: pool.nextCycleAt,
      creditAmount: pool.creditAmount,
      payoutTarget: contemplated
        ? { wallet: contemplated.wallet, slotIndex: contemplated.slotIndex }
        : null,
      settleCandidates,
    };
  } catch {
    return emptyEntry(key);
  }
}

export function usePoolRadar(refreshMs = 30_000): UsePoolRadarResult {
  const { connection } = useConnection();
  const [entries, setEntries] = useState<PoolRadarEntry[]>(() => POOL_KEYS.map(emptyEntry));
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const scanned = await Promise.all(POOL_KEYS.map((k) => scanPool(connection, k)));
      if (cancelledRef.current) return;
      setEntries(scanned);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs]);

  return { entries, loading, refresh: load };
}
