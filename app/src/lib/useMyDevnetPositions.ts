"use client";

import { useMemo } from "react";

import { useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";

import type { RawMemberView, RawPoolView } from "@roundfi/sdk";

import type { NftPosition } from "@/data/carteira";
import type { DevnetPoolKey } from "@/lib/devnet";
import {
  usePool,
  usePoolMembers,
  type UsePoolMembersResult,
  type UsePoolResult,
} from "@/lib/usePool";

// Single source of truth for "your real on-chain cotas": surfaces the
// connected wallet's live Member slots across EVERY deployed devnet pool as
// sellable NftPositions. Used by /carteira → Positions and the /home cycles
// list so a real join_pool shows up natively (not just the session mock).
//
// Returns [] unless a connected wallet is a live (non-defaulted,
// non-paid-out) member of at least one pool, so the demo is unchanged for
// everyone else. Each pool is read on usePool's 30s cadence (read-only,
// graceful "fallback" when the pool/RPC is unavailable).

interface PoolEntry {
  key: DevnetPoolKey;
  pool: UsePoolResult;
  members: UsePoolMembersResult;
}

// Days until this member's NEXT installment is due, from the on-chain pool
// clock. The pivot is whether the member already paid the CURRENT cycle
// (contributionsPaid > currentCycle): if so, their next obligation is the
// NEXT cycle (≈ nextCycleAt + one cycle duration); otherwise it's this
// cycle's deadline (nextCycleAt). That's what makes the /home countdown
// advance the moment a payment lands — paying flips the member past the
// current cycle and the due date jumps forward a full cycle. A Forming /
// not-yet-active pool has no live deadline, so we fall back to the cycle
// cadence (its length in days) as a neutral placeholder.
function nextDueDaysFor(p: RawPoolView, m: RawMemberView): number {
  const cycleDays = Math.max(1, Math.round(Number(p.cycleDurationSec) / 86_400));
  if (p.status !== "active" || p.nextCycleAt <= 0n) return cycleDays;
  const paidThisCycle = m.contributionsPaid > p.currentCycle;
  const dueTsSec = paidThisCycle
    ? Number(p.nextCycleAt) + Number(p.cycleDurationSec)
    : Number(p.nextCycleAt);
  return Math.max(0, Math.ceil((dueTsSec * 1000 - Date.now()) / 86_400_000));
}

function collect(wallet: PublicKey | null, entries: PoolEntry[]): NftPosition[] {
  if (!wallet) return [];
  const out: NftPosition[] = [];
  for (const { key, pool, members } of entries) {
    if (pool.status !== "ok" || !pool.pool || members.status !== "ok") continue;
    const p = pool.pool;
    for (const m of members.members) {
      if (!m.wallet.equals(wallet) || m.defaulted || m.paidOut) continue;
      out.push({
        id: `onchain-${key}-${m.slotIndex}`,
        num: String(m.slotIndex).padStart(2, "0"),
        group: `Cota on-chain · pool ${p.seedId.toString()}`,
        tone: "t",
        month: m.contributionsPaid,
        total: p.membersTarget,
        exp: "devnet",
        value: Number(p.creditAmount) / 1e6,
        yieldPct: 0,
        devnetPool: key,
        slotIndex: m.slotIndex,
        nextDueDays: nextDueDaysFor(p, m),
      });
    }
  }
  return out;
}

export function useMyDevnetPositions(): NftPosition[] {
  const { publicKey } = useAdapterWallet();
  // 15s (vs the 30s default) so the /home hero countdown + cycle dial reflect
  // a fresh join/contribute within seconds rather than half a minute — the
  // keyed Helius RPC (primary on devnet) has the headroom for it.
  const REFRESH_MS = 15_000;
  // Hooks must be called unconditionally + in a stable order, so each devnet
  // pool is wired explicitly (the set is small + fixed in lib/devnet.ts).
  const pool1 = usePool("pool1", REFRESH_MS);
  const members1 = usePoolMembers("pool1", REFRESH_MS);
  const pool2 = usePool("pool2", REFRESH_MS);
  const members2 = usePoolMembers("pool2", REFRESH_MS);
  const pool3 = usePool("pool3", REFRESH_MS);
  const members3 = usePoolMembers("pool3", REFRESH_MS);
  const pool4 = usePool("pool4", REFRESH_MS);
  const members4 = usePoolMembers("pool4", REFRESH_MS);
  const pool6 = usePool("pool6", REFRESH_MS);
  const members6 = usePoolMembers("pool6", REFRESH_MS);

  return useMemo(
    () =>
      collect(publicKey, [
        { key: "pool1", pool: pool1, members: members1 },
        { key: "pool2", pool: pool2, members: members2 },
        { key: "pool3", pool: pool3, members: members3 },
        { key: "pool4", pool: pool4, members: members4 },
        // pool6 = the live "fast pool" team test (5 slots, 2-day cycle) —
        // surfaces each joined member's cota in /carteira + /home + /grupos.
        { key: "pool6", pool: pool6, members: members6 },
      ]),
    [
      publicKey,
      pool1,
      members1,
      pool2,
      members2,
      pool3,
      members3,
      pool4,
      members4,
      pool6,
      members6,
    ],
  );
}
