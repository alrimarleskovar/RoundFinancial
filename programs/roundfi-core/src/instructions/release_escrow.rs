use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::RoundfiError;
use crate::math::cumulative_vested;
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
    //
    // Adevar Labs SEV-029 fix (regression of SEV-016 partial-release):
    //
    // Prior shape recomputed `delta_target = releasable_delta(last_chk,
    // new_chk)` on every call and **left `last_released_checkpoint`
    // un-advanced when the release was partial** (vault shortfall).
    // Result: a member who got partial-paid at chk=5 could re-call with
    // `checkpoint=5` (allowed because last_chk hadn't moved) and the
    // math would return the SAME 208 again — collecting the original
    // partial 100 + a fresh 208 = 308 against an entitlement of 208.
    // Bounded fund-leak from the shared escrow_vault per partial-pay
    // window, repeatable per cycle, observable via the msg! "partial"
    // log emitted by SEV-016.
    //
    // Correct invariant: `cumulative_paid_via_releases = stake_deposited
    // - escrow_balance` (escrow_balance starts at stake_deposited and
    // is **only** decremented by release_escrow on non-defaulted
    // members; settle_default cannot touch a non-defaulted member's
    // escrow_balance because the `!member.defaulted` constraint above
    // bars defaulted callers entirely).
    //
    // Therefore: compute the total amount owed at the requested
    // checkpoint (`cumulative_vested`), subtract what has already been
    // paid out, and pay the remainder capped by vault availability.
    // `last_released_checkpoint` advances on **every** successful call
    // — the partial-pay path is now encoded in the cumulative counter,
    // not in checkpoint replay.
    //
    // Trace (stake=1000, cycles=24, vault=100 then refilled to 200):
    //   call 1 chk=5:  due=208 paid=0 owed=208 delta=min(208,100)=100
    //                  escrow_balance 1000→900, last_chk=5
    //   call 2 chk=6:  due=250 paid=100 owed=150 delta=min(150,200)=150
    //                  escrow_balance 900→750,  last_chk=6
    //   total paid:   250 == cumulative_vested(stake, 6, 24) ✓ (no overpay)
    let total_due_at_checkpoint = cumulative_vested(
        member.stake_deposited,
        args.checkpoint,
        pool_cycles,
    )?;
    let total_already_paid = member
        .stake_deposited
        .saturating_sub(member.escrow_balance);
    let delta_target = total_due_at_checkpoint.saturating_sub(total_already_paid);
    require!(delta_target > 0, RoundfiError::EscrowNothingToRelease);

    // Defensive: vesting math cannot owe more than the remaining
    // escrow balance. Holds by construction (`total_due <= stake`,
    // `total_already_paid = stake - escrow_balance` ⇒ `delta_target
    // <= escrow_balance`), but assert it explicitly so a future
    // refactor that changes how escrow_balance is mutated trips
    // immediately rather than overpaying silently.
    require!(
        delta_target <= member.escrow_balance,
        RoundfiError::EscrowNothingToRelease,
    );

    // Cap at vault availability — the SEV-016 partial-release path is
    // preserved (callers don't get DoS'd by a transient vault shortfall
    // after a settle_default seizure), but the cumulative-paid counter
    // now ensures the partial doesn't double-pay on the next call.
    let delta = delta_target.min(vault_amount);
    require!(delta > 0, RoundfiError::EscrowNothingToRelease);
    if delta < delta_target {
        msg!(
            "roundfi-core: release_escrow partial pool={} member={} owed_now={} paid={} (vault shortfall)",
            pool_key, member.wallet, delta_target, delta,
        );
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
    // SEV-029: ALWAYS advance the checkpoint. The partial-pay path
    // (SEV-016) is now encoded in the `total_already_paid =
    // stake - escrow_balance` counter above — the next call computes
    // owed_now from that counter, not from a non-advancing checkpoint.
    // Leaving the checkpoint un-advanced was the regression vector.
    member.last_released_checkpoint = args.checkpoint;
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
