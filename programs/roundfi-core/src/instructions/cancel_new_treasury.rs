//! `cancel_new_treasury()` — authority-only abort of a pending
//! treasury rotation.
//!
//! Resets `config.pending_treasury` to `Pubkey::default()` and
//! `config.pending_treasury_eta` to `0`. Live `config.treasury` is
//! never touched.
//!
//! Use cases:
//!   - Authority changed mind / caught a typo in the proposed pubkey
//!   - User community spotted a malicious proposal — authority (if
//!     multisig) revokes before the timelock fires
//!   - Required precondition before issuing a fresh `propose_new_treasury`
//!     since the propose handler refuses to overwrite a pending eta
//!
//! Rejected when no proposal is pending — explicit error so the
//! caller knows the on-chain state.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct CancelNewTreasury<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = authority.key() == config.authority @ RoundfiError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<CancelNewTreasury>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        cfg.pending_treasury != Pubkey::default(),
        RoundfiError::NoPendingTreasuryChange,
    );

    let cancelled = cfg.pending_treasury;
    cfg.pending_treasury     = Pubkey::default();
    cfg.pending_treasury_eta = 0;

    msg!(
        "roundfi-core: cancel_new_treasury cancelled={}",
        cancelled,
    );

    Ok(())
}
