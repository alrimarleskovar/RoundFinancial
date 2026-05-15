//! `ReputationConfig` — singleton stored at PDA `[b"rep-config"]`.
//!
//! Holds program-wide settings that must NOT change arbitrarily:
//! - `roundfi_core_program` is FROZEN at initialization (immutable). The
//!   identity of the attestor program is load-bearing for the anti-spoof
//!   guard in `attest`, so a rotation would be equivalent to handing the
//!   attacker the keys.
//! - `passport_network` and `authority` are mutable via `update_reputation_config`.
//!
//! ## Civic → Human Passport migration (#227)
//!
//! Field names + types renamed from `civic_*` to `passport_*`. Account
//! layout is byte-identical (same Pubkey × 4 + bool + u8 + 30-byte
//! padding), so existing devnet `ReputationConfig` PDAs survive
//! without realloc. Semantic shift: the "gateway program" field now
//! holds the **off-chain bridge service pubkey** that issues
//! Passport-derived attestations, not the Civic Networks program ID.

use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct ReputationConfig {
    /// Admin authority — can update `passport_network` and whitelist issuers.
    pub authority: Pubkey,

    /// The roundfi-core program ID whose `Pool` PDAs are trusted as
    /// attestation issuers. FROZEN after initialization.
    pub roundfi_core_program: Pubkey,

    /// **Passport attestation authority** — pubkey of the off-chain
    /// bridge service that translates Human Passport score queries
    /// into on-chain 83-byte attestation accounts. Validator requires
    /// `attestation_account.owner == passport_attestation_authority`.
    /// FROZEN at initialization. Field name kept generic so a future
    /// provider migration (e.g. → Sumsub for KYC-grade signal in
    /// Phase 3 B2B) is also byte-compatible.
    pub passport_attestation_authority: Pubkey,

    /// Passport "network" pubkey — a free-form scope identifier the
    /// bridge service embeds in every attestation it issues so
    /// rotation between e.g. "passport-prod" and "passport-staging"
    /// scopes is possible without re-deploying. Mutable so a
    /// mainnet migration can switch scope without a program upgrade.
    pub passport_network: Pubkey,

    /// Emergency stop — short-circuits write-path instructions.
    pub paused: bool,

    /// PDA bump.
    pub bump: u8,

    /// Reserved for future fields without a migration.
    pub _padding: [u8; 30],
}

impl ReputationConfig {
    /// Anchor discriminator (8) + fields.
    /// 32*4 + 1 + 1 + 30 = 160.
    pub const LEN: usize = 8 + 32 * 4 + 1 + 1 + 30;
}
