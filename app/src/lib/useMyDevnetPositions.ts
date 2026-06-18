"use client";

import { useMemo } from "react";

import { useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";

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
      });
    }
  }
  return out;
}

export function useMyDevnetPositions(): NftPosition[] {
  const { publicKey } = useAdapterWallet();
  // Hooks must be called unconditionally + in a stable order, so each devnet
  // pool is wired explicitly (the set is small + fixed in lib/devnet.ts).
  const pool1 = usePool("pool1");
  const members1 = usePoolMembers("pool1");
  const pool2 = usePool("pool2");
  const members2 = usePoolMembers("pool2");
  const pool3 = usePool("pool3");
  const members3 = usePoolMembers("pool3");
  const pool4 = usePool("pool4");
  const members4 = usePoolMembers("pool4");

  return useMemo(
    () =>
      collect(publicKey, [
        { key: "pool1", pool: pool1, members: members1 },
        { key: "pool2", pool: pool2, members: members2 },
        { key: "pool3", pool: pool3, members: members3 },
        { key: "pool4", pool: pool4, members: members4 },
      ]),
    [publicKey, pool1, members1, pool2, members2, pool3, members3, pool4, members4],
  );
}
