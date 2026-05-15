//! `Attestation` — SAS-compatible, persistent record of a scoring event.
//! PDA seeds: `[b"attestation", issuer, subject, schema_id_le, nonce_le]`.
//!
//! The seed layout *includes* `nonce`, which is chosen by the issuer.
//! roundfi-core uses `nonce = (cycle as u64) << 32 | slot_index as u64`
//! so every on-chain event has a deterministic, idempotent PDA.

use anchor_lang::prelude::*;

use crate::constants::ATTESTATION_PAYLOAD_LEN;

/// Newtype wrapper around the 96-byte attestation payload.
///
/// Why a wrapper: Anchor 0.30.1 pins `borsh >=0.9, <0.11`, and that
/// borsh range only auto-implements `BorshSerialize`/`BorshDeserialize`
/// for arrays up to `[u8; 32]`. Plain `[u8; 96]` would force every
/// enclosing struct to fail `#[derive(AnchorSerialize)]`.
///
/// This newtype declares manual borsh impls that read/write the 96
/// bytes raw — no length prefix, no transformation. Layout-stable with
/// the bare `[u8; 96]` so on-chain account size + the wire format
/// produced by `roundfi-core::cpi::reputation::invoke_attest` (which
/// writes the payload as raw bytes via `data.extend_from_slice`)
/// remain byte-identical.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Payload(pub [u8; ATTESTATION_PAYLOAD_LEN]);

// Default + borsh impls hand-written: Rust's std `Default` only
// auto-derives for arrays 0..=32. Borsh 1.x's `BorshDeserialize` trait
// adds `deserialize_reader` as a required method that's not auto-
// implemented for `[u8; 96]`, so we provide both the reader path and
// the legacy slice path as a default-impl-aware shim.

impl Default for Payload {
    fn default() -> Self {
        Self([0u8; ATTESTATION_PAYLOAD_LEN])
    }
}

impl borsh::BorshSerialize for Payload {
    fn serialize<W: std::io::Write>(
        &self,
        writer: &mut W,
    ) -> std::io::Result<()> {
        writer.write_all(&self.0)
    }
}

impl borsh::BorshDeserialize for Payload {
    fn deserialize_reader<R: std::io::Read>(
        reader: &mut R,
    ) -> std::io::Result<Self> {
        let mut buf = [0u8; ATTESTATION_PAYLOAD_LEN];
        reader.read_exact(&mut buf)?;
        Ok(Self(buf))
    }
}

#[account]
#[derive(Debug)]
pub struct Attestation {
    pub issuer:  Pubkey, // program-signed PDA or direct authority
    pub subject: Pubkey, // wallet the attestation describes

    pub schema_id: u16,
    pub nonce:     u64,

    /// Fixed 96-byte payload. Schema-specific layout; see
    /// architecture.md §4.6.3.
    pub payload: Payload,

    pub issued_at: i64,
    pub revoked:   bool,

    pub bump: u8,

    /// Whether the subject had a verified `IdentityRecord` at the
    /// moment this attestation was issued. Snapshotted at attest time
    /// and immutable thereafter — `revoke` uses this stored value
    /// (not the CURRENT identity status) to determine the score
    /// reversal weight, ensuring `apply + revoke` is exactly
    /// zero-sum.
    ///
    /// Adevar Labs SEV-008 fix: without this snapshot, a subject who
    /// passed unverified→verified between attest and revoke would
    /// have their score over-reversed (apply with weight 1/2, revoke
    /// with weight 2/2 → score goes negative).
    pub verified_at_attest: bool,

    pub _padding: [u8; 13],
}

impl Attestation {
    /// discriminator(8) + issuer(32) + subject(32) + schema(2) + nonce(8)
    ///   + payload(96) + issued_at(8) + revoked(1) + bump(1)
    ///   + verified_at_attest(1) + pad(13).
    /// Total unchanged on disk — SEV-008 consumed 1 byte of pad.
    pub const LEN: usize =
        8 + 32 + 32 + 2 + 8 + ATTESTATION_PAYLOAD_LEN + 8 + 1 + 1 + 1 + 13;
}

/// Reusable zero payload for emit sites that don't need the slot.
pub const ZERO_PAYLOAD: Payload = Payload([0u8; ATTESTATION_PAYLOAD_LEN]);
