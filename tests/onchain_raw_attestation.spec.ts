/**
 * Exact-offset coverage for `decodeAttestationRaw` (@roundfi/sdk).
 *
 * The IDL-free Attestation decoder mirrors the on-chain layout in
 * `programs/roundfi-reputation/src/state/attestation.rs`. This spec
 * builds a synthetic 202-byte account buffer at the documented offsets
 * and asserts every field decodes, including the `(cycle, slotIndex)`
 * split of `nonce = (cycle << 32) | slot_index` and the embedded
 * BehavioralPayload (decoded via the canonical codec).
 */

import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import {
  ATTESTATION_LEN,
  CLASS_PAYMENT_EARLY,
  decodeAttestationRaw,
  encodeBehavioralPayload,
  makeBehavioralPayload,
} from "@roundfi/sdk";

// Layout (source of truth: attestation.rs):
//   8 disc | 32 issuer | 32 subject | 2 schema | 8 nonce | 96 payload
//   | 8 issued_at | 1 revoked | 1 bump | 1 verified_at_attest | 13 pad
function buildAttestation(opts: {
  issuer: PublicKey;
  subject: PublicKey;
  schemaId: number;
  nonce: bigint;
  payload: Buffer;
  issuedAt: bigint;
  revoked: boolean;
  bump: number;
  verifiedAtAttest: boolean;
}): Buffer {
  const buf = Buffer.alloc(ATTESTATION_LEN);
  // [0..8] discriminator — left zero; the decoder ignores it.
  opts.issuer.toBuffer().copy(buf, 8);
  opts.subject.toBuffer().copy(buf, 40);
  buf.writeUInt16LE(opts.schemaId, 72);
  buf.writeBigUInt64LE(opts.nonce, 74);
  opts.payload.copy(buf, 82);
  buf.writeBigInt64LE(opts.issuedAt, 178);
  buf.writeUInt8(opts.revoked ? 1 : 0, 186);
  buf.writeUInt8(opts.bump, 187);
  buf.writeUInt8(opts.verifiedAtAttest ? 1 : 0, 188);
  return buf;
}

describe("decodeAttestationRaw", () => {
  const issuer = new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw"); // pool/program-ish
  const subject = PublicKey.unique();
  const address = PublicKey.unique();

  it("decodes every field including the (cycle, slotIndex) nonce split", () => {
    const cycle = 5;
    const slotIndex = 12;
    const nonce = (BigInt(cycle) << 32n) | BigInt(slotIndex);

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

    const buf = buildAttestation({
      issuer,
      subject,
      schemaId: 1,
      nonce,
      payload,
      issuedAt: 1_699_999_400n,
      revoked: false,
      bump: 254,
      verifiedAtAttest: true,
    });

    const a = decodeAttestationRaw(address, buf);
    expect(a.address.equals(address)).to.equal(true);
    expect(a.issuer.equals(issuer)).to.equal(true);
    expect(a.subject.equals(subject)).to.equal(true);
    expect(a.schemaId).to.equal(1);
    expect(a.nonce).to.equal(nonce);
    expect(a.cycle).to.equal(cycle);
    expect(a.slotIndex).to.equal(slotIndex);
    expect(a.issuedAt).to.equal(1_699_999_400n);
    expect(a.revoked).to.equal(false);
    expect(a.verifiedAtAttest).to.equal(true);

    // Raw payload preserved byte-for-byte.
    expect(Buffer.compare(a.payloadRaw, payload)).to.equal(0);

    // Structured payload decoded via the canonical codec.
    expect(a.payload).to.not.equal(null);
    expect(a.payload!.classification).to.equal(CLASS_PAYMENT_EARLY);
    expect(a.payload!.groupSize).to.equal(24);
    expect(a.payload!.deltaSeconds).to.equal(-600n);
    expect(a.payload!.amount).to.equal(600_000_000n);
  });

  it("surfaces a legacy zero payload as payload === null", () => {
    const buf = buildAttestation({
      issuer,
      subject,
      schemaId: 2,
      nonce: 0n,
      payload: Buffer.alloc(96), // all zeros — pre-v5.2
      issuedAt: 1n,
      revoked: false,
      bump: 1,
      verifiedAtAttest: false,
    });
    const a = decodeAttestationRaw(address, buf);
    expect(a.payload).to.equal(null);
    // ...but the raw bytes are still exposed for audit diffing.
    expect(a.payloadRaw.length).to.equal(96);
    expect(a.payloadRaw.every((b) => b === 0)).to.equal(true);
  });

  it("decodes the revoked flag", () => {
    const buf = buildAttestation({
      issuer,
      subject,
      schemaId: 1,
      nonce: 0n,
      payload: Buffer.alloc(96),
      issuedAt: 1n,
      revoked: true,
      bump: 1,
      verifiedAtAttest: false,
    });
    expect(decodeAttestationRaw(address, buf).revoked).to.equal(true);
  });
});
