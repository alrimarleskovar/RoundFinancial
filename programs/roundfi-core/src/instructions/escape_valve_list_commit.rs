//! `escape_valve_list_commit(commit_hash)` — first half of the
//! commit-reveal listing flow (#232 MEV mitigation).
//!
//! Creates an `EscapeValveListing` PDA in `Pending` status with
//! `price_usdc = 0`, storing only `commit_hash = SHA-256(price ||
//! salt)`. Searchers monitoring the chain see the listing exists
//! but cannot derive the price, so they can't prepare a snipe tx.
//!
//! The (price, salt) tuple is shared off-chain between seller and
//! the prospective buyer. The reveal phase
//! (`escape_valve_list_reveal`) publishes the price on chain and
//! arms a `REVEAL_COOLDOWN_SECS` window before the listing becomes
//! buyable — giving the legitimate buyer a head-start over any
//! searcher reacting to the now-public price.
//!
//! Same eligibility constraints as the legacy `escape_valve_list`:
//!   • !member.defaulted
//!   • member.contributions_paid >= pool.current_cycle
//!   • Pool in Active state
//!   • No existing listing for this slot
//!
//! Companion docs: `docs/security/mev-front-running.md` § 2.2.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{EscapeValveListing, EscapeValveStatus, Member, Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EscapeValveListCommitArgs {
    /// `SHA-256(price_usdc.to_le_bytes() || salt.to_le_bytes())`.
    /// 32 bytes. Hash format is fixed — the reveal handler
    /// recomputes it byte-for-byte from the (price, salt) args.
    ///
    /// **Salt entropy requirement (Adevar Labs SEV-013):** the `salt`
    /// half of the pre-image MUST be cryptographically random. SDK
    /// helpers should use `crypto.randomBytes(8)` and BigInt-decode.
    /// `salt = 0` or predictable patterns (timestamps, slot numbers,
    /// counters) let a searcher brute-force the commit_hash by
    /// enumerating prices in the expected range, breaking the
    /// commit-reveal privacy property.
    ///
    /// The reveal handler rejects `salt = 0` outright with
    /// `SaltMustBeNonZero` as a minimal trivially-broken-case guard.
    /// Beyond that, salt-quality enforcement is the SDK's
    /// responsibility — we cannot verify entropy from a single
    /// 64-bit observation on chain.
    pub commit_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct EscapeValveListCommit<'info> {
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
        seeds = [SEED_MEMBER, pool.key().as_ref(), seller_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.wallet == seller_wallet.key() @ RoundfiError::NotAMember,
        constraint = !member.defaulted @ RoundfiError::DefaultedMember,
    )]
    pub member: Box<Account<'info, Member>>,

    #[account(
        init,
        payer = seller_wallet,
        space = EscapeValveListing::SIZE,
        seeds = [SEED_LISTING, pool.key().as_ref(), &[member.slot_index]],
        bump,
    )]
    pub listing: Box<Account<'info, EscapeValveListing>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<EscapeValveListCommit>, args: EscapeValveListCommitArgs) -> Result<()> {
    let clock = Clock::get()?;
    let member = &ctx.accounts.member;
    let pool = &ctx.accounts.pool;

    require!(
        member.contributions_paid >= pool.current_cycle,
        RoundfiError::MemberNotBehind,
    );

    let listing = &mut ctx.accounts.listing;
    listing.pool          = pool.key();
    listing.seller        = ctx.accounts.seller_wallet.key();
    listing.slot_index    = member.slot_index;
    listing.price_usdc    = 0;
    listing.status        = EscapeValveStatus::Pending as u8;
    listing.listed_at     = clock.unix_timestamp;
    listing.bump          = ctx.bumps.listing;
    listing.commit_hash   = args.commit_hash;
    // Not buyable until reveal arms the cooldown. Using i64::MAX
    // would also work but `0` is simpler and `escape_valve_buy`'s
    // status check fires first (`status == Active` is the gate).
    listing.buyable_after = 0;

    msg!(
        "roundfi-core: escape_valve_list_commit slot={} seller={}",
        member.slot_index, listing.seller,
    );

    Ok(())
}
