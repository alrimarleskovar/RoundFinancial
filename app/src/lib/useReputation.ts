"use client";

// useReputation() — reads the connected wallet's on-chain ReputationProfile
// (score + level + payment counters) from the devnet reputation program,
// IDL-free via the SDK's `fetchReputationProfileRaw`. This is the SAME read
// the admin API already runs server-side; here it's wired into the USER
// dashboard so /home, /reputacao and /insights show the wallet's REAL
// score/level instead of the static "Maria Luísa" fixture.
//
// A wallet that never participated has no ReputationProfile PDA. The program
// treats that as level 1 / score 0, so we mirror that default (exists:false)
// rather than erroring — that IS the correct empty-state for a fresh wallet.
// An RPC failure yields status:"fallback" so callers can say "unavailable"
// instead of showing a misleading zero.

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { fetchReputationProfileRaw } from "@roundfi/sdk";

import { DEVNET_PROGRAM_IDS } from "./devnet";
import { cacheGet, cacheSet } from "./poolCache";

export type UseReputationStatus = "loading" | "ok" | "fallback";

export interface UseReputationResult {
  status: UseReputationStatus;
  /** true iff an on-chain ReputationProfile exists for this wallet. */
  exists: boolean;
  level: number;
  score: number;
  cyclesCompleted: number;
  onTimePayments: number;
  latePayments: number;
  defaults: number;
  totalParticipated: number;
  refresh: () => Promise<void>;
}

const FRESH: Omit<UseReputationResult, "refresh"> = {
  status: "ok",
  exists: false,
  level: 1,
  score: 0,
  cyclesCompleted: 0,
  onTimePayments: 0,
  latePayments: 0,
  defaults: 0,
  totalParticipated: 0,
};

// The cacheable slice of the result (status is derived, refresh is a fn).
type ProfileSnapshot = Omit<UseReputationResult, "refresh" | "status">;

export function useReputation(refreshMs = 30_000): UseReputationResult {
  const { connection } = useConnection();
  const { publicKey } = useAdapterWallet();
  const [state, setState] = useState<Omit<UseReputationResult, "refresh">>({
    ...FRESH,
    status: "loading",
  });
  const cancelledRef = useRef(false);
  // Wallet whose snapshot sits in `state` — guards the SWR hydrate on wallet
  // switches (one wallet's score must never paint under another's key).
  const walletRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!publicKey) {
      setState({ ...FRESH, status: "ok" });
      return;
    }
    try {
      const raw = await fetchReputationProfileRaw(
        connection,
        DEVNET_PROGRAM_IDS.reputation,
        publicKey,
      );
      if (cancelledRef.current) return;
      if (!raw) {
        // No PDA → fresh wallet: level 1 / score 0 (program default).
        setState({ ...FRESH, status: "ok" });
        return;
      }
      const snapshot: ProfileSnapshot = {
        exists: true,
        level: raw.level,
        score: Number(raw.score),
        cyclesCompleted: raw.cyclesCompleted,
        onTimePayments: raw.onTimePayments,
        latePayments: raw.latePayments,
        defaults: raw.defaults,
        totalParticipated: raw.totalParticipated,
      };
      cacheSet("profile", publicKey.toBase58(), snapshot);
      setState({ status: "ok", ...snapshot });
    } catch {
      if (cancelledRef.current) return;
      // RPC hiccup: keep the last-known REAL score (from cache or a prior
      // poll) instead of wiping to score 0 — flashing a zeroed passport over
      // real reputation is worse than a stale one. Status still signals it.
      setState((prev) =>
        prev.exists ? { ...prev, status: "fallback" } : { ...FRESH, status: "fallback" },
      );
    }
  }, [connection, publicKey]);

  useEffect(() => {
    cancelledRef.current = false;
    // Stale-while-revalidate: paint the last-known profile for THIS wallet
    // immediately; load() revalidates. A wallet switch resets instead of
    // leaking the previous wallet's numbers.
    const w = publicKey?.toBase58() ?? null;
    if (walletRef.current !== w) {
      walletRef.current = w;
      const cached = w ? cacheGet<ProfileSnapshot>("profile", w) : null;
      setState(cached ? { status: "ok", ...cached } : { ...FRESH, status: "loading" });
    }
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs, publicKey]);

  return { ...state, refresh: load };
}
