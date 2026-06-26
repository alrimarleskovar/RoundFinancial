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

export function useReputation(refreshMs = 30_000): UseReputationResult {
  const { connection } = useConnection();
  const { publicKey } = useAdapterWallet();
  const [state, setState] = useState<Omit<UseReputationResult, "refresh">>({
    ...FRESH,
    status: "loading",
  });
  const cancelledRef = useRef(false);

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
      setState({
        status: "ok",
        exists: true,
        level: raw.level,
        score: Number(raw.score),
        cyclesCompleted: raw.cyclesCompleted,
        onTimePayments: raw.onTimePayments,
        latePayments: raw.latePayments,
        defaults: raw.defaults,
        totalParticipated: raw.totalParticipated,
      });
    } catch {
      if (cancelledRef.current) return;
      setState({ ...FRESH, status: "fallback" });
    }
  }, [connection, publicKey]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs]);

  return { ...state, refresh: load };
}
