//! `cancel_new_fee_bps_yield` — authority-only.
//!
//! Withdraws a pending `fee_bps_yield` rotation before
//! `commit_new_fee_bps_yield` lands. Restores
//! `pending_fee_bps_yield_eta = 0` (the "no pending change" sentinel)
//! and clears the staged value.
//!
//! Same shape as `cancel_new_treasury` / `cancel_new_authority`.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct CancelNewFeeBpsYield<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = authority.key() == config.authority @ RoundfiError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<CancelNewFeeBpsYield>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        cfg.pending_fee_bps_yield_eta != 0,
        RoundfiError::NoPendingFeeBpsYieldChange,
    );

    let prev = cfg.pending_fee_bps_yield;
    cfg.pending_fee_bps_yield     = 0;
    cfg.pending_fee_bps_yield_eta = 0;

    msg!("roundfi-core: cancel_new_fee_bps_yield canceled={}", prev);
    Ok(())
}
