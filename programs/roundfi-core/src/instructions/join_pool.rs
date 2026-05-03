use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use mpl_core::{
    instructions::CreateV2CpiBuilder,
    types::{
        DataState, FreezeDelegate, Plugin, PluginAuthority, PluginAuthorityPair,
        TransferDelegate,
    },
};

use roundfi_reputation::constants::SEED_PROFILE;
use roundfi_reputation::state::ReputationProfile;

use crate::constants::*;
use crate::error::RoundfiError;
use crate::state::{Member, Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct JoinPoolArgs {
    /// Slot to occupy (0..members_target). Client picks the first free slot.
    pub slot_index:       u8,
    /// Asserted reputation level 1..=3 — the caller's expectation. The
    /// handler derives the trusted level from the on-chain
    /// `ReputationProfile` PDA owned by `config.reputation_program` and
    /// rejects with `ReputationLevelMismatch` if the assertion drifts.
    /// Closes the Step-4d audit gap (was: trusted client input).
    pub reputation_level: u8,
    /// Position NFT metadata URI. Max MAX_URI_LEN bytes; scheme must be
    /// `https://`, `ipfs://`, or `ar://` (validated below).
    pub metadata_uri:     String,
}

#[derive(Accounts)]
#[instruction(args: JoinPoolArgs)]
pub struct JoinPool<'info> {
    #[account(mut)]
    pub member_wallet: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = !config.paused @ RoundfiError::ProtocolPaused,
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        seeds = [SEED_POOL, pool.authority.as_ref(), &pool.seed_id.to_le_bytes()],
        bump = pool.bump,
        constraint = pool.status == PoolStatus::Forming as u8 @ RoundfiError::PoolNotForming,
        constraint = pool.members_joined < pool.members_target @ RoundfiError::PoolFull,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        init,
        payer = member_wallet,
        space = Member::SIZE,
        seeds = [SEED_MEMBER, pool.key().as_ref(), member_wallet.key().as_ref()],
        bump,
    )]
    pub member: Account<'info, Member>,

    #[account(
        constraint = usdc_mint.key() == pool.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = member_wallet,
    )]
    pub member_usdc: Account<'info, TokenAccount>,

    /// CHECK: Escrow vault authority PDA.
    #[account(
        seeds = [SEED_ESCROW, pool.key().as_ref()],
        bump = pool.escrow_vault_bump,
    )]
    pub escrow_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = escrow_vault_authority,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    /// CHECK: Position authority PDA — becomes the FreezeDelegate of the position NFT.
    #[account(
        seeds = [SEED_POSITION, pool.key().as_ref(), &[args.slot_index]],
        bump,
    )]
    pub position_authority: UncheckedAccount<'info>,

    /// CHECK: Fresh keypair that will become the position NFT asset; signer on this tx.
    #[account(mut, signer)]
    pub nft_asset: UncheckedAccount<'info>,

    /// CHECK: Metaplex Core program — pinned to config.metaplex_core.
    #[account(address = config.metaplex_core @ RoundfiError::Unauthorized)]
    pub metaplex_core: UncheckedAccount<'info>,

    // ─── Step 4d audit close-out: trusted reputation level ──────────────
    // The caller passes the reputation program plus the member's
    // ReputationProfile PDA. The handler validates program-id against
    // `config.reputation_program`, recomputes the canonical profile PDA
    // from `[SEED_PROFILE, member_wallet]`, validates the account owner,
    // deserializes, and uses `profile.level` as the trusted level. A
    // missing profile (fresh wallet) is the canonical level-1 case.
    //
    /// CHECK: program-id guard against config.reputation_program in handler.
    pub reputation_program: UncheckedAccount<'info>,
    /// CHECK: PDA + owner validated in handler. May be uninitialized (fresh wallet).
    pub reputation_profile: UncheckedAccount<'info>,

    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
    pub rent:                     Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<JoinPool>, args: JoinPoolArgs) -> Result<()> {
    require!(
        (1..=3).contains(&args.reputation_level),
        RoundfiError::InvalidReputationLevel,
    );
    // ─── metadata_uri validation (audit hardening) ────────────────────
    // (a) Non-empty: an empty string would mint an unviewable NFT and
    //     waste the slot.
    // (b) Length cap: MAX_URI_LEN = 200 bytes mirrors mpl-core 0.8's
    //     internal asset URI ceiling. `len()` is BYTE length — for
    //     unicode URIs the visible-char count may be smaller, which
    //     is the conservative direction.
    // (c) Scheme allow-list: must start with one of the supported
    //     schemes (https://, ipfs://, ar://). Catches typos like
    //     "ipsf://..." that mpl-core would mint successfully but no
    //     wallet/explorer can resolve.
    require!(
        !args.metadata_uri.is_empty(),
        RoundfiError::MetadataUriTooLong, // reuse — "invalid length" covers empty too
    );
    require!(
        args.metadata_uri.len() <= MAX_URI_LEN,
        RoundfiError::MetadataUriTooLong,
    );
    require!(
        args.metadata_uri.starts_with("https://")
            || args.metadata_uri.starts_with("ipfs://")
            || args.metadata_uri.starts_with("ar://"),
        RoundfiError::MetadataUriInvalidScheme,
    );

    // ─── Step 4d audit close-out — trusted reputation level ─────────────
    // The caller's `args.reputation_level` is now an *assertion* checked
    // against the ReputationProfile PDA owned by `config.reputation_program`.
    // Mismatch → reject. This closes the gap where a malicious client
    // could pick whichever stake_bps tier they wanted.
    let trusted_level = derive_trusted_reputation_level(
        &ctx.accounts.config,
        &ctx.accounts.reputation_program,
        &ctx.accounts.reputation_profile,
        ctx.accounts.member_wallet.key(),
    )?;
    require!(
        args.reputation_level == trusted_level,
        RoundfiError::ReputationLevelMismatch,
    );

    let stake_bps = stake_bps_for_level(trusted_level)
        .ok_or(error!(RoundfiError::InvalidReputationLevel))?;

    // ─── Slot reservation ───────────────────────────────────────────────
    let pool = &mut ctx.accounts.pool;
    require!(
        args.slot_index < pool.members_target,
        RoundfiError::InvalidSlot,
    );
    pool.mark_slot_taken(args.slot_index)?;

    // ─── Stake math ─────────────────────────────────────────────────────
    let stake_amount = (pool.credit_amount as u128)
        .checked_mul(stake_bps as u128)
        .ok_or(error!(RoundfiError::MathOverflow))?
        .checked_div(MAX_BPS as u128)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    let stake_amount =
        u64::try_from(stake_amount).map_err(|_| error!(RoundfiError::MathOverflow))?;
    require!(stake_amount > 0, RoundfiError::InsufficientStake);
    require!(
        ctx.accounts.member_usdc.amount >= stake_amount,
        RoundfiError::InsufficientStake,
    );

    // ─── Lock stake in escrow ───────────────────────────────────────────
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.member_usdc.to_account_info(),
                to:        ctx.accounts.escrow_vault.to_account_info(),
                authority: ctx.accounts.member_wallet.to_account_info(),
            },
        ),
        stake_amount,
    )?;

    // ─── Mint position NFT via Metaplex Core ────────────────────────────
    let position_authority_key = ctx.accounts.position_authority.key();
    CreateV2CpiBuilder::new(&ctx.accounts.metaplex_core.to_account_info())
        .asset(&ctx.accounts.nft_asset.to_account_info())
        .payer(&ctx.accounts.member_wallet.to_account_info())
        .owner(Some(&ctx.accounts.member_wallet.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .data_state(DataState::AccountState)
        .name(format!("RoundFi Position #{}", args.slot_index))
        .uri(args.metadata_uri.clone())
        .plugins(vec![
            // FreezeDelegate keeps the asset locked under the slot's
            // position_authority PDA. Members can hold the NFT in their
            // wallet but can't transfer it directly — only protocol
            // instructions can move it.
            PluginAuthorityPair {
                plugin: Plugin::FreezeDelegate(FreezeDelegate { frozen: true }),
                authority: Some(PluginAuthority::Address {
                    address: position_authority_key,
                }),
            },
            // TransferDelegate grants the same position_authority PDA the
            // right to move the asset between owners. Required for the
            // Escape Valve flow (`escape_valve_buy.rs`) where the seller
            // doesn't sign the buy tx — the protocol PDA executes the
            // transfer on the seller's behalf after USDC settles.
            PluginAuthorityPair {
                plugin: Plugin::TransferDelegate(TransferDelegate {}),
                authority: Some(PluginAuthority::Address {
                    address: position_authority_key,
                }),
            },
        ])
        .invoke()?;

    // ─── Initialize Member ──────────────────────────────────────────────
    let clock = Clock::get()?;
    let member = &mut ctx.accounts.member;
    member.pool                      = pool.key();
    member.wallet                    = ctx.accounts.member_wallet.key();
    member.nft_asset                 = ctx.accounts.nft_asset.key();
    member.slot_index                = args.slot_index;
    member.reputation_level          = trusted_level;
    member.stake_bps                 = stake_bps;
    member.stake_deposited           = stake_amount;
    member.contributions_paid        = 0;
    member.total_contributed         = 0;
    member.total_received            = 0;
    member.escrow_balance            = stake_amount;
    member.on_time_count             = 0;
    member.late_count                = 0;
    member.defaulted                 = false;
    member.paid_out                  = false;
    member.last_released_checkpoint  = 0;
    member.joined_at                 = clock.unix_timestamp;
    // 4c: snapshot initial collateral for D/C invariant + seed escrow as "deposited"
    member.stake_deposited_initial   = stake_amount;
    member.total_escrow_deposited    = stake_amount;
    member.last_transferred_at       = 0;
    member.bump                      = ctx.bumps.member;

    // ─── Pool state update ──────────────────────────────────────────────
    pool.members_joined = pool
        .members_joined
        .checked_add(1)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    pool.escrow_balance = pool
        .escrow_balance
        .checked_add(stake_amount)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    if pool.members_joined == pool.members_target {
        pool.status        = PoolStatus::Active as u8;
        pool.started_at    = clock.unix_timestamp;
        pool.current_cycle = 0;
        pool.next_cycle_at = clock
            .unix_timestamp
            .checked_add(pool.cycle_duration)
            .ok_or(error!(RoundfiError::MathOverflow))?;
        msg!("roundfi-core: pool activated — all members joined");
    }

    msg!(
        "roundfi-core: member joined slot={} level={} stake={}",
        args.slot_index,
        trusted_level,
        stake_amount,
    );
    Ok(())
}

// ─── helper: derive_trusted_reputation_level ────────────────────────────
//
// Loads the on-chain ReputationProfile for `member_wallet` and returns
// the canonical `level` field. Treated as untrusted at every step:
//   1. `reputation_program` must equal `config.reputation_program` and
//      be marked executable.
//   2. `reputation_profile` must hash to the canonical PDA derived from
//      `[SEED_PROFILE, member_wallet]` using the validated program id.
//   3. If the account is empty (fresh wallet, never paid into a pool)
//      we treat it as level 1 — matches the doc-string on
//      `ReputationProfile`. The reputation program will init it on the
//      first attestation in `contribute`.
//   4. Otherwise the account owner must equal the reputation program,
//      and the deserialized `profile.wallet` must match the joining
//      wallet. Level is clamped to 1..=3 in case a future schema bump
//      ever stores anything outside that band.
//
// Backwards compat: if `config.reputation_program == Pubkey::default()`
// (legacy pre-Step-4e devnet fixtures), falls back to level 1 without
// touching the passed-in accounts.
fn derive_trusted_reputation_level(
    config: &ProtocolConfig,
    rep_program: &UncheckedAccount,
    rep_profile: &UncheckedAccount,
    member_wallet: Pubkey,
) -> Result<u8> {
    if config.reputation_program == Pubkey::default() {
        msg!("roundfi-core: join_pool — reputation_program unset, defaulting to level 1");
        return Ok(1);
    }

    require_keys_eq!(
        rep_program.key(),
        config.reputation_program,
        RoundfiError::ReputationProgramMismatch,
    );
    require!(
        rep_program.executable,
        RoundfiError::ReputationProgramMismatch,
    );

    let rep_program_id = rep_program.key();
    let (expected_profile, _bump) = Pubkey::find_program_address(
        &[SEED_PROFILE, member_wallet.as_ref()],
        &rep_program_id,
    );
    require_keys_eq!(
        rep_profile.key(),
        expected_profile,
        RoundfiError::ReputationProgramMismatch,
    );

    if rep_profile.data_is_empty() {
        msg!("roundfi-core: join_pool — no profile yet for {}, defaulting to level 1", member_wallet);
        return Ok(1);
    }

    require_keys_eq!(
        *rep_profile.owner,
        rep_program_id,
        RoundfiError::ReputationProgramMismatch,
    );

    let data = rep_profile.try_borrow_data()?;
    let profile = ReputationProfile::try_deserialize(&mut &data[..])
        .map_err(|_| error!(RoundfiError::ReputationCpiFailed))?;

    require_keys_eq!(
        profile.wallet,
        member_wallet,
        RoundfiError::ReputationProgramMismatch,
    );

    Ok(profile.level.clamp(1, 3))
}
