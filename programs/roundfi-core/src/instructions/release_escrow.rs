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
    // **Adevar Labs SEV-034 fix** — regression-of-regression. The
    // SEV-029 fix (PR #342) used `total_already_paid = stake_deposited
    // - escrow_balance` as a derived counter. The accompanying comment
    // claimed: "escrow_balance starts at stake_deposited and is **only**
    // decremented by release_escrow on non-defaulted members."
    //
    // **That claim was false.** `contribute()` INCREMENTS
    // `member.escrow_balance` by the per-cycle escrow_deposit (25% of
    // installment by default) at every contribution. So in the natural
    // contribute-release-contribute-release lifecycle, escrow_balance
    // oscillates above `stake_deposited`, and the `saturating_sub`
    // returns 0 even when releases have already happened. Trace:
    //
    //   stake=750, cycles=3, installment=1000, escrow_bps=25%
    //   start:               esc=750
    //   c0 contribute(+250): esc=1000
    //   release(chk=1):      due=250, paid_derived=sat_sub(750,1000)=0,
    //                        delta=250 ✓ (correct first call)
    //   c1 contribute(+250): esc=1000 (back up after release)
    //   release(chk=2):      due=500, paid_derived=0,
    //                        delta=500 ✗ (SHOULD BE 250; OVERPAY 250)
    //   c2 contribute(+250): esc=1000
    //   release(chk=3):      due=750, paid_derived=0,
    //                        delta=750 ✗ (SHOULD BE 250; OVERPAY 500)
    //   total paid: 1500 vs stake 750 — 100% leak from shared vault.
    //
    // The auditor's pre-audit W4 caught this. The SEV-029 unit + proptest
    // suite did NOT — because the test simulator (escrow_vesting.rs::
    // simulate_release_sequence) tracked `cumulative_paid` as a separate
    // u64 and didn't model `contribute()` between releases. The tests
    // proved the *simulator* was correct, not the on-chain code.
    //
    // **Correct invariant** (derivable from existing state, no new field):
    //
    //   For non-defaulted members (the only callers of release_escrow):
    //     stake_deposited        == stake_deposited_initial  (no seizures)
    //     escrow_balance changes only via own contribute (+) and own
    //         release_escrow (-) — settle_default cannot touch a
    //         non-defaulted member's escrow_balance.
    //
    //   Therefore:
    //     ever_deposited_on_member_account = stake_deposited_initial
    //                                      + total_escrow_deposited
    //     total_released = ever_deposited_on_member_account - escrow_balance
    //
    // Both `stake_deposited_initial` and `total_escrow_deposited` already
    // exist on the Member struct (state/member.rs:27-31) and are both
    // monotonic — exactly the building blocks the SEV-029 fix needed but
    // didn't use.
    //
    // **Trace post-SEV-034 (auditor's scenario):**
    //
    //   start:                s_init=750 ted=0  esc=750  → released=0
    //   c0 contribute(+250):  s_init=750 ted=250 esc=1000 → released=0
    //   release(chk=1):       due=250 released=0 delta=250
    //                         post: esc=750, derived released = 750+250-750 = 250 ✓
    //   c1 contribute(+250):  ted=500 esc=1000 → derived released = 750+500-1000 = 250
    //   release(chk=2):       due=500 released=250 delta=250 ✓
    //                         post: esc=750, derived released = 750+500-750 = 500 ✓
    //   c2 contribute(+250):  ted=750 esc=1000 → derived released = 500
    //   release(chk=3):       due=750 released=500 delta=250 ✓
    //                         post: esc=750, derived released = 750 ✓
    //
    //   Total released = stake = 750. No overpay. Math closes.
    let ever_deposited = member
        .stake_deposited_initial
        .checked_add(member.total_escrow_deposited)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    let total_already_paid = ever_deposited.saturating_sub(member.escrow_balance);
    let total_due_at_checkpoint = cumulative_vested(
        member.stake_deposited_initial,
        args.checkpoint,
        pool_cycles,
    )?;
    let delta_target = total_due_at_checkpoint.saturating_sub(total_already_paid);
    require!(delta_target > 0, RoundfiError::EscrowNothingToRelease);

    // Defensive: vesting math cannot owe more than the remaining
    // escrow balance. Holds by construction (the math splits the
    // ever_deposited tally into "released so far" and "still in escrow";
    // delta_target is bounded by `cumulative_vested(stake) <= stake <=
    // escrow_balance + total_released`). Asserting it explicitly so a
    // future refactor that changes how escrow_balance is mutated trips
    // immediately rather than overpaying silently.
    require!(
        delta_target <= member.escrow_balance,
        RoundfiError::EscrowNothingToRelease,
    );

    // Cap at vault availability — the SEV-016 partial-release path is
    // preserved (callers don't get DoS'd by a transient vault shortfall
    // after a settle_default seizure), but the cumulative-paid counter
    // (now correctly derived) ensures the partial doesn't double-pay on
    // the next call.
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
    // SEV-029/SEV-034: ALWAYS advance the checkpoint. The partial-pay
    // path (SEV-016) is encoded in the cumulative-paid derivation
    // above (`ever_deposited - escrow_balance`) — the next call
    // computes owed_now from that counter, not from a non-advancing
    // checkpoint. Leaving the checkpoint un-advanced was the original
    // SEV-029 regression vector; the SEV-034 fix corrects the
    // derivation but keeps the always-advance behavior.
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
