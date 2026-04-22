//! `Attestation` — SAS-compatible, persistent record of a scoring event.
//! PDA seeds: `[b"attestation", issuer, subject, schema_id_le, nonce_le]`.
//!
//! The seed layout *includes* `nonce`, which is chosen by the issuer.
//! roundfi-core uses `nonce = (cycle as u64) << 32 | slot_index as u64`
//! so every on-chain event has a deterministic, idempotent PDA.

use anchor_lang::prelude::*;

use crate::constants::ATTESTATION_PAYLOAD_LEN;

#[account]
#[derive(Debug)]
pub struct Attestation {
    pub issuer:  Pubkey, // program-signed PDA or direct authority
    pub subject: Pubkey, // wallet the attestation describes

    pub schema_id: u16,
    pub nonce:     u64,

    /// Fixed 96-byte payload. Schema-specific layout; see
    /// architecture.md §4.6.3.
    pub payload: [u8; ATTESTATION_PAYLOAD_LEN],

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
pub const ZERO_PAYLOAD: [u8; ATTESTATION_PAYLOAD_LEN] = [0u8; ATTESTATION_PAYLOAD_LEN];
