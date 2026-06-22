//! `unlink_identity` — owner-only removal of the IdentityRecord.
//!
//! Closes the account and returns rent to the wallet owner. Anchor's
//! `close = wallet` handles the rent transfer.
//!
//! **SEV-E fix:** removing identity drops the wallet to Unverified, so the
//! stored `ReputationProfile.level` is re-capped to the identity floor here.
//! Without it, a wallet could verify → promote to L4 (Elite) → unlink (and
//! reclaim the IdentityRecord rent) → keep the L4 stake discount forever, since
//! `roundfi-core::join_pool` reads `profile.level` directly and MUST NOT read
//! the IdentityRecord. The demotion is UNCONDITIONAL on this path (identity is
//! definitively gone), which is why this closes the *deterministic* exploit —
//! it doesn't depend on an indexer observing a passive expiry.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::{IdentityGateConfig, IdentityRecord, ReputationProfile};

#[derive(Accounts)]
pub struct UnlinkIdentity<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,

    #[account(
        mut,
        close = wallet,
        seeds = [SEED_IDENTITY, wallet.key().as_ref()],
        bump = identity.bump,
        constraint = identity.wallet == wallet.key() @ ReputationError::Unauthorized,
    )]
    pub identity: Account<'info, IdentityRecord>,

    /// SEV-E: identity-gate policy (singleton, REQUIRED so the floor can't be
    /// bypassed by omitting the account — mirrors `promote_level`). Supplies
    /// `required_min_level` for the demotion. With `required_min_level == 0`
    /// only the elite hard floor (L4) bites.
    #[account(
        seeds = [SEED_IDENTITY_GATE],
        bump = identity_gate.bump,
    )]
    pub identity_gate: Account<'info, IdentityGateConfig>,

    /// SEV-E: the wallet's own reputation profile. Optional — `None` when the
    /// wallet verified identity but never built a profile (no pool joined yet);
    /// there is then no stored level to demote. When present, its `level` is
    /// re-capped to the identity floor as identity is removed.
    #[account(
        mut,
        seeds = [SEED_PROFILE, wallet.key().as_ref()],
        bump,
    )]
    pub profile: Option<Account<'info, ReputationProfile>>,
}

pub fn handler(ctx: Context<UnlinkIdentity>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // SEV-E: unconditional identity-floor re-cap — identity is now gone, so the
    // subject is Unverified. Closes the verify→reach-L4→unlink→keep-L4 exploit.
    if let Some(profile) = ctx.accounts.profile.as_mut() {
        let floor = ctx.accounts.identity_gate.required_min_level;
        if profile.demote_to_identity_floor(floor, now) {
            msg!(
                "roundfi-reputation: unlink_identity identity-floor demotion wallet={} level={}",
                profile.wallet,
                profile.level,
            );
        }
    }

    msg!("roundfi-reputation: unlink_identity wallet={}", ctx.accounts.wallet.key());
    Ok(())
}
