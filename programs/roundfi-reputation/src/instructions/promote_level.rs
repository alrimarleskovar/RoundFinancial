//! `promote_level` — permissionless re-evaluation of `profile.level`
//! from the current score, using thresholds baked into constants.rs.
//!
//! - Anyone can call — no admin path, no privileged signer.
//! - Monotonic: level can only increase. If the score drops below the
//!   current tier (because a Default was attested), the new level is
//!   still the highest threshold-qualifying one; it never demotes here.
//!   (Demotion is intentional: the protocol interprets a lower score as
//!   "the member has NOT proven level N behavior in recent cycles" — the
//!   next `join_pool` snapshots whatever level resolves at that time.)

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::ReputationProfile;

#[derive(Accounts)]
pub struct PromoteLevel<'info> {
    /// CHECK: only used to seed the profile PDA.
    pub subject: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_PROFILE, subject.key().as_ref()],
        bump = profile.bump,
    )]
    pub profile: Account<'info, ReputationProfile>,

    pub caller: Signer<'info>,
}

pub fn handler(ctx: Context<PromoteLevel>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let profile = &mut ctx.accounts.profile;

    let new_level = ReputationProfile::resolve_level(
        profile.score,
        LEVEL_2_THRESHOLD,
        LEVEL_3_THRESHOLD,
    );

    // Monotonic up: the ladder is advance-only in this instruction.
    // (The next join_pool re-snapshots whatever the current level is,
    // which IS allowed to be lower if the score has dropped.)
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
        "roundfi-reputation: promote_level subject={} {} -> {} (score={})",
        profile.wallet, prev, new_level, profile.score,
    );
    Ok(())
}
