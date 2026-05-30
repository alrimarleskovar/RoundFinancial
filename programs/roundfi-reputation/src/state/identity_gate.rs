//! `IdentityGateConfig` — SEV-047 defense-in-depth (identity gate) config.
//!
//! A SEPARATE singleton PDA (seed `[b"identity-gate"]`) — deliberately NOT a
//! field on `ReputationConfig`, whose padding is exhausted (SEV-032). Keeping
//! it standalone avoids a `realloc` of the live `ReputationConfig` PDA, which
//! would make existing config accounts unreadable until migrated (the exact
//! hazard SEV-032 flagged).
//!
//! Default / absence ≡ gate DISABLED. The protocol authority opts in via the
//! `set_identity_gate` instruction, so devnet / Canary is unaffected until the
//! gate is explicitly enabled for mainnet.
//!
//! Pairs with the pure `ReputationProfile::cap_level_for_identity` helper,
//! which applies the floor; this account only stores the policy.

use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct IdentityGateConfig {
    /// Authority allowed to change the gate. Set to `ReputationConfig.authority`
    /// at creation; `set_identity_gate` re-checks the live config authority on
    /// every call, so a later authority rotation is honored.
    pub authority: Pubkey,

    /// Lowest reputation level that requires a verified `IdentityRecord`.
    ///   - `0` ≡ gate DISABLED (no level requires identity — the default).
    ///   - `N` (2..=`LEVEL_MAX`) ≡ promotion to level ≥ N requires a verified
    ///     identity; unverified subjects are capped at `N − 1`.
    pub required_min_level: u8,

    pub bump: u8,
}

impl IdentityGateConfig {
    /// 8 (discriminator) + 32 (authority) + 1 (required_min_level) + 1 (bump).
    pub const LEN: usize = 8 + 32 + 1 + 1;
}
