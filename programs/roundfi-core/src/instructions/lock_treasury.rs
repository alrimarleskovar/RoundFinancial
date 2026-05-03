//! `lock_treasury()` — one-way kill switch for the treasury slot.
//!
//! After the team is confident the deployed `treasury` wallet is the
//! permanent one, the authority can call this to set
//! `config.treasury_locked = true`. Once true:
//!
//!   - `propose_new_treasury` rejects with `TreasuryLocked`
//!   - Even authority cannot reverse the flag (no `unlock_treasury`)
//!   - Existing pending proposals still commit if the timelock has
//!     elapsed (lock blocks NEW proposals, not in-flight ones)
//!
//! This is the "Option C" of the audit response: time-lock as the
//! everyday safety net, lock-flag as the post-deployment hardening
//! when no further rotations are anticipated.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct LockTreasury<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = authority.key() == config.authority @ RoundfiError::Unauthorized,
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<LockTreasury>) -> Result<()> {
    let cfg = &mut ctx.accounts.config;

    // Idempotent. Calling twice is a no-op, not an error.
    if cfg.treasury_locked {
        msg!("roundfi-core: lock_treasury already locked — no-op");
        return Ok(());
    }

    cfg.treasury_locked = true;
    msg!(
        "roundfi-core: lock_treasury treasury={} permanently frozen",
        cfg.treasury,
    );

    Ok(())
}
