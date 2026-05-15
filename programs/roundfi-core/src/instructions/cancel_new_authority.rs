//! `cancel_new_authority()` — authority-only abort of a pending
//! protocol-authority rotation.
//!
//! Resets `config.pending_authority` to `Pubkey::default()` and
//! `config.pending_authority_eta` to `0`. Live `config.authority` is
//! never touched.
//!
//! Use cases:
//!   - Authority changed mind / caught a typo in the proposed pubkey
//!   - User community spotted a malicious proposal — authority (if
//!     already multisig) revokes before the timelock fires
//!   - Required precondition before issuing a fresh
//!     `propose_new_authority` since propose refuses to overwrite
//!     a pending eta
//!
//! Rejected when no proposal is pending — explicit error so the
//! caller knows the on-chain state.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct CancelNewAuthority<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = authority.key() == config.authority @ RoundfiError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<CancelNewAuthority>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        cfg.pending_authority != Pubkey::default(),
        RoundfiError::NoPendingAuthorityChange,
    );

    let cancelled = cfg.pending_authority;
    cfg.pending_authority     = Pubkey::default();
    cfg.pending_authority_eta = 0;

    msg!(
        "roundfi-core: cancel_new_authority cancelled={}",
        cancelled,
    );

    Ok(())
}
