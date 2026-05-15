//! `cancel_new_reputation_authority()` — authority-only abort of a
//! pending reputation-authority rotation.
//!
//! Adevar Labs SEV-021 fix. Mirrors core's `cancel_new_authority`.
//! Resets `config.pending_authority` to `Pubkey::default()` and
//! `config.pending_authority_eta` to `0`. Live `config.authority`
//! never touched.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::ReputationConfig;

#[derive(Accounts)]
pub struct CancelNewReputationAuthority<'info> {
    #[account(
        mut,
        seeds = [SEED_REP_CONFIG],
        bump = config.bump,
        constraint = authority.key() == config.authority @ ReputationError::Unauthorized,
    )]
    pub config: Account<'info, ReputationConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<CancelNewReputationAuthority>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        cfg.pending_authority != Pubkey::default(),
        ReputationError::NoPendingAuthorityChange,
    );

    let cancelled = cfg.pending_authority;
    cfg.pending_authority     = Pubkey::default();
    cfg.pending_authority_eta = 0;

    msg!(
        "roundfi-reputation: cancel_new_authority cancelled={}",
        cancelled,
    );

    Ok(())
}
