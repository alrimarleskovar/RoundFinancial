//! `commit_new_fee_bps_yield` — **permissionless** after the timelock
//! eta has elapsed.
//!
//! Step 3 of the fee_bps_yield rotation flow. Anyone can crank this once
//! `clock.unix_timestamp >= config.pending_fee_bps_yield_eta` so the
//! change eventually lands even if the proposing authority goes offline
//! during the public window — same shape as the treasury / authority
//! rotation cranks.
//!
//! Applies `pending_fee_bps_yield` → `fee_bps_yield` and clears the
//! pending slot. Validates the staged value is still within
//! `MAX_FEE_BPS_YIELD` (which can only have moved down via a contract
//! upgrade, so this is defense-in-depth, not a state-mutation guard).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct CommitNewFeeBpsYield<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        // No authority constraint — permissionless crank.
    )]
    pub config: Account<'info, ProtocolConfig>,
}

pub fn handler(ctx: Context<CommitNewFeeBpsYield>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    require!(
        cfg.pending_fee_bps_yield_eta != 0,
        RoundfiError::NoPendingFeeBpsYieldChange,
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= cfg.pending_fee_bps_yield_eta,
        RoundfiError::FeeBpsYieldTimelockActive,
    );

    let new_value = cfg.pending_fee_bps_yield;
    // Defense-in-depth: re-validate the cap in case the constant was
    // tightened between propose and commit (the constant is `const`,
    // so this only matters across program upgrades — but it's cheap).
    require!(new_value <= MAX_FEE_BPS_YIELD, RoundfiError::InvalidBps);

    let prev = cfg.fee_bps_yield;
    cfg.fee_bps_yield             = new_value;
    cfg.pending_fee_bps_yield     = 0;
    cfg.pending_fee_bps_yield_eta = 0;

    msg!(
        "roundfi-core: commit_new_fee_bps_yield {} -> {}",
        prev, new_value,
    );

    Ok(())
}
