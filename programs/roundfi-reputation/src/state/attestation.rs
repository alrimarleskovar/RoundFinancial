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

    pub _padding: [u8; 14],
}

impl Attestation {
    /// discriminator(8) + issuer(32) + subject(32) + schema(2) + nonce(8)
    ///   + payload(96) + issued_at(8) + revoked(1) + bump(1) + pad(14).
    pub const LEN: usize =
        8 + 32 + 32 + 2 + 8 + ATTESTATION_PAYLOAD_LEN + 8 + 1 + 1 + 14;
}

/// Reusable zero payload for emit sites that don't need the slot.
pub const ZERO_PAYLOAD: Payload = Payload([0u8; ATTESTATION_PAYLOAD_LEN]);
