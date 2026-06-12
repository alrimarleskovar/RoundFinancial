/**
 * Reputation v5.2 metrics — Reliability + Punctuality (Phase C.3).
 *
 * Pure, deterministic functions of a subject's behavioral history,
 * faithful to the proposal (`mobile/docs/reputation-v2/01-proposal.md`
 * §6) **including its two mandatory bug-fixes** (BLOQUEADOR 1 & 2 in
 * `03-spec.md`):
 *   1. `reliability()` guards `count` with `.max(1)` and clamps to
 *      0..100 — a window of all-`BadFaith` events sums negative and must
 *      not underflow.
 *   2. `punctuality()` preserves `count` through the fold (the proposal's
 *      reference used `count` undeclared and didn't compile).
 *
 * Commitment + Recovery are **deferred** (proposal §6.3/§6.4 — they need
 * identity-layer pool counts / the derived `Recovery` event, both out of
 * scope for this provisional pass per `06-team-decisions.md`).
 *
 * NOTHING here is published as canonical. The HTTP surface (C.3.3) tags
 * every response `formula_versao: "v1-provisional"`; weights get
 * calibrated against a real dataset before any set is canonical.
 *
 * No `now()`, no randomness, no external reads — same input, same output,
 * so any third party recomputes the identical number from the on-chain
 * bytes. Exact-value unit-tested (`reputation_metrics.spec.ts`) against
 * the proposal's published test vectors.
 */

import {
  type EventClassification,
  MAX_WEIGHT,
  isPaymentClass,
  weightOf,
} from "./behavioralClassification.js";

/** Reliability averages the last N weighted events. */
export const RELIABILITY_WINDOW = 50;
/** Punctuality averages the last N payment events' lateness. */
export const PUNCTUALITY_WINDOW = 50;
/** A payment under 1h late doesn't count as late for Punctuality. */
export const PUNCTUALITY_FRICTION_GRACE_SECS = 3_600; // 1h
/** Score returned by Punctuality when the window has no payment data. */
export const PUNCTUALITY_NEUTRAL = 80;

/** The behavioral signal each metric consumes. `deltaSeconds` is the
 *  on-chain i64 (`null` only for non-payment events). Order the input
 *  oldest-first; the metrics take the most-recent window themselves. */
export interface BehavioralSignal {
  classification: EventClassification;
  deltaSeconds: bigint | null;
}

/**
 * **Reliability** — normalised weighted average of the last
 * `RELIABILITY_WINDOW` reliability-eligible events, in 0..100.
 *
 * Reliability-eligible = events with a published weight (payments +
 * default). `cycle_complete` (a Commitment signal) and `unspecified`
 * carry no weight and are excluded — so a window of 50 on-time payments
 * scores exactly 100.
 *
 * Faithful formula (proposal §6, fixed): for the window's weight sum `S`
 * and count `N`,
 *   `raw = (S * 100) / (max(N, 1) * MAX_WEIGHT)`  (integer division)
 *   `reliability = clamp(raw, 0, 100)`
 * An empty window returns 0 (no evidence).
 */
export function reliability(history: readonly BehavioralSignal[]): number {
  const weighted: number[] = [];
  // Walk newest-first, collect up to WINDOW weighted events, then stop.
  for (let i = history.length - 1; i >= 0 && weighted.length < RELIABILITY_WINDOW; i--) {
    const w = weightOf(history[i]!.classification);
    if (w !== null) weighted.push(w);
  }
  const count = weighted.length;
  if (count === 0) return 0;
  const sum = weighted.reduce((s, w) => s + w, 0);
  const raw = Math.trunc((sum * 100) / (count * MAX_WEIGHT));
  return clamp(raw, 0, 100);
}

/**
 * **Punctuality** — "how close to the deadline does this subject pay, on
 * average," in 0..100, over the last `PUNCTUALITY_WINDOW` payment events.
 *
 * Averages `delta_seconds` (payments only — `default` has no payment
 * time, `cycle_complete` no timing), flooring a sub-1h-late delta to 0
 * (the friction grace), then applies the proposal's published piecewise-
 * linear map:
 *   delta <= -3d        → 100
 *   -3d <  delta <= 0   → 80..100   (earlier = higher)
 *    0  <  delta <= 1d  → 80..60
 *    1d <  delta <= 7d  → 60..30
 *    7d <  delta <= 30d → 30..0
 *   delta >  30d        → 0
 * No payment data → 80 (neutral — absence of lateness evidence).
 */
export function punctuality(history: readonly BehavioralSignal[]): number {
  const deltas: bigint[] = [];
  for (let i = history.length - 1; i >= 0 && deltas.length < PUNCTUALITY_WINDOW; i--) {
    const e = history[i]!;
    if (isPaymentClass(e.classification) && e.deltaSeconds !== null) {
      // Friction grace: a payment under 1h late is treated as on time.
      const d =
        e.deltaSeconds > 0n && e.deltaSeconds <= BigInt(PUNCTUALITY_FRICTION_GRACE_SECS)
          ? 0n
          : e.deltaSeconds;
      deltas.push(d);
    }
  }
  if (deltas.length === 0) return PUNCTUALITY_NEUTRAL;

  // Integer-mean of the deltas (matches the on-chain i64 division).
  const sum = deltas.reduce((s, d) => s + d, 0n);
  const avg = sum / BigInt(deltas.length);

  return clamp(punctualityOfAvg(avg), 0, 100);
}

/** The proposal's published piecewise-linear map from an average delta
 *  (seconds) to a 0..100 punctuality score. Exposed for direct testing
 *  of the breakpoints. */
export function punctualityOfAvg(avg: bigint): number {
  const d = avg;
  if (d <= -259_200n) return 100; // <= 3 days early
  if (d <= 0n) return 80 + Number((-d * 20n) / 259_200n);
  if (d <= 86_400n) return 80 - Number((d * 20n) / 86_400n);
  if (d <= 604_800n) return 60 - Number((d * 30n) / 604_800n);
  if (d <= 2_592_000n) return 30 - Number((d * 30n) / 2_592_000n);
  return 0; // > 30 days late
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
