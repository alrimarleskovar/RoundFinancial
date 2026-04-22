use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::RoundfiError;
use crate::math::split_installment;
use crate::state::{Member, Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContributeArgs {
    /// Must equal `pool.current_cycle` AND `member.contributions_paid` —
    /// enforces ordered contributions (no skipping / no retroactive pay).
    pub cycle: u8,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
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
        constraint = pool.status == PoolStatus::Active as u8 @ RoundfiError::PoolNotActive,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [SEED_MEMBER, pool.key().as_ref(), member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.wallet == member_wallet.key() @ RoundfiError::NotAMember,
        constraint = !member.defaulted @ RoundfiError::DefaultedMember,
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

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool,
    )]
    pub pool_usdc_vault: Account<'info, TokenAccount>,

    /// CHECK: Solidarity vault authority PDA (validated via bump).
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

    /// CHECK: Escrow vault authority PDA (validated via bump).
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

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Contribute>, args: ContributeArgs) -> Result<()> {
    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.pool;
    let member = &mut ctx.accounts.member;

    // ─── Cycle alignment ─────────────────────────────────────────────────
    require!(args.cycle == pool.current_cycle,          RoundfiError::WrongCycle);
    require!(args.cycle == member.contributions_paid,   RoundfiError::AlreadyContributed);
    require!(args.cycle < pool.cycles_total,            RoundfiError::PoolClosed);

    // ─── Split installment ──────────────────────────────────────────────
    let (solidarity_amt, escrow_deposit, pool_amt) = split_installment(
        pool.installment_amount,
        pool.solidarity_bps,
        pool.escrow_release_bps,
    )?;

    // ─── Balance check ──────────────────────────────────────────────────
    require!(
        ctx.accounts.member_usdc.amount >= pool.installment_amount,
        RoundfiError::InsufficientStake,
    );

    // ─── Three transfers: solidarity, escrow, pool float ────────────────
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.member_usdc.to_account_info(),
                to:        ctx.accounts.solidarity_vault.to_account_info(),
                authority: ctx.accounts.member_wallet.to_account_info(),
            },
        ),
        solidarity_amt,
    )?;

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.member_usdc.to_account_info(),
                to:        ctx.accounts.escrow_vault.to_account_info(),
                authority: ctx.accounts.member_wallet.to_account_info(),
            },
        ),
        escrow_deposit,
    )?;

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.member_usdc.to_account_info(),
                to:        ctx.accounts.pool_usdc_vault.to_account_info(),
                authority: ctx.accounts.member_wallet.to_account_info(),
            },
        ),
        pool_amt,
    )?;

    // ─── On-time vs late ────────────────────────────────────────────────
    let on_time = clock.unix_timestamp <= pool.next_cycle_at;
    if on_time {
        member.on_time_count = member
            .on_time_count
            .checked_add(1)
            .ok_or(error!(RoundfiError::MathOverflow))?;
    } else {
        member.late_count = member
            .late_count
            .checked_add(1)
            .ok_or(error!(RoundfiError::MathOverflow))?;
    }

    // ─── Member bookkeeping ─────────────────────────────────────────────
    member.contributions_paid = member
        .contributions_paid
        .checked_add(1)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    member.total_contributed = member
        .total_contributed
        .checked_add(pool.installment_amount)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    member.escrow_balance = member
        .escrow_balance
        .checked_add(escrow_deposit)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    // ─── Pool bookkeeping ───────────────────────────────────────────────
    pool.total_contributed = pool
        .total_contributed
        .checked_add(pool.installment_amount)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    pool.solidarity_balance = pool
        .solidarity_balance
        .checked_add(solidarity_amt)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    pool.escrow_balance = pool
        .escrow_balance
        .checked_add(escrow_deposit)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    msg!(
        "roundfi-core: contribute cycle={} slot={} on_time={} solidarity={} escrow={} pool={}",
        args.cycle, member.slot_index, on_time, solidarity_amt, escrow_deposit, pool_amt,
    );

    // TODO(4d): CPI into roundfi-reputation to emit Payment/Late attestation.
    Ok(())
}
