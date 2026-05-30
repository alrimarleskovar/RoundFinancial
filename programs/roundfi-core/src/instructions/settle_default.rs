//! `settle_default(member)` — crank that settles a member that has been
//! delinquent past the grace window.
//!
//! Preconditions (enforced on-chain):
//!   1. `clock.unix_timestamp >= pool.next_cycle_at + GRACE_PERIOD_SECS`
//!      (7 days, protocol constant — not per-pool).
//!   2. `member.contributions_paid < pool.current_cycle` — member is
//!      genuinely behind by at least one installment.
//!   3. `!member.defaulted` — state transitions are one-directional.
//!
//! Seizure order (deterministic — prevents crank-race nondeterminism):
//!   a) solidarity vault — up to the missed installment amount.
//!   b) member.escrow_balance — up to D_remaining shortfall.
//!   c) member.stake_deposited — remaining shortfall.
//! All seized funds flow into `pool_usdc_vault` so remaining members
//! never foot the bill.
//!
//! D/C invariant:
//!   After seizure, require
//!     D_remaining * C_initial <= C_remaining * D_initial
//!   (cross-multiplied, u128). If the target seizure would violate it,
//!   we seize LESS — better to leave collateral locked than break the
//!   invariant.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use roundfi_reputation::constants::SCHEMA_DEFAULT;

use crate::constants::*;
use crate::cpi::reputation::{invoke_attest, AttestAccounts, AttestCall, EMPTY_PAYLOAD};
use crate::error::RoundfiError;
use crate::math::{dc_invariant_holds, seize_for_default, CascadeInputs};
use crate::state::{Member, Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SettleDefaultArgs {
    /// Cycle at which the member defaulted. Must equal `pool.current_cycle`.
    /// Included so the crank caller commits to the exact scenario they
    /// computed off-chain.
    pub cycle: u8,
}

#[derive(Accounts)]
pub struct SettleDefault<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        // settle_default bypasses the pause flag intentionally — funds
        // must never be locked indefinitely (see feedback/step4c).
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
        seeds = [SEED_MEMBER, pool.key().as_ref(), member.wallet.as_ref()],
        bump = member.bump,
        constraint = !member.defaulted @ RoundfiError::DefaultedMember,
    )]
    pub member: Box<Account<'info, Member>>,

    /// CHECK: defaulted member's wallet — used as the reputation subject.
    /// Validated by constraint against `member.wallet`; does NOT sign.
    #[account(
        constraint = defaulted_member_wallet.key() == member.wallet @ RoundfiError::NotAMember,
    )]
    pub defaulted_member_wallet: UncheckedAccount<'info>,

    #[account(
        constraint = usdc_mint.key() == pool.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool,
    )]
    pub pool_usdc_vault: Box<Account<'info, TokenAccount>>,

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
    pub solidarity_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: Escrow vault authority PDA.
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
    /// CHECK: program-id guard against config.reputation_program.
    pub reputation_program: UncheckedAccount<'info>,
    /// CHECK: seeds validated inside reputation::attest.
    #[account(mut)]
    pub reputation_config: UncheckedAccount<'info>,
    /// CHECK: seeds validated inside reputation::attest (init_if_needed).
    #[account(mut)]
    pub reputation_profile: UncheckedAccount<'info>,
    /// CHECK: Option<IdentityRecord>. Pass reputation_program to signal None.
    pub identity_record: UncheckedAccount<'info>,
    /// CHECK: new attestation PDA; reputation::attest inits.
    #[account(mut)]
    pub attestation: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SettleDefault>, args: SettleDefaultArgs) -> Result<()> {
    let clock = Clock::get()?;

    // ─── Snapshot pool fields before the mutable borrow of member ───────
    let pool_key             = ctx.accounts.pool.key();
    let pool_authority       = ctx.accounts.pool.authority;
    let pool_seed_id         = ctx.accounts.pool.seed_id;
    let pool_bump            = ctx.accounts.pool.bump;
    let solidarity_bump      = ctx.accounts.pool.solidarity_vault_bump;
    let escrow_bump          = ctx.accounts.pool.escrow_vault_bump;
    let pool_current_cycle   = ctx.accounts.pool.current_cycle;
    let pool_next_cycle_at   = ctx.accounts.pool.next_cycle_at;
    let pool_installment     = ctx.accounts.pool.installment_amount;
    let pool_credit          = ctx.accounts.pool.credit_amount;
    let pool_cycles_total    = ctx.accounts.pool.cycles_total;
    let solidarity_available = ctx.accounts.solidarity_vault.amount;
    let escrow_vault_amount  = ctx.accounts.escrow_vault.amount;

    let member = &mut ctx.accounts.member;

    // ─── Preconditions ──────────────────────────────────────────────────
    require!(args.cycle == pool_current_cycle, RoundfiError::WrongCycle);
    require!(
        member.contributions_paid < pool_current_cycle,
        RoundfiError::MemberNotBehind,
    );
    let grace_deadline = pool_next_cycle_at
        .checked_add(GRACE_PERIOD_SECS)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    require!(
        clock.unix_timestamp >= grace_deadline,
        RoundfiError::GracePeriodNotElapsed,
    );

    // ─── D/C invariant (pre-seizure snapshot) ───────────────────────────
    let d_initial   = Member::debt_initial(pool_credit);
    let d_remaining = member.debt_remaining(pool_cycles_total, pool_installment);
    let c_initial   = member.collateral_initial();
    let c_before    = member.collateral_remaining();

    // The "owed installment" this cycle — what the member should have
    // paid but didn't. Cap at D_remaining so we never over-seize.
    let missed = pool_installment.min(d_remaining);

    // ─── Seizure cascade (delegated to math crate) ──────────────────────
    //
    // **SEV-026 fix (W3 audit):** previously the cascade math
    // (solidarity → escrow → stake, each capped by the D/C invariant)
    // was duplicated inline here AND lived as
    // `roundfi_math::seize_for_default` in the math crate. Two copies
    // of financial logic drifting over time was the auditor's exact
    // concern — "tests pass partially, protocol behavior diverges from
    // model."
    //
    // Now: this handler builds `CascadeInputs` from the snapshotted
    // pool/member state, delegates to `seize_for_default`, then uses
    // the `CascadeOutcome` to gate the 3 token::transfer calls + state
    // updates. The math is exercised by the math crate's existing
    // 8-test suite (including `exhaustive_post_seizure_invariant_always_holds`
    // which sweeps 5×5×3×5×3×4×3 = ~13_500 input combinations and
    // asserts the D/C invariant holds post-seizure). The on-chain
    // handler now has a single source of truth.
    let escrow_cap = member.escrow_balance.min(escrow_vault_amount);
    let stake_cap = member
        .stake_deposited
        .min(escrow_vault_amount.saturating_sub(escrow_cap));
    let outcome = seize_for_default(CascadeInputs {
        d_init: d_initial,
        d_rem: d_remaining,
        c_init: c_initial,
        c_before,
        missed,
        solidarity_available,
        escrow_cap,
        stake_cap,
    })?;
    let from_solidarity = outcome.from_solidarity;
    let from_escrow = outcome.from_escrow;
    let from_stake = outcome.from_stake;

    // ─── Execute the seizure transfers per the cascade outcome ──────────
    if from_solidarity > 0 {
        let signer_seeds_solidarity: &[&[u8]] = &[
            SEED_SOLIDARITY,
            pool_key.as_ref(),
            std::slice::from_ref(&solidarity_bump),
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.solidarity_vault.to_account_info(),
                    to:        ctx.accounts.pool_usdc_vault.to_account_info(),
                    authority: ctx.accounts.solidarity_vault_authority.to_account_info(),
                },
                &[signer_seeds_solidarity],
            ),
            from_solidarity,
        )?;
    }
    if from_escrow > 0 {
        let signer_seeds_escrow: &[&[u8]] = &[
            SEED_ESCROW,
            pool_key.as_ref(),
            std::slice::from_ref(&escrow_bump),
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.escrow_vault.to_account_info(),
                    to:        ctx.accounts.pool_usdc_vault.to_account_info(),
                    authority: ctx.accounts.escrow_vault_authority.to_account_info(),
                },
                &[signer_seeds_escrow],
            ),
            from_escrow,
        )?;
        member.escrow_balance = member.escrow_balance.saturating_sub(from_escrow);
    }
    if from_stake > 0 {
        // Stake is held in the SAME escrow vault as the deposited
        // escrow balance (Step 4a) — same authority, same signer seeds.
        let signer_seeds_escrow: &[&[u8]] = &[
            SEED_ESCROW,
            pool_key.as_ref(),
            std::slice::from_ref(&escrow_bump),
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.escrow_vault.to_account_info(),
                    to:        ctx.accounts.pool_usdc_vault.to_account_info(),
                    authority: ctx.accounts.escrow_vault_authority.to_account_info(),
                },
                &[signer_seeds_escrow],
            ),
            from_stake,
        )?;
        member.stake_deposited = member.stake_deposited.saturating_sub(from_stake);
    }

    let seized_total = outcome.total();

    // ─── Final D/C invariant check (must still hold post-seizure) ───────
    let c_after = member.collateral_remaining();
    require!(
        dc_invariant_holds(d_initial, d_remaining, c_initial, c_after),
        RoundfiError::DebtCollateralViolation,
    );

    // ─── Snapshot member fields for the reputation CPI below ───────────
    let member_slot_index = member.slot_index;
    let member_wallet     = member.wallet;

    // ─── Irreversible state transition ──────────────────────────────────
    member.defaulted = true;

    // ─── Pool bookkeeping ───────────────────────────────────────────────
    let pool = &mut ctx.accounts.pool;
    pool.defaulted_members = pool
        .defaulted_members
        .checked_add(1)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    pool.solidarity_balance = pool
        .solidarity_balance
        .saturating_sub(from_solidarity);
    pool.escrow_balance = pool
        .escrow_balance
        .saturating_sub(from_escrow.saturating_add(from_stake));

    msg!(
        "roundfi-core: settle_default cycle={} member={} seized_total={} solidarity={} escrow={} stake={} d_rem={} c_init={} c_after={}",
        args.cycle, member_wallet, seized_total,
        from_solidarity, from_escrow, from_stake,
        d_remaining, c_initial, c_after,
    );

    // ─── Step 4e: Default attestation (sticky — SCHEMA_DEFAULT) ─────────
    // The reputation program enforces stickiness: once a subject has a
    // DEFAULT attestation for (pool_authority, pool_seed_id), future
    // positive attestations against the same pool become no-ops on the
    // delta side (max downside). Idempotent via deterministic nonce.
    let config = &ctx.accounts.config;
    if config.reputation_program != Pubkey::default() {
        let nonce = ((args.cycle as u64) << 32) | (member_slot_index as u64);
        let seed_id_le = pool_seed_id.to_le_bytes();

        let signer_seeds_inner: &[&[u8]] = &[
            SEED_POOL,
            pool_authority.as_ref(),
            seed_id_le.as_ref(),
            std::slice::from_ref(&pool_bump),
        ];
        let signer_seeds_arr: &[&[&[u8]]] = &[signer_seeds_inner];

        // Option<IdentityRecord> encoding: passing the reputation program
        // pubkey itself signals "no identity linked" (Anchor convention).
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
                subject:        ctx.accounts.defaulted_member_wallet.to_account_info(),
                rep_config:     ctx.accounts.reputation_config.to_account_info(),
                profile:        ctx.accounts.reputation_profile.to_account_info(),
                identity:       identity_slot,
                attestation:    ctx.accounts.attestation.to_account_info(),
                payer:          ctx.accounts.caller.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
            signer_seeds: signer_seeds_arr,
            schema_id:    SCHEMA_DEFAULT,
            nonce,
            payload:      EMPTY_PAYLOAD,
            pool:         pool_key,
            pool_authority,
            pool_seed_id,
        })?;
    } else {
        msg!("roundfi-core: settle_default skipped reputation CPI (reputation_program unset)");
    }

    Ok(())
}

// D/C invariant math (`dc_invariant_holds`, `max_seizure_respecting_dc`)
// lives in `crate::math::dc` — see that module for comprehensive unit
// tests. Keeping the handler lean.
