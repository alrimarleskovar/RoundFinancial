/**
 * EventClassification + reputation v5.2 weight constants (Phase C.3).
 *
 * This module is now faithful to the v5.2 **proposal** taxonomy
 * (`mobile/docs/reputation-v2/01-proposal.md` §8, `03-spec.md`), not the
 * coarse 6-variant placeholder C.2a shipped. The delta-driven variants
 * are derived deterministically from `delta_seconds`; the
 * FrictionProof-gated (`FrictionOperational`) and governance-gated
 * (`BadFaith`) variants — plus the derived `Recovery` event — are
 * **deferred** per `06-team-decisions.md` (decisões 3 & 4) and are not
 * produced here.
 *
 * ─── AUTHORITY MODEL ─────────────────────────────────────────────────
 * The on-chain `BehavioralPayload.classification` byte identifies the
 * event KIND (payment / default / cycle-complete). For payment events
 * the precise variant is re-derived from `delta_seconds` against the
 * proposal's published boundaries — the indexer is authoritative, the
 * byte is a hint. A buggy emit site can't corrupt the classification.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Pure + synchronous. Exact-value unit-tested
 * (`behavioral_classification.spec.ts`).
 */

import {
  type BehavioralPayload,
  BEHAVIORAL_PAYLOAD_VERSION_LEGACY,
  CLASS_DEFAULT,
  CLASS_LATE,
  CLASS_PAYMENT_EARLY,
  CLASS_PAYMENT_ON_TIME,
  CLASS_PAYOUT_CLAIMED,
  CLASS_POOL_COMPLETE,
} from "@roundfi/sdk";

// ─── Classification boundaries (proposal §8, published constants) ─────
/** PaymentOnTime upper bound: paid within 6h of the deadline. */
export const GRACE_TEMPORAL_SECS = 21_600; // 6h
/** FrictionTemporal upper bound: up to 2 days late. */
export const FRICTION_TEMPORAL_MAX_SECS = 86_400 * 2; // 2d
/** LateBehavioral upper bound: up to 7 days late. */
export const LATE_BEHAVIORAL_MAX_SECS = 604_800; // 7d

/**
 * v5.2 `EventClassification` — the proposal taxonomy, restricted to the
 * variants derivable without a FrictionProof / governance attestation.
 *
 *   - `payment_early`         delta < 0 (paid before the deadline)
 *   - `payment_on_time`       0 <= delta <= 6h
 *   - `friction_temporal`     6h < delta <= 2d   (minor slip)
 *   - `late_behavioral`       2d < delta <= 7d   (behavioral lateness)
 *   - `temporary_incapacity`  delta > 7d, but paid
 *   - `default`               did not pay
 *   - `pool_complete`         finished paying every installment in the
 *                             pool (Pass-3 rename of `cycle_complete`)
 *   - `payout_claimed`        received their carta — Pass-3, score-neutral
 *                             audit trail, NOT a commitment signal
 *   - `unspecified`           legacy zero payload / unknown version
 *
 * Pass-3 (Caio HIGH, 2026-06-12) split the conflated `cycle_complete`
 * into two distinct events. Legacy v1 payloads carrying byte 5 (the old
 * `CLASS_CYCLE_COMPLETE`) are mapped to `payout_claimed` — that's what
 * the byte ACTUALLY MEANT under the old semantics ("received payout").
 *
 * Deferred (NOT produced here): `friction_operational` (needs an
 * on-chain FrictionProof), `bad_faith` (needs governance), `recovery`
 * (a derived pattern over the full history).
 */
export type EventClassification =
  | "payment_early"
  | "payment_on_time"
  | "friction_temporal"
  | "late_behavioral"
  | "temporary_incapacity"
  | "default"
  | "pool_complete"
  | "payout_claimed"
  | "unspecified";

// ─── Reliability weights (proposal §6, basis points, 100 = +1.00) ─────
// Published as constants so any third party recomputes the same number.
export const W_PAYMENT_ON_TIME = 100;
export const W_PAYMENT_EARLY = 100;
export const W_FRICTION_OPERATIONAL = 100; // neutral — proven friction never punishes
export const W_FRICTION_TEMPORAL = 95;
export const W_LATE_BEHAVIORAL = 70;
export const W_TEMPORARY_INCAPACITY = 40;
export const W_DEFAULT = 0;
export const W_BAD_FAITH = -200; // compound penalty (deferred variant)

/** The maximum single-event weight — the Reliability normaliser. */
export const MAX_WEIGHT = W_PAYMENT_ON_TIME; // 100

/**
 * Reliability weight of a classification, or `null` for classifications
 * that are NOT reliability inputs (`pool_complete` feeds Commitment;
 * `payout_claimed` is pure audit trail; `unspecified` carries no
 * signal). `reliability()` filters the nulls so only weighted events
 * contribute to the average.
 */
export function weightOf(c: EventClassification): number | null {
  switch (c) {
    case "payment_on_time":
      return W_PAYMENT_ON_TIME;
    case "payment_early":
      return W_PAYMENT_EARLY;
    case "friction_temporal":
      return W_FRICTION_TEMPORAL;
    case "late_behavioral":
      return W_LATE_BEHAVIORAL;
    case "temporary_incapacity":
      return W_TEMPORARY_INCAPACITY;
    case "default":
      return W_DEFAULT;
    case "pool_complete":
    case "payout_claimed":
    case "unspecified":
      return null;
  }
}

/** Whether a classification is a "payment" event — the set Punctuality
 *  averages over (it carries a meaningful `delta_seconds`). Excludes
 *  `default` (never paid), `pool_complete` + `payout_claimed` (no
 *  payment-timing semantics on either). */
export function isPaymentClass(c: EventClassification): boolean {
  return (
    c === "payment_early" ||
    c === "payment_on_time" ||
    c === "friction_temporal" ||
    c === "late_behavioral" ||
    c === "temporary_incapacity"
  );
}

/**
 * Derive the authoritative `EventClassification` from a decoded payload.
 * `null` payload (legacy zero / unknown version) → `"unspecified"`.
 *
 * **Pass-3 version dispatch.** The classification byte 5 has different
 * meaning across payload versions:
 *   - v2 byte 5 → `pool_complete` (Pass-3, contribute-emitted)
 *   - v1 byte 5 → `payout_claimed` (legacy, claim_payout-emitted — was
 *     `CLASS_CYCLE_COMPLETE` under the old +50/cycles_completed
 *     semantics that Pass-3 corrects)
 * v2 also adds byte 6 = `payout_claimed`.
 */
export function deriveEventClassification(payload: BehavioralPayload | null): EventClassification {
  if (payload === null) return "unspecified";

  switch (payload.classification) {
    case CLASS_DEFAULT:
      return "default";
    case CLASS_POOL_COMPLETE: // byte 5 — version-aware
      return payload.version === BEHAVIORAL_PAYLOAD_VERSION_LEGACY
        ? "payout_claimed"
        : "pool_complete";
    case CLASS_PAYOUT_CLAIMED: // byte 6 — v2 only
      return "payout_claimed";
    case CLASS_PAYMENT_ON_TIME:
    case CLASS_PAYMENT_EARLY:
    case CLASS_LATE:
      return classifyPaymentTiming(payload.deltaSeconds);
    default:
      // CLASS_UNSPECIFIED or any byte this build doesn't recognize.
      return "unspecified";
  }
}

/**
 * Re-derive a payment's variant from `delta_seconds` against the
 * proposal's published boundaries (proposal §8 `classify`). Exposed for
 * callers holding a raw delta.
 *
 *   delta < 0          → payment_early
 *   delta <= 6h        → payment_on_time
 *   delta <= 2d        → friction_temporal
 *   delta <= 7d        → late_behavioral
 *   delta >  7d        → temporary_incapacity
 */
export function classifyPaymentTiming(deltaSeconds: bigint): EventClassification {
  if (deltaSeconds < 0n) return "payment_early";
  if (deltaSeconds <= BigInt(GRACE_TEMPORAL_SECS)) return "payment_on_time";
  if (deltaSeconds <= BigInt(FRICTION_TEMPORAL_MAX_SECS)) return "friction_temporal";
  if (deltaSeconds <= BigInt(LATE_BEHAVIORAL_MAX_SECS)) return "late_behavioral";
  return "temporary_incapacity";
}

/** Coarse polarity for UI / aggregation. The metrics (Reliability /
 *  Punctuality) are the authoritative signals; this is a display aid. */
export type EventPolarity = "positive" | "neutral" | "negative";

export function classificationPolarity(c: EventClassification): EventPolarity {
  switch (c) {
    case "payment_early":
    case "payment_on_time":
    case "pool_complete":
      return "positive";
    case "friction_temporal":
    case "payout_claimed": // Pass-3: pure audit, not a polarity signal
    case "unspecified":
      return "neutral";
    case "late_behavioral":
    case "temporary_incapacity":
    case "default":
      return "negative";
  }
}
