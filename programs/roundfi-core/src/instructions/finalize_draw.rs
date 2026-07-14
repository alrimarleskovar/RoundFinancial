//! `finalize_draw` — mint the payout-order permutation for a sorteio pool
//! (ADR pool_v2). Permissionless, exactly once per pool.
//!
//! When a pool with `ordering_policy == ORDERING_SORTEIO` fills (last
//! `join_pool` flips it Active), payouts are UNREACHABLE — the three
//! payout instructions fail `DrawRequired` — until someone runs this. The
//! app fires it right after the activating join; because it's
//! permissionless (same trust model as `crank_payout`: no funds move
//! anywhere but where the protocol already says they go), any member can
//! unstick a pool whose creator forgot.
//!
//! **Seed (v1-canary, honest limitation).** sha256(pool ‖ clock.slot ‖
//! clock.unix_timestamp ‖ members_target). The finalize caller can grind
//! the timing of this transaction (~1 slot granularity) to nudge the
//! permutation — bounded, but real. Acceptable for the devnet canary; a
//! VRF-bound seed (Switchboard/ORAO) replaces this before mainnet, which
//! is why the seed is STORED on the DrawResult: the upgrade only changes
//! where the bytes come from, and audits can always re-derive
//! `order = draw_slot_order(seed, n)`.
//!
//! **Window re-anchor.** The cycle-0 clock started at activation, but a
//! sorteio pool is only operable once drawn. If the draw lands late, the
//! contemplated member's claim window would be silently eaten — the exact
//! unfairness class SEV-053 closed. Same cure: re-anchor
//! `next_cycle_at = max(next_cycle_at, now + cycle_duration)`, so an
//! immediate finalize is a no-op and a late one opens a full window.

use anchor_lang::prelude::*;
use solana_program::hash::hashv;

use crate::constants::{ORDERING_SORTEIO, SEED_DRAW_RESULT};
use crate::error::RoundfiError;
use crate::math::draw_slot_order_checked;
use crate::state::{DrawResult, Pool, PoolStatus};

#[derive(Accounts)]
pub struct FinalizeDraw<'info> {
    /// Permissionless caller — pays the DrawResult rent.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        constraint = pool.ordering_policy == ORDERING_SORTEIO @ RoundfiError::DrawNotReady,
        constraint = pool.status == PoolStatus::Active as u8 @ RoundfiError::DrawNotReady,
        constraint = pool.members_joined == pool.members_target @ RoundfiError::DrawNotReady,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// `init` (not init_if_needed) makes the draw single-shot: a second
    /// finalize collides on the existing PDA and reverts — nobody can
    /// re-roll an unfavorable permutation.
    #[account(
        init,
        payer = caller,
        space = DrawResult::SIZE,
        seeds = [SEED_DRAW_RESULT, pool.key().as_ref()],
        bump,
    )]
    pub draw: Box<Account<'info, DrawResult>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<FinalizeDraw>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let draw = &mut ctx.accounts.draw;
    let clock = Clock::get()?;
    let n = pool.members_target;

    // v1-canary entropy — see module docs for the grinding caveat + the
    // VRF upgrade path. Stored so the permutation stays re-derivable.
    let seed = hashv(&[
        pool.key().as_ref(),
        &clock.slot.to_le_bytes(),
        &clock.unix_timestamp.to_le_bytes(),
        &[n],
    ])
    .to_bytes();

    let mut order = [0u8; crate::constants::MAX_MEMBERS as usize];
    // Bijection over 0..n guaranteed by roundfi_math (unit + fuzz tested);
    // the wrapper maps MathError → RoundfiError at the boundary.
    draw_slot_order_checked(&seed, &mut order[..n as usize])?;

    draw.pool = pool.key();
    draw.seed = seed;
    draw.order = order;
    draw.members_target = n;
    draw.bump = ctx.bumps.draw;

    // SEV-053-pattern re-anchor: the pool becomes operable NOW, so cycle
    // 0 gets a full window from now (immediate finalize ⇒ max picks the
    // activation schedule, no drift).
    pool.next_cycle_at = pool.next_cycle_at.max(
        clock
            .unix_timestamp
            .checked_add(pool.cycle_duration)
            .ok_or(error!(RoundfiError::MathOverflow))?,
    );

    msg!(
        "roundfi-core: draw finalized pool={} n={} seed={:?} (payout order minted; cycle-0 window re-anchored)",
        pool.key(),
        n,
        &seed[..8],
    );
    Ok(())
}
