use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{Member, Pool, PoolStatus, ProtocolConfig};

/// Permissionless cycle advance for a contemplation cycle whose contemplated
/// member defaulted **before** their payout slot.
///
/// **Why this exists (liveness).** `claim_payout` is the only instruction that
/// advances `pool.current_cycle`, and it requires the claimant to be the
/// current slot's member (`slot_index == cycle`) AND `!member.defaulted`. A
/// member who defaults pre-contemplation is settled (`defaulted = true`) by the
/// permissionless `settle_default` crank during the grace window — so when
/// their own contemplation cycle arrives, NO ONE can claim it and the pool
/// would lock forever (never reaching `Completed` / `close_pool`). This
/// instruction advances such a cycle WITHOUT disbursing the credit: the
/// forfeited pot stays in the pool float as surplus (mirrors the L1 Stress Lab
/// `calote_pre` model, where the defaulter's `received` is 0 and the
/// undisbursed pot remains in `poolBalance`). It restores the
/// "No indefinite locks" guarantee in `docs/architecture.md`.
///
/// Surfaced by the litesvm L1↔L2 parity slice (`tests/litesvm_parity.spec.ts`).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SkipDefaultedPayoutArgs {
    /// Must equal `pool.current_cycle` AND the defaulted member's `slot_index`.
    pub cycle: u8,
}

#[derive(Accounts)]
pub struct SkipDefaultedPayout<'info> {
    /// Permissionless crank — anyone can unstick the pool. Pays only tx fees.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = !config.paused @ RoundfiError::ProtocolPaused,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [SEED_POOL, pool.authority.as_ref(), &pool.seed_id.to_le_bytes()],
        bump = pool.bump,
        constraint = pool.status == PoolStatus::Active as u8 @ RoundfiError::PoolNotActive,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        seeds = [SEED_MEMBER, pool.key().as_ref(), defaulted_member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.wallet == defaulted_member_wallet.key() @ RoundfiError::NotAMember,
        // Only a DEFAULTED slot may be skipped — a live member must claim.
        constraint = member.defaulted @ RoundfiError::SlotNotDefaulted,
        // Never skip a slot that already paid out (can't happen for a
        // defaulter, but defensive).
        constraint = !member.paid_out @ RoundfiError::NotYourPayoutSlot,
    )]
    pub member: Box<Account<'info, Member>>,

    /// CHECK: the defaulted member's wallet — only used to derive the Member PDA.
    pub defaulted_member_wallet: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<SkipDefaultedPayout>, args: SkipDefaultedPayoutArgs) -> Result<()> {
    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.pool;
    let member = &ctx.accounts.member;

    // Same slot-monotonicity guards as claim_payout: only the CURRENT
    // contemplation slot, and only its own (defaulted) member.
    require!(args.cycle == pool.current_cycle, RoundfiError::WrongCycle);
    // Policy-aware gate (ADR pool_v2): sorteio pools translate seat →
    // cycle via the DrawResult in remaining_accounts (re-verified inside).
    let contemplated_cycle = crate::state::contemplated_cycle_for_seat(
        pool.ordering_policy,
        member.slot_index,
        &pool.key(),
        ctx.remaining_accounts,
    )?;
    require!(contemplated_cycle == args.cycle, RoundfiError::NotYourPayoutSlot);
    require!(args.cycle < pool.cycles_total, RoundfiError::PoolClosed);

    // No token transfer — the defaulter forfeited the pot; it stays in the
    // float. Advance the cycle exactly like claim_payout does.
    let next_cycle = args.cycle.checked_add(1).ok_or(error!(RoundfiError::MathOverflow))?;
    if next_cycle >= pool.cycles_total {
        pool.status = PoolStatus::Completed as u8;
        msg!(
            "roundfi-core: pool completed (final slot {} defaulted, pot forfeited) after {} cycles",
            member.slot_index,
            pool.cycles_total,
        );
    } else {
        pool.current_cycle = next_cycle;
        // SEV-053: same re-anchor as claim_payout / crank_payout — a skip
        // fires only after the settle path, i.e. well past the frozen
        // deadline, so the next window must open from `now` or the group's
        // catch-up contributions mint wrongful LATEs.
        pool.next_cycle_at = pool
            .next_cycle_at
            .max(clock.unix_timestamp)
            .checked_add(pool.cycle_duration)
            .ok_or(error!(RoundfiError::MathOverflow))?;
    }

    msg!(
        "roundfi-core: skip_defaulted_payout cycle={} slot={} (defaulter forfeited pot; cycle advanced)",
        args.cycle,
        member.slot_index,
    );

    Ok(())
}
