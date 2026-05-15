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
    /// **Adevar Labs SEV-022 carve-out:** pool-PDA-signed CPI from
    /// roundfi-core continues even when paused (so core's
    /// settle_default / contribute / claim_payout never lock-up via
    /// the back door of a paused reputation). See attest.rs handler.
    pub paused: bool,

    /// PDA bump.
    pub bump: u8,

    // ─── Adevar Labs SEV-021 fix — timelocked authority rotation ──────
    /// Pending authority rotation. `Pubkey::default()` (all-zero) when
    /// no rotation queued. Set by `propose_new_reputation_authority`,
    /// cleared by `cancel_new_reputation_authority` or finalized by
    /// `commit_new_reputation_authority`. Mirrors the core program's
    /// authority rotation pattern (PR #323) — was originally a
    /// no-timelock rotation via `update_reputation_config`, which
    /// the auditor flagged as asymmetric with core's protection.
    pub pending_authority:     Pubkey,
    /// Earliest unix-ts at which `commit_new_reputation_authority`
    /// may execute. `0` when no rotation pending. Equals
    /// `now + REPUTATION_AUTHORITY_TIMELOCK_SECS` (7d) at proposal
    /// time. Same window as core's authority + treasury rotations.
    pub pending_authority_eta: i64,

    /// Reserved for future fields without a migration. Adevar SEV-021
    /// consumed 30 of the original 30 pad bytes (Pubkey 32 + i64 8 =
    /// 40, exceeded pad by 10) — LEN grew by 10 to 170. Pre-PR
    /// devnet `ReputationConfig` accounts need re-init since Anchor
    /// sizes accounts at create time.
    pub _padding: [u8; 0],
}

impl ReputationConfig {
    /// Anchor discriminator (8) + fields.
    /// 32*4 + 1 + 1 + 32 + 8 + 0 = 170.
    pub const LEN: usize = 8 + 32 * 4 + 1 + 1 + 32 + 8 + 0;
}
