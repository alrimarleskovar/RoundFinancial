//! `unlink_identity` — owner-only removal of the IdentityRecord.
//!
//! Closes the account and returns rent to the wallet owner. Anchor's
//! `close = wallet` handles the rent transfer.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::IdentityRecord;

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
}

pub fn handler(ctx: Context<UnlinkIdentity>) -> Result<()> {
    msg!("roundfi-reputation: unlink_identity wallet={}", ctx.accounts.wallet.key());
    Ok(())
}
