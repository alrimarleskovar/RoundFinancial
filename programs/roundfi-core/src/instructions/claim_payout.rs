use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::RoundfiError;
use crate::math::apply_bps;
use crate::state::{Member, Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ClaimPayoutArgs {
    /// Must equal `pool.current_cycle` AND `member.slot_index`.
    pub cycle: u8,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
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
        constraint = !member.paid_out @ RoundfiError::NotYourPayoutSlot,
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

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimPayout>, args: ClaimPayoutArgs) -> Result<()> {
    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.pool;
    let member = &mut ctx.accounts.member;

    // ─── Slot monotonicity (invariant #6) ───────────────────────────────
    require!(args.cycle == pool.current_cycle,   RoundfiError::WrongCycle);
    require!(member.slot_index == args.cycle,    RoundfiError::NotYourPayoutSlot);
    require!(args.cycle < pool.cycles_total,     RoundfiError::PoolClosed);

    // ─── Seed Draw invariant (invariant #1) ─────────────────────────────
    // At the end of Month 1 (cycle 0 payout), pool must retain >= 91.6%
    // of max possible month-1 collections:
    //   pool_usdc_vault + escrow >= seed_draw_bps * members_target * installment
    if args.cycle == 0 {
        let max_month1 = (pool.members_target as u128)
            .checked_mul(pool.installment_amount as u128)
            .and_then(|v| u64::try_from(v).ok())
            .ok_or(error!(RoundfiError::MathOverflow))?;
        let floor = apply_bps(max_month1, pool.seed_draw_bps)?;
        let retained = ctx
            .accounts
            .pool_usdc_vault
            .amount
            .checked_add(pool.escrow_balance)
            .ok_or(error!(RoundfiError::MathOverflow))?;
        require!(retained >= floor, RoundfiError::SeedDrawShortfall);
    }

    // ─── Ensure pool float can cover the payout ─────────────────────────
    require!(
        ctx.accounts.pool_usdc_vault.amount >= pool.credit_amount,
        RoundfiError::WaterfallUnderflow,
    );

    // ─── Transfer credit_amount → member (Pool PDA signs) ───────────────
    let authority_key = pool.authority;
    let seed_id_le    = pool.seed_id.to_le_bytes();
    let pool_bump     = pool.bump;
    let credit        = pool.credit_amount;
    let signer_seeds: &[&[u8]] = &[
        SEED_POOL,
        authority_key.as_ref(),
        seed_id_le.as_ref(),
        std::slice::from_ref(&pool_bump),
    ];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.pool_usdc_vault.to_account_info(),
                to:        ctx.accounts.member_usdc.to_account_info(),
                authority: pool.to_account_info(),
            },
            &[signer_seeds],
        ),
        credit,
    )?;

    // ─── Bookkeeping ────────────────────────────────────────────────────
    member.paid_out = true;
    member.total_received = member
        .total_received
        .checked_add(credit)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    pool.total_paid_out = pool
        .total_paid_out
        .checked_add(credit)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    // ─── Advance cycle ──────────────────────────────────────────────────
    let next_cycle = args.cycle.checked_add(1).ok_or(error!(RoundfiError::MathOverflow))?;
    if next_cycle >= pool.cycles_total {
        pool.status = PoolStatus::Completed as u8;
        msg!("roundfi-core: pool completed after {} cycles", pool.cycles_total);
    } else {
        pool.current_cycle = next_cycle;
        pool.next_cycle_at = pool
            .next_cycle_at
            .checked_add(pool.cycle_duration)
            .ok_or(error!(RoundfiError::MathOverflow))?;
    }

    msg!(
        "roundfi-core: payout cycle={} slot={} credit={} retained_at_payout={}",
        args.cycle, member.slot_index, credit, ctx.accounts.pool_usdc_vault.amount,
    );

    // TODO(4d): CPI roundfi-reputation to emit CycleComplete / LevelUp attestation.
    let _ = clock;
    Ok(())
}
