/**
 * Exact-byte parity test for the BehavioralPayload codec.
 *
 * The Rust source of truth lives in
 * `programs/roundfi-reputation/src/state/behavioral_payload.rs`. This
 * spec asserts the TypeScript mirror (`@roundfi/sdk/behavioralPayload`)
 * encodes and decodes byte-identically.
 *
 * Per ADR 0009 / amendment #2: "field populated" is NOT a passing
 * criterion. This suite locks the exact 96-byte layout — version,
 * classification, group_size, parcels_paid, the i64/u64 block at the
 * documented offsets — and the saturating delta-derivation rules.
 *
 * Drift between the on-chain Rust codec and this TS mirror would mean
 * the indexer scores against different bytes than every reputation
 * client sees. That's worse than a "field-populated" miss; it's silent
 * miscount, so the assertions here are intentionally tight.
 */

import { expect } from "chai";

import {
  ATTESTATION_PAYLOAD_LEN,
  BEHAVIORAL_PAYLOAD_VERSION,
  CLASS_CYCLE_COMPLETE,
  CLASS_DEFAULT,
  CLASS_LATE,
  CLASS_PAYMENT_EARLY,
  CLASS_PAYMENT_ON_TIME,
  CLASS_UNSPECIFIED,
  NO_TIMESTAMP,
  classificationLabel,
  decodeBehavioralPayload,
  encodeBehavioralPayload,
  makeBehavioralPayload,
} from "@roundfi/sdk";

const I64_MAX = 9223372036854775807n;
const I64_MIN = -9223372036854775808n;
const U64_MAX = 18446744073709551615n;

describe("BehavioralPayload — TS ↔ Rust codec parity", () => {
  it("on-time payment round-trips with derived negative delta", () => {
    // Mirrors the Rust `round_trips_on_time_payment` test.
    const p = makeBehavioralPayload({
      classification: CLASS_PAYMENT_ON_TIME,
      groupSize: 24,
      parcelsPaid: 1,
      dueTs: 1_700_000_000n,
      paidTs: 1_699_999_400n, // 600s early
      amount: 600_000_000n,
    });
    expect(p.deltaSeconds).to.equal(-600n);
    expect(p.version).to.equal(BEHAVIORAL_PAYLOAD_VERSION);

    const bytes = encodeBehavioralPayload(p);
    expect(bytes.length).to.equal(ATTESTATION_PAYLOAD_LEN);

    const back = decodeBehavioralPayload(bytes);
    expect(back).to.deep.equal(p);
  });

  it("DEFAULT event uses NO_TIMESTAMP sentinel and zero delta", () => {
    // Mirrors the Rust `default_event_uses_no_timestamp_sentinel` test.
    const p = makeBehavioralPayload({
      classification: CLASS_DEFAULT,
      groupSize: 24,
      parcelsPaid: 0,
      dueTs: 1_700_000_000n,
      paidTs: NO_TIMESTAMP,
      amount: 0n,
    });
    expect(p.deltaSeconds).to.equal(0n);
    expect(p.paidTs).to.equal(NO_TIMESTAMP);

    const back = decodeBehavioralPayload(encodeBehavioralPayload(p));
    expect(back).to.deep.equal(p);
  });

  it("legacy zero payload decodes to null (pre-v5.2 attestation)", () => {
    // Mirrors the Rust `legacy_zero_payload_decodes_none` test.
    const zero = Buffer.alloc(ATTESTATION_PAYLOAD_LEN);
    expect(decodeBehavioralPayload(zero)).to.equal(null);
  });

  it("unknown future version decodes to null", () => {
    // Mirrors the Rust `unknown_future_version_decodes_none` test.
    const bytes = encodeBehavioralPayload(
      makeBehavioralPayload({
        classification: CLASS_LATE,
        groupSize: 12,
        parcelsPaid: 1,
        dueTs: 100n,
        paidTs: 200n,
        amount: 5n,
      }),
    );
    bytes.writeUInt8(99, 0); // pretend a future layout
    expect(decodeBehavioralPayload(bytes)).to.equal(null);
  });

  it("encode is exactly 96 bytes with zero reserved regions", () => {
    // Mirrors the Rust `encode_is_exactly_96_bytes_with_zero_reserved` test.
    const p = makeBehavioralPayload({
      classification: CLASS_CYCLE_COMPLETE,
      groupSize: 24,
      parcelsPaid: 1,
      dueTs: 1n,
      paidTs: 2n,
      amount: 3n,
    });
    const bytes = encodeBehavioralPayload(p);
    expect(bytes.length).to.equal(ATTESTATION_PAYLOAD_LEN);
    // alignment pad (4..8) and reserved tail (40..96) must be zero.
    for (let i = 4; i < 8; i++) expect(bytes[i]).to.equal(0);
    for (let i = 40; i < ATTESTATION_PAYLOAD_LEN; i++) expect(bytes[i]).to.equal(0);
  });

  it("late payment produces positive delta", () => {
    // Mirrors the Rust `late_payment_positive_delta` test.
    const p = makeBehavioralPayload({
      classification: CLASS_LATE,
      groupSize: 24,
      parcelsPaid: 1,
      dueTs: 1_700_000_000n,
      paidTs: 1_700_086_400n, // 1 day late
      amount: 600_000_000n,
    });
    expect(p.deltaSeconds).to.equal(86_400n);
    expect(decodeBehavioralPayload(encodeBehavioralPayload(p))).to.deep.equal(p);
  });

  it("boundary values survive round-trip without panic", () => {
    // Mirrors the Rust `boundary_values_survive_round_trip` test.
    const p = makeBehavioralPayload({
      classification: 255,
      groupSize: 255,
      parcelsPaid: 255,
      dueTs: I64_MAX,
      paidTs: I64_MAX,
      amount: U64_MAX,
    });
    // saturating_sub: MAX - MAX = 0
    expect(p.deltaSeconds).to.equal(0n);
    expect(decodeBehavioralPayload(encodeBehavioralPayload(p))).to.deep.equal(p);
  });

  it("delta saturates to I64_MAX instead of overflowing", () => {
    // Mirrors the Rust `delta_saturates_instead_of_overflowing` test.
    // paid very large, due very negative → naive subtraction overflows.
    const p = makeBehavioralPayload({
      classification: CLASS_LATE,
      groupSize: 24,
      parcelsPaid: 1,
      dueTs: I64_MIN + 1n,
      paidTs: I64_MAX,
      amount: 1n,
    });
    expect(p.deltaSeconds).to.equal(I64_MAX);
    expect(decodeBehavioralPayload(encodeBehavioralPayload(p))).to.deep.equal(p);
  });

  it("rejects payloads whose length is wrong", () => {
    // Length mismatch is a caller bug, not forward-compat — must throw.
    expect(() => decodeBehavioralPayload(Buffer.alloc(95))).to.throw(/expected 96/);
    expect(() => decodeBehavioralPayload(Buffer.alloc(97))).to.throw(/expected 96/);
  });

  it("accepts a raw Uint8Array (mobile / web3.js path)", () => {
    // RN consumers may pass `Uint8Array` from `@solana/web3.js` directly.
    const p = makeBehavioralPayload({
      classification: CLASS_PAYMENT_EARLY,
      groupSize: 5,
      parcelsPaid: 1,
      dueTs: 1n,
      paidTs: 0n,
      amount: 1n,
    });
    const u8 = new Uint8Array(encodeBehavioralPayload(p));
    expect(decodeBehavioralPayload(u8)).to.deep.equal(p);
  });

  it("classificationLabel covers every v1 class plus unknown", () => {
    expect(classificationLabel(CLASS_UNSPECIFIED)).to.equal("unspecified");
    expect(classificationLabel(CLASS_PAYMENT_ON_TIME)).to.equal("payment_on_time");
    expect(classificationLabel(CLASS_PAYMENT_EARLY)).to.equal("payment_early");
    expect(classificationLabel(CLASS_LATE)).to.equal("payment_late");
    expect(classificationLabel(CLASS_DEFAULT)).to.equal("default");
    expect(classificationLabel(CLASS_CYCLE_COMPLETE)).to.equal("cycle_complete");
    expect(classificationLabel(99)).to.equal("unknown_99");
  });

  it("on-disk layout: i64 block aligns at offset 8 (parity with Rust)", () => {
    // Lock the exact byte offsets — drift here is the failure mode that
    // most easily slips past higher-level round-trip tests because both
    // sides would still be self-consistent.
    const p = makeBehavioralPayload({
      classification: CLASS_PAYMENT_ON_TIME,
      groupSize: 1,
      parcelsPaid: 1,
      dueTs: 0x0102030405060708n,
      paidTs: 0x1112131415161718n,
      amount: 0xa0a1a2a3a4a5a6a7n,
    });
    const bytes = encodeBehavioralPayload(p);
    expect(bytes.readBigInt64LE(8)).to.equal(0x0102030405060708n);
    expect(bytes.readBigInt64LE(16)).to.equal(0x1112131415161718n);
    expect(bytes.readBigUInt64LE(32)).to.equal(0xa0a1a2a3a4a5a6a7n);
  });
});
