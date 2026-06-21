//! Behavioral payload — the structured v5.2 Hybrid view of the 96-byte
//! `Attestation.payload` field.
//!
//! ## Why this exists
//!
//! Every scoring event already gets its own immutable, idempotent
//! `Attestation` PDA (see `attestation.rs`) — keyed by
//! `(issuer, subject, schema_id, nonce)` where
//! `nonce = (cycle << 32) | slot_index`. That account carries a 96-byte
//! `payload` that, prior to reputation v5.2, `roundfi-core` wrote as all
//! zeros ("Core does not embed per-cycle data in the payload").
//!
//! The v5.2 Hybrid direction (architecture.md §4.7) needs richer
//! per-event data on-chain — `delta_seconds`, the deadline, the paid
//! amount, group size — so the indexer can compute a score off-chain
//! that any third party can recompute from the same on-chain bytes. The
//! existing 96-byte slot is exactly the place for it: no new account, no
//! batched-PDA `Vec`, no migration. Old attestations keep their zero
//! payload (decode → `None` → "pre-v5.2, no rich data"); new ones carry
//! this layout.
//!
//! ## Authority boundary
//!
//! This is a **breadcrumb**, not the verdict. `classification` here is a
//! coarse on-chain hint; the indexer is authoritative — it derives the
//! final v5.2 `EventClassification` (and any FrictionProof reweighting)
//! off-chain. The deployed program never reads this payload back to gate
//! anything; it only writes it. That keeps the on-chain trust surface
//! unchanged while the data becomes available.
//!
//! ## Versioning
//!
//! Byte 0 is a schema version. The indexer dispatches on it, so a future
//! layout (v2) and the legacy zero payload (v0) coexist with v1 without
//! an account-size change. `decode` returns `None` for v0 (legacy) and
//! for any version this program build doesn't know — version dispatch
//! beyond v1 is the indexer's job in TypeScript, not the program's.

use crate::constants::ATTESTATION_PAYLOAD_LEN;

/// Current payload layout version. Bump on any field-layout change.
/// Bumped from 1 to 2 by Pass-3 (Caio HIGH, 2026-06-12). The byte
/// layout did not change, so v2 payloads decode under the same
/// `BehavioralPayload` shape, but the classification taxonomy changed:
/// `CLASS_CYCLE_COMPLETE` was renamed-and-resemanticised to
/// `CLASS_POOL_COMPLETE`, and a new `CLASS_PAYOUT_CLAIMED` was added.
/// The indexer uses the version byte to disambiguate legacy v1
/// payloads (`classification = 5` meant "received payout, score +50")
/// from v2 payloads (`classification = 5` means "completed the pool
/// end-to-end" and `classification = 6` means "received payout, score
/// neutral"). See `services/indexer/src/behavioralClassification.ts`.
pub const BEHAVIORAL_PAYLOAD_VERSION: u8 = 2;

// ── Coarse on-chain classification hints ─────────────────────────────
// The indexer is authoritative; these are cheap breadcrumbs so a raw
// account read is interpretable without replaying the schedule.
pub const CLASS_UNSPECIFIED: u8 = 0; // legacy zero payload / unknown
pub const CLASS_PAYMENT_ON_TIME: u8 = 1;
pub const CLASS_PAYMENT_EARLY: u8 = 2;
pub const CLASS_LATE: u8 = 3;
pub const CLASS_DEFAULT: u8 = 4;
/// Renamed by Pass-3 from `CLASS_CYCLE_COMPLETE`. Same byte value (5),
/// different meaning: under payload v2 this is emitted by `contribute`
/// at the member's final installment. Under v1 (legacy attestations)
/// this byte means "received payout" — the indexer disambiguates by the
/// version byte.
pub const CLASS_POOL_COMPLETE: u8 = 5;
/// NEW (Pass-3, v2 only). Emitted by `claim_payout` to record the audit
/// trail of a member receiving their carta this cycle. Score-neutral.
pub const CLASS_PAYOUT_CLAIMED: u8 = 6;

/// Pre-Pass-3 alias — kept so external decoders that read the constant
/// directly don't error. New code MUST use `CLASS_POOL_COMPLETE` and be
/// version-aware. Removed in a follow-up wave.
#[deprecated(since = "0.5.0", note = "use CLASS_POOL_COMPLETE (Pass-3 rename)")]
pub const CLASS_CYCLE_COMPLETE: u8 = CLASS_POOL_COMPLETE;

/// Sentinel for "no payment timestamp" (e.g. a DEFAULT event — the
/// member never paid). `delta_seconds` is forced to 0 in that case and
/// the `classification` byte signals that timing is not meaningful.
pub const NO_TIMESTAMP: i64 = i64::MIN;

/// Structured view of `Attestation.payload` under
/// `BEHAVIORAL_PAYLOAD_VERSION`. All multi-byte integers little-endian.
///
/// On-disk layout (96 bytes):
/// ```text
///   off  0: version         u8       (1)
///   off  1: classification  u8       (1)
///   off  2: group_size      u8       (1)   members_target of the pool
///   off  3: parcels_paid    u8       (1)   installments paid this event
///   off  4: _pad0           [u8; 4]  (4)   align the i64 block to 8
///   off  8: due_ts          i64      (8)   cycle deadline (unix secs)
///   off 16: paid_ts         i64      (8)   payment time, or NO_TIMESTAMP
///   off 24: delta_seconds   i64      (8)   paid_ts - due_ts (0 if none)
///   off 32: amount          u64      (8)   USDC base units moved
///   off 40: _reserved       [u8; 56] (56)  zero — future fields
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BehavioralPayload {
    pub version: u8,
    pub classification: u8,
    pub group_size: u8,
    pub parcels_paid: u8,
    pub due_ts: i64,
    pub paid_ts: i64,
    pub delta_seconds: i64,
    pub amount: u64,
}

impl BehavioralPayload {
    /// Build a v1 payload. `delta_seconds` is derived here (single code
    /// path) so it can never disagree with `paid_ts - due_ts`. For a
    /// no-payment event pass `paid_ts = NO_TIMESTAMP`; delta is then 0
    /// and the caller should set `classification = CLASS_DEFAULT`.
    ///
    /// `saturating_sub` guards the pathological i64 over/underflow that a
    /// crafted/garbage timestamp could otherwise trigger.
    pub fn new(
        classification: u8,
        group_size: u8,
        parcels_paid: u8,
        due_ts: i64,
        paid_ts: i64,
        amount: u64,
    ) -> Self {
        let delta_seconds = if paid_ts == NO_TIMESTAMP {
            0
        } else {
            paid_ts.saturating_sub(due_ts)
        };
        Self {
            version: BEHAVIORAL_PAYLOAD_VERSION,
            classification,
            group_size,
            parcels_paid,
            due_ts,
            paid_ts,
            delta_seconds,
            amount,
        }
    }

    /// Serialize to the fixed 96-byte buffer. Reserved/pad bytes are
    /// always zero, so two equal payloads encode byte-identically
    /// (important: the attestation PDA's content is part of the audit
    /// trail; non-deterministic padding would break byte-level diffing).
    pub fn encode(&self) -> [u8; ATTESTATION_PAYLOAD_LEN] {
        let mut out = [0u8; ATTESTATION_PAYLOAD_LEN];
        out[0] = self.version;
        out[1] = self.classification;
        out[2] = self.group_size;
        out[3] = self.parcels_paid;
        // out[4..8] reserved (zero) — alignment pad.
        out[8..16].copy_from_slice(&self.due_ts.to_le_bytes());
        out[16..24].copy_from_slice(&self.paid_ts.to_le_bytes());
        out[24..32].copy_from_slice(&self.delta_seconds.to_le_bytes());
        out[32..40].copy_from_slice(&self.amount.to_le_bytes());
        // out[40..96] reserved (zero).
        out
    }

    /// Decode a 96-byte payload. Returns `None` when:
    ///   - version byte is `0` (legacy zero payload — pre-v5.2), or
    ///   - version is not one this build understands (future layout —
    ///     the indexer dispatches those in TS, not the program).
    ///
    /// A `Some` result is a fully-populated v1 payload.
    pub fn decode(bytes: &[u8; ATTESTATION_PAYLOAD_LEN]) -> Option<Self> {
        let version = bytes[0];
        if version != BEHAVIORAL_PAYLOAD_VERSION {
            // v0 = legacy zero payload; anything else = unknown future.
            return None;
        }
        let read_i64 = |off: usize| {
            let mut b = [0u8; 8];
            b.copy_from_slice(&bytes[off..off + 8]);
            i64::from_le_bytes(b)
        };
        let read_u64 = |off: usize| {
            let mut b = [0u8; 8];
            b.copy_from_slice(&bytes[off..off + 8]);
            u64::from_le_bytes(b)
        };
        Some(Self {
            version,
            classification: bytes[1],
            group_size: bytes[2],
            parcels_paid: bytes[3],
            due_ts: read_i64(8),
            paid_ts: read_i64(16),
            delta_seconds: read_i64(24),
            amount: read_u64(32),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_on_time_payment() {
        let p = BehavioralPayload::new(
            CLASS_PAYMENT_ON_TIME,
            24,            // group_size
            1,             // parcels_paid
            1_700_000_000, // due_ts
            1_699_999_400, // paid_ts (600s early)
            600_000_000,   // amount (600 USDC)
        );
        // Derived delta is exact.
        assert_eq!(p.delta_seconds, -600);
        let bytes = p.encode();
        let back = BehavioralPayload::decode(&bytes).expect("v1 decodes");
        assert_eq!(p, back);
    }

    #[test]
    fn default_event_uses_no_timestamp_sentinel() {
        let p = BehavioralPayload::new(
            CLASS_DEFAULT,
            24,
            0, // no parcels paid
            1_700_000_000,
            NO_TIMESTAMP, // never paid
            0,
        );
        // delta forced to 0 for the no-payment case.
        assert_eq!(p.delta_seconds, 0);
        assert_eq!(p.paid_ts, NO_TIMESTAMP);
        let back = BehavioralPayload::decode(&p.encode()).unwrap();
        assert_eq!(p, back);
    }

    #[test]
    fn legacy_zero_payload_decodes_none() {
        // The exact bytes core wrote before v5.2: all zeros.
        let zero = [0u8; ATTESTATION_PAYLOAD_LEN];
        assert!(BehavioralPayload::decode(&zero).is_none());
    }

    #[test]
    fn unknown_future_version_decodes_none() {
        let mut bytes = BehavioralPayload::new(CLASS_LATE, 12, 1, 100, 200, 5).encode();
        bytes[0] = 99; // pretend a future layout
        assert!(BehavioralPayload::decode(&bytes).is_none());
    }

    #[test]
    fn encode_is_exactly_96_bytes_with_zero_reserved() {
        let p = BehavioralPayload::new(CLASS_POOL_COMPLETE, 24, 1, 1, 2, 3);
        let bytes = p.encode();
        assert_eq!(bytes.len(), ATTESTATION_PAYLOAD_LEN);
        // alignment pad (4..8) and reserved tail (40..96) must be zero.
        assert!(bytes[4..8].iter().all(|&b| b == 0));
        assert!(bytes[40..].iter().all(|&b| b == 0));
    }

    #[test]
    fn late_payment_positive_delta() {
        let p = BehavioralPayload::new(
            CLASS_LATE,
            24,
            1,
            1_700_000_000,
            1_700_086_400, // 1 day late
            600_000_000,
        );
        assert_eq!(p.delta_seconds, 86_400);
        assert_eq!(BehavioralPayload::decode(&p.encode()).unwrap(), p);
    }

    #[test]
    fn boundary_values_survive_round_trip() {
        let p = BehavioralPayload::new(
            255,      // max classification byte
            255,      // max group_size
            255,      // max parcels_paid
            i64::MAX, // due_ts extreme
            i64::MAX, // paid_ts extreme → delta should saturate, not panic
            u64::MAX, // amount extreme
        );
        // saturating_sub: MAX - MAX = 0, no panic.
        assert_eq!(p.delta_seconds, 0);
        let back = BehavioralPayload::decode(&p.encode()).unwrap();
        assert_eq!(p, back);
    }

    #[test]
    fn delta_saturates_instead_of_overflowing() {
        // paid very large, due very negative → naive subtraction overflows.
        let p = BehavioralPayload::new(CLASS_LATE, 24, 1, i64::MIN + 1, i64::MAX, 1);
        // Must be the saturated value, not a panic / wrapped result.
        assert_eq!(p.delta_seconds, i64::MAX);
        assert_eq!(BehavioralPayload::decode(&p.encode()).unwrap(), p);
    }
}
