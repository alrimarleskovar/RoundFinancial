/**
 * Exact-value coverage for the authoritative `EventClassification`
 * derivation (reputation v5.2 Hybrid, Phase C.2).
 *
 * Pure function, no DB / RPC. The assertions lock the boundary
 * convention (inclusive on-time, open-interval grace) and the authority
 * rule that payment timing is re-derived from `delta_seconds`, not the
 * on-chain `classification` byte.
 */

import { expect } from "chai";

import {
  CLASS_CYCLE_COMPLETE,
  CLASS_DEFAULT,
  CLASS_LATE,
  CLASS_PAYMENT_EARLY,
  CLASS_PAYMENT_ON_TIME,
  CLASS_UNSPECIFIED,
  GRACE_PERIOD_SECS,
  NO_TIMESTAMP,
  makeBehavioralPayload,
} from "@roundfi/sdk";

import {
  classificationPolarity,
  classifyPaymentTiming,
  deriveEventClassification,
} from "../src/behavioralClassification.js";

const GRACE = BigInt(GRACE_PERIOD_SECS); // 604_800n

function payment(deltaDrivenPaidTs: bigint, classByte: number) {
  // due_ts fixed at 0; paid_ts = delta, so delta_seconds = paid - 0 = delta.
  return makeBehavioralPayload({
    classification: classByte,
    groupSize: 24,
    parcelsPaid: 1,
    dueTs: 0n,
    paidTs: deltaDrivenPaidTs,
    amount: 1_000_000n,
  });
}

describe("deriveEventClassification — kind dispatch", () => {
  it("null payload (legacy zero / unknown version) → unspecified", () => {
    expect(deriveEventClassification(null)).to.equal("unspecified");
  });

  it("DEFAULT byte → default (timing not meaningful)", () => {
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

  it("CYCLE_COMPLETE byte → cycle_complete", () => {
    const p = makeBehavioralPayload({
      classification: CLASS_CYCLE_COMPLETE,
      groupSize: 24,
      parcelsPaid: 0,
      dueTs: 0n,
      paidTs: NO_TIMESTAMP,
      amount: 0n,
    });
    expect(deriveEventClassification(p)).to.equal("cycle_complete");
  });

  it("CLASS_UNSPECIFIED byte → unspecified", () => {
    const p = makeBehavioralPayload({
      classification: CLASS_UNSPECIFIED,
      groupSize: 1,
      parcelsPaid: 0,
      dueTs: 0n,
      paidTs: 0n,
      amount: 0n,
    });
    expect(deriveEventClassification(p)).to.equal("unspecified");
  });

  it("unrecognized classification byte → unspecified (defensive)", () => {
    const p = payment(0n, 200 /* not a known CLASS_* */);
    expect(deriveEventClassification(p)).to.equal("unspecified");
  });
});

describe("deriveEventClassification — payment timing re-derived from delta", () => {
  it("delta < 0 → payment_early", () => {
    expect(deriveEventClassification(payment(-1n, CLASS_PAYMENT_EARLY))).to.equal("payment_early");
    expect(deriveEventClassification(payment(-604_800n, CLASS_PAYMENT_EARLY))).to.equal(
      "payment_early",
    );
  });

  it("delta === 0 → payment_on_time (inclusive boundary)", () => {
    expect(deriveEventClassification(payment(0n, CLASS_PAYMENT_ON_TIME))).to.equal(
      "payment_on_time",
    );
  });

  it("0 < delta < grace → payment_late_within_grace", () => {
    expect(deriveEventClassification(payment(1n, CLASS_LATE))).to.equal(
      "payment_late_within_grace",
    );
    expect(deriveEventClassification(payment(GRACE - 1n, CLASS_LATE))).to.equal(
      "payment_late_within_grace",
    );
  });

  it("delta === grace → payment_late_past_grace (open-interval: due+grace is default-eligible)", () => {
    expect(deriveEventClassification(payment(GRACE, CLASS_LATE))).to.equal(
      "payment_late_past_grace",
    );
  });

  it("delta > grace → payment_late_past_grace", () => {
    expect(deriveEventClassification(payment(GRACE + 1n, CLASS_LATE))).to.equal(
      "payment_late_past_grace",
    );
  });

  it("authority rule: timing follows delta even if the byte disagrees", () => {
    // Byte claims ON_TIME but delta is positive past grace → the
    // deterministic value wins (defends against a buggy emit site).
    const lying = payment(GRACE + 100n, CLASS_PAYMENT_ON_TIME);
    expect(deriveEventClassification(lying)).to.equal("payment_late_past_grace");
  });
});

describe("classifyPaymentTiming — raw delta entrypoint", () => {
  it("respects a custom grace window", () => {
    expect(classifyPaymentTiming(50n, 100)).to.equal("payment_late_within_grace");
    expect(classifyPaymentTiming(100n, 100)).to.equal("payment_late_past_grace");
    expect(classifyPaymentTiming(-1n, 100)).to.equal("payment_early");
    expect(classifyPaymentTiming(0n, 100)).to.equal("payment_on_time");
  });
});

describe("classificationPolarity", () => {
  it("maps each classification to its signed polarity", () => {
    expect(classificationPolarity("payment_early")).to.equal("positive");
    expect(classificationPolarity("payment_on_time")).to.equal("positive");
    expect(classificationPolarity("cycle_complete")).to.equal("positive");
    expect(classificationPolarity("payment_late_within_grace")).to.equal("neutral");
    expect(classificationPolarity("unspecified")).to.equal("neutral");
    expect(classificationPolarity("payment_late_past_grace")).to.equal("negative");
    expect(classificationPolarity("default")).to.equal("negative");
  });
});
