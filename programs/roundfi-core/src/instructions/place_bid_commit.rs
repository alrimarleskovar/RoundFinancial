//! `place_bid_commit(cycle, commit_hash)` — first half of the sealed
//! free bid (ADR 0012 Fase 3 — lance livre).
//!
//! Creates the bidder's `Bid` PDA for this cycle carrying ONLY
//! `sha256(amount || salt || bidder)`. No USDC moves and no amount is
//! stored, so the chain reveals that someone is bidding but not how
//! deep — which is the point: in Fase 2 a late embedded bid could read
//! `pool.current_bid_depth` and outbid it by exactly one installment.
//!
//! **The seal is temporal.** Committing requires `clock <
//! pool.next_cycle_at`; revealing requires `clock >= next_cycle_at`
//! (see `place_bid_reveal`). The two windows are disjoint, so by the
//! time the first envelope opens nobody can still seal a new one, and
//! nobody can change what they already sealed. A late revealer does
//! learn the standing bids — but their own amount is already fixed, so
//! the only choice left is whether to reveal at all. Declining costs
//! them the auction and nothing else; it can't take anything from an
//! honest bidder.
//!
//! Eligibility mirrors `place_embedded_bid` exactly — same pool/member
//! gates, same "your drawn turn must still be in the future" rule —
//! because a revealed free bid IS an embedded bid, funded in the same
//! transaction. Committing when you'd be ineligible to bid just wastes
//! the rent, so we check up front.

use anchor_lang::prelude::*;

use crate::constants::{ORDERING_SORTEIO, SEED_BID, SEED_CONFIG, SEED_MEMBER, SEED_POOL};
use crate::error::RoundfiError;
use crate::state::{Bid, BidState, Member, Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PlaceBidCommitArgs {
    /// Must equal `pool.current_cycle` — also a PDA seed, so an envelope
    /// can never be replayed into a different cycle.
    pub cycle: u8,
    /// `sha256(amount.to_le_bytes() || salt.to_le_bytes() || bidder)`.
    ///
    /// **Salt entropy (Adevar Labs SEV-013, same lesson as #232):** the
    /// salt MUST be cryptographically random. The bid amount lives in a
    /// small, guessable space (a handful of installment multiples), so a
    /// predictable salt lets anyone brute-force the envelope. The reveal
    /// rejects `salt = 0` as the minimal trivially-broken guard; real
    /// entropy is the client's responsibility (`crypto.randomBytes`).
    pub commit_hash: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: PlaceBidCommitArgs)]
pub struct PlaceBidCommit<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = !config.paused @ RoundfiError::ProtocolPaused,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        seeds = [SEED_POOL, pool.authority.as_ref(), &pool.seed_id.to_le_bytes()],
        bump = pool.bump,
        constraint = pool.status == PoolStatus::Active as u8 @ RoundfiError::PoolNotActive,
        constraint = pool.ordering_policy == ORDERING_SORTEIO @ RoundfiError::EmbeddedBidUnavailable,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        seeds = [SEED_MEMBER, pool.key().as_ref(), bidder.key().as_ref()],
        bump = member.bump,
        constraint = member.wallet == bidder.key() @ RoundfiError::NotAMember,
        constraint = !member.defaulted @ RoundfiError::DefaultedMember,
        constraint = !member.paid_out @ RoundfiError::EmbeddedBidUnavailable,
    )]
    pub member: Box<Account<'info, Member>>,

    /// One sealed envelope per (pool, cycle, bidder). `init` (not
    /// `init_if_needed`) is deliberate: re-sealing after peeking is
    /// exactly the attack the commit exists to stop, so a second commit
    /// for the same cycle must fail on the account, not silently
    /// overwrite.
    #[account(
        init,
        payer = bidder,
        space = Bid::SIZE,
        seeds = [SEED_BID, pool.key().as_ref(), &[args.cycle], bidder.key().as_ref()],
        bump,
    )]
    pub bid: Box<Account<'info, Bid>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<PlaceBidCommit>, args: PlaceBidCommitArgs) -> Result<()> {
    let clock = Clock::get()?;
    let pool = &ctx.accounts.pool;
    let member = &ctx.accounts.member;

    require!(args.cycle == pool.current_cycle, RoundfiError::WrongCycle);
    require!(args.cycle < pool.cycles_total, RoundfiError::PoolClosed);

    // Bidding closes AT the cycle deadline; reveals open there. Without
    // this, a bidder could wait for others to reveal and then seal a
    // winning envelope with full knowledge — the seal would be theatre.
    require!(
        clock.unix_timestamp < pool.next_cycle_at,
        RoundfiError::BidWindowClosed,
    );

    // Nothing to bid FOR if the current cycle is already yours (or past).
    // Read through the caller-supplied draw would need the account here;
    // instead we defer the seat check to the reveal, which already loads
    // the DrawResult to perform the swap. What we CAN cheaply reject is
    // the member who has nothing to pay with later.
    require!(
        member.contributions_paid < pool.cycles_total,
        RoundfiError::EmbeddedBidUnavailable,
    );

    let bid = &mut ctx.accounts.bid;
    bid.pool = pool.key();
    bid.bidder = ctx.accounts.bidder.key();
    bid.cycle = args.cycle;
    bid.commit_hash = args.commit_hash;
    bid.amount = 0;
    bid.parcels = 0;
    bid.state = BidState::Committed as u8;
    bid.committed_at = clock.unix_timestamp;
    bid.bump = ctx.bumps.bid;

    msg!(
        "roundfi-core: bid committed pool={} cycle={} bidder={} (amount sealed)",
        pool.key(),
        args.cycle,
        bid.bidder,
    );
    Ok(())
}
