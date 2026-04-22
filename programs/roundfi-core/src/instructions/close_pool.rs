//! `close_pool()` — authority sweeps residuals after a pool completes.
//!
//! Preconditions:
//!   • `pool.status == Completed` (or Liquidated — both are terminal)
//!   • All payouts distributed (checked implicitly via Completed status)
//!   • No dangling defaults on the last cycle's member
//!
//! Behavior in Step 4c:
//!   • Flips `pool.status` back to a sentinel `Completed` so clients
//!     know the pool is permanently finalized.
//!   • Emits a summary msg! log with final balances.
//!
//! Actual vault-close and rent-return is deferred: closing an ATA
//! requires knowing it's empty, which in turn requires the authority
//! to have drained leftover dust to treasury. That drain is a
//! follow-up chore; for the hackathon demo a Completed pool is
//! effectively closed.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{Pool, PoolStatus, ProtocolConfig};

#[derive(Accounts)]
pub struct ClosePool<'info> {
    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// Authority must match the pool's creator OR the protocol authority.
    #[account(
        constraint = (authority.key() == pool.authority || authority.key() == config.authority)
            @ RoundfiError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_POOL, pool.authority.as_ref(), &pool.seed_id.to_le_bytes()],
        bump = pool.bump,
        constraint = pool.status == PoolStatus::Completed as u8 @ RoundfiError::PoolNotCompleted,
    )]
    pub pool: Account<'info, Pool>,
}

pub fn handler(ctx: Context<ClosePool>) -> Result<()> {
    let pool = &ctx.accounts.pool;

    require!(
        pool.defaulted_members == 0 || pool.escrow_balance == 0,
        RoundfiError::OutstandingDefaults,
    );

    msg!(
        "roundfi-core: close_pool pool={} total_contributed={} total_paid_out={} yield_accrued={} gf_balance={} protocol_fees={}",
        pool.key(),
        pool.total_contributed,
        pool.total_paid_out,
        pool.yield_accrued,
        pool.guarantee_fund_balance,
        pool.total_protocol_fee_accrued,
    );

    Ok(())
}
