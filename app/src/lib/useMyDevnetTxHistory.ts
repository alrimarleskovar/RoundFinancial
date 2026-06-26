"use client";

/**
 * `useMyDevnetTxHistory()` — durable, refresh-surviving transaction history
 * for the connected wallet, read straight from chain.
 *
 * The session ledger (`recordTx` → SessionEvent) is optimistic + in-memory:
 * it shows an action the instant it confirms, but evaporates on a full page
 * reload. This hook is the persistent twin — it asks the RPC for the wallet's
 * real on-chain activity so /carteira's Transações survives F5.
 *
 * Strategy: for each deployed pool we derive the wallet's Member PDA and call
 * `getSignaturesForAddress(memberPda)`. That returns ONLY the transactions
 * that touched that member account — `join_pool` (which created it) + every
 * `contribute` (which mutated it) — with zero faucet / transfer noise that a
 * wallet-level signature scan would drag in. The oldest signature for a given
 * member is the join; the rest are installments. Amounts + names come from the
 * same group catalog the cards render, so the ledger reads consistently.
 *
 * Classification is order-based (oldest = join) rather than per-tx decode: it
 * is correct for the join→contribute→… path the test exercises and keeps this
 * to one RPC round-trip per pool instead of one per signature.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { memberPda } from "@roundfi/sdk/pda";

import type { Transaction } from "@/data/carteira";
import { ACTIVE_GROUPS, DISCOVER_GROUPS } from "@/data/groups";
import { DEVNET_POOLS, DEVNET_PROGRAM_IDS, type DevnetPoolKey } from "@/lib/devnet";

// Pool display name + per-installment (BRL), sourced from the same catalogs
// the cards render from so the ledger labels/amounts stay in sync.
const POOL_META: Partial<Record<DevnetPoolKey, { name: string; installment: number }>> = (() => {
  const out: Partial<Record<DevnetPoolKey, { name: string; installment: number }>> = {};
  for (const g of ACTIVE_GROUPS) {
    if (g.devnetPool && !out[g.devnetPool])
      out[g.devnetPool] = { name: g.name, installment: g.installment };
  }
  for (const d of DISCOVER_GROUPS) {
    if (d.devnetPool && !out[d.devnetPool])
      out[d.devnetPool] = { name: d.name, installment: d.installment };
  }
  return out;
})();

function relative(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}m atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

export interface UseTxHistoryResult {
  status: "loading" | "ok" | "fallback";
  txs: Transaction[];
  refresh: () => Promise<void>;
}

export function useMyDevnetTxHistory(refreshMs = 30_000): UseTxHistoryResult {
  const { connection } = useConnection();
  const { publicKey } = useAdapterWallet();
  const [state, setState] = useState<{ status: UseTxHistoryResult["status"]; txs: Transaction[] }>({
    status: "loading",
    txs: [],
  });
  const cancelled = useRef(false);

  const load = useCallback(async () => {
    if (!publicKey) {
      setState({ status: "ok", txs: [] });
      return;
    }
    try {
      const keys = Object.keys(DEVNET_POOLS) as DevnetPoolKey[];
      const perPool = await Promise.all(
        keys.map(async (key) => {
          const [mPda] = memberPda(DEVNET_PROGRAM_IDS.core, DEVNET_POOLS[key].pda, publicKey);
          const sigs = await connection.getSignaturesForAddress(mPda, { limit: 20 });
          // getSignaturesForAddress is newest-first, so the LAST entry is the
          // oldest = the join_pool that created this member account.
          return sigs.map((s, i) => ({
            key,
            sig: s.signature,
            blockTime: s.blockTime ?? 0,
            isJoin: i === sigs.length - 1,
          }));
        }),
      );
      if (cancelled.current) return;
      const txs: Transaction[] = perPool
        .flat()
        .sort((a, b) => b.blockTime - a.blockTime)
        .map((e) => {
          const meta = POOL_META[e.key];
          const name = meta?.name ?? `Pool ${e.key.replace("pool", "")}`;
          return {
            label: e.isJoin ? `Entrada · ${name}` : `Parcela · ${name}`,
            addr: e.sig,
            amount: e.isJoin ? 0 : -(meta?.installment ?? 0),
            date: e.blockTime ? relative(e.blockTime * 1000) : "—",
          };
        });
      setState({ status: "ok", txs });
    } catch {
      // RPC hiccup / rate-limit — keep whatever we had, fall back to the
      // session ledger. No throw: the ledger is a read-only convenience.
      if (cancelled.current) return;
      setState((prev) => ({ status: "fallback", txs: prev.txs }));
    }
  }, [connection, publicKey]);

  useEffect(() => {
    cancelled.current = false;
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs]);

  return { ...state, refresh: load };
}
