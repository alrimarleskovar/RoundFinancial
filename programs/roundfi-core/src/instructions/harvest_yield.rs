//! `harvest_yield()` — realizes accrued yield from the adapter and splits
//! it through the strict waterfall:
//!   1. Guarantee Fund top-up  (FIRST)
//!   2. Protocol fee           (fee_bps_yield)
//!   3. Good-faith bonus       (routed to solidarity vault)
//!   4. Participants           (remains in pool_usdc_vault)
//!
//! Adapter-is-untrusted:
//!   - Snapshot pool_usdc_vault before CPI; the adapter's `harvest()`
//!     transfers realized yield INTO pool_usdc_vault.
//!   - Post-CPI delta on pool_usdc_vault is the authoritative yield amount,
//!     regardless of what the adapter claims.
//!   - If the adapter delivers zero (nothing accrued), we short-circuit
//!     with an Ok(()) log — not an error.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::cpi::yield_adapter::{anchor_ix_discriminator, invoke_adapter, token_amount, AdapterCpiArgs};
use crate::error::RoundfiError;
use crate::math::{guarantee_fund_room, waterfall};
use crate::state::{Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct HarvestYieldArgs {
    /// Share of the post-fee residual routed to the good-faith bonus
    /// pool. Defaults to DEFAULT_GOOD_FAITH_SHARE_BPS (5_000 = 50%).
    /// Capped at 10_000 (100%). The caller (typically the pool creator
    /// or a protocol crank) provides this; the on-chain check rejects
    /// anything > 10_000.
    pub good_faith_share_bps: u16,
}

#[derive(Accounts)]
pub struct HarvestYield<'info> {
    pub caller: Signer<'info>,

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
        constraint = pool.status == PoolStatus::Active as u8 @ RoundfiError::PoolNotActive,
        constraint = pool.yield_adapter != Pubkey::default() @ RoundfiError::YieldAdapterNotConfigured,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        constraint = usdc_mint.key() == pool.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool,
    )]
    pub pool_usdc_vault: Account<'info, TokenAccount>,

    /// CHECK: Solidarity vault authority PDA.
    #[account(
        seeds = [SEED_SOLIDARITY, pool.key().as_ref()],
        bump = pool.solidarity_vault_bump,
    )]
    pub solidarity_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = solidarity_vault_authority,
    )]
    pub solidarity_vault: Account<'info, TokenAccount>,

    /// Protocol treasury — pinned to config.treasury.
    #[account(
        mut,
        constraint = treasury_usdc.owner == config.treasury @ RoundfiError::Unauthorized,
        constraint = treasury_usdc.mint  == pool.usdc_mint   @ RoundfiError::InvalidMint,
    )]
    pub treasury_usdc: Account<'info, TokenAccount>,

    /// CHECK: Untrusted adapter-side vault.
    #[account(mut)]
    pub yield_vault: UncheckedAccount<'info>,

    /// CHECK: External adapter program. Must equal `pool.yield_adapter`.
    pub yield_adapter_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, HarvestYield<'info>>,
    args: HarvestYieldArgs,
) -> Result<()> {
    require!(
        args.good_faith_share_bps as u32 <= MAX_BPS as u32,
        RoundfiError::InvalidBps,
    );

    let pool = &mut ctx.accounts.pool;

    // ─── Snapshot for untrusted-adapter accounting ──────────────────────
    let vault_before = ctx.accounts.pool_usdc_vault.amount;
    let yield_vault_before = token_amount(&ctx.accounts.yield_vault.to_account_info())?;

    // ─── CPI: adapter.harvest() ─────────────────────────────────────────
    let authority_key = pool.authority;
    let seed_id_le = pool.seed_id.to_le_bytes();
    let pool_bump = pool.bump;
    let pool_key = pool.key();

    let pool_vault_info   = ctx.accounts.pool_usdc_vault.to_account_info();
    let yield_vault_info  = ctx.accounts.yield_vault.to_account_info();
    let token_program_info = ctx.accounts.token_program.to_account_info();

    let mut metas = vec![
        AccountMeta::new(yield_vault_info.key(), false),
        AccountMeta::new(pool_vault_info.key(), false),
        AccountMeta::new_readonly(pool_key, true),
        AccountMeta::new_readonly(token_program_info.key(), false),
    ];
    let mut infos = vec![
        yield_vault_info.clone(),
        pool_vault_info.clone(),
        pool.to_account_info(),
        token_program_info.clone(),
    ];
    for extra in ctx.remaining_accounts.iter() {
        metas.push(AccountMeta {
            pubkey: extra.key(),
            is_signer: extra.is_signer,
            is_writable: extra.is_writable,
        });
        infos.push(extra.clone());
    }

    let signer_seeds: &[&[u8]] = &[
        SEED_POOL,
        authority_key.as_ref(),
        seed_id_le.as_ref(),
        std::slice::from_ref(&pool_bump),
    ];
    let signer_seeds_arr: &[&[&[u8]]] = &[signer_seeds];

    // `harvest()` takes no args beyond the discriminator.
    invoke_adapter(
        "harvest",
        Vec::new(),
        AdapterCpiArgs {
            adapter_program: &ctx.accounts.yield_adapter_program,
            expected_program_id: pool.yield_adapter,
            accounts: &metas,
            account_infos: &infos,
            signer_seeds: signer_seeds_arr,
        },
    )?;
    // Silence unused-warning when discriminator helper isn't referenced elsewhere.
    let _ = anchor_ix_discriminator;

    // ─── Measure realized yield from pool_usdc_vault delta ──────────────
    // Reload the pool vault so the Anchor account cache reflects post-CPI state.
    ctx.accounts.pool_usdc_vault.reload()?;
    let vault_after = ctx.accounts.pool_usdc_vault.amount;
    let yield_vault_after = token_amount(&ctx.accounts.yield_vault.to_account_info())?;

    let realized = vault_after.saturating_sub(vault_before);
    // Sanity: whatever entered pool_vault must have (approximately) left
    // yield_vault. Harvest may also mint new rewards externally — we
    // don't penalize the pool if yield_vault *shrunk less* than realized
    // (e.g. adapter credits from its own rewards buffer).
    let yield_vault_drop = yield_vault_before.saturating_sub(yield_vault_after);
    require!(
        yield_vault_drop <= realized.saturating_add(1),
        RoundfiError::YieldAdapterBalanceMismatch,
    );

    if realized == 0 {
        msg!("roundfi-core: harvest_yield realized=0 — nothing to distribute");
        return Ok(());
    }

    // ─── Waterfall ──────────────────────────────────────────────────────
    let gf_room = guarantee_fund_room(
        pool.total_protocol_fee_accrued,
        pool.guarantee_fund_balance,
        ctx.accounts.config.guarantee_fund_bps,
    )?;
    let w = waterfall(
        realized,
        gf_room,
        ctx.accounts.config.fee_bps_yield,
        args.good_faith_share_bps,
    )?;

    // ─── Step 1: GF — logical earmark inside pool_usdc_vault ────────────
    pool.guarantee_fund_balance = pool
        .guarantee_fund_balance
        .checked_add(w.guarantee_fund)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    // ─── Step 2: Protocol fee — transfer to treasury ────────────────────
    if w.protocol_fee > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                token_program_info.clone(),
                Transfer {
                    from:      pool_vault_info.clone(),
                    to:        ctx.accounts.treasury_usdc.to_account_info(),
                    authority: pool.to_account_info(),
                },
                signer_seeds_arr,
            ),
            w.protocol_fee,
        )?;
        pool.total_protocol_fee_accrued = pool
            .total_protocol_fee_accrued
            .checked_add(w.protocol_fee)
            .ok_or(error!(RoundfiError::MathOverflow))?;
    }

    // ─── Step 3: Good-faith bonus — transfer to solidarity vault ────────
    if w.good_faith > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                token_program_info.clone(),
                Transfer {
                    from:      pool_vault_info.clone(),
                    to:        ctx.accounts.solidarity_vault.to_account_info(),
                    authority: pool.to_account_info(),
                },
                signer_seeds_arr,
            ),
            w.good_faith,
        )?;
        pool.solidarity_balance = pool
            .solidarity_balance
            .checked_add(w.good_faith)
            .ok_or(error!(RoundfiError::MathOverflow))?;
    }

    // ─── Step 4: Participants — remain in pool_usdc_vault ──────────────
    pool.yield_accrued = pool
        .yield_accrued
        .checked_add(realized)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    // Adapter principal tracking: a real adapter's yield_vault will drop
    // by the withdrawn principal portion. Our mock can't distinguish
    // yield vs principal drain, so we conservatively reduce tracked
    // principal by the adapter's vault drop.
    pool.yield_principal_deposited = pool
        .yield_principal_deposited
        .saturating_sub(yield_vault_drop.saturating_sub(realized));

    msg!(
        "roundfi-core: harvest realized={} gf+={} fee={} good_faith={} participants={} gf_balance={}",
        realized,
        w.guarantee_fund,
        w.protocol_fee,
        w.good_faith,
        w.participants,
        pool.guarantee_fund_balance,
    );

    Ok(())
}
