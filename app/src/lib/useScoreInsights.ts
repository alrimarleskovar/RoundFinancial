"use client";

/**
 * `useScoreInsights()` — the REAL /insights data for a connected wallet, read
 * straight from chain:
 *   - behavioural factors from the on-chain ReputationProfile counters
 *     (useReputation), and
 *   - a score-over-time curve reconstructed from the wallet's real payment
 *     timestamps (useMyDevnetTxHistory) anchored to its true current score.
 *
 * Both fall back to an empty list / empty curve when there's no on-chain
 * signal yet, so the page renders an honest empty-state instead of fabricated
 * fixture numbers. Demo mode keeps the fixtures (the page gates on demoActive).
 */

import { useMemo } from "react";

import {
  computeRealFactors,
  reconstructScoreHistory,
  type RealFactor,
  type ScorePoint,
} from "@/data/insights";
import { useReputation } from "@/lib/useReputation";
import { useMyDevnetTxHistory } from "@/lib/useMyDevnetTxHistory";

export interface ScoreInsights {
  status: "loading" | "ready";
  /** true iff the wallet has an on-chain ReputationProfile. */
  exists: boolean;
  currentScore: number;
  level: number;
  factors: RealFactor[];
  /** Reconstructed (time, score) curve; ≥2 points when ≥1 payment exists. */
  history: ScorePoint[];
}

export function useScoreInsights(): ScoreInsights {
  const rep = useReputation();
  const hist = useMyDevnetTxHistory();

  return useMemo(() => {
    const loading = rep.status === "loading" || hist.status === "loading";
    const factors = computeRealFactors(rep);

    // Member-PDA history rows: a contribute carries a negative amount (the
    // installment), a join carries 0. Payment timestamps drive the curve; the
    // earliest activity (usually the join) seeds the start point.
    const payTimes = hist.txs
      .filter((tx) => (tx.amount ?? 0) < 0 && (tx.ts ?? 0) > 0)
      .map((tx) => tx.ts as number);
    const allTimes = hist.txs.map((tx) => tx.ts ?? 0).filter((t) => t > 0);
    const start = allTimes.length ? Math.min(...allTimes) : (payTimes[0] ?? 0);
    const history = reconstructScoreHistory(rep.score, payTimes, start);

    return {
      status: loading ? "loading" : "ready",
      exists: rep.exists,
      currentScore: rep.score,
      level: rep.level,
      factors,
      history,
    };
  }, [rep, hist]);
}
