//! `error` — reputation-program error codes.

use anchor_lang::prelude::*;

#[error_code]
pub enum ReputationError {
    // ─── Issuer / caller authorization ──────────────────────────────────
    #[msg("Issuer is not on the whitelist and is not the config authority.")]
    InvalidIssuer,
    #[msg("Unauthorized identity provider.")]
    UnauthorizedProvider,

    // ─── Attestation validation ─────────────────────────────────────────
    #[msg("Unknown or unsupported attestation schema id.")]
    InvalidSchema,
    #[msg("Attestation has already been revoked.")]
    AttestationRevoked,
    #[msg("Cooldown window for this attestation type has not elapsed.")]
    CooldownActive,
    #[msg("Member has a sticky default on this pool; no further positive attestations accepted.")]
    DefaultSticky,
    #[msg("Attestation payload length mismatch.")]
    InvalidPayload,

    // ─── Reputation math ────────────────────────────────────────────────
    #[msg("Reputation score underflow.")]
    ReputationUnderflow,
    #[msg("Math overflow in reputation arithmetic.")]
    MathOverflow,
    #[msg("Requested level is not permitted — threshold not met or out of range.")]
    LevelThresholdNotMet,
    #[msg("Reputation profile not initialized for this wallet.")]
    ProfileNotFound,

    // ─── Identity layer ─────────────────────────────────────────────────
    #[msg("Identity proof failed validation (owner, state, network, or signer mismatch).")]
    InvalidIdentityProof,
    #[msg("Identity proof is expired.")]
    IdentityExpired,
    #[msg("Identity is already linked to this profile — unlink first.")]
    IdentityAlreadyLinked,

    // ─── Admin ──────────────────────────────────────────────────────────
    #[msg("Caller is not the reputation program authority.")]
    Unauthorized,
    #[msg("ReputationConfig is frozen after initialization — this field is immutable.")]
    ImmutableConfigField,
}
