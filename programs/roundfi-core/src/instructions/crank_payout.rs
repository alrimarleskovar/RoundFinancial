use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use roundfi_reputation::constants::SCHEMA_PAYOUT_CLAIMED;
use roundfi_reputation::state::{BehavioralPayload, CLASS_PAYOUT_CLAIMED, NO_TIMESTAMP};

use crate::constants::*;
use crate::cpi::reputation::{invoke_attest, AttestAccounts, AttestCall};
use crate::error::RoundfiError;
use crate::math::retained_meets_seed_draw;
use crate::state::{Member, Pool, PoolStatus, ProtocolConfig};

/// Permissionless payout for a **live (non-defaulted)** contemplated member who
/// hasn't claimed after the grace window — the liveness twin of `claim_payout`.
///
/// **Why this exists (liveness — SEV-051).** `claim_payout` is the member's own
/// fast path, but it requires the contemplated member to SIGN. If that member
/// loses their wallet / abandons / simply never clicks, the cycle can't advance
/// (`claim_payout` needs their signature) and they can't be unstuck by
/// `skip_defaulted_payout` either — that requires `member.defaulted`, and a
/// member who is CURRENT on contributions can never satisfy `settle_default`'s
/// `contributions_paid < current_cycle` at their own contemplation slot, so they
/// never become defaulted. The pool would lock forever, freezing every OTHER
/// member's capital. `skip_defaulted_payout` (SEV-049) only covered the
/// *defaulted* contemplated member; this closes the *non-defaulted* case.
///
/// Unlike `skip_defaulted_payout`, this DOES disburse: the credit goes to the
/// contemplated member's OWN USDC ATA (never the caller's), so making it
/// permissionless introduces no theft vector — anyone can deliver the member
/// their money and advance the cycle. If the wallet is truly lost the funds
/// land in the member's ATA (only they can move them), but the pool unblocks for
/// everyone else. Same slot-monotonicity, seed-draw, earmark, cycle-advance and
/// `PAYOUT_CLAIMED` attestation as `claim_payout` — the ONLY differences are the
/// permissionless caller + the grace gate.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CrankPayoutArgs {
    /// Must equal `pool.current_cycle` AND the contemplated member's `slot_index`.
    pub cycle: u8,
}

#[derive(Accounts)]
pub struct CrankPayout<'info> {
    /// Permissionless crank — anyone can deliver the payout + unstick the pool.
    /// Pays only tx fees + the attestation account rent.
    #[account(mut)]
    pub caller: Signer<'info>,

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
        seeds = [SEED_MEMBER, pool.key().as_ref(), member.wallet.as_ref()],
        bump = member.bump,
        // A LIVE member only — a defaulter's slot is advanced (pot forfeited)
        // by `skip_defaulted_payout`, not paid out here.
        constraint = !member.defaulted @ RoundfiError::DefaultedMember,
        constraint = !member.paid_out @ RoundfiError::NotYourPayoutSlot,
    )]
    pub member: Box<Account<'info, Member>>,

    /// CHECK: the contemplated member's wallet — only used to pin their USDC
    /// ATA + as the reputation subject. Validated against `member.wallet`; does
    /// NOT sign (that's the whole point — the member need not be reachable).
    #[account(
        constraint = member_wallet.key() == member.wallet @ RoundfiError::NotAMember,
    )]
    pub member_wallet: UncheckedAccount<'info>,

    #[account(
        constraint = usdc_mint.key() == pool.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// The contemplated member's own USDC ATA — the payout destination. Pinned
    /// to `member.wallet`, so the credit can only ever land with the member,
    /// never the permissionless caller. (It exists: the member funded a USDC
    /// stake at join + contributed from it.)
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

pub fn handler(ctx: Context<CrankPayout>, args: CrankPayoutArgs) -> Result<()> {
    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.pool;
    let member = &mut ctx.accounts.member;

    // ─── Slot monotonicity (invariant #6) — identical to claim_payout ───
    require!(args.cycle == pool.current_cycle, RoundfiError::WrongCycle);
    require!(member.slot_index == args.cycle, RoundfiError::NotYourPayoutSlot);
    require!(args.cycle < pool.cycles_total, RoundfiError::PoolClosed);

    // ─── Grace gate ─────────────────────────────────────────────────────
    // The member gets the full cycle window + grace to self-claim via
    // `claim_payout` FIRST; only after the same deadline `settle_default`
    // uses may anyone crank the payout on their behalf. Symmetric with the
    // late-contributor path: past `next_cycle_at + GRACE` the pool can always
    // be unstuck — a late payer settled, or an unclaimed payout delivered.
    let claim_deadline = pool
        .next_cycle_at
        .checked_add(GRACE_PERIOD_SECS)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    require!(
        clock.unix_timestamp >= claim_deadline,
        RoundfiError::PayoutGraceActive,
    );

    // ─── Seed Draw invariant (invariant #1) — identical to claim_payout ──
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

    // ─── Ensure pool float can cover the payout (GF + LP earmark survive) ─
    let earmark = pool
        .guarantee_fund_balance
        .saturating_add(pool.lp_distribution_balance);
    let spendable = ctx.accounts.pool_usdc_vault.amount.saturating_sub(earmark);
    require!(spendable >= pool.credit_amount, RoundfiError::WaterfallUnderflow);

    // ─── Transfer credit_amount → member's own ATA (Pool PDA signs) ─────
    let authority_key = pool.authority;
    let seed_id_le = pool.seed_id.to_le_bytes();
    let pool_bump = pool.bump;
    let credit = pool.credit_amount;
    let signer_seeds: &[&[u8]] = &[
        SEED_POOL,
        authority_key.as_ref(),
        seed_id_le.as_ref(),
        std::slice::from_ref(&pool_bump),
    ];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.pool_usdc_vault.to_account_info(),
                to: ctx.accounts.member_usdc.to_account_info(),
                authority: pool.to_account_info(),
            },
            &[signer_seeds],
        ),
        credit,
    )?;

    // ─── Bookkeeping — identical to claim_payout ────────────────────────
    member.paid_out = true;
    member.total_received = member
        .total_received
        .checked_add(credit)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    pool.total_paid_out = pool
        .total_paid_out
        .checked_add(credit)
        .ok_or(error!(RoundfiError::MathOverflow))?;

    // ─── Advance cycle — identical to claim_payout ──────────────────────
    let next_cycle = args.cycle.checked_add(1).ok_or(error!(RoundfiError::MathOverflow))?;
    if next_cycle >= pool.cycles_total {
        pool.status = PoolStatus::Completed as u8;
        msg!("roundfi-core: pool completed (cranked payout) after {} cycles", pool.cycles_total);
    } else {
        pool.current_cycle = next_cycle;
        pool.next_cycle_at = pool
            .next_cycle_at
            .checked_add(pool.cycle_duration)
            .ok_or(error!(RoundfiError::MathOverflow))?;
    }

    msg!(
        "roundfi-core: crank_payout cycle={} slot={} credit={} caller={} (delivered to member ATA; cycle advanced)",
        args.cycle, member.slot_index, credit, ctx.accounts.caller.key(),
    );

    // ─── PAYOUT_CLAIMED attestation — identical to claim_payout ─────────
    let config = &ctx.accounts.config;
    if config.reputation_program != Pubkey::default() {
        let nonce = ((args.cycle as u64) << 32) | (member.slot_index as u64);
        let pool_key = pool.key();

        let payload = BehavioralPayload::new(
            CLASS_PAYOUT_CLAIMED,
            pool.members_target,
            0,
            0,
            NO_TIMESTAMP,
            0,
        )
        .encode();

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
            reputation_program: &ctx.accounts.reputation_program.to_account_info(),
            expected_program_id: config.reputation_program,
            accounts: AttestAccounts {
                issuer: pool.to_account_info(),
                subject: ctx.accounts.member_wallet.to_account_info(),
                rep_config: ctx.accounts.reputation_config.to_account_info(),
                profile: ctx.accounts.reputation_profile.to_account_info(),
                identity: identity_slot,
                attestation: ctx.accounts.attestation.to_account_info(),
                // The permissionless caller funds the attestation rent (the
                // member need not be reachable).
                payer: ctx.accounts.caller.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
            signer_seeds: signer_seeds_arr,
            schema_id: SCHEMA_PAYOUT_CLAIMED,
            nonce,
            payload,
            pool: pool_key,
            pool_authority: authority_key,
            pool_seed_id: pool.seed_id,
        })?;
    } else {
        msg!("roundfi-core: crank_payout skipped reputation CPI (reputation_program unset)");
    }

    Ok(())
}
