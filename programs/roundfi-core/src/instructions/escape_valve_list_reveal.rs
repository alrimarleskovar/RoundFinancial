//! `escape_valve_list_reveal(price_usdc, salt)` — second half of the
//! commit-reveal listing flow (#232 MEV mitigation).
//!
//! Transitions a `Pending` listing to `Active`:
//!   1. Reconstructs `SHA-256(price.to_le_bytes() || salt.to_le_bytes())`
//!      and asserts it equals the `commit_hash` stored at commit time.
//!      Mismatch → `InvalidCommitHash`. Prevents the seller from
//!      changing the price between commit and reveal.
//!   2. Writes `price_usdc` to the listing.
//!   3. Sets `buyable_after = now + REVEAL_COOLDOWN_SECS`, which
//!      `escape_valve_buy` enforces. The cooldown is the anti-snipe
//!      window: searchers seeing the just-revealed price race the
//!      legitimate buyer, but the buyer has the head-start because
//!      they already know the price + salt off-chain and can land
//!      their buy tx at `buyable_after` exactly.
//!
//! Authority: only `listing.seller` may reveal. The signer constraint
//! ensures a third party can't reveal someone else's commit even if
//! they somehow know the (price, salt) tuple.
//!
//! Status invariant: only `Pending` listings can be revealed. Already-
//! `Active` listings (from the legacy single-step path) revert with
//! `ListingNotPending`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{EscapeValveListing, EscapeValveStatus, Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EscapeValveListRevealArgs {
    pub price_usdc: u64,
    pub salt:       u64,
}

#[derive(Accounts)]
pub struct EscapeValveListReveal<'info> {
    #[account(mut)]
    pub seller_wallet: Signer<'info>,

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
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [SEED_LISTING, pool.key().as_ref(), &[listing.slot_index]],
        bump = listing.bump,
        constraint = listing.pool == pool.key() @ RoundfiError::ListingNotActive,
        constraint = listing.seller == seller_wallet.key() @ RoundfiError::Unauthorized,
        constraint = listing.status == EscapeValveStatus::Pending as u8 @ RoundfiError::ListingNotPending,
    )]
    pub listing: Box<Account<'info, EscapeValveListing>>,
}

pub fn handler(ctx: Context<EscapeValveListReveal>, args: EscapeValveListRevealArgs) -> Result<()> {
    require!(args.price_usdc > 0, RoundfiError::InvalidListingPrice);

    let listing = &mut ctx.accounts.listing;

    // Reconstruct the commit and compare against stored. Hash format
    // is fixed by spec (see `escape_valve_list_commit.rs` docstring)
    // — any mismatch indicates either a corrupted commit, a wrong
    // (price, salt) pair, or a seller trying to reveal a different
    // price than what they committed to.
    let mut buf = [0u8; 16];
    buf[..8].copy_from_slice(&args.price_usdc.to_le_bytes());
    buf[8..].copy_from_slice(&args.salt.to_le_bytes());
    let computed = hash::hash(&buf);

    require!(
        computed.to_bytes() == listing.commit_hash,
        RoundfiError::InvalidCommitHash,
    );

    let clock = Clock::get()?;
    listing.price_usdc    = args.price_usdc;
    listing.status        = EscapeValveStatus::Active as u8;
    listing.buyable_after = clock.unix_timestamp.saturating_add(REVEAL_COOLDOWN_SECS);

    msg!(
        "roundfi-core: escape_valve_list_reveal slot={} seller={} price={} buyable_after={}",
        listing.slot_index, listing.seller, args.price_usdc, listing.buyable_after,
    );

    Ok(())
}
