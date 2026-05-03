//! `harvest_yield()` — realizes accrued yield from the adapter and splits
//! it through the strict PDF-canonical waterfall (v1.1):
//!   1. Protocol fee           (fee_bps_yield on gross — primary revenue)
//!   2. Guarantee Fund top-up  (capped at 150% of credit)
//!   3. LP / Anjos de Liquidez (lp_share_bps of post-fee-and-GF residual,
//!                              earmarked on pool.lp_distribution_balance)
//!   4. Participants           ("prêmio de paciência" — remains in
//!                              pool_usdc_vault)
//!
//! Note on Cofre Solidário: the v1.0 of this file routed step 3 (then
//! "good_faith") to `solidarity_vault`, but the canonical PDFs and the
//! Stress Lab L1 simulator both place the solidarity bucket OUTSIDE the
//! yield waterfall — it's funded only by the 1% das parcelas inside
//! `contribute()`. v1.1 corrects that: the yield-waterfall LP slice is
//! tracked logically on `pool.lp_distribution_balance`, the
//! `solidarity_vault` ATA is no longer credited from harvests.
//!
//! Adapter-is-untrusted:
//!   - Snapshot pool_usdc_vault before CPI; the adapter's `harvest()`
//!     transfers realized yield INTO pool_usdc_vault.
//!   - Post-CPI delta on pool_usdc_vault is the authoritative yield amount,
//!     regardless of what the adapter claims.
//!   - `yield_vault_drop <= realized + 1` invariant catches a malicious
//!     adapter trying to OVER-withdraw (drain principal as if it were yield).
//!   - `realized >= args.min_realized_usdc` slippage guard catches a
//!     malicious adapter UNDER-withdrawing (returning dust + pocketing
//!     the rest). Caller computes `min_realized_usdc` off-chain from
//!     adapter APY × elapsed time × tolerance. Pass 0 to opt out.
//!   - If the adapter delivers zero AND min_realized_usdc is zero, we
//!     short-circuit with an Ok(()) log — not an error.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::cpi::yield_adapter::{invoke_adapter, token_amount, AdapterCpiArgs};
use crate::error::RoundfiError;
use crate::math::{guarantee_fund_room, waterfall};
use crate::state::{Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct HarvestYieldArgs {
    /// Share of the post-fee-and-GF residual routed to LPs / Anjos de
    /// Liquidez. Defaults to DEFAULT_LP_SHARE_BPS (6_500 = 65%).
    /// Capped at 10_000 (100%). The caller (typically the pool creator
    /// or a protocol crank) provides this; the on-chain check rejects
    /// anything > 10_000.
    pub lp_share_bps: u16,
    /// Slippage guard: minimum realized USDC the caller is willing to
    /// accept on this harvest. If the adapter returns less, the tx
    /// reverts with `HarvestSlippageExceeded`. Pass `0` to disable
    /// (back-compat default — caller takes whatever the adapter
    /// delivers, including zero).
    ///
    /// The crank computes this off-chain as
    ///   `expected_yield × (1 − tolerance_bps / 10_000)`
    /// where `expected_yield = principal × adapter_apy × elapsed_secs / YEAR_SECS`.
    /// Without this guard, a malicious or buggy adapter could return
    /// e.g. 1 lamport when ~$50 USDC was due, the waterfall would
    /// silently take a 20% fee on dust, and the residual yield
    /// stays inside the adapter's own vault.
    pub min_realized_usdc: u64,
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

    // NOTE: pre-v1.1 this struct also pinned `solidarity_vault_authority`
    // and `solidarity_vault` because harvest_yield used to transfer the
    // (incorrectly named) "good_faith" slice into the Cofre Solidário.
    // The PDF-canonical waterfall has the LP slice earmarked logically
    // on `pool.lp_distribution_balance` instead, so those accounts are
    // no longer needed here. The Cofre Solidário is now funded only
    // from the 1% das parcelas inside `contribute()`.

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
        args.lp_share_bps as u32 <= MAX_BPS as u32,
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

    // ─── Slippage guard (audit defence) ───────────────────────────────
    // Caller computed `min_realized_usdc` off-chain from
    // (principal × adapter_apy × elapsed_secs / YEAR_SECS) ×
    // (1 − tolerance_bps / 10_000). If the adapter returns less, this
    // tx reverts BEFORE the waterfall executes — protecting the pool
    // from a malicious adapter that under-reports realized yield to
    // pocket the difference (the existing `yield_vault_drop` check only
    // catches OVER-withdraw; this catches UNDER-withdraw).
    //
    // Setting `min_realized_usdc = 0` opts out — back-compat default.
    require!(
        realized >= args.min_realized_usdc,
        RoundfiError::HarvestSlippageExceeded,
    );

    if realized == 0 {
        // realized==0 + min==0 (the only path that reaches here, given
        // the slippage check above) → adapter had nothing to harvest.
        // Short-circuit cleanly without running the waterfall.
        msg!("roundfi-core: harvest_yield realized=0 — nothing to distribute");
        return Ok(());
    }

    // ─── Waterfall (PDF-canonical: fee → GF → LP → participants) ──────
    let gf_room = guarantee_fund_room(
        pool.total_protocol_fee_accrued,
        pool.guarantee_fund_balance,
        ctx.accounts.config.guarantee_fund_bps,
    )?;
    let w = waterfall(
        realized,
        gf_room,
        ctx.accounts.config.fee_bps_yield,
        args.lp_share_bps,
    )?;

    // ─── Step 1: Protocol fee — transfer to treasury (FIRST on gross) ──
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

    // ─── Step 2: GF — logical earmark inside pool_usdc_vault ───────────
    pool.guarantee_fund_balance = pool
        .guarantee_fund_balance
        .checked_add(w.guarantee_fund)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    // ─── Step 3: LP / Anjos de Liquidez — logical earmark ──────────────
    // Funds remain in pool_usdc_vault; tracked on pool.lp_distribution_balance.
    // The actual LP withdrawal pathway is M3 work — the vault holds the
    // tokens until then. NOTE: pre-v1.1 this slice was routed (incorrectly)
    // to the solidarity_vault ATA. The Cofre Solidário is funded only by
    // the 1% das parcelas in `contribute()`.
    pool.lp_distribution_balance = pool
        .lp_distribution_balance
        .checked_add(w.lp_share)
        .ok_or(error!(RoundfiError::MathOverflow))?;

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
        "roundfi-core: harvest realized={} fee={} gf+={} lp_share={} participants={} gf_balance={} lp_distribution_balance={}",
        realized,
        w.protocol_fee,
        w.guarantee_fund,
        w.lp_share,
        w.participants,
        pool.guarantee_fund_balance,
        pool.lp_distribution_balance,
    );

    Ok(())
}
