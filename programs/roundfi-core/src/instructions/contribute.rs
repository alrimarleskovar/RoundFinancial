use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

// Pass-3 (Caio HIGH, 2026-06-12): when this is the member's LAST
// installment of the pool, we emit `SCHEMA_POOL_COMPLETE` instead of
// `SCHEMA_PAYMENT` — that's the moment the "pay-after-receiving" thesis
// is demonstrated end-to-end, and the +50 / cycles_completed bump
// belongs here, not at claim_payout.
use roundfi_reputation::constants::{SCHEMA_LATE, SCHEMA_PAYMENT, SCHEMA_POOL_COMPLETE};
use roundfi_reputation::state::{
    BehavioralPayload, CLASS_LATE, CLASS_PAYMENT_EARLY, CLASS_PAYMENT_ON_TIME, CLASS_POOL_COMPLETE,
};

use crate::constants::*;
use crate::cpi::reputation::{invoke_attest, AttestAccounts, AttestCall};
use crate::error::RoundfiError;
use crate::math::split_installment;
use crate::state::{Member, Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContributeArgs {
    /// The installment being paid. Must equal `member.contributions_paid`
    /// (strictly the next unpaid installment — no skipping) and be EITHER
    /// `>= pool.current_cycle` (ADR 0012 — prepayment: pay ahead) OR an
    /// ARREARS cycle while the current grace window is open (ADR 0013 —
    /// catch-up: `< current_cycle` accepted only when
    /// `clock < next_cycle_at + GRACE_PERIOD_SECS`; classified LATE).
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
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [SEED_POOL, pool.authority.as_ref(), &pool.seed_id.to_le_bytes()],
        bump = pool.bump,
        constraint = pool.status == PoolStatus::Active as u8 @ RoundfiError::PoolNotActive,
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

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool,
    )]
    pub pool_usdc_vault: Box<Account<'info, TokenAccount>>,

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
    pub solidarity_vault: Box<Account<'info, TokenAccount>>,

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
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,

    // ─── Step 4e: reputation sidecar ────────────────────────────────────
    // All reputation accounts are UncheckedAccount: the reputation
    // program validates seeds + ownership inside `attest`. Core only
    // enforces the program-id guard against `config.reputation_program`.
    //
    /// CHECK: program-id guard against config.reputation_program.
    pub reputation_program: UncheckedAccount<'info>,
    /// CHECK: PDA seeds validated inside reputation::attest.
    #[account(mut)]
    pub reputation_config: UncheckedAccount<'info>,
    /// CHECK: PDA seeds validated inside reputation::attest (init_if_needed).
    #[account(mut)]
    pub reputation_profile: UncheckedAccount<'info>,
    /// CHECK: Optional IdentityRecord. Pass the reputation program itself
    /// to signal "no identity linked" (Anchor Option<Account> convention).
    pub identity_record: UncheckedAccount<'info>,
    /// CHECK: New attestation PDA; reputation::attest will init.
    #[account(mut)]
    pub attestation: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Contribute>, args: ContributeArgs) -> Result<()> {
    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.pool;
    let member = &mut ctx.accounts.member;

    // ─── Cycle alignment ─────────────────────────────────────────────────
    // ADR 0012 (prepayment): `args.cycle >= current_cycle` — a member MAY pay
    // AHEAD of the pool's current cycle. ADR 0013 (catch-up): OR pay ARREARS
    // (`args.cycle < current_cycle`) while the CURRENT cycle's grace window is
    // still open (`clock < next_cycle_at + GRACE_PERIOD_SECS`). settle_default
    // requires `clock >=` that SAME deadline, so the catch-up and settle
    // windows are temporally DISJOINT — a late payment can never race a
    // settlement for the same miss (LEAD-001, preserved by TIME instead of
    // STATE; pinned in tests/litesvm_catchup_grace.spec.ts).
    // The `== contributions_paid` check still forces strictly the next unpaid
    // installment (no skipping, oldest arrears first); `< cycles_total` caps
    // at the final installment. Funds are fungible in the vault either way.
    let grace_deadline = pool
        .next_cycle_at
        .checked_add(GRACE_PERIOD_SECS)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    let arrears_in_grace =
        args.cycle < pool.current_cycle && clock.unix_timestamp < grace_deadline;
    require!(
        args.cycle >= pool.current_cycle || arrears_in_grace,
        RoundfiError::WrongCycle,
    );
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
            ctx.accounts.token_program.key(),
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
            ctx.accounts.token_program.key(),
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
            ctx.accounts.token_program.key(),
            Transfer {
                from:      ctx.accounts.member_usdc.to_account_info(),
                to:        ctx.accounts.pool_usdc_vault.to_account_info(),
                authority: ctx.accounts.member_wallet.to_account_info(),
            },
        ),
        pool_amt,
    )?;

    // ─── On-time vs late ────────────────────────────────────────────────
    // Every installment is judged against ITS OWN deadline, derived from the
    // pool's current anchor:
    //
    //     deadline(c) = next_cycle_at − (current_cycle − c) × cycle_duration
    //
    // `next_cycle_at` is by definition the deadline of `current_cycle`, so
    // stepping back one `cycle_duration` per cycle recovers any earlier
    // installment's deadline, and stepping FORWARD (negative difference)
    // recovers a future one.
    //
    // **Why this replaced `args.cycle >= current_cycle && clock <= next_cycle_at`.**
    // That form called every arrears payment late by construction, on the
    // premise that "the installment's own deadline passed when the pool
    // advanced". The pool does not advance on the clock — it advances on
    // `claim_payout`, which has no lower time bound and fires as soon as the
    // vault can fund the credit (`spendable >= credit_amount`). The
    // contemplated member has every reason to claim the moment that clears,
    // which in the default geometry happens once ~23 of 24 members have paid.
    // Whoever pays after that — still comfortably inside their own 30-day
    // window — was stamped LATE, costing a permanent −100 (`SCORE_LATE`, a
    // fifth of an outright default) against a 500-point L2 threshold that
    // governs their required stake. A timing accident cost real collateral.
    // The same form also stamped a CURRENT member LATE for prepaying during
    // the grace window, since `clock > next_cycle_at` there.
    //
    // **Known residual — the derivation errs late, never early.** SEV-053
    // re-anchors `next_cycle_at` forward when an advance lands past a frozen
    // deadline, and this back-derivation carries that shift into the
    // reconstructed past deadlines. In a pool that stalled, a genuinely late
    // arrears payment can therefore read as on-time. That direction is the
    // deliberate one: a missed LATE under-counts a soft signal, while a
    // wrongful LATE is permanent and priced in collateral.
    //
    // (Unchanged by this rewrite: an arrears payment can never be the FINAL
    // installment. While Active, `current_cycle <= cycles_total - 1`, so
    // `args.cycle < current_cycle` lands `contributions_paid < cycles_total`
    // — the POOL_COMPLETE escalation below stays unreachable from catch-up.)
    // Shared with `place_bid_reveal` via `Pool::installment_deadline` — see
    // its docstring for the derivation and the SEV-053 residual. Two copies
    // of this expression is how the two paths would drift apart on what a
    // deadline means (audit L-2 was the second copy's contradiction).
    let installment_deadline = pool.installment_deadline(args.cycle)?;
    let on_time = clock.unix_timestamp <= installment_deadline;
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
    member.total_escrow_deposited = member
        .total_escrow_deposited
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

    // ─── Step 4e: reputation attestation (one CPI per event) ────────────
    //
    // Pass-3 (Caio HIGH, 2026-06-12): when this contribution is the
    // member's LAST installment of the pool (`contributions_paid` was
    // just incremented to `cycles_total`), the schema escalates from
    // PAYMENT/LATE to POOL_COMPLETE. That's the moment the member has
    // demonstrably kept every obligation in the pool — including any
    // post-payout installments if they were drawn early — so it's the
    // correct site for the +50 score reward and the `cycles_completed`
    // bump that the anti-farming gate consumes.
    //
    // Late-on-the-final-payment edge case: we still escalate to
    // POOL_COMPLETE. The intent is to record the obligation as kept; the
    // tardiness was already counted via the on_time_count / late_count
    // member fields (and `LATE` payloads were minted for any earlier
    // cycle the member was late on). Counting a late final payment as a
    // POOL_COMPLETE matches the proposal taxonomy: completion is binary,
    // punctuality is a separate metric.
    let config = &ctx.accounts.config;
    if config.reputation_program != Pubkey::default() {
        let is_final_installment = member.contributions_paid == pool.cycles_total;
        let schema_id = if is_final_installment {
            SCHEMA_POOL_COMPLETE
        } else if on_time {
            SCHEMA_PAYMENT
        } else {
            SCHEMA_LATE
        };
        let nonce = ((args.cycle as u64) << 32) | (member.slot_index as u64);

        // v5.2 Hybrid (Phase B + Pass-3): populate the 96-byte attestation
        // payload with the per-event timing the indexer scores off-chain.
        // The classification byte is a coarse hint (indexer is
        // authoritative); delta_seconds carries the precise timing.
        // `parcels_paid = 1` (one installment per contribute). `amount`
        // is the installment.
        let classification = if is_final_installment {
            CLASS_POOL_COMPLETE
        } else if !on_time {
            CLASS_LATE
        } else if clock.unix_timestamp < installment_deadline {
            CLASS_PAYMENT_EARLY
        } else {
            CLASS_PAYMENT_ON_TIME
        };
        // `due_ts` is THIS installment's deadline, not the pool's current one.
        // Sending `next_cycle_at` made an arrears payment look early to the
        // indexer (`paid_ts < due_ts`) while the schema said LATE — the two
        // halves of the same attestation disagreeing about the same event.
        // `delta_seconds` now signs correctly for every path.
        let payload = BehavioralPayload::new(
            classification,
            pool.members_target,
            1,
            installment_deadline,
            clock.unix_timestamp,
            pool.installment_amount,
        )
        .encode();

        // Freeze pool signer-seed components before mutable borrows drop.
        let pool_authority = pool.authority;
        let pool_seed_id   = pool.seed_id;
        let pool_bump      = pool.bump;
        let pool_key       = pool.key();
        let seed_id_le     = pool_seed_id.to_le_bytes();

        let signer_seeds: &[&[u8]] = &[
            SEED_POOL,
            pool_authority.as_ref(),
            seed_id_le.as_ref(),
            std::slice::from_ref(&pool_bump),
        ];
        let signer_seeds_arr: &[&[&[u8]]] = &[signer_seeds];

        // If identity_record is the reputation program itself, the CPI
        // treats it as `None` (Anchor Option<Account> convention).
        let identity_slot = if ctx.accounts.identity_record.key()
            == ctx.accounts.reputation_program.key()
        {
            None
        } else {
            Some(ctx.accounts.identity_record.to_account_info())
        };

        invoke_attest(AttestCall {
            reputation_program: &ctx.accounts.reputation_program.to_account_info(),
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
            schema_id,
            nonce,
            payload,
            pool: pool_key,
            pool_authority,
            pool_seed_id,
        })?;
    } else {
        msg!("roundfi-core: contribute skipped reputation CPI (reputation_program unset)");
    }

    Ok(())
}
