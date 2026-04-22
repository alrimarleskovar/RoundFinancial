//! `deposit_idle_to_yield(amount)` — moves idle USDC from `pool_usdc_vault`
//! into the configured yield adapter's `yield_vault`.
//!
//! Adapter-is-untrusted pattern (see `cpi::yield_adapter`):
//!   1. Snapshot source and destination token balances before the CPI.
//!   2. Invoke the adapter with the requested amount.
//!   3. Re-read balances and compute the *actual* delta.
//!   4. Accept the adapter's behavior — even under-delivery is OK, we
//!      just book less principal and continue.
//!
//! Also enforces the GF solvency guard: we never push an amount that
//! would leave `pool_usdc_vault.amount < pool.guarantee_fund_balance`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::cpi::yield_adapter::{invoke_and_measure, AdapterCpiArgs};
use crate::error::RoundfiError;
use crate::state::{Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DepositIdleToYieldArgs {
    /// Amount of USDC (base units) to move from pool vault to yield vault.
    /// The adapter may deposit less than requested (e.g. due to caps) —
    /// we book the actual post-CPI delta.
    pub amount: u64,
}

#[derive(Accounts)]
pub struct DepositIdleToYield<'info> {
    /// Anyone can crank this; the pool PDA authorizes the transfer.
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

    /// The adapter-side vault. Authority is adapter-controlled; we never
    /// verify its layout, only read its `amount` field before/after CPI.
    /// CHECK: Untrusted token account; validated via balance delta.
    #[account(mut)]
    pub yield_vault: UncheckedAccount<'info>,

    /// CHECK: External adapter program. Must equal `pool.yield_adapter`.
    pub yield_adapter_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, DepositIdleToYield<'info>>,
    args: DepositIdleToYieldArgs,
) -> Result<()> {
    require!(args.amount > 0, RoundfiError::InvalidAmount);

    // ─── GF solvency guard ──────────────────────────────────────────────
    // Never pull an amount that would leave vault below the earmarked
    // guarantee-fund balance.
    let pool = &mut ctx.accounts.pool;
    let vault_before = ctx.accounts.pool_usdc_vault.amount;
    let gf_earmark = pool.guarantee_fund_balance;
    let spendable_idle = vault_before.saturating_sub(gf_earmark);
    require!(args.amount <= spendable_idle, RoundfiError::InsufficientStake);

    // Verify adapter program identity up front (redundant with CPI wrapper,
    // but fails fast with a clear error before we construct the call).
    require!(
        ctx.accounts.yield_adapter_program.key() == pool.yield_adapter,
        RoundfiError::YieldAdapterMismatch,
    );

    // ─── Build adapter CPI ──────────────────────────────────────────────
    let authority_key = pool.authority;
    let seed_id_le = pool.seed_id.to_le_bytes();
    let pool_bump = pool.bump;
    let pool_key = pool.key();
    let adapter_program = &ctx.accounts.yield_adapter_program;
    let pool_vault_info = ctx.accounts.pool_usdc_vault.to_account_info();
    let yield_vault_info = ctx.accounts.yield_vault.to_account_info();
    let token_program_info = ctx.accounts.token_program.to_account_info();

    // Minimal account order expected by the adapter's `deposit`:
    //   [source_token_account (writable), destination_token_account (writable),
    //    authority (signer/readonly), token_program (readonly),
    //    remaining_accounts...]
    // Any additional adapter-specific accounts must be passed via
    // `remaining_accounts` in the same order the adapter expects.
    let mut metas = vec![
        AccountMeta::new(pool_vault_info.key(), false),
        AccountMeta::new(yield_vault_info.key(), false),
        AccountMeta::new_readonly(pool_key, true),
        AccountMeta::new_readonly(token_program_info.key(), false),
    ];
    let mut infos = vec![
        pool_vault_info.clone(),
        yield_vault_info.clone(),
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

    let ix_data = args.amount.to_le_bytes().to_vec();

    // ─── Invoke + measure ───────────────────────────────────────────────
    let (src_delta, dst_delta) = invoke_and_measure(
        "deposit",
        ix_data,
        &pool_vault_info,
        &yield_vault_info,
        AdapterCpiArgs {
            adapter_program,
            expected_program_id: pool.yield_adapter,
            accounts: &metas,
            account_infos: &infos,
            signer_seeds: signer_seeds_arr,
        },
    )?;

    // Adapter-is-untrusted checks:
    //   • src_delta must be <= requested amount (adapter can't drain extra)
    //   • dst_delta must match src_delta within rounding (1 lamport tolerance)
    //     — i.e. no tokens "disappeared" between vaults.
    require!(src_delta <= args.amount, RoundfiError::YieldAdapterBalanceMismatch);
    let slack = src_delta.saturating_sub(dst_delta);
    require!(slack == 0, RoundfiError::YieldAdapterBalanceMismatch);

    // ─── Book actual deposited principal ────────────────────────────────
    pool.yield_principal_deposited = pool
        .yield_principal_deposited
        .checked_add(src_delta)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    msg!(
        "roundfi-core: deposit_idle_to_yield requested={} actual={} principal_now={}",
        args.amount, src_delta, pool.yield_principal_deposited,
    );

    Ok(())
}
