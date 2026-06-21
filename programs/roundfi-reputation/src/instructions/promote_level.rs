//! `promote_level` — permissionless re-evaluation of `profile.level`
//! from the current score + cycles, with the SEV-047 identity gate applied.
//!
//! - Anyone can call — no admin path, no privileged signer.
//! - Monotonic: level can only increase here. If the score drops below the
//!   current tier (because a Default was attested), the new level is still the
//!   highest qualifying one; it never demotes here. (The next `join_pool`
//!   re-snapshots whatever resolves at that time, which IS allowed to be lower.)
//! - **SEV-047 defense-in-depth (Part 2):** the score/cycles-resolved level is
//!   then capped by `IdentityGateConfig.required_min_level` — when the gate is
//!   enabled (mainnet), reaching the configured tier requires a verified
//!   `IdentityRecord`. The gate config is a REQUIRED account so enforcement
//!   cannot be bypassed by omitting it; with `required_min_level == 0` (the
//!   default) it is a no-op (devnet / Canary unaffected).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::{IdentityGateConfig, IdentityRecord, ReputationProfile};

#[derive(Accounts)]
pub struct PromoteLevel<'info> {
    /// CHECK: only used to seed the profile + identity PDAs.
    pub subject: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_PROFILE, subject.key().as_ref()],
        bump = profile.bump,
    )]
    pub profile: Account<'info, ReputationProfile>,

    /// SEV-047 identity-gate config (singleton). REQUIRED — the policy must be
    /// loadable so the gate can't be bypassed by omitting it. With
    /// `required_min_level == 0` (default) it is a no-op. Created via
    /// `set_identity_gate` (run once per deployment before `promote_level`).
    #[account(
        seeds = [SEED_IDENTITY_GATE],
        bump = identity_gate.bump,
    )]
    pub identity_gate: Account<'info, IdentityGateConfig>,

    /// Optional `IdentityRecord` for the subject. Absence ≡ Unverified — which,
    /// when the gate is enabled, caps the subject below the identity floor.
    /// Seeds-constrained so it can't be forged; passing a non-IdentityRecord
    /// account (e.g. the program ID) resolves to `None`.
    ///
    /// CHECK: verified via seeds + owner by Anchor; treated as Unverified if None.
    #[account(
        seeds = [SEED_IDENTITY, subject.key().as_ref()],
        bump,
    )]
    pub identity: Option<Account<'info, IdentityRecord>>,

    pub caller: Signer<'info>,
}

pub fn handler(ctx: Context<PromoteLevel>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // SEV-047 identity gate (read before the &mut profile borrow).
    let required_min_level = ctx.accounts.identity_gate.required_min_level;
    let identity_verified = ctx
        .accounts
        .identity
        .as_ref()
        .map_or(false, |rec| rec.is_verified(now));

    let profile = &mut ctx.accounts.profile;

    // Score + cycles gate (SEV-047 Part 1 / cycles).
    let resolved = ReputationProfile::resolve_level(
        profile.score,
        LEVEL_2_THRESHOLD,
        LEVEL_3_THRESHOLD,
        LEVEL_4_THRESHOLD,
        profile.cycles_completed,
        LEVEL_2_MIN_CYCLES,
        LEVEL_3_MIN_CYCLES,
        LEVEL_4_MIN_CYCLES,
    );

    // Identity floor (SEV-047 Part 2). No-op when required_min_level == 0.
    let new_level =
        ReputationProfile::cap_level_for_identity(resolved, identity_verified, required_min_level);

    // Monotonic up: the ladder is advance-only in this instruction.
    require!(new_level >= profile.level, ReputationError::LevelThresholdNotMet);
    require!(new_level <= LEVEL_MAX, ReputationError::LevelThresholdNotMet);

    if new_level == profile.level {
        // No-op but still succeeds — callers can poll.
        msg!("roundfi-reputation: promote_level no-op level={}", profile.level);
        return Ok(());
    }

    let prev = profile.level;
    profile.level = new_level;
    profile.last_updated_at = now;

    msg!(
        "roundfi-reputation: promote_level subject={} {} -> {} (score={} resolved={} id_floor={} verified={})",
        profile.wallet,
        prev,
        new_level,
        profile.score,
        resolved,
        required_min_level,
        identity_verified,
    );
    Ok(())
}
