//! `cancel_pending_listing()` — seller-only abort of a `Pending`
//! escape-valve listing.
//!
//! Adevar Labs SEV-015 fix. The commit-reveal flow (#232) creates
//! listings in `Pending` status during `escape_valve_list_commit`,
//! then transitions to `Active` via `escape_valve_list_reveal`. If
//! the seller never reveals — changed their mind, lost the salt,
//! transient bug — the listing's slot was previously locked
//! indefinitely. The PDA seeds are `[b"listing", pool, slot_index]`,
//! so no new listing for that slot could be created either.
//!
//! This ix lets the seller close their abandoned Pending listing,
//! reclaim the rent, and free the slot for a fresh commit (or for
//! the legacy `escape_valve_list` if commit-reveal isn't required).
//!
//! Safety:
//!   - Seller-only (signer constraint matches stored `listing.seller`).
//!   - Pending-only (rejects Active/Filled/Cancelled). Cancelling an
//!     already-active listing would conflict with a pending buyer
//!     who's about to call `escape_valve_buy` — out of scope for
//!     this fix, and the existing `escape_valve_buy` race ordering
//!     handles it implicitly.
//!   - No timelock — seller paid the rent, can recover whenever
//!     they want. The commit_hash is private off-chain; canceling
//!     reveals nothing.
//!
//! See:
//!   - `escape_valve_list_commit.rs` for the create-Pending path
//!   - `escape_valve_list_reveal.rs` for the Pending → Active transition

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{EscapeValveListing, EscapeValveStatus, Pool, ProtocolConfig};

#[derive(Accounts)]
pub struct CancelPendingListing<'info> {
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
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// The Pending listing being cancelled. Closes back to
    /// `seller_wallet` so rent is reclaimed.
    #[account(
        mut,
        close = seller_wallet,
        seeds = [SEED_LISTING, pool.key().as_ref(), &[listing.slot_index]],
        bump = listing.bump,
        constraint = listing.pool == pool.key() @ RoundfiError::ListingNotActive,
        constraint = listing.seller == seller_wallet.key() @ RoundfiError::Unauthorized,
        constraint = listing.status == EscapeValveStatus::Pending as u8 @ RoundfiError::ListingNotPending,
    )]
    pub listing: Box<Account<'info, EscapeValveListing>>,
}

pub fn handler(ctx: Context<CancelPendingListing>) -> Result<()> {
    let listing = &ctx.accounts.listing;
    msg!(
        "roundfi-core: cancel_pending_listing pool={} slot={} seller={}",
        listing.pool, listing.slot_index, listing.seller,
    );
    // Account close happens automatically via Anchor's `close =
    // seller_wallet` constraint above. No mutation needed here.
    Ok(())
}
