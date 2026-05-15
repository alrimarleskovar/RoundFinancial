use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::RoundfiError;
use crate::math::releasable_delta;
use crate::state::{Member, Pool, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ReleaseEscrowArgs {
    /// Milestone index 1..=cycles_total. Must be greater than
    /// `member.last_released_checkpoint` (monotonic).
    pub checkpoint: u8,
}

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    #[account(mut)]
    pub member_wallet: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = !config.paused @ RoundfiError::ProtocolPaused,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [SEED_POOL, pool.authority.as_ref(), &pool.seed_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [SEED_MEMBER, pool.key().as_ref(), member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.wallet == member_wallet.key() @ RoundfiError::NotAMember,
        constraint = !member.defaulted @ RoundfiError::DefaultedMember,
    )]
    pub member: Box<Account<'info, Member>>,

    #[account(
        constraint = usdc_mint.key() == pool.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = member_wallet,
    )]
    pub member_usdc: Box<Account<'info, TokenAccount>>,

    /// CHECK: Escrow vault authority PDA — signs the outbound transfer.
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
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ReleaseEscrow>, args: ReleaseEscrowArgs) -> Result<()> {
    // ─── Snapshot pool values before the mutable borrow ─────────────────
    let pool_key       = ctx.accounts.pool.key();
    let pool_cycles    = ctx.accounts.pool.cycles_total;
    let pool_current   = ctx.accounts.pool.current_cycle;
    let escrow_bump    = ctx.accounts.pool.escrow_vault_bump;
    let vault_amount   = ctx.accounts.escrow_vault.amount;

    let member = &mut ctx.accounts.member;

    // ─── Checkpoint validation ──────────────────────────────────────────
    require!(args.checkpoint > 0,                                 RoundfiError::EscrowLocked);
    require!(args.checkpoint <= pool_cycles,                      RoundfiError::EscrowLocked);
    require!(args.checkpoint > member.last_released_checkpoint,   RoundfiError::EscrowNothingToRelease);
    // Checkpoint cannot exceed current_cycle + 1 — caller cannot release in advance.
    require!(args.checkpoint <= pool_current.saturating_add(1),   RoundfiError::EscrowLocked);

    // ─── On-time requirement (invariant #2 scaffolding) ─────────────────
    require!(
        member.on_time_count as u16 >= args.checkpoint as u16,
        RoundfiError::EscrowLocked,
    );

    // ─── Vesting math — linear over cycles_total ────────────────────────
    let delta_target = releasable_delta(
        member.stake_deposited,
        member.last_released_checkpoint,
        args.checkpoint,
        pool_cycles,
    )?;
    require!(delta_target > 0,                       RoundfiError::EscrowNothingToRelease);
    require!(delta_target <= member.escrow_balance,  RoundfiError::EscrowNothingToRelease);

    // Adevar Labs SEV-016 fix — partial release on vault shortfall.
    //
    // The escrow_vault ATA is shared across all pool members. If a
    // settle_default seized vault funds shortly before this call, the
    // vault may hold less than what the vesting math owes this member
    // (the invariant sum(member.balances) <= vault_amount holds in
    // steady state but can transiently violate during ordering races
    // with a default seizure).
    //
    // Before this fix, `require!(delta <= vault_amount)` would DoS
    // legitimate release calls until enough escrow refills happened.
    // Now: cap the release at `vault_amount.min(delta_target)` and
    // log when the cap fires so a future audit / operator can see
    // the rare-but-real partial-release path.
    //
    // Bookkeeping uses the actual `delta`, so member.escrow_balance
    // only decrements by what was actually moved — the unreleased
    // remainder vests on a future checkpoint when the vault refills.
    let delta = delta_target.min(vault_amount);
    require!(delta > 0, RoundfiError::EscrowNothingToRelease);
    if delta < delta_target {
        msg!(
            "roundfi-core: release_escrow partial pool={} member={} owed={} paid={} (vault shortfall)",
            pool_key, member.wallet, delta_target, delta,
        );
        // NOTE: do NOT advance last_released_checkpoint when delta <
        // delta_target — that would consume the checkpoint without
        // fully paying for it. The member can re-call release_escrow
        // with the same args once the vault refills.
    }

    // ─── Transfer from escrow → member (escrow PDA signs) ───────────────
    let signer_seeds: &[&[u8]] = &[
        SEED_ESCROW,
        pool_key.as_ref(),
        std::slice::from_ref(&escrow_bump),
    ];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.escrow_vault.to_account_info(),
                to:        ctx.accounts.member_usdc.to_account_info(),
                authority: ctx.accounts.escrow_vault_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        delta,
    )?;

    // ─── Member bookkeeping ─────────────────────────────────────────────
    member.escrow_balance = member
        .escrow_balance
        .checked_sub(delta)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    // SEV-016: only advance the checkpoint when we paid the full
    // owed amount. A partial release leaves the checkpoint where it
    // is so the member can re-call once the vault refills and finish
    // collecting the remainder.
    if delta == delta_target {
        member.last_released_checkpoint = args.checkpoint;
    }
    let member_escrow_left = member.escrow_balance;

    // ─── Pool bookkeeping — aggregated off-chain counter ────────────────
    let pool = &mut ctx.accounts.pool;
    pool.escrow_balance = pool
        .escrow_balance
        .checked_sub(delta)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    msg!(
        "roundfi-core: release_escrow checkpoint={} amount={} member_escrow_left={}",
        args.checkpoint, delta, member_escrow_left,
    );

    Ok(())
}
