/**
 * Authoritative `EventClassification` derivation (reputation v5.2 Hybrid,
 * Phase C.2).
 *
 * architecture.md §4.7: "the indexer derives `EventClassification`
 * deterministically from `delta_seconds` — the on-chain `classification`
 * byte is a hint." This module is that derivation.
 *
 * ─── AUTHORITY MODEL ─────────────────────────────────────────────────
 * The on-chain `BehavioralPayload.classification` byte tells us the
 * event KIND (a payment vs a default vs a cycle-complete). For payment
 * events the precise timing sub-class is **re-derived here from
 * `delta_seconds`** — the indexer never trusts the byte for timing.
 * Two reasons:
 *   1. The byte only carries a coarse early/on-time/late split; the
 *      within-grace vs past-grace refinement (the signal that matters
 *      for the v5.2 `punctuality` / `recovery` metrics) is grace-window
 *      logic the program does not encode.
 *   2. If a future emit-site bug ever disagreed with `delta_seconds`,
 *      the deterministic, recomputable-by-anyone value wins — that's the
 *      whole point of putting the timing on-chain.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Pure + synchronous: no DB, no RPC. Unit-tested with exact-value
 * coverage (`tests/behavioral_classification.spec.ts`).
 */

import {
  type BehavioralPayload,
  CLASS_CYCLE_COMPLETE,
  CLASS_DEFAULT,
  CLASS_LATE,
  CLASS_PAYMENT_EARLY,
  CLASS_PAYMENT_ON_TIME,
  GRACE_PERIOD_SECS,
} from "@roundfi/sdk";

/**
 * The indexer's authoritative classification of a scoring event. Richer
 * than the on-chain hint: payments split four ways on the grace window.
 *
 *   - `payment_early`             — paid before the deadline (delta < 0)
 *   - `payment_on_time`           — paid exactly at the deadline (delta = 0)
 *   - `payment_late_within_grace` — late but inside the 7-day grace window
 *   - `payment_late_past_grace`   — late past grace (default-eligible territory)
 *   - `default`                   — settled as defaulted (no payment)
 *   - `cycle_complete`            — payout claimed (cycle finished)
 *   - `unspecified`               — legacy zero payload / unknown version /
 *                                   unrecognized classification byte
 */
export type EventClassification =
  | "payment_early"
  | "payment_on_time"
  | "payment_late_within_grace"
  | "payment_late_past_grace"
  | "default"
  | "cycle_complete"
  | "unspecified";

/** Coarse polarity of an event for score aggregation. The provisional
 *  v1 weights (Phase C.3) map each classification to a signed
 *  contribution; this is the sign, surfaced for UI and sanity checks.
 *  `neutral` events (cycle_complete is a positive commitment signal but
 *  carries no timing) are deliberately separated from `positive`. */
export type EventPolarity = "positive" | "neutral" | "negative";

/**
 * Derive the authoritative `EventClassification` from a decoded
 * payload. Pass `null` for a payload that {@link decodeBehavioralPayload}
 * could not interpret (legacy zero / unknown version) — yields
 * `"unspecified"`, the only correct answer when the bytes carry no v1
 * structure.
 *
 * `graceSecs` defaults to the protocol's 7-day window
 * (`GRACE_PERIOD_SECS`), overridable for tests / a future per-pool grace.
 */
export function deriveEventClassification(
  payload: BehavioralPayload | null,
  graceSecs: number = GRACE_PERIOD_SECS,
): EventClassification {
  if (payload === null) return "unspecified";

  switch (payload.classification) {
    case CLASS_DEFAULT:
      return "default";
    case CLASS_CYCLE_COMPLETE:
      return "cycle_complete";
    case CLASS_PAYMENT_ON_TIME:
    case CLASS_PAYMENT_EARLY:
    case CLASS_LATE:
      return classifyPaymentTiming(payload.deltaSeconds, graceSecs);
    default:
      // CLASS_UNSPECIFIED or any byte this build doesn't recognize.
      return "unspecified";
  }
}

/**
 * Re-derive a payment's timing sub-class from `delta_seconds` alone.
 * Exposed so callers that already hold a raw delta (e.g. a backfill
 * joining the schedule) can classify without reconstructing a payload.
 *
 * Boundary convention (mirrors `sdk/behavioral.ts`):
 *   - `delta <= 0`  → early / on-time (the on-chain `on_time` boundary
 *     is INCLUSIVE: paid exactly at the deadline is on-time, not late),
 *   - `0 < delta < grace`  → late within grace,
 *   - `delta >= grace`     → late past grace (at exactly `due + grace`
 *     the member becomes default-eligible, so that boundary is NOT
 *     "within grace" — same open-interval rule as `usedGrace`).
 */
export function classifyPaymentTiming(
  deltaSeconds: bigint,
  graceSecs: number = GRACE_PERIOD_SECS,
): EventClassification {
  if (deltaSeconds < 0n) return "payment_early";
  if (deltaSeconds === 0n) return "payment_on_time";
  if (deltaSeconds < BigInt(graceSecs)) return "payment_late_within_grace";
  return "payment_late_past_grace";
}

/** Polarity of a classification for aggregation / display. */
export function classificationPolarity(c: EventClassification): EventPolarity {
  switch (c) {
    case "payment_early":
    case "payment_on_time":
    case "cycle_complete":
      return "positive";
    case "payment_late_within_grace":
      return "neutral";
    case "payment_late_past_grace":
    case "default":
      return "negative";
    case "unspecified":
      return "neutral";
  }
}
