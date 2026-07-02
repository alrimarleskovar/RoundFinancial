"use client";

/**
 * `useScoreTimeline()` — the TRUE score-over-time curve for the connected
 * wallet, replayed from its on-chain Attestation records.
 *
 * Each scoring attestation (payment / late / default / pool-complete) carries
 * the exact delta the reputation program applied — including the +5 halving for
 * an unverified payment and the 0 for a neutralized pool-complete — plus its
 * `issued_at` timestamp. Stepping through them in order reproduces the real
 * climb (and any dips), and the endpoint equals the on-chain `profile.score` by
 * construction. This is the honest replacement for the payment-timestamp
 * INTERPOLATION in `reconstructScoreHistory` (which could only draw a straight
 * line to the current total).
 *
 * `getProgramAccounts` is unindexed on public RPCs, so a failure yields
 * status:"fallback" (callers keep the prior curve / drop to the reconstruction)
 * rather than a hard error.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { fetchAttestationsForSubject } from "@roundfi/sdk";

import { buildScoreTimeline, type ScoreAttestation, type ScorePoint } from "@/data/insights";
import { DISCOVER_GROUPS } from "@/data/groups";
import { DEVNET_POOLS, DEVNET_PROGRAM_IDS, type DevnetPoolKey } from "./devnet";

// Attestation issuer (the pool PDA, for the contribute / settle paths) → the
// pool's display name, so a vertex can say WHICH group moved the score. Real
// catalog only (a demo-fixture pool falls back to no name, still valid).
const POOL_NAME_BY_ISSUER: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const key of Object.keys(DEVNET_POOLS) as DevnetPoolKey[]) {
    const g = DISCOVER_GROUPS.find((d) => d.devnetPool === key);
    if (g) m.set(DEVNET_POOLS[key].pda.toBase58(), g.name);
  }
  return m;
})();

export interface ScoreTimeline {
  status: "loading" | "ok" | "fallback";
  /** Replayed (time, score) vertices; ≥2 when the wallet has ≥1 scoring event. */
  points: ScorePoint[];
}

export function useScoreTimeline(refreshMs = 30_000): ScoreTimeline {
  const { connection } = useConnection();
  const { publicKey } = useAdapterWallet();
  const [state, setState] = useState<ScoreTimeline>({ status: "loading", points: [] });
  const cancelled = useRef(false);

  const load = useCallback(async () => {
    if (!publicKey) {
      setState({ status: "ok", points: [] });
      return;
    }
    try {
      const atts = await fetchAttestationsForSubject(
        connection,
        DEVNET_PROGRAM_IDS.reputation,
        publicKey,
      );
      if (cancelled.current) return;
      const events: ScoreAttestation[] = atts.map((a) => ({
        schemaId: a.schemaId,
        issuedAtMs: Number(a.issuedAt) * 1000,
        verified: a.verifiedAtAttest,
        neutralized: a.neutralized,
        revoked: a.revoked,
        poolName: POOL_NAME_BY_ISSUER.get(a.issuer.toBase58()) ?? null,
      }));
      setState({ status: "ok", points: buildScoreTimeline(events) });
    } catch {
      // getProgramAccounts hiccup / rate-limit — keep the last good curve so the
      // chart doesn't blink to empty; callers may drop to the reconstruction.
      if (cancelled.current) return;
      setState((prev) => ({ status: "fallback", points: prev.points }));
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

  return state;
}
