/**
 * Pure mapping coverage for `attestationToRowFields` (Phase C.2b).
 *
 * No database. Builds a synthetic on-chain Attestation buffer, runs it
 * through the real decode path (`decodeAttestationRaw`) and the row
 * mapper, and asserts the structured columns the
 * `attestation_behavioral_payload` migration introduced.
 *
 * The DB round-trip (upsert + FK resolution in `backfillAttestations`)
 * is exercised by the operator-run integration suite against a live
 * Postgres — same posture as `insights.spec.ts`, which is not part of
 * the standard CI lane. This spec locks the deterministic, DB-free half:
 * decoded bytes → row fields.
 */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import {
  ATTESTATION_LEN,
  CLASS_POOL_COMPLETE,
  CLASS_DEFAULT,
  CLASS_LATE,
  CLASS_PAYMENT_EARLY,
  NO_TIMESTAMP,
  decodeAttestationRaw,
  encodeBehavioralPayload,
  makeBehavioralPayload,
} from "@roundfi/sdk";

import { attestationToRowFields } from "../src/attestationBackfill.js";

const issuer = new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw");
const subject = PublicKey.unique();
const address = PublicKey.unique();

function build(opts: {
  schemaId: number;
  cycle: number;
  slotIndex: number;
  payload: Buffer;
  issuedAt: bigint;
  revoked?: boolean;
}) {
  const buf = Buffer.alloc(ATTESTATION_LEN);
  issuer.toBuffer().copy(buf, 8);
  subject.toBuffer().copy(buf, 40);
  buf.writeUInt16LE(opts.schemaId, 72);
  const nonce = (BigInt(opts.cycle) << 32n) | BigInt(opts.slotIndex);
  buf.writeBigUInt64LE(nonce, 74);
  opts.payload.copy(buf, 82);
  buf.writeBigInt64LE(opts.issuedAt, 178);
  buf.writeUInt8(opts.revoked ? 1 : 0, 186);
  return decodeAttestationRaw(address, buf);
}

describe("attestationToRowFields — decoded bytes → DB columns", () => {
  it("maps an early payment with the derived classification + delta", () => {
    const payload = encodeBehavioralPayload(
      makeBehavioralPayload({
        classification: CLASS_PAYMENT_EARLY,
        groupSize: 24,
        parcelsPaid: 1,
        dueTs: 1_700_000_000n,
        paidTs: 1_699_999_400n, // 600s early
        amount: 600_000_000n,
      }),
    );
    const raw = build({
      schemaId: 1,
      cycle: 3,
      slotIndex: 7,
      payload,
      issuedAt: 1_699_999_400n,
    });

    const row = attestationToRowFields(raw);
    expect(row.issuer).to.equal(issuer.toBase58());
    expect(row.subject).to.equal(subject.toBase58());
    expect(row.schemaId).to.equal(1);
    expect(row.nonce).to.equal((3n << 32n) | 7n);
    expect(row.cycle).to.equal(3);
    expect(row.slotIndex).to.equal(7);
    expect(row.payloadVersion).to.equal(2); // Pass-3 bump (1 → 2)
    expect(row.classification).to.equal("payment_early");
    expect(row.groupSize).to.equal(24);
    expect(row.parcelsPaid).to.equal(1);
    expect(row.deltaSeconds).to.equal(-600n);
    expect(row.amount).to.equal(600_000_000n);
    expect(row.issuedAt).to.equal(1_699_999_400n);
    expect(row.revoked).to.equal(false);
    // Raw payload preserved as 192-char hex.
    expect(row.payload).to.have.length(192);
    expect(row.payload).to.equal(payload.toString("hex"));
  });

  it("maps a temporary-incapacity payment (classification re-derived from delta)", () => {
    const payload = encodeBehavioralPayload(
      makeBehavioralPayload({
        classification: CLASS_LATE,
        groupSize: 12,
        parcelsPaid: 1,
        dueTs: 0n,
        paidTs: 700_000n, // ~8.1 days late → > 7d LATE_BEHAVIORAL_MAX
        amount: 10_000_000n,
      }),
    );
    const row = attestationToRowFields(
      build({ schemaId: 2, cycle: 0, slotIndex: 0, payload, issuedAt: 700_000n }),
    );
    expect(row.classification).to.equal("temporary_incapacity");
    expect(row.deltaSeconds).to.equal(700_000n);
  });

  it("maps a DEFAULT event (no-payment sentinel)", () => {
    const payload = encodeBehavioralPayload(
      makeBehavioralPayload({
        classification: CLASS_DEFAULT,
        groupSize: 24,
        parcelsPaid: 0,
        dueTs: 1_700_000_000n,
        paidTs: NO_TIMESTAMP,
        amount: 0n,
      }),
    );
    const row = attestationToRowFields(
      build({ schemaId: 3, cycle: 5, slotIndex: 2, payload, issuedAt: 1_700_700_000n }),
    );
    expect(row.classification).to.equal("default");
    expect(row.parcelsPaid).to.equal(0);
    expect(row.deltaSeconds).to.equal(0n); // forced 0 for NO_TIMESTAMP
    expect(row.amount).to.equal(0n);
  });

  it("maps a CYCLE_COMPLETE event", () => {
    const payload = encodeBehavioralPayload(
      makeBehavioralPayload({
        classification: CLASS_POOL_COMPLETE,
        groupSize: 24,
        parcelsPaid: 0,
        dueTs: 0n,
        paidTs: NO_TIMESTAMP,
        amount: 0n,
      }),
    );
    const row = attestationToRowFields(
      build({ schemaId: 4, cycle: 23, slotIndex: 23, payload, issuedAt: 1n }),
    );
    expect(row.classification).to.equal("pool_complete");
    expect(row.cycle).to.equal(23);
  });

  it("legacy zero payload → all structured fields null, classification unspecified", () => {
    const raw = build({
      schemaId: 1,
      cycle: 0,
      slotIndex: 0,
      payload: Buffer.alloc(96), // pre-v5.2 zero payload
      issuedAt: 1n,
    });
    const row = attestationToRowFields(raw);
    expect(row.payloadVersion).to.equal(null);
    expect(row.classification).to.equal("unspecified");
    expect(row.groupSize).to.equal(null);
    expect(row.parcelsPaid).to.equal(null);
    expect(row.deltaSeconds).to.equal(null);
    expect(row.amount).to.equal(null);
    // ...but the raw bytes + identity are still captured.
    expect(row.payload).to.equal("0".repeat(192));
    expect(row.cycle).to.equal(0);
  });

  it("carries the revoked flag through", () => {
    const payload = encodeBehavioralPayload(
      makeBehavioralPayload({
        classification: CLASS_PAYMENT_EARLY,
        groupSize: 5,
        parcelsPaid: 1,
        dueTs: 10n,
        paidTs: 5n,
        amount: 1n,
      }),
    );
    const row = attestationToRowFields(
      build({ schemaId: 1, cycle: 1, slotIndex: 1, payload, issuedAt: 5n, revoked: true }),
    );
    expect(row.revoked).to.equal(true);
  });
});
