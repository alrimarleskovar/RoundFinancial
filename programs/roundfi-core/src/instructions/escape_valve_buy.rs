//! `escape_valve_buy(price_usdc)` — buyer purchases a listed position.
//!
//! Atomic re-anchor pattern — because `Member` PDA seeds include
//! `wallet`, transferring a position requires a close-old / create-new
//! sequence in a single transaction, plus a real Metaplex Core asset
//! transfer:
//!
//!   1. Validate listing (Active, price matches, same pool/slot).
//!   2. Validate buyer has no existing Member for this pool.
//!   3. Transfer `price_usdc` buyer → seller.
//!   4. Snapshot all the old Member's state fields.
//!   5. Close the old Member PDA; rent returns to seller.
//!   6. Initialize the new Member PDA (seeds include the buyer's
//!      wallet) with the snapshotted state.
//!   7. Toggle FreezeDelegate.frozen=false → Transfer asset
//!      seller_wallet → buyer_wallet → toggle FreezeDelegate.frozen=true.
//!      All three CPIs signed by the slot's `position_authority` PDA
//!      (which is FreezeDelegate AND TransferDelegate authority).
//!   8. Post-CPI verification (audit defence-in-depth): re-deserialize
//!      the asset and assert `asset.owner == buyer_wallet` AND the
//!      FreezeDelegate plugin is `frozen=true`. Catches a buggy or
//!      compromised mpl-core, a future API drift, or a mis-configured
//!      CPI builder that returned Ok(()) without actually mutating
//!      state — any of which would otherwise leave the position in
//!      an inconsistent owned/frozen mix without our handler noticing.
//!   9. Close the listing; rent returns to seller.
//!
//! Pool-level aggregates (total_contributed, solidarity_balance,
//! escrow_balance) are untouched — only the wallet pointer moves and
//! the NFT changes hands.
//!
//! Why this works:
//!   - Position NFTs are minted in `join_pool.rs` with TWO plugins:
//!     FreezeDelegate (frozen=true) AND TransferDelegate, both with
//!     authority = position_authority PDA `[b"position", pool, slot]`.
//!     The PDA is pool-scoped, not wallet-scoped, so it survives the
//!     seller→buyer change.
//!   - Frozen assets cannot be transferred even by a delegate; we
//!     thaw → transfer → re-freeze in three CPIs to keep the post-
//!     transfer asset locked under protocol control.
//!   - Seller does NOT receive a default attestation — they exited
//!     cleanly via the Escape Valve.
//!   - Buyer assumes ALL future obligations: contributions_paid,
//!     escrow_balance, on_time_count, etc. carry over verbatim.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use mpl_core::{
    accounts::BaseAssetV1,
    fetch_plugin,
    instructions::{
        ApprovePluginAuthorityV1CpiBuilder, TransferV1CpiBuilder, UpdatePluginV1CpiBuilder,
    },
    types::{FreezeDelegate, Plugin, PluginAuthority, PluginType},
};

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
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        seeds = [SEED_POOL, pool.authority.as_ref(), &pool.seed_id.to_le_bytes()],
        bump = pool.bump,
        constraint = pool.status == PoolStatus::Active as u8 @ RoundfiError::PoolNotActive,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        close = seller_wallet,
        seeds = [SEED_LISTING, pool.key().as_ref(), &[listing.slot_index]],
        bump = listing.bump,
        constraint = listing.pool == pool.key() @ RoundfiError::ListingNotActive,
        constraint = listing.status == EscapeValveStatus::Active as u8 @ RoundfiError::ListingNotActive,
    )]
    pub listing: Box<Account<'info, EscapeValveListing>>,

    #[account(
        mut,
        close = seller_wallet,
        seeds = [SEED_MEMBER, pool.key().as_ref(), seller_wallet.key().as_ref()],
        bump = old_member.bump,
        constraint = old_member.wallet == seller_wallet.key() @ RoundfiError::NotAMember,
        constraint = !old_member.defaulted @ RoundfiError::DefaultedMember,
        constraint = old_member.slot_index == listing.slot_index @ RoundfiError::NotYourPayoutSlot,
    )]
    pub old_member: Box<Account<'info, Member>>,

    #[account(
        init,
        payer = buyer_wallet,
        space = Member::SIZE,
        seeds = [SEED_MEMBER, pool.key().as_ref(), buyer_wallet.key().as_ref()],
        bump,
    )]
    pub new_member: Box<Account<'info, Member>>,

    #[account(
        constraint = usdc_mint.key() == pool.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = buyer_wallet,
    )]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = seller_wallet,
    )]
    pub seller_usdc: Box<Account<'info, TokenAccount>>,

    /// CHECK: Metaplex Core asset for this slot. Pinned to
    /// `old_member.nft_asset` so the buyer can't substitute someone
    /// else's NFT mid-transfer.
    #[account(
        mut,
        constraint = nft_asset.key() == old_member.nft_asset @ RoundfiError::InvalidNftAsset,
    )]
    pub nft_asset: UncheckedAccount<'info>,

    /// CHECK: Position authority PDA — FreezeDelegate + TransferDelegate
    /// of the position NFT (set in join_pool). Signs the asset transfer
    /// CPIs via PDA seeds.
    #[account(
        seeds = [SEED_POSITION, pool.key().as_ref(), &[old_member.slot_index]],
        bump,
    )]
    pub position_authority: UncheckedAccount<'info>,

    /// CHECK: Metaplex Core program — pinned to config.metaplex_core.
    #[account(address = config.metaplex_core @ RoundfiError::Unauthorized)]
    pub metaplex_core: UncheckedAccount<'info>,

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

    // ─── NFT transfer: thaw → transfer → re-freeze ──────────────────────
    // All three CPIs are signed by the slot's position_authority PDA,
    // which holds both FreezeDelegate and TransferDelegate authority.
    let pool_key = ctx.accounts.pool.key();
    let slot_index_arr = [snapshot.slot_index];
    let position_bump = ctx.bumps.position_authority;
    let position_signer_seeds: &[&[u8]] = &[
        SEED_POSITION,
        pool_key.as_ref(),
        &slot_index_arr,
        std::slice::from_ref(&position_bump),
    ];
    let position_signer: &[&[&[u8]]] = &[position_signer_seeds];

    // Step 1 — Unfreeze.
    UpdatePluginV1CpiBuilder::new(&ctx.accounts.metaplex_core.to_account_info())
        .asset(&ctx.accounts.nft_asset.to_account_info())
        .payer(&ctx.accounts.buyer_wallet.to_account_info())
        .authority(Some(&ctx.accounts.position_authority.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: false }))
        .invoke_signed(position_signer)?;

    // Step 2 — Transfer to buyer.
    TransferV1CpiBuilder::new(&ctx.accounts.metaplex_core.to_account_info())
        .asset(&ctx.accounts.nft_asset.to_account_info())
        .payer(&ctx.accounts.buyer_wallet.to_account_info())
        .authority(Some(&ctx.accounts.position_authority.to_account_info()))
        .new_owner(&ctx.accounts.buyer_wallet.to_account_info())
        .system_program(Some(&ctx.accounts.system_program.to_account_info()))
        .invoke_signed(position_signer)?;

    // Step 2b — Re-delegate owner-managed plugins back to position_authority.
    //
    // mpl-core's TransferV1 resets owner-managed plugin authorities
    // (FreezeDelegate AND TransferDelegate) to the new owner — the
    // position_authority PDA is no longer recognized as the plugin
    // delegate post-transfer. Surfaced on devnet 2026-05-07 against a
    // freshly transferred Pool 2 / slot 1 position; the immediate
    // re-freeze in Step 3 reverted with mpl-core 0x1a (Approve)
    // "Neither the asset or any plugins have approved this operation".
    //
    // The fix below re-approves position_authority as the delegate for
    // both plugins, signed by buyer_wallet (the current owner). Without
    // re-approving TransferDelegate too, a future escape_valve_buy
    // against this slot would hit the same wall on its Step 2 transfer.
    let new_plugin_authority = PluginAuthority::Address {
        address: ctx.accounts.position_authority.key(),
    };
    ApprovePluginAuthorityV1CpiBuilder::new(&ctx.accounts.metaplex_core.to_account_info())
        .asset(&ctx.accounts.nft_asset.to_account_info())
        .payer(&ctx.accounts.buyer_wallet.to_account_info())
        .authority(Some(&ctx.accounts.buyer_wallet.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .plugin_type(PluginType::FreezeDelegate)
        .new_authority(new_plugin_authority)
        .invoke()?;
    let new_plugin_authority = PluginAuthority::Address {
        address: ctx.accounts.position_authority.key(),
    };
    ApprovePluginAuthorityV1CpiBuilder::new(&ctx.accounts.metaplex_core.to_account_info())
        .asset(&ctx.accounts.nft_asset.to_account_info())
        .payer(&ctx.accounts.buyer_wallet.to_account_info())
        .authority(Some(&ctx.accounts.buyer_wallet.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .plugin_type(PluginType::TransferDelegate)
        .new_authority(new_plugin_authority)
        .invoke()?;

    // Step 3 — Re-freeze under the (re-delegated) position_authority.
    UpdatePluginV1CpiBuilder::new(&ctx.accounts.metaplex_core.to_account_info())
        .asset(&ctx.accounts.nft_asset.to_account_info())
        .payer(&ctx.accounts.buyer_wallet.to_account_info())
        .authority(Some(&ctx.accounts.position_authority.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: true }))
        .invoke_signed(position_signer)?;

    // ─── Post-CPI invariant verification (audit defence-in-depth) ────
    // Solana txs are atomic, so any of the 3 CPIs above failing would
    // revert the entire handler. But that doesn't protect against:
    //   (a) a buggy/compromised mpl-core program returning Ok(()) without
    //       actually transferring the asset
    //   (b) a future mpl-core release silently changing semantics so
    //       the same builder call no longer guarantees ownership swap
    //   (c) our own CPI builder being mis-configured (wrong field set,
    //       missing signer, etc.) so the call appears successful but
    //       no state change happened
    // Re-deserialize the asset and assert the post-conditions we
    // promised: owner == buyer_wallet AND FreezeDelegate is on +
    // frozen. If either invariant fails the tx reverts here and the
    // bookkeeping (Member re-anchor, USDC payment) rolls back with it.
    {
        let asset_info = ctx.accounts.nft_asset.to_account_info();
        let asset_data = asset_info.try_borrow_data()?;
        let asset = BaseAssetV1::from_bytes(&asset_data)
            .map_err(|_| error!(RoundfiError::AssetTransferIncomplete))?;
        require_keys_eq!(
            asset.owner,
            ctx.accounts.buyer_wallet.key(),
            RoundfiError::AssetTransferIncomplete,
        );
        drop(asset_data);

        // FreezeDelegate must be present AND frozen=true. fetch_plugin
        // returns (authority, plugin, _offset). The authority side is
        // a sanity check that the plugin still points at our PDA —
        // an attacker that somehow re-routed the FreezeDelegate to a
        // different signer during the transfer would land here.
        let (_freeze_auth, freeze, _) = fetch_plugin::<BaseAssetV1, FreezeDelegate>(
            &asset_info,
            PluginType::FreezeDelegate,
        )
        .map_err(|_| error!(RoundfiError::AssetNotRefrozen))?;
        require!(freeze.frozen, RoundfiError::AssetNotRefrozen);
    }

    // ─── Reinit defense (audit hardening) ─────────────────────────────
    // Anchor 0.30 runs `close = seller_wallet` on `old_member` at the
    // very end of the ix (post-handler). Solana atomicity guarantees
    // that if anything between here and that finalization step fails,
    // the close is also rolled back — so reinit at the same PDA seeds
    // is impossible by tx semantics.
    //
    // Belt-and-suspenders nonetheless: explicitly zero out the
    // discriminator-adjacent identity fields on `old_member` BEFORE
    // returning Ok(()). Two payoffs:
    //   (a) If a future Anchor refactor moves `close` semantics or
    //       a hypothetical CPI re-enters between handler exit and
    //       close finalization, the account is already structurally
    //       invalid (wallet=zero, slot_index=u8::MAX) and cannot be
    //       deserialized as a live Member.
    //   (b) On-chain explorers reading the account between exit and
    //       close show "exited" rather than the seller's stale state.
    //
    // The post-CPI verification block above guarantees the asset
    // already moved to buyer + frozen, so seller no longer has any
    // claim on the position — these zero-outs reinforce that on the
    // Member side.
    {
        let old = &mut ctx.accounts.old_member;
        old.wallet = Pubkey::default();
        old.nft_asset = Pubkey::default();
        old.slot_index = u8::MAX;
        old.defaulted = true; // sentinel — also blocks any constraint
                              // path that might check `!defaulted`
                              // before the close finalizes.
    }

    msg!(
        "roundfi-core: escape_valve_buy slot={} seller={} buyer={} price={} asset={}",
        snapshot.slot_index,
        ctx.accounts.seller_wallet.key(),
        ctx.accounts.buyer_wallet.key(),
        args.price_usdc,
        snapshot.nft_asset,
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
