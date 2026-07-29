"use client";

/**
 * Poll the connected wallet's sealed free-bid envelope for a pool's
 * CURRENT cycle (ADR 0012 Fase 3).
 *
 * Two things depend on this read:
 *   - the panel's state machine (`hasEnvelope` / `envelopeRevealed`);
 *   - envelope RECOVERY — `commitHash` is what a returning bidder scans
 *     candidate amounts against when their local copy is gone.
 *
 * Deliberately NOT cached in `poolCache`: an envelope is per-wallet,
 * per-cycle and short-lived, and a stale "you have no envelope" would be
 * the one wrong answer that costs someone the auction.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { BID_STATE, fetchBidRaw, type RawBidView } from "@roundfi/sdk";
import { bidPda } from "@roundfi/sdk/pda";

import { DEVNET_POOLS, DEVNET_PROGRAM_IDS, type DevnetPoolKey } from "./devnet";

export interface UseBidResult {
  /** null when nothing was sealed for this (pool, cycle, wallet). */
  bid: RawBidView | null;
  /** The envelope's PDA — stable even before it exists. */
  bidPda: PublicKey | null;
  status: "idle" | "loading" | "ok";
  hasEnvelope: boolean;
  revealed: boolean;
  refresh: () => Promise<void>;
}

export function useBid(
  seedKey: DevnetPoolKey | null | undefined,
  cycle: number | null,
  bidder: PublicKey | null,
  enabled = true,
  refreshMs = 20_000,
): UseBidResult {
  const { connection } = useConnection();
  const active = !!seedKey && cycle !== null && !!bidder && enabled;
  const [state, setState] = useState<{ bid: RawBidView | null; status: "idle" | "loading" | "ok" }>(
    { bid: null, status: "idle" },
  );
  const cancelledRef = useRef(false);

  const pda =
    seedKey && cycle !== null && bidder
      ? bidPda(DEVNET_PROGRAM_IDS.core, DEVNET_POOLS[seedKey].pda, cycle, bidder)[0]
      : null;
  const pdaKey = pda?.toBase58() ?? null;

  const load = useCallback(async () => {
    if (!active || !pdaKey) return;
    try {
      const view = await fetchBidRaw(connection, new PublicKey(pdaKey));
      if (cancelledRef.current) return;
      setState({ bid: view, status: "ok" });
    } catch {
      if (cancelledRef.current) return;
      // Keep whatever we had. Reporting "no envelope" on an RPC hiccup is
      // the dangerous direction — it would offer a re-seal the program
      // rejects, or hide a reveal the bidder needs.
      setState((prev) => ({ bid: prev.bid, status: "ok" }));
    }
  }, [connection, active, pdaKey]);

  useEffect(() => {
    if (!active) {
      setState({ bid: null, status: "idle" });
      return;
    }
    cancelledRef.current = false;
    setState((prev) => (prev.status === "idle" ? { ...prev, status: "loading" } : prev));
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [load, active, refreshMs]);

  return {
    ...state,
    bidPda: pda,
    hasEnvelope: state.bid !== null,
    revealed: state.bid?.state === BID_STATE.Revealed,
    refresh: load,
  };
}
