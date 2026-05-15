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
    /// Protocol singleton. Mutable so the handler can decrement the
    /// running `committed_protocol_tvl_usdc` total when the pool's
    /// max-flow contribution leaves the active set (TVL caps —
    /// items 4.2 + 4.3 of `MAINNET_READINESS.md`).
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

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
    pub pool: Box<Account<'info, Pool>>,
}

pub fn handler(ctx: Context<ClosePool>) -> Result<()> {
    let pool_key = ctx.accounts.pool.key();

    require!(
        ctx.accounts.pool.defaulted_members == 0 || ctx.accounts.pool.escrow_balance == 0,
        RoundfiError::OutstandingDefaults,
    );

    // ─── Decrement committed TVL (symmetric with init_pool_vaults) ───
    // Use the same computation: pool's max committed flow is
    // `credit_amount × cycles_total`. The Adevar Labs SEV-005 fix
    // (PoolStatus::Closed terminal state, set below) means this
    // decrement runs exactly once per pool — before SEV-005, repeated
    // close_pool invocations on a Completed pool would deflate the
    // global TVL counter by N × pool_committed, allowing a pool
    // authority to escalate into impacting the protocol-wide cap
    // headroom (Adevar Labs SEV-005 High).
    let pool_committed = (ctx.accounts.pool.credit_amount as u128)
        .checked_mul(ctx.accounts.pool.cycles_total as u128)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    let pool_committed: u64 = pool_committed
        .try_into()
        .map_err(|_| error!(RoundfiError::MathOverflow))?;

    let total_contributed = ctx.accounts.pool.total_contributed;
    let total_paid_out = ctx.accounts.pool.total_paid_out;
    let yield_accrued = ctx.accounts.pool.yield_accrued;
    let guarantee_fund_balance = ctx.accounts.pool.guarantee_fund_balance;
    let total_protocol_fee_accrued = ctx.accounts.pool.total_protocol_fee_accrued;

    let config = &mut ctx.accounts.config;
    let committed_before = config.committed_protocol_tvl_usdc;
    config.committed_protocol_tvl_usdc = config
        .committed_protocol_tvl_usdc
        .saturating_sub(pool_committed);

    // Adevar Labs SEV-005 fix: transition pool to terminal Closed
    // state. The entry constraint requires status == Completed —
    // once Closed, a subsequent call sees status != Completed and
    // reverts with PoolNotCompleted. Single-shot guaranteed.
    ctx.accounts.pool.status = PoolStatus::Closed as u8;

    msg!(
        "roundfi-core: close_pool pool={} total_contributed={} total_paid_out={} yield_accrued={} gf_balance={} protocol_fees={} committed_tvl_released={} committed_tvl_total={}→{} status=Closed",
        pool_key,
        total_contributed,
        total_paid_out,
        yield_accrued,
        guarantee_fund_balance,
        total_protocol_fee_accrued,
        pool_committed,
        committed_before,
        config.committed_protocol_tvl_usdc,
    );

    Ok(())
}
