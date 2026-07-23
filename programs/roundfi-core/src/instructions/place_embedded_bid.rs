//! `place_embedded_bid` — lance embutido (ADR 0012 Phase 2).
//!
//! A sorteio-pool member who has PREPAID installments beyond the pool's
//! current cycle (ADR 0012 Phase 1) may offer that prepayment as a bid to
//! be contemplated NOW: the instruction swaps two entries of the pool's
//! `DrawResult.order` so the bidder's seat takes the CURRENT cycle and the
//! seat that held the current cycle takes the bidder's original (future)
//! drawn cycle.
//!
//! Why a swap is the whole mechanism:
//!   - `order` stays a bijection over `0..members_target`, so EVERY member
//!     is still contemplated exactly once — nobody is skipped, nobody can
//!     be paid twice. The displaced member keeps the same credit, later
//!     (bid beats luck — the consórcio deal).
//!   - `claim_payout` / `crank_payout` / `skip_defaulted_payout` already
//!     read contemplation through `contemplated_cycle_for_seat`, so they
//!     need ZERO changes — the swapped DrawResult IS the new truth, and
//!     the vault waterfall / viability math never notice.
//!   - The bid moves NO funds: the "price" was already paid through the
//!     normal `contribute` split (solidarity/escrow/float preserved).
//!     Pay-after-receiving is untouched — a bid winner contemplated early
//!     still owes every remaining installment, and their prepayment IS
//!     those installments.
//!
//! Within one cycle, bids compete: only a STRICTLY deeper bid (more
//! installments prepaid beyond `current_cycle`) than
//! `pool.current_bid_depth` is accepted; winning re-swaps against the
//! current holder (which may be the previous bidder — the chain of swaps
//! keeps the permutation intact). Cycle advance resets the tracker so the
//! next cycle's competition starts fresh; standing swaps persist in the
//! DrawResult, auditable via the event log.
//!
//! Anti-snipe note (accepted for the devnet canary, flagged in
//! `docs/security/lance-contemplation.md`): a deeper bid can land right
//! before the current holder claims. The claim-vs-bid race is benign —
//! whichever tx lands first wins the slot, and both outcomes are valid
//! permutations. Phase 3 (free bids, external USDC) adds commit-reveal in
//! the #232 mold before it ships.

use anchor_lang::prelude::*;

use crate::constants::{ORDERING_SORTEIO, SEED_CONFIG, SEED_DRAW_RESULT, SEED_MEMBER, SEED_POOL};
use crate::error::RoundfiError;
use crate::state::{DrawResult, Member, Pool, PoolStatus, ProtocolConfig};

#[derive(Accounts)]
pub struct PlaceEmbeddedBid<'info> {
    pub member_wallet: Signer<'info>,

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
        constraint = pool.ordering_policy == ORDERING_SORTEIO @ RoundfiError::EmbeddedBidUnavailable,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        seeds = [SEED_MEMBER, pool.key().as_ref(), member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.wallet == member_wallet.key() @ RoundfiError::NotAMember,
        constraint = !member.defaulted @ RoundfiError::DefaultedMember,
    )]
    pub member: Box<Account<'info, Member>>,

    #[account(
        mut,
        seeds = [SEED_DRAW_RESULT, pool.key().as_ref()],
        bump = draw.bump,
        constraint = draw.pool == pool.key() @ RoundfiError::InvalidDrawAccount,
    )]
    pub draw: Box<Account<'info, DrawResult>>,
}

pub fn handler(ctx: Context<PlaceEmbeddedBid>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let member = &ctx.accounts.member;
    let draw = &mut ctx.accounts.draw;

    // A member already contemplated has nothing to bid FOR (and letting a
    // paid-out member swap back into the current cycle would be a second
    // payout — the one corruption the bijection alone can't rule out).
    require!(!member.paid_out, RoundfiError::EmbeddedBidUnavailable);

    // The bid metric: installments prepaid BEYOND the one currently due.
    // `contributions_paid == current_cycle + 1` is just being CURRENT (the
    // normal paid-this-cycle state) — bid material starts at the FIRST
    // installment past that (ADR 0012 Phase 1 made it reachable), else any
    // merely-paid-up member could take the cycle with a zero bid.
    let ahead = member.contributions_paid.saturating_sub(pool.current_cycle);
    let depth = ahead.saturating_sub(1);
    require!(depth >= 1, RoundfiError::EmbeddedBidUnavailable);
    require!(depth > pool.current_bid_depth, RoundfiError::EmbeddedBidTooShallow);

    // The bidder's own drawn turn must still be in the FUTURE: equal to the
    // current cycle means they already hold it (no-op), and a past turn
    // implies paid_out (excluded above) — defensive both ways.
    let seat = member.slot_index;
    let my_cycle = draw.cycle_for_seat(seat)?;
    let current = pool.current_cycle;
    require!(my_cycle > current, RoundfiError::EmbeddedBidUnavailable);

    // Find the seat currently holding this cycle. `order` is a bijection
    // over 0..members_target, so exactly one exists; anything else means a
    // corrupted draw account.
    let n = draw.members_target as usize;
    let displaced = draw.order[..n]
        .iter()
        .position(|&c| c == current)
        .ok_or(error!(RoundfiError::InvalidDrawAccount))?;

    // The swap — permutation in, permutation out.
    draw.order[seat as usize] = current;
    draw.order[displaced] = my_cycle;
    pool.current_bid_depth = depth;

    msg!(
        "roundfi-core: embedded bid pool={} cycle={} winner_seat={} depth={} displaced_seat={} displaced_to_cycle={}",
        pool.key(),
        current,
        seat,
        depth,
        displaced,
        my_cycle,
    );
    Ok(())
}
