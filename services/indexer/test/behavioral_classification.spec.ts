/**
 * Exact-value coverage for the v5.2 `EventClassification` derivation +
 * reliability weights (Phase C.3 — faithful to the proposal taxonomy).
 *
 * Pure function, no DB / RPC. Locks the published classification
 * boundaries (6h / 2d / 7d) and the weight constants any third party
 * recomputes the score from.
 */

import { expect } from "chai";

import {
  CLASS_PAYOUT_CLAIMED,
  CLASS_POOL_COMPLETE,
  CLASS_DEFAULT,
  CLASS_LATE,
  CLASS_PAYMENT_EARLY,
  CLASS_PAYMENT_ON_TIME,
  CLASS_UNSPECIFIED,
  NO_TIMESTAMP,
  makeBehavioralPayload,
} from "@roundfi/sdk";

import {
  FRICTION_TEMPORAL_MAX_SECS,
  GRACE_TEMPORAL_SECS,
  LATE_BEHAVIORAL_MAX_SECS,
  W_DEFAULT,
  W_FRICTION_TEMPORAL,
  W_LATE_BEHAVIORAL,
  W_PAYMENT_ON_TIME,
  W_TEMPORARY_INCAPACITY,
  classificationPolarity,
  classifyPaymentTiming,
  deriveEventClassification,
  isPaymentClass,
  weightOf,
} from "../src/behavioralClassification.js";

const SIX_H = BigInt(GRACE_TEMPORAL_SECS); // 21_600n
const TWO_D = BigInt(FRICTION_TEMPORAL_MAX_SECS); // 172_800n
const SEVEN_D = BigInt(LATE_BEHAVIORAL_MAX_SECS); // 604_800n

function payment(deltaPaidTs: bigint, classByte: number) {
  // due_ts = 0, paid_ts = delta → delta_seconds = delta.
  return makeBehavioralPayload({
    classification: classByte,
    groupSize: 24,
    parcelsPaid: 1,
    dueTs: 0n,
    paidTs: deltaPaidTs,
    amount: 1_000_000n,
  });
}

describe("deriveEventClassification — kind dispatch", () => {
  it("null payload → unspecified", () => {
    expect(deriveEventClassification(null)).to.equal("unspecified");
  });

  it("DEFAULT byte → default", () => {
    const p = makeBehavioralPayload({
      classification: CLASS_DEFAULT,
      groupSize: 24,
      parcelsPaid: 0,
      dueTs: 1_700_000_000n,
      paidTs: NO_TIMESTAMP,
      amount: 0n,
    });
    expect(deriveEventClassification(p)).to.equal("default");
  });

  it("POOL_COMPLETE byte (v2) → pool_complete", () => {
    const p = makeBehavioralPayload({
      classification: CLASS_POOL_COMPLETE,
      groupSize: 24,
      parcelsPaid: 0,
      dueTs: 0n,
      paidTs: NO_TIMESTAMP,
      amount: 0n,
    });
    expect(deriveEventClassification(p)).to.equal("pool_complete");
  });

  it("Pass-3: byte 5 under legacy v1 payload → payout_claimed (not pool_complete)", () => {
    // The on-chain byte 5 used to mean "received payout" (with the buggy
    // +50/cycles_completed semantics). After Pass-3, indexer dispatches
    // version-aware: v1 byte 5 → payout_claimed; v2 byte 5 → pool_complete.
    // Build a v1 payload by hand (the encoder always emits v2).
    const v2 = makeBehavioralPayload({
      classification: CLASS_POOL_COMPLETE,
      groupSize: 24,
      parcelsPaid: 0,
      dueTs: 0n,
      paidTs: NO_TIMESTAMP,
      amount: 0n,
    });
    const v1: typeof v2 = { ...v2, version: 1 };
    expect(deriveEventClassification(v1)).to.equal("payout_claimed");
    expect(deriveEventClassification(v2)).to.equal("pool_complete");
  });

  it("Pass-3: byte 6 → payout_claimed (v2 only)", () => {
    const p = makeBehavioralPayload({
      classification: CLASS_PAYOUT_CLAIMED,
      groupSize: 24,
      parcelsPaid: 0,
      dueTs: 0n,
      paidTs: NO_TIMESTAMP,
      amount: 0n,
    });
    expect(deriveEventClassification(p)).to.equal("payout_claimed");
  });

  it("CLASS_UNSPECIFIED / unknown byte → unspecified", () => {
    expect(
      deriveEventClassification(
        makeBehavioralPayload({
          classification: CLASS_UNSPECIFIED,
          groupSize: 1,
          parcelsPaid: 0,
          dueTs: 0n,
          paidTs: 0n,
          amount: 0n,
        }),
      ),
    ).to.equal("unspecified");
    expect(deriveEventClassification(payment(0n, 200))).to.equal("unspecified");
  });
});

describe("classifyPaymentTiming — proposal boundaries (6h / 2d / 7d)", () => {
  it("delta < 0 → payment_early", () => {
    expect(deriveEventClassification(payment(-1n, CLASS_PAYMENT_EARLY))).to.equal("payment_early");
  });

  it("0 <= delta <= 6h → payment_on_time (inclusive)", () => {
    expect(deriveEventClassification(payment(0n, CLASS_PAYMENT_ON_TIME))).to.equal(
      "payment_on_time",
    );
    expect(deriveEventClassification(payment(SIX_H, CLASS_PAYMENT_ON_TIME))).to.equal(
      "payment_on_time",
    );
  });

  it("6h < delta <= 2d → friction_temporal", () => {
    expect(deriveEventClassification(payment(SIX_H + 1n, CLASS_LATE))).to.equal(
      "friction_temporal",
    );
    expect(deriveEventClassification(payment(TWO_D, CLASS_LATE))).to.equal("friction_temporal");
  });

  it("2d < delta <= 7d → late_behavioral", () => {
    expect(deriveEventClassification(payment(TWO_D + 1n, CLASS_LATE))).to.equal("late_behavioral");
    expect(deriveEventClassification(payment(SEVEN_D, CLASS_LATE))).to.equal("late_behavioral");
  });

  it("delta > 7d → temporary_incapacity", () => {
    expect(deriveEventClassification(payment(SEVEN_D + 1n, CLASS_LATE))).to.equal(
      "temporary_incapacity",
    );
  });

  it("authority rule: variant follows delta even if the byte disagrees", () => {
    // Byte claims ON_TIME but delta is 3 days → late_behavioral wins.
    expect(deriveEventClassification(payment(TWO_D + 100n, CLASS_PAYMENT_ON_TIME))).to.equal(
      "late_behavioral",
    );
  });

  it("classifyPaymentTiming is callable on a raw delta", () => {
    expect(classifyPaymentTiming(-5n)).to.equal("payment_early");
    expect(classifyPaymentTiming(SIX_H)).to.equal("payment_on_time");
    expect(classifyPaymentTiming(TWO_D)).to.equal("friction_temporal");
    expect(classifyPaymentTiming(SEVEN_D)).to.equal("late_behavioral");
    expect(classifyPaymentTiming(SEVEN_D + 1n)).to.equal("temporary_incapacity");
  });
});

describe("weightOf — published reliability weights", () => {
  it("matches the proposal constants", () => {
    expect(weightOf("payment_on_time")).to.equal(W_PAYMENT_ON_TIME); // 100
    expect(weightOf("payment_early")).to.equal(100);
    expect(weightOf("friction_temporal")).to.equal(W_FRICTION_TEMPORAL); // 95
    expect(weightOf("late_behavioral")).to.equal(W_LATE_BEHAVIORAL); // 70
    expect(weightOf("temporary_incapacity")).to.equal(W_TEMPORARY_INCAPACITY); // 40
    expect(weightOf("default")).to.equal(W_DEFAULT); // 0
  });

  it("returns null for non-reliability classes", () => {
    expect(weightOf("pool_complete")).to.equal(null);
    expect(weightOf("payout_claimed")).to.equal(null);
    expect(weightOf("unspecified")).to.equal(null);
  });
});

describe("isPaymentClass", () => {
  it("is true for the five payment variants, false otherwise", () => {
    for (const c of [
      "payment_early",
      "payment_on_time",
      "friction_temporal",
      "late_behavioral",
      "temporary_incapacity",
    ] as const) {
      expect(isPaymentClass(c)).to.equal(true);
    }
    expect(isPaymentClass("default")).to.equal(false);
    expect(isPaymentClass("pool_complete")).to.equal(false);
    expect(isPaymentClass("payout_claimed")).to.equal(false);
    expect(isPaymentClass("unspecified")).to.equal(false);
  });
});

describe("classificationPolarity", () => {
  it("maps each classification to a polarity", () => {
    expect(classificationPolarity("payment_early")).to.equal("positive");
    expect(classificationPolarity("payment_on_time")).to.equal("positive");
    expect(classificationPolarity("pool_complete")).to.equal("positive");
    expect(classificationPolarity("payout_claimed")).to.equal("neutral");
    expect(classificationPolarity("friction_temporal")).to.equal("neutral");
    expect(classificationPolarity("unspecified")).to.equal("neutral");
    expect(classificationPolarity("late_behavioral")).to.equal("negative");
    expect(classificationPolarity("temporary_incapacity")).to.equal("negative");
    expect(classificationPolarity("default")).to.equal("negative");
  });
});
