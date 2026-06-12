/**
 * TypeScript mirror of `roundfi_reputation::state::BehavioralPayload`
 * (the structured v5.2 Hybrid view of `Attestation.payload`).
 *
 * Lives in @roundfi/sdk because TWO consumers must agree byte-for-byte
 * with the on-chain Rust codec:
 *   - the indexer (`services/indexer`) decodes payloads at ingest to
 *     derive `EventClassification` and the off-chain score,
 *   - the mobile + admin clients decode them directly from raw account
 *     reads when no indexer is in front (P2P / cold-start path).
 *
 * ─── PARITY CONTRACT ─────────────────────────────────────────────────
 * Every field offset / size below mirrors the Rust source of truth:
 *   `programs/roundfi-reputation/src/state/behavioral_payload.rs`
 * If the program's layout changes (version bump), update this module
 * AND the Rust source AND re-run `tests/behavioral_payload_parity.spec.ts`
 * — the parity spec encodes a fixture in Rust and decodes it here,
 * asserting field-for-field equality.
 * ─────────────────────────────────────────────────────────────────────
 *
 * All multi-byte integers are little-endian (matches Solana convention
 * and the Rust `to_le_bytes`). i64/u64 fields surface as `bigint` to
 * match the on-chain types without precision loss.
 */

/** Length of `Attestation.payload`, in bytes. Mirrors the Rust constant
 *  `roundfi_reputation::constants::ATTESTATION_PAYLOAD_LEN`. */
export const ATTESTATION_PAYLOAD_LEN = 96;

/** Current payload layout version. Bumps on any field-layout change.
 *  Mirrors `BEHAVIORAL_PAYLOAD_VERSION` in the Rust source. */
export const BEHAVIORAL_PAYLOAD_VERSION = 1;

// ── Coarse on-chain classification hints ─────────────────────────────
// The indexer is authoritative; these are cheap breadcrumbs so a raw
// account read is interpretable without replaying the schedule.
export const CLASS_UNSPECIFIED = 0; // legacy zero payload / unknown
export const CLASS_PAYMENT_ON_TIME = 1;
export const CLASS_PAYMENT_EARLY = 2;
export const CLASS_LATE = 3;
export const CLASS_DEFAULT = 4;
export const CLASS_CYCLE_COMPLETE = 5;

/** Set of every known v1 classification byte — anything outside this
 *  set is unknown and the decoder maps it through as-is (callers can
 *  decide whether to surface "unknown" or drop). */
export const KNOWN_CLASSES: ReadonlySet<number> = new Set([
  CLASS_UNSPECIFIED,
  CLASS_PAYMENT_ON_TIME,
  CLASS_PAYMENT_EARLY,
  CLASS_LATE,
  CLASS_DEFAULT,
  CLASS_CYCLE_COMPLETE,
]);

/**
 * Sentinel for "no payment timestamp" (DEFAULT events — the member
 * never paid; CYCLE_COMPLETE — payout claim, timing N/A). When set,
 * `deltaSeconds` is forced to `0n` by the encoder.
 *
 * Equal to Rust's `i64::MIN` (`-2^63`). Stored as bigint to survive
 * the JS Number range.
 */
export const NO_TIMESTAMP: bigint = -9223372036854775808n; // i64::MIN

/** Structured view of `Attestation.payload` under version 1.
 *
 *  Layout (96 bytes, little-endian):
 *  ```text
 *    off  0: version         u8       (1)
 *    off  1: classification  u8       (1)
 *    off  2: group_size      u8       (1)
 *    off  3: parcels_paid    u8       (1)
 *    off  4: _pad0           [u8; 4]  (4)   align the i64 block to 8
 *    off  8: due_ts          i64      (8)
 *    off 16: paid_ts         i64      (8)   or NO_TIMESTAMP
 *    off 24: delta_seconds   i64      (8)   paid_ts - due_ts (saturating)
 *    off 32: amount          u64      (8)   USDC base units
 *    off 40: _reserved       [u8; 56] (56)  zero — future fields
 *  ```
 */
export interface BehavioralPayload {
  version: number;
  classification: number;
  groupSize: number;
  parcelsPaid: number;
  dueTs: bigint;
  paidTs: bigint;
  deltaSeconds: bigint;
  amount: bigint;
}

const OFF_VERSION = 0;
const OFF_CLASSIFICATION = 1;
const OFF_GROUP_SIZE = 2;
const OFF_PARCELS_PAID = 3;
const OFF_DUE_TS = 8;
const OFF_PAID_TS = 16;
const OFF_DELTA_SECONDS = 24;
const OFF_AMOUNT = 32;

/** Saturating `i64` subtraction — mirrors Rust's `i64::saturating_sub`.
 *  Used by the encoder so `paid_ts - due_ts` can't panic on a crafted
 *  pair of extreme timestamps. */
function saturatingSubI64(a: bigint, b: bigint): bigint {
  const I64_MAX = 9223372036854775807n;
  const I64_MIN = -9223372036854775808n;
  const r = a - b;
  if (r > I64_MAX) return I64_MAX;
  if (r < I64_MIN) return I64_MIN;
  return r;
}

/**
 * Build a v1 payload. `deltaSeconds` is derived here (single code path)
 * so it can never disagree with `paidTs - dueTs`. For a no-payment
 * event pass `paidTs = NO_TIMESTAMP`; delta is then `0n` and the caller
 * should set `classification = CLASS_DEFAULT`.
 *
 * Mirrors `BehavioralPayload::new` in the Rust source.
 */
export function makeBehavioralPayload(args: {
  classification: number;
  groupSize: number;
  parcelsPaid: number;
  dueTs: bigint;
  paidTs: bigint;
  amount: bigint;
}): BehavioralPayload {
  const deltaSeconds =
    args.paidTs === NO_TIMESTAMP ? 0n : saturatingSubI64(args.paidTs, args.dueTs);
  return {
    version: BEHAVIORAL_PAYLOAD_VERSION,
    classification: args.classification,
    groupSize: args.groupSize,
    parcelsPaid: args.parcelsPaid,
    dueTs: args.dueTs,
    paidTs: args.paidTs,
    deltaSeconds,
    amount: args.amount,
  };
}

/**
 * Encode a v1 payload to a fixed 96-byte buffer. Reserved bytes are
 * always zero so two equal payloads encode byte-identically (the
 * attestation PDA is part of the audit trail — non-deterministic
 * padding would break byte-level diffing).
 *
 * Mirrors `BehavioralPayload::encode` in Rust.
 */
export function encodeBehavioralPayload(p: BehavioralPayload): Buffer {
  const buf = Buffer.alloc(ATTESTATION_PAYLOAD_LEN);
  buf.writeUInt8(p.version, OFF_VERSION);
  buf.writeUInt8(p.classification, OFF_CLASSIFICATION);
  buf.writeUInt8(p.groupSize, OFF_GROUP_SIZE);
  buf.writeUInt8(p.parcelsPaid, OFF_PARCELS_PAID);
  // [4..8] reserved (zero) — alignment pad.
  buf.writeBigInt64LE(p.dueTs, OFF_DUE_TS);
  buf.writeBigInt64LE(p.paidTs, OFF_PAID_TS);
  buf.writeBigInt64LE(p.deltaSeconds, OFF_DELTA_SECONDS);
  buf.writeBigUInt64LE(p.amount, OFF_AMOUNT);
  // [40..96] reserved (zero).
  return buf;
}

/**
 * Decode a `Attestation.payload` blob. Returns `null` for:
 *   - a legacy zero payload (version byte `0`, what core wrote
 *     pre-v5.2),
 *   - any version this SDK build doesn't understand (future layout —
 *     bump the SDK in lockstep with the program).
 *
 * Throws on a length-wrong input — that's a caller bug, not a forward-
 * compat case. Accepts both `Buffer` and `Uint8Array` so this is usable
 * from both Node (indexer) and React Native (mobile) without extra
 * shimming — RN polyfills `Buffer` but consumers may pass a raw
 * `Uint8Array` from `@solana/web3.js`.
 */
export function decodeBehavioralPayload(bytes: Buffer | Uint8Array): BehavioralPayload | null {
  if (bytes.length !== ATTESTATION_PAYLOAD_LEN) {
    throw new Error(
      `decodeBehavioralPayload: expected ${ATTESTATION_PAYLOAD_LEN} bytes, got ${bytes.length}`,
    );
  }
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const version = buf.readUInt8(OFF_VERSION);
  if (version !== BEHAVIORAL_PAYLOAD_VERSION) {
    // v0 (legacy zero) and any unknown future version → caller treats
    // as "no structured data" — parity with the Rust decoder.
    return null;
  }
  return {
    version,
    classification: buf.readUInt8(OFF_CLASSIFICATION),
    groupSize: buf.readUInt8(OFF_GROUP_SIZE),
    parcelsPaid: buf.readUInt8(OFF_PARCELS_PAID),
    dueTs: buf.readBigInt64LE(OFF_DUE_TS),
    paidTs: buf.readBigInt64LE(OFF_PAID_TS),
    deltaSeconds: buf.readBigInt64LE(OFF_DELTA_SECONDS),
    amount: buf.readBigUInt64LE(OFF_AMOUNT),
  };
}

/** Human label for a classification byte. Used by admin/mobile UI;
 *  the indexer derives its own `EventClassification` and should not
 *  rely on this label for scoring. */
export function classificationLabel(byte: number): string {
  switch (byte) {
    case CLASS_UNSPECIFIED:
      return "unspecified";
    case CLASS_PAYMENT_ON_TIME:
      return "payment_on_time";
    case CLASS_PAYMENT_EARLY:
      return "payment_early";
    case CLASS_LATE:
      return "payment_late";
    case CLASS_DEFAULT:
      return "default";
    case CLASS_CYCLE_COMPLETE:
      return "cycle_complete";
    default:
      return `unknown_${byte}`;
  }
}
