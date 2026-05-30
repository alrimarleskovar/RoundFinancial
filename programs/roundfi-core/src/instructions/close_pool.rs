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
//! Actual vault-close and rent-return happens in `close_pool_vaults`
//! (the final step of the rent-reclaim ceremony) — closing an ATA
//! requires it to be empty, so that ix drains leftover residual to
//! treasury first. `close_pool` itself stays a pure terminal-state
//! transition.
//!
//! **Adevar Labs SEV-039 (Informational) — CLOSED.** The auditor's W5
//! pass flagged that close_pool does not close the Pool PDA, the Member
//! PDAs, or the four vault ATAs (escrow / solidarity / yield /
//! pool_usdc), leaving their rent locked. This is now resolved by the
//! full ceremony: `close_pool` → `close_member` × N → `close_pool_vaults`.
//! `close_member` reclaims each Member PDA's rent (and decrements the
//! live-member count); `close_pool_vaults` drains every vault residual
//! to `config.treasury`, closes the four vault ATAs, and closes the Pool
//! PDA. Ordering is enforced on chain (close_pool_vaults requires
//! `members_joined == 0`). Validated by the litesvm parity slice.

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

    // SEV-050 (liveness): the former guard required
    // `defaulted_members == 0 || escrow_balance == 0` for a defaulted pool.
    // But `settle_default` only ever INCREMENTS `defaulted_members` (never
    // zeroes it) and `escrow_balance` ends at `Σ total_escrow_deposited > 0`
    // for any pool that took contributions (release_escrow vests only the
    // STAKE, never the escrow deposits) — so BOTH clauses are unsatisfiable
    // once anyone defaults: a defaulted pool could NEVER close, stranding its
    // funds AND leaking its committed TVL forever (the decrement below never
    // ran → a griefing DoS on the global cap).
    //
    // close_pool is a pure terminal-state transition: it moves NO funds (vault
    // drain/rent reclaim is deferred — see the module header / SEV-039) and the
    // `status == Completed` account constraint already proves every cycle ran
    // (defaulters resolved via settle_default / skip_defaulted_payout). So the
    // guard protected no funds; it only blocked legitimate closes. Removed.

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
