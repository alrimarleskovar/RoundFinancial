use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use roundfi_reputation::constants::SCHEMA_CYCLE_COMPLETE;

use crate::constants::*;
use crate::cpi::reputation::{invoke_attest, AttestAccounts, AttestCall, EMPTY_PAYLOAD};
use crate::error::RoundfiError;
use crate::math::seed_draw::retained_meets_seed_draw;
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

    // ─── Step 4e: reputation sidecar ────────────────────────────────────
    /// CHECK: program-id guard against config.reputation_program.
    pub reputation_program: UncheckedAccount<'info>,
    /// CHECK: seeds validated inside reputation::attest.
    #[account(mut)]
    pub reputation_config: UncheckedAccount<'info>,
    /// CHECK: seeds validated inside reputation::attest.
    #[account(mut)]
    pub reputation_profile: UncheckedAccount<'info>,
    /// CHECK: Option<IdentityRecord>. Pass reputation_program to signal None.
    pub identity_record: UncheckedAccount<'info>,
    /// CHECK: new attestation PDA; reputation::attest inits.
    #[account(mut)]
    pub attestation: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
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
    // of max possible month-1 collections. Delegated to
    // `math::seed_draw::retained_meets_seed_draw` — see that module for
    // boundary unit tests.
    if args.cycle == 0 {
        let retained = ctx
            .accounts
            .pool_usdc_vault
            .amount
            .checked_add(pool.escrow_balance)
            .ok_or(error!(RoundfiError::MathOverflow))?;
        require!(
            retained_meets_seed_draw(
                pool.members_target,
                pool.installment_amount,
                pool.seed_draw_bps,
                retained,
            )?,
            RoundfiError::SeedDrawShortfall,
        );
    }

    // ─── Ensure pool float can cover the payout ─────────────────────────
    // 4c: Guarantee Fund is earmarked inside pool_usdc_vault — it must
    // remain after a payout so the shock absorber is never drained.
    let spendable = ctx
        .accounts
        .pool_usdc_vault
        .amount
        .saturating_sub(pool.guarantee_fund_balance);
    require!(
        spendable >= pool.credit_amount,
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

    // ─── Step 4e: CycleComplete attestation ─────────────────────────────
    let config = &ctx.accounts.config;
    if config.reputation_program != Pubkey::default() {
        let nonce = ((args.cycle as u64) << 32) | (member.slot_index as u64);
        let pool_key = pool.key();

        let signer_seeds_inner: &[&[u8]] = &[
            SEED_POOL,
            authority_key.as_ref(),
            seed_id_le.as_ref(),
            std::slice::from_ref(&pool_bump),
        ];
        let signer_seeds_arr: &[&[&[u8]]] = &[signer_seeds_inner];

        let identity_slot = if ctx.accounts.identity_record.key()
            == ctx.accounts.reputation_program.key()
        {
            None
        } else {
            Some(ctx.accounts.identity_record.to_account_info())
        };

        invoke_attest(AttestCall {
            reputation_program:  &ctx.accounts.reputation_program.to_account_info(),
            expected_program_id: config.reputation_program,
            accounts: AttestAccounts {
                issuer:         pool.to_account_info(),
                subject:        ctx.accounts.member_wallet.to_account_info(),
                rep_config:     ctx.accounts.reputation_config.to_account_info(),
                profile:        ctx.accounts.reputation_profile.to_account_info(),
                identity:       identity_slot,
                attestation:    ctx.accounts.attestation.to_account_info(),
                payer:          ctx.accounts.member_wallet.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
            signer_seeds: signer_seeds_arr,
            schema_id:    SCHEMA_CYCLE_COMPLETE,
            nonce,
            payload:      EMPTY_PAYLOAD,
            pool:         pool_key,
            pool_authority: authority_key,
            pool_seed_id:   pool.seed_id,
        })?;
    } else {
        msg!("roundfi-core: claim_payout skipped reputation CPI (reputation_program unset)");
    }

    let _ = clock;
    Ok(())
}
