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
 * that touched that member account — `join_pool` (created it), every
 * `contribute` (paid in), and a `claim_payout` (took the pot) — with zero
 * faucet / transfer noise a wallet-level scan would drag in. The oldest
 * signature is the join. To tell a contribution from a payout (both mutate the
 * member and neither is the oldest) we look at the wallet's USDC balance delta
 * in the tx: received → payout, paid → installment. Amounts + names come from
 * the same group catalog the cards render, so the ledger reads consistently.
 *
 * Cost: one `getSignaturesForAddress` per pool + one batched
 * `getParsedTransactions` for the not-yet-classified non-join signatures,
 * memoised per signature (a confirmed tx never changes its kind), so the
 * steady-state 30s refresh adds no RPC.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";

import { memberPda } from "@roundfi/sdk/pda";

import type { Transaction } from "@/data/carteira";
import { DISCOVER_GROUPS } from "@/data/groups";
import {
  DEVNET_POOLS,
  DEVNET_PROGRAM_IDS,
  DEVNET_USDC_MINT,
  type DevnetPoolKey,
} from "@/lib/devnet";
import { cacheGet, cacheSet } from "@/lib/poolCache";

// Pool display name + per-installment + prize (all BRL), sourced from the same
// catalogs the cards render from so the ledger labels/amounts stay in sync.
// `prize` is the pot the contemplated member receives — the amount shown on a
// claim_payout row.
type PoolMeta = { name: string; installment: number; prize: number };
const POOL_META: Partial<Record<DevnetPoolKey, PoolMeta>> = (() => {
  const out: Partial<Record<DevnetPoolKey, PoolMeta>> = {};
  // Real catalog only — a pool that exists solely as a demo fixture (pool3 ↔
  // "Renovação MEI") must not stamp a pitch name + demo amounts on a real
  // wallet's ledger rows; those fall back to "Pool N" + the on-chain delta.
  for (const d of DISCOVER_GROUPS) {
    if (d.devnetPool && !out[d.devnetPool])
      out[d.devnetPool] = { name: d.name, installment: d.installment, prize: d.prize };
  }
  return out;
})();

/** USDC balance change for `owner` across a parsed tx (post − pre), matched by
 *  owner + mint. Drives contribute-vs-payout classification: a `claim_payout`
 *  credits the member (delta > 0), a `contribute` debits them (delta < 0). */
function usdcDeltaFor(ptx: ParsedTransactionWithMeta | null, owner: string, mint: string): number {
  const meta = ptx?.meta;
  if (!meta) return 0;
  const find = (
    list:
      | { owner?: string; mint: string; uiTokenAmount: { uiAmount: number | null } }[]
      | null
      | undefined,
  ) => list?.find((b) => b.owner === owner && b.mint === mint)?.uiTokenAmount.uiAmount ?? 0;
  return find(meta.postTokenBalances) - find(meta.preTokenBalances);
}

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
  // signature → true once classified as a claim_payout (member received the
  // pot). Persists across the 30s refresh so each tx is decoded at most once;
  // rehydrated from poolCache on mount so it also survives reloads.
  const payoutCache = useRef<Map<string, boolean>>(new Map());
  // Wallet whose ledger sits in `state` — guards the SWR hydrate on switches.
  const walletRef = useRef<string | null>(null);

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
      const flat = perPool.flat();

      // Classify the non-join signatures we haven't seen yet by the wallet's
      // USDC delta (received → claim_payout, paid → contribute). One batched
      // RPC, memoised per signature; an RPC hiccup just leaves a sig
      // unclassified → it falls back to the "Parcela" label below.
      const walletStr = publicKey.toBase58();
      const mintStr = DEVNET_USDC_MINT.toBase58();
      const pending = flat
        .filter((e) => !e.isJoin && !payoutCache.current.has(e.sig))
        .map((e) => e.sig);
      if (pending.length > 0) {
        try {
          const parsed = await connection.getParsedTransactions(pending, {
            maxSupportedTransactionVersion: 0,
          });
          parsed.forEach((ptx, i) => {
            payoutCache.current.set(pending[i]!, usdcDeltaFor(ptx, walletStr, mintStr) > 0);
          });
        } catch {
          // RPC hiccup — leave unclassified; rows default to the parcela label.
        }
        if (cancelled.current) return;
      }

      const txs: Transaction[] = flat
        .sort((a, b) => b.blockTime - a.blockTime)
        .map((e) => {
          const meta = POOL_META[e.key];
          const name = meta?.name ?? `Pool ${e.key.replace("pool", "")}`;
          const isPayout = !e.isJoin && payoutCache.current.get(e.sig) === true;
          const label = e.isJoin
            ? `Entrada · ${name}`
            : isPayout
              ? `Prêmio · ${name}`
              : `Parcela · ${name}`;
          const amount = e.isJoin ? 0 : isPayout ? (meta?.prize ?? 0) : -(meta?.installment ?? 0);
          return {
            label,
            addr: e.sig,
            amount,
            ts: e.blockTime ? e.blockTime * 1000 : 0,
            date: e.blockTime ? relative(e.blockTime * 1000) : "—",
            seedKey: e.key,
          };
        });
      // Persist ledger + payout classification: reloads paint instantly and a
      // confirmed tx never re-pays the getParsedTransactions decode.
      const w = publicKey.toBase58();
      cacheSet("txhistory", w, txs);
      cacheSet("txclass", w, Object.fromEntries(payoutCache.current));
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
    // Stale-while-revalidate: paint the last-known ledger for THIS wallet
    // immediately (relative dates recomputed from the stored timestamps so a
    // cached "2h atrás" doesn't fossilize), rehydrate the signature→payout
    // memo so the classification survives reloads, then load() revalidates.
    const w = publicKey?.toBase58() ?? null;
    if (walletRef.current !== w) {
      walletRef.current = w;
      payoutCache.current = new Map(
        Object.entries(w ? (cacheGet<Record<string, boolean>>("txclass", w) ?? {}) : {}),
      );
      const cached = w ? cacheGet<Transaction[]>("txhistory", w) : null;
      setState(
        cached
          ? {
              status: "ok",
              txs: cached.map((t) => ({ ...t, date: t.ts ? relative(t.ts) : "—" })),
            }
          : { status: "loading", txs: [] },
      );
    }
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs, publicKey]);

  return { ...state, refresh: load };
}
