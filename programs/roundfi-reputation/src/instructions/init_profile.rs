//! `init_profile` — permissionless bootstrap of a `ReputationProfile`.
//!
//! Anyone can initialize a profile for any wallet. This is safe because:
//!   - the profile is a PDA seeded by the wallet, so there can only be
//!     exactly one;
//!   - creating a profile with score 0 / level 1 is a no-op for downstream
//!     logic (join_pool already treats "missing profile" as level 1);
//!   - the payer pays the rent (so the wallet does not need to be funded).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::ReputationProfile;

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct InitProfile<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = ReputationProfile::LEN,
        seeds = [SEED_PROFILE, wallet.as_ref()],
        bump,
    )]
    pub profile: Account<'info, ReputationProfile>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitProfile>, wallet: Pubkey) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let profile = &mut ctx.accounts.profile;
    profile.wallet                 = wallet;
    profile.level                  = LEVEL_MIN;
    profile.cycles_completed       = 0;
    profile.on_time_payments       = 0;
    profile.late_payments          = 0;
    profile.defaults               = 0;
    profile.total_participated     = 0;
    profile.score                  = 0;
    profile.last_cycle_complete_at = 0;
    profile.first_seen_at          = now;
    profile.last_updated_at        = now;
    profile.bump                   = ctx.bumps.profile;
    profile._padding               = [0; 15];

    msg!("roundfi-reputation: profile initialized wallet={}", wallet);
    Ok(())
}
