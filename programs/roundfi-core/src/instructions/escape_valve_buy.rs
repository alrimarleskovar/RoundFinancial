//! `escape_valve_buy(price_usdc)` — buyer purchases a listed position.
//!
//! Atomic re-anchor pattern — because `Member` PDA seeds include
//! `wallet`, transferring a position requires a close-old / create-new
//! sequence in a single transaction:
//!
//!   1. Validate listing (Active, price matches, same pool/slot).
//!   2. Validate buyer has no existing Member for this pool.
//!   3. Transfer `price_usdc` buyer → seller (protocol takes no fee in
//!      Step 4c — reserved; easy to add later without breaking).
//!   4. Snapshot all the old Member's state fields.
//!   5. Close the old Member PDA; rent returns to seller.
//!   6. Initialize the new Member PDA (seeds include the buyer's
//!      wallet) with the snapshotted state.
//!   7. Close the listing; rent returns to seller.
//!
//! Pool-level aggregates (total_contributed, solidarity_balance,
//! escrow_balance) are untouched — only the wallet pointer moves.
//!
//! NOTE: Metaplex Core NFT ownership transfer lives in a follow-up
//! commit (4c-tail) once we've re-exercised the Core plugin permissions
//! with FreezeDelegate; for now the asset stays frozen under the slot's
//! `position_authority` PDA, which is pool-scoped, not wallet-scoped.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{EscapeValveListing, EscapeValveStatus, Member, Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EscapeValveBuyArgs {
    /// Must equal `listing.price_usdc` — buyer commits to the price
    /// they saw off-chain. Rejects if the seller changed price between
    /// view and buy.
    pub price_usdc: u64,
}

#[derive(Accounts)]
pub struct EscapeValveBuy<'info> {
    #[account(mut)]
    pub buyer_wallet: Signer<'info>,

    /// CHECK: seller account receives lamports from closed PDAs + the
    /// listing rent refund. Must match `listing.seller`.
    #[account(
        mut,
        constraint = seller_wallet.key() == listing.seller @ RoundfiError::Unauthorized,
    )]
    pub seller_wallet: UncheckedAccount<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = !config.paused @ RoundfiError::ProtocolPaused,
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(
        seeds = [SEED_POOL, pool.authority.as_ref(), &pool.seed_id.to_le_bytes()],
        bump = pool.bump,
        constraint = pool.status == PoolStatus::Active as u8 @ RoundfiError::PoolNotActive,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        close = seller_wallet,
        seeds = [SEED_LISTING, pool.key().as_ref(), &[listing.slot_index]],
        bump = listing.bump,
        constraint = listing.pool == pool.key() @ RoundfiError::ListingNotActive,
        constraint = listing.status == EscapeValveStatus::Active as u8 @ RoundfiError::ListingNotActive,
    )]
    pub listing: Account<'info, EscapeValveListing>,

    #[account(
        mut,
        close = seller_wallet,
        seeds = [SEED_MEMBER, pool.key().as_ref(), seller_wallet.key().as_ref()],
        bump = old_member.bump,
        constraint = old_member.wallet == seller_wallet.key() @ RoundfiError::NotAMember,
        constraint = !old_member.defaulted @ RoundfiError::DefaultedMember,
        constraint = old_member.slot_index == listing.slot_index @ RoundfiError::NotYourPayoutSlot,
    )]
    pub old_member: Account<'info, Member>,

    #[account(
        init,
        payer = buyer_wallet,
        space = Member::SIZE,
        seeds = [SEED_MEMBER, pool.key().as_ref(), buyer_wallet.key().as_ref()],
        bump,
    )]
    pub new_member: Account<'info, Member>,

    #[account(
        constraint = usdc_mint.key() == pool.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = buyer_wallet,
    )]
    pub buyer_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = seller_wallet,
    )]
    pub seller_usdc: Account<'info, TokenAccount>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<EscapeValveBuy>, args: EscapeValveBuyArgs) -> Result<()> {
    let listing = &ctx.accounts.listing;
    require!(
        args.price_usdc == listing.price_usdc,
        RoundfiError::EscapeValvePriceMismatch,
    );
    require!(
        ctx.accounts.buyer_usdc.amount >= args.price_usdc,
        RoundfiError::InsufficientStake,
    );

    // ─── Pay seller ─────────────────────────────────────────────────────
    // Straight SPL transfer buyer → seller; buyer signs for their own ATA.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.buyer_usdc.to_account_info(),
                to:        ctx.accounts.seller_usdc.to_account_info(),
                authority: ctx.accounts.buyer_wallet.to_account_info(),
            },
        ),
        args.price_usdc,
    )?;

    // ─── Snapshot old Member ────────────────────────────────────────────
    let old = &ctx.accounts.old_member;
    let snapshot = MemberSnapshot {
        pool:                       old.pool,
        nft_asset:                  old.nft_asset,
        slot_index:                 old.slot_index,
        reputation_level:           old.reputation_level,
        stake_bps:                  old.stake_bps,
        stake_deposited:            old.stake_deposited,
        contributions_paid:         old.contributions_paid,
        total_contributed:          old.total_contributed,
        total_received:             old.total_received,
        escrow_balance:             old.escrow_balance,
        on_time_count:              old.on_time_count,
        late_count:                 old.late_count,
        paid_out:                   old.paid_out,
        last_released_checkpoint:   old.last_released_checkpoint,
        stake_deposited_initial:    old.stake_deposited_initial,
        total_escrow_deposited:     old.total_escrow_deposited,
    };

    // ─── Initialize new Member at buyer PDA ─────────────────────────────
    let clock = Clock::get()?;
    let new = &mut ctx.accounts.new_member;
    new.pool                     = snapshot.pool;
    new.wallet                   = ctx.accounts.buyer_wallet.key();
    new.nft_asset                = snapshot.nft_asset;
    new.slot_index               = snapshot.slot_index;
    new.reputation_level         = snapshot.reputation_level;
    new.stake_bps                = snapshot.stake_bps;
    new.stake_deposited          = snapshot.stake_deposited;
    new.contributions_paid       = snapshot.contributions_paid;
    new.total_contributed        = snapshot.total_contributed;
    new.total_received           = snapshot.total_received;
    new.escrow_balance           = snapshot.escrow_balance;
    new.on_time_count            = snapshot.on_time_count;
    new.late_count               = snapshot.late_count;
    new.defaulted                = false;
    new.paid_out                 = snapshot.paid_out;
    new.last_released_checkpoint = snapshot.last_released_checkpoint;
    new.joined_at                = clock.unix_timestamp; // re-stamped on transfer
    new.stake_deposited_initial  = snapshot.stake_deposited_initial;
    new.total_escrow_deposited   = snapshot.total_escrow_deposited;
    new.last_transferred_at      = clock.unix_timestamp;
    new.bump                     = ctx.bumps.new_member;

    msg!(
        "roundfi-core: escape_valve_buy slot={} seller={} buyer={} price={}",
        snapshot.slot_index,
        ctx.accounts.seller_wallet.key(),
        ctx.accounts.buyer_wallet.key(),
        args.price_usdc,
    );

    Ok(())
}

/// Minimal copy-out of the fields we need to re-anchor the Member.
/// Keeping it local (not public) so future schema changes surface as
/// compile errors in exactly one place.
struct MemberSnapshot {
    pool:                     Pubkey,
    nft_asset:                Pubkey,
    slot_index:               u8,
    reputation_level:         u8,
    stake_bps:                u16,
    stake_deposited:          u64,
    contributions_paid:       u8,
    total_contributed:        u64,
    total_received:           u64,
    escrow_balance:           u64,
    on_time_count:            u16,
    late_count:               u16,
    paid_out:                 bool,
    last_released_checkpoint: u8,
    stake_deposited_initial:  u64,
    total_escrow_deposited:   u64,
}
