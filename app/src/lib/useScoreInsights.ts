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
  annotateScoreHistory,
  computeRealFactors,
  reconstructScoreHistory,
  type RealFactor,
  type ScorePoint,
} from "@/data/insights";
import { useReputation } from "@/lib/useReputation";
import { useMyDevnetTxHistory } from "@/lib/useMyDevnetTxHistory";
import { useScoreTimeline } from "@/lib/useScoreTimeline";

/** Pull the pool name out of a ledger label ("Parcela · Pool Rápida" → "Pool
 *  Rápida"). Returns null when the row has no "· <name>" suffix (e.g. a pool
 *  that only exists as a demo fixture falls back to "Pool N", still valid). */
function poolNameFromLabel(label: string): string | null {
  const i = label.indexOf("·");
  if (i < 0) return null;
  const name = label.slice(i + 1).trim();
  return name.length > 0 ? name : null;
}

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
  const timeline = useScoreTimeline();

  return useMemo(() => {
    const loading =
      rep.status === "loading" || hist.status === "loading" || timeline.status === "loading";
    const factors = computeRealFactors(rep);

    // Member-PDA history rows: a contribute carries a negative amount (the
    // installment), a join carries 0. Payment timestamps drive the curve; the
    // earliest activity (usually the join) seeds the start point. We sort the
    // contributes ascending here so their pool names line up 1:1 with the
    // vertices `reconstructScoreHistory` produces (it steps through the times in
    // ascending order), letting the chart label WHY the score moved at each step.
    const contributes = hist.txs
      .filter((tx) => (tx.amount ?? 0) < 0 && (tx.ts ?? 0) > 0)
      .slice()
      .sort((a, b) => (a.ts as number) - (b.ts as number));
    const payTimes = contributes.map((tx) => tx.ts as number);
    const paymentPools = contributes.map((tx) => poolNameFromLabel(tx.label));

    const withTs = hist.txs.filter((tx) => (tx.ts ?? 0) > 0);
    const start = withTs.length
      ? Math.min(...withTs.map((tx) => tx.ts as number))
      : (payTimes[0] ?? 0);
    // Baseline vertex = the earliest activity, normally the join_pool row.
    const joinTx = withTs.slice().sort((a, b) => (a.ts as number) - (b.ts as number))[0];
    const joinPool = joinTx ? poolNameFromLabel(joinTx.label) : null;

    // Prefer the TRUE attestation-replay curve (real per-event deltas, exact
    // endpoint). Fall back to the payment-timestamp reconstruction only if the
    // replay is unavailable (getProgramAccounts failed / not yet loaded) so the
    // chart still shows an approximate climb instead of an empty box.
    const history =
      timeline.points.length >= 2
        ? timeline.points
        : annotateScoreHistory(
            reconstructScoreHistory(rep.score, payTimes, start),
            joinPool,
            paymentPools,
          );

    return {
      status: loading ? "loading" : "ready",
      exists: rep.exists,
      currentScore: rep.score,
      level: rep.level,
      factors,
      history,
    };
  }, [rep, hist, timeline]);
}
