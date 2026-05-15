//! `commit_new_reputation_authority()` — finalizes a pending
//! reputation-authority rotation.
//!
//! Adevar Labs SEV-021 fix. Mirrors core's `commit_new_authority`.
//! Permissionless crank — runs after the 7-day eta has elapsed.
//!
//! Atomically:
//!   1. Validate `now >= pending_authority_eta`
//!   2. `config.authority = config.pending_authority`
//!   3. Clear `pending_authority` + `pending_authority_eta`

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ReputationError;
use crate::state::ReputationConfig;

#[derive(Accounts)]
pub struct CommitNewReputationAuthority<'info> {
    #[account(
        mut,
        seeds = [SEED_REP_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, ReputationConfig>,

    /// Anyone can crank — no signer/authority constraint. The 7-day
    /// timelock + the prior `propose_new_reputation_authority` signed
    /// by the then-current authority are the gates.
    pub caller: Signer<'info>,
}

pub fn handler(ctx: Context<CommitNewReputationAuthority>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        cfg.pending_authority != Pubkey::default(),
        ReputationError::NoPendingAuthorityChange,
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= cfg.pending_authority_eta,
        ReputationError::AuthorityTimelockActive,
    );

    let old = cfg.authority;
    let new = cfg.pending_authority;

    cfg.authority             = new;
    cfg.pending_authority     = Pubkey::default();
    cfg.pending_authority_eta = 0;

    msg!(
        "roundfi-reputation: commit_new_authority old={} new={}",
        old, new,
    );

    Ok(())
}
