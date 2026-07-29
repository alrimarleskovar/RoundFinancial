//! `place_bid_reveal(cycle, amount, salt)` — second half of the sealed
//! free bid (ADR 0012 Fase 3 — lance livre).
//!
//! Opens the envelope sealed by `place_bid_commit`, PAYS the bid, and
//! adjudicates it — atomically, in one transaction.
//!
//! # The reduction that makes this cheap to audit
//!
//! A free bid **compiles down to prepayment + embedded bid**:
//!
//!   1. `amount` buys `K = amount / installment_amount` whole
//!      installments, moved through the SAME `split_installment`
//!      partition `contribute` uses (solidarity / escrow / float shares
//!      preserved bit-for-bit), and `member.contributions_paid += K`;
//!   2. the resulting depth is then adjudicated by Fase 2's rule —
//!      `depth = contributions_paid − current_cycle − 1`, strictly
//!      greater than `pool.current_bid_depth` — and the winner takes the
//!      current cycle by SWAPPING two `DrawResult.order` entries.
//!
//! So Fase 3 adds a sealed-envelope layer and **no new contemplation
//! math**: the bijection argument, the payout instructions, the vault
//! waterfall and every Fase 1 safety property carry over verbatim.
//!
//! # Why there is no bid vault, no refund and no settlement step
//!
//! The obvious design escrows every bid, adjudicates after the reveal
//! window, converts the winner's lock into installments and refunds the
//! losers. That design needs a vault authority, a winner pointer, a
//! settlement crank and a refund path — four new surfaces holding other
//! people's money.
//!
//! None of it is necessary, because a losing reveal simply **REVERTS**
//! (`EmbeddedBidTooShallow`): the bidder's USDC never left their wallet.
//! And a winning reveal has already turned the money into the bidder's
//! OWN prepaid installments — their own debt, brought forward — so
//! there is nothing to refund and nothing to settle later. The bid is
//! all-or-nothing by construction.
//!
//! That also means the honest UX line is: *losing costs you only the
//! fee; winning costs you nothing you didn't already owe.*
//!
//! # One attestation for K installments
//!
//! `BehavioralPayload` carries `parcels_paid: u8` — "installments paid
//! this event" — which `contribute` has always set to 1 simply because
//! it pays one at a time. A K-installment bid IS one behavioral event,
//! so it mints ONE attestation with `parcels_paid = K`, nonced on the
//! LAST installment paid. Minting K separate attestations would inflate
//! the payment count for a single act and burn K cooldown slots.
//!
//! Every installment this bid buys is strictly in the FUTURE (the
//! handler requires the bidder to already be current for this cycle), so
//! the event is unambiguously an EARLY payment — no clock comparison
//! needed, and no risk of stamping a prepayment as late just because the
//! reveal window opens at the cycle deadline.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
// Anchor 1.0's `solana_program` shim no longer re-exports `hash`.
use solana_program::hash;

use roundfi_reputation::constants::{SCHEMA_PAYMENT, SCHEMA_POOL_COMPLETE};
use roundfi_reputation::state::{BehavioralPayload, CLASS_PAYMENT_EARLY, CLASS_POOL_COMPLETE};

use crate::constants::*;
use crate::cpi::reputation::{invoke_attest, AttestAccounts, AttestCall};
use crate::error::RoundfiError;
use crate::math::split_installment;
use crate::state::{Bid, BidState, DrawResult, Member, Pool, PoolStatus, ProtocolConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PlaceBidRevealArgs {
    /// Must equal `pool.current_cycle` AND the sealed `bid.cycle`.
    pub cycle: u8,
    /// USDC bid — an exact multiple of `pool.installment_amount`.
    pub amount: u64,
    /// The commit salt. `0` is rejected (SEV-013 lesson): the amount
    /// space is small and guessable, so a predictable salt makes the
    /// envelope brute-forceable.
    pub salt: u64,
}

#[derive(Accounts)]
#[instruction(args: PlaceBidRevealArgs)]
pub struct PlaceBidReveal<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

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
        constraint = pool.ordering_policy == ORDERING_SORTEIO @ RoundfiError::EmbeddedBidUnavailable,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [SEED_MEMBER, pool.key().as_ref(), bidder.key().as_ref()],
        bump = member.bump,
        constraint = member.wallet == bidder.key() @ RoundfiError::NotAMember,
        constraint = !member.defaulted @ RoundfiError::DefaultedMember,
        constraint = !member.paid_out @ RoundfiError::EmbeddedBidUnavailable,
    )]
    pub member: Box<Account<'info, Member>>,

    #[account(
        mut,
        seeds = [SEED_BID, pool.key().as_ref(), &[args.cycle], bidder.key().as_ref()],
        bump = bid.bump,
        constraint = bid.pool == pool.key() @ RoundfiError::WrongCycle,
        constraint = bid.bidder == bidder.key() @ RoundfiError::NotAMember,
    )]
    pub bid: Box<Account<'info, Bid>>,

    #[account(
        mut,
        seeds = [SEED_DRAW_RESULT, pool.key().as_ref()],
        bump = draw.bump,
        constraint = draw.pool == pool.key() @ RoundfiError::InvalidDrawAccount,
    )]
    pub draw: Box<Account<'info, DrawResult>>,

    #[account(
        constraint = usdc_mint.key() == pool.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = bidder,
    )]
    pub bidder_usdc: Box<Account<'info, TokenAccount>>,

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

    // ─── reputation sidecar (same shape as contribute) ──────────────────
    /// CHECK: program-id guard against config.reputation_program.
    pub reputation_program: UncheckedAccount<'info>,
    /// CHECK: PDA seeds validated inside reputation::attest.
    #[account(mut)]
    pub reputation_config: UncheckedAccount<'info>,
    /// CHECK: PDA seeds validated inside reputation::attest (init_if_needed).
    #[account(mut)]
    pub reputation_profile: UncheckedAccount<'info>,
    /// CHECK: Optional IdentityRecord — pass the reputation program itself
    /// to signal "no identity linked".
    pub identity_record: UncheckedAccount<'info>,
    /// CHECK: New attestation PDA; reputation::attest will init.
    #[account(mut)]
    pub attestation: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<PlaceBidReveal>, args: PlaceBidRevealArgs) -> Result<()> {
    let clock = Clock::get()?;

    // ─── Windows: reveals open exactly where commits close ──────────────
    // Commits require `clock < next_cycle_at`; reveals require
    // `>= next_cycle_at`. Disjoint by construction, so no envelope can be
    // sealed after another one has been opened.
    //
    // The upper bound is the SAME grace deadline `settle_default` waits
    // for (ADR 0013's time exclusion): once the cycle can be settled or
    // cranked, the auction for it is over.
    {
        let pool = &ctx.accounts.pool;
        require!(args.cycle == pool.current_cycle, RoundfiError::WrongCycle);
        let grace_deadline = pool
            .next_cycle_at
            .checked_add(GRACE_PERIOD_SECS)
            .ok_or(error!(RoundfiError::MathOverflow))?;
        require!(
            clock.unix_timestamp >= pool.next_cycle_at
                && clock.unix_timestamp < grace_deadline,
            RoundfiError::BidWindowClosed,
        );
    }

    // ─── Open the envelope ──────────────────────────────────────────────
    require!(
        ctx.accounts.bid.state == BidState::Committed as u8,
        RoundfiError::BidAlreadyRevealed,
    );
    require!(ctx.accounts.bid.cycle == args.cycle, RoundfiError::WrongCycle);
    require!(args.salt != 0, RoundfiError::SaltMustBeNonZero);

    // sha256(amount_le || salt_le || bidder). The bidder is inside the
    // pre-image so a hash copied from someone else's envelope can never
    // be revealed from this wallet, even if the salt leaked.
    let mut preimage = [0u8; 48];
    preimage[..8].copy_from_slice(&args.amount.to_le_bytes());
    preimage[8..16].copy_from_slice(&args.salt.to_le_bytes());
    preimage[16..].copy_from_slice(ctx.accounts.bidder.key().as_ref());
    require!(
        hash::hash(&preimage).to_bytes() == ctx.accounts.bid.commit_hash,
        RoundfiError::BidCommitMismatch,
    );

    // ─── The bid buys WHOLE installments ────────────────────────────────
    let installment = ctx.accounts.pool.installment_amount;
    require!(installment > 0, RoundfiError::MathOverflow);
    require!(
        args.amount >= installment && args.amount % installment == 0,
        RoundfiError::BidAmountNotMultiple,
    );
    let parcels_u64 = args.amount / installment;
    let parcels: u8 = u8::try_from(parcels_u64).map_err(|_| error!(RoundfiError::MathOverflow))?;

    // ─── Eligibility (same shape as place_embedded_bid) ─────────────────
    let current_cycle = ctx.accounts.pool.current_cycle;
    let cycles_total = ctx.accounts.pool.cycles_total;

    // The bidder must ALREADY be current for this cycle, so every
    // installment the bid buys is strictly in the future. That is what
    // lets us classify the whole event as EARLY without a clock test, and
    // it matches the depth metric's `−1` (being merely current is depth 0).
    require!(
        ctx.accounts.member.contributions_paid
            >= current_cycle
                .checked_add(1)
                .ok_or(error!(RoundfiError::MathOverflow))?,
        RoundfiError::EmbeddedBidUnavailable,
    );
    let paid_after = ctx
        .accounts
        .member
        .contributions_paid
        .checked_add(parcels)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    require!(paid_after <= cycles_total, RoundfiError::PoolClosed);

    // The bidder's own drawn turn must still be in the future — otherwise
    // there is nothing to bring forward.
    let seat = ctx.accounts.member.slot_index;
    let my_cycle = ctx.accounts.draw.cycle_for_seat(seat)?;
    require!(my_cycle > current_cycle, RoundfiError::EmbeddedBidUnavailable);

    // ─── Adjudicate BEFORE moving a single lamport ──────────────────────
    // A losing bid must cost nothing but the fee, so the depth comparison
    // runs first: on `EmbeddedBidTooShallow` the whole transaction reverts
    // and the USDC never leaves the bidder's wallet.
    let depth = paid_after
        .checked_sub(current_cycle)
        .and_then(|ahead| ahead.checked_sub(1))
        .ok_or(error!(RoundfiError::MathOverflow))?;
    require!(depth >= 1, RoundfiError::EmbeddedBidUnavailable);
    require!(
        depth > ctx.accounts.pool.current_bid_depth,
        RoundfiError::EmbeddedBidTooShallow,
    );

    // ─── Pay: K installments through the normal split ───────────────────
    // `split_installment` partitions ONE installment exactly (the float
    // bucket absorbs the bps residual), so K × the triple sums to exactly
    // `amount` — identical to K sequential `contribute` calls, with the
    // same per-installment rounding and one third of the CPI cost.
    let (solidarity_one, escrow_one, float_one) = split_installment(
        installment,
        ctx.accounts.pool.solidarity_bps,
        ctx.accounts.pool.escrow_release_bps,
    )?;
    let k = parcels as u64;
    let solidarity_amt = solidarity_one.checked_mul(k).ok_or(error!(RoundfiError::MathOverflow))?;
    let escrow_deposit = escrow_one.checked_mul(k).ok_or(error!(RoundfiError::MathOverflow))?;
    let float_amt = float_one.checked_mul(k).ok_or(error!(RoundfiError::MathOverflow))?;

    require!(
        ctx.accounts.bidder_usdc.amount >= args.amount,
        RoundfiError::InsufficientStake,
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from:      ctx.accounts.bidder_usdc.to_account_info(),
                to:        ctx.accounts.solidarity_vault.to_account_info(),
                authority: ctx.accounts.bidder.to_account_info(),
            },
        ),
        solidarity_amt,
    )?;
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from:      ctx.accounts.bidder_usdc.to_account_info(),
                to:        ctx.accounts.escrow_vault.to_account_info(),
                authority: ctx.accounts.bidder.to_account_info(),
            },
        ),
        escrow_deposit,
    )?;
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from:      ctx.accounts.bidder_usdc.to_account_info(),
                to:        ctx.accounts.pool_usdc_vault.to_account_info(),
                authority: ctx.accounts.bidder.to_account_info(),
            },
        ),
        float_amt,
    )?;

    // ─── Bookkeeping (K installments' worth) ────────────────────────────
    {
        let member = &mut ctx.accounts.member;
        member.contributions_paid = paid_after;
        member.total_contributed = member
            .total_contributed
            .checked_add(args.amount)
            .ok_or(error!(RoundfiError::MathOverflow))?;
        member.escrow_balance = member
            .escrow_balance
            .checked_add(escrow_deposit)
            .ok_or(error!(RoundfiError::MathOverflow))?;
        member.total_escrow_deposited = member
            .total_escrow_deposited
            .checked_add(escrow_deposit)
            .ok_or(error!(RoundfiError::MathOverflow))?;
        // Every one of the K is a FUTURE installment — on-time by
        // construction, so the whole bid counts as K punctual payments.
        member.on_time_count = member
            .on_time_count
            .checked_add(parcels as u16)
            .ok_or(error!(RoundfiError::MathOverflow))?;
    }

    // ─── The swap — permutation in, permutation out ─────────────────────
    let displaced = {
        let draw = &ctx.accounts.draw;
        let n = draw.members_target as usize;
        draw.order[..n]
            .iter()
            .position(|&c| c == current_cycle)
            .ok_or(error!(RoundfiError::InvalidDrawAccount))?
    };
    {
        let draw = &mut ctx.accounts.draw;
        draw.order[seat as usize] = current_cycle;
        draw.order[displaced] = my_cycle;
    }

    {
        let pool = &mut ctx.accounts.pool;
        pool.current_bid_depth = depth;
        pool.total_contributed = pool
            .total_contributed
            .checked_add(args.amount)
            .ok_or(error!(RoundfiError::MathOverflow))?;
        pool.solidarity_balance = pool
            .solidarity_balance
            .checked_add(solidarity_amt)
            .ok_or(error!(RoundfiError::MathOverflow))?;
        pool.escrow_balance = pool
            .escrow_balance
            .checked_add(escrow_deposit)
            .ok_or(error!(RoundfiError::MathOverflow))?;
    }

    {
        let bid = &mut ctx.accounts.bid;
        bid.amount = args.amount;
        bid.parcels = parcels;
        bid.state = BidState::Revealed as u8;
    }

    msg!(
        "roundfi-core: free bid WON pool={} cycle={} winner_seat={} parcels={} amount={} depth={} displaced_seat={} displaced_to_cycle={}",
        ctx.accounts.pool.key(),
        current_cycle,
        seat,
        parcels,
        args.amount,
        depth,
        displaced,
        my_cycle,
    );

    // ─── One attestation for the whole event ────────────────────────────
    let config = &ctx.accounts.config;
    if config.reputation_program != Pubkey::default() {
        let is_final_installment = paid_after == cycles_total;
        let schema_id = if is_final_installment {
            SCHEMA_POOL_COMPLETE
        } else {
            SCHEMA_PAYMENT
        };
        // Nonce on the LAST installment this bid paid, so it can never
        // collide with the `contribute` attestation of any other cycle.
        let last_cycle = paid_after
            .checked_sub(1)
            .ok_or(error!(RoundfiError::MathOverflow))?;
        let nonce = ((last_cycle as u64) << 32) | (seat as u64);

        let classification = if is_final_installment {
            CLASS_POOL_COMPLETE
        } else {
            CLASS_PAYMENT_EARLY
        };
        let pool = &ctx.accounts.pool;
        let payload = BehavioralPayload::new(
            classification,
            pool.members_target,
            parcels,
            pool.next_cycle_at,
            clock.unix_timestamp,
            args.amount,
        )
        .encode();

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
                subject:        ctx.accounts.bidder.to_account_info(),
                rep_config:     ctx.accounts.reputation_config.to_account_info(),
                profile:        ctx.accounts.reputation_profile.to_account_info(),
                identity:       identity_slot,
                attestation:    ctx.accounts.attestation.to_account_info(),
                payer:          ctx.accounts.bidder.to_account_info(),
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
        msg!("roundfi-core: place_bid_reveal skipped reputation CPI (reputation_program unset)");
    }

    Ok(())
}
