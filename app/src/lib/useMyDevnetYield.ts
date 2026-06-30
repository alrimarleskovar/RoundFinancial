"use client";

import { useMemo } from "react";
import { useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";

import {
  usePool,
  usePoolMembers,
  type UsePoolMembersResult,
  type UsePoolResult,
} from "@/lib/usePool";

// Aggregate on-chain yield across the pools the connected wallet is a member
// of. The yield engine (Kamino on mainnet, the `roundfi-yield-mock` adapter on
// devnet) deposits each Active pool's idle USDC; `yieldPrincipalDeposited` +
// `yieldAccrued` are real fields on the Pool account. This surfaces the genuine
// figures behind /carteira → Conexões' "Kamino" card in place of the static
// demo numbers.
//
// Member-gated — only YOUR pools count toward "your" yield — and read-only:
// returns zeroes when there's no wallet / no member pools / the RPC is
// unavailable, so the demo path is untouched for everyone else. Mirrors
// `useMyDevnetPositions`' per-pool usePool/usePoolMembers wiring (same fixed
// devnet set, hooks called unconditionally in a stable order).

export interface MyYield {
  status: "loading" | "ok" | "fallback";
  /** Σ yieldPrincipalDeposited across my pools, in whole USDC. */
  principalUsdc: number;
  /** Σ yieldAccrued across my pools, in whole USDC. */
  accruedUsdc: number;
  /** How many of my pools currently have principal deployed to yield. */
  poolCount: number;
}

interface Entry {
  pool: UsePoolResult;
  members: UsePoolMembersResult;
}

function aggregate(wallet: PublicKey | null, entries: Entry[]): MyYield {
  if (!wallet) return { status: "ok", principalUsdc: 0, accruedUsdc: 0, poolCount: 0 };
  let principal = 0n;
  let accrued = 0n;
  let poolCount = 0;
  let anyOk = false;
  let anyLoading = false;
  for (const { pool, members } of entries) {
    if (pool.status === "loading" || members.status === "loading") anyLoading = true;
    if (pool.status !== "ok" || !pool.pool || members.status !== "ok") continue;
    const mine = members.members.some((m) => m.wallet.equals(wallet) && !m.defaulted);
    if (!mine) continue;
    anyOk = true;
    principal += pool.pool.yieldPrincipalDeposited;
    accrued += pool.pool.yieldAccrued;
    if (pool.pool.yieldPrincipalDeposited > 0n) poolCount += 1;
  }
  return {
    status: anyOk ? "ok" : anyLoading ? "loading" : "fallback",
    principalUsdc: Number(principal) / 1e6,
    accruedUsdc: Number(accrued) / 1e6,
    poolCount,
  };
}

export function useMyDevnetYield(): MyYield {
  const { publicKey } = useAdapterWallet();
  const REFRESH_MS = 30_000;
  // Hooks called unconditionally + in a stable order; the devnet set is small +
  // fixed (lib/devnet.ts), same pools as useMyDevnetPositions.
  const pool1 = usePool("pool1", REFRESH_MS);
  const members1 = usePoolMembers("pool1", REFRESH_MS);
  const pool2 = usePool("pool2", REFRESH_MS);
  const members2 = usePoolMembers("pool2", REFRESH_MS);
  const pool3 = usePool("pool3", REFRESH_MS);
  const members3 = usePoolMembers("pool3", REFRESH_MS);
  const pool4 = usePool("pool4", REFRESH_MS);
  const members4 = usePoolMembers("pool4", REFRESH_MS);
  const pool7 = usePool("pool7", REFRESH_MS);
  const members7 = usePoolMembers("pool7", REFRESH_MS);

  return useMemo(
    () =>
      aggregate(publicKey, [
        { pool: pool1, members: members1 },
        { pool: pool2, members: members2 },
        { pool: pool3, members: members3 },
        { pool: pool4, members: members4 },
        { pool: pool7, members: members7 },
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
      pool7,
      members7,
    ],
  );
}
