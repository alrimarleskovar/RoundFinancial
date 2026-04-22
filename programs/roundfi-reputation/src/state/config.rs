//! `ReputationConfig` — singleton stored at PDA `[b"rep-config"]`.
//!
//! Holds program-wide settings that must NOT change arbitrarily:
//! - `roundfi_core_program` is FROZEN at initialization (immutable). The
//!   identity of the attestor program is load-bearing for the anti-spoof
//!   guard in `attest`, so a rotation would be equivalent to handing the
//!   attacker the keys.
//! - `civic_network` and `authority` are mutable via `update_reputation_config`.

use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct ReputationConfig {
    /// Admin authority — can update `civic_network` and whitelist issuers.
    pub authority: Pubkey,

    /// The roundfi-core program ID whose `Pool` PDAs are trusted as
    /// attestation issuers. FROZEN after initialization.
    pub roundfi_core_program: Pubkey,

    /// Civic Networks program ID (gateway-token account owner). FROZEN.
    pub civic_gateway_program: Pubkey,

    /// Civic gatekeeper network pubkey (e.g. uniqueness / kyc). Mutable
    /// so a Mainnet migration can switch network without a program upgrade.
    pub civic_network: Pubkey,

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
