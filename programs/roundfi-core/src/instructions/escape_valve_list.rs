//! `escape_valve_list(price_usdc)` — a non-defaulted, current member
//! puts their position up for sale.
//!
//! Eligibility (strict):
//!   • !member.defaulted
//!   • member.contributions_paid == pool.current_cycle (no listing
//!     overdue obligations)
//!   • Pool in Active state
//!   • No existing Active listing for this slot
//!
//! The listing PDA `[b"listing", pool, slot_index]` holds the price.
//! Cancellation is a separate instruction (out of scope for this step).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{EscapeValveListing, EscapeValveStatus, Member, Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EscapeValveListArgs {
    pub price_usdc: u64,
}

#[derive(Accounts)]
pub struct EscapeValveList<'info> {
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

pub fn handler(ctx: Context<EscapeValveList>, args: EscapeValveListArgs) -> Result<()> {
    require!(args.price_usdc > 0, RoundfiError::InvalidListingPrice);

    let clock = Clock::get()?;
    let member = &ctx.accounts.member;
    let pool = &ctx.accounts.pool;

    // ─── Current-on-contributions gate ──────────────────────────────────
    // Listing an overdue obligation is forbidden — the buyer would be
    // walking into an immediate default risk they didn't price in.
    require!(
        member.contributions_paid >= pool.current_cycle,
        RoundfiError::MemberNotBehind,
    );

    // ─── Populate listing ───────────────────────────────────────────────
    let listing = &mut ctx.accounts.listing;
    listing.pool       = pool.key();
    listing.seller     = ctx.accounts.seller_wallet.key();
    listing.slot_index = member.slot_index;
    listing.price_usdc = args.price_usdc;
    listing.status     = EscapeValveStatus::Active as u8;
    listing.listed_at  = clock.unix_timestamp;
    listing.bump       = ctx.bumps.listing;

    msg!(
        "roundfi-core: escape_valve_list slot={} seller={} price={}",
        member.slot_index, listing.seller, args.price_usdc,
    );

    Ok(())
}
