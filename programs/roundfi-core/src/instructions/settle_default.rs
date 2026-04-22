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

use crate::constants::*;
use crate::error::RoundfiError;
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
    pub caller: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        // settle_default bypasses the pause flag intentionally — funds
        // must never be locked indefinitely (see feedback/step4c).
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
        seeds = [SEED_MEMBER, pool.key().as_ref(), member.wallet.as_ref()],
        bump = member.bump,
        constraint = !member.defaulted @ RoundfiError::DefaultedMember,
    )]
    pub member: Account<'info, Member>,

    #[account(
        constraint = usdc_mint.key() == pool.usdc_mint @ RoundfiError::InvalidMint,
    )]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = pool,
    )]
    pub pool_usdc_vault: Account<'info, TokenAccount>,

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
    pub solidarity_vault: Account<'info, TokenAccount>,

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
    pub escrow_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SettleDefault>, args: SettleDefaultArgs) -> Result<()> {
    let clock = Clock::get()?;

    // ─── Snapshot pool fields before the mutable borrow of member ───────
    let pool_key             = ctx.accounts.pool.key();
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

    // ─── Seizure in strict order ────────────────────────────────────────

    // (a) Solidarity vault
    let from_solidarity = missed.min(solidarity_available);
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
    let mut shortfall = missed.saturating_sub(from_solidarity);

    // (b) Member escrow balance
    let from_escrow = {
        // Don't seize more than is actually in the vault OR the member's
        // bookkeeping balance — whichever is smaller.
        let cap = member.escrow_balance.min(escrow_vault_amount);
        let proposed = shortfall.min(cap);
        // Check D/C invariant: after seizure, c_remaining = c_before - proposed.
        // Require D_remaining * C_initial <= (C_before - proposed) * D_initial
        // => proposed <= C_before - D_remaining * C_initial / D_initial
        // We solve with cross-multiplication to avoid division.
        max_seizure_respecting_dc(d_initial, d_remaining, c_initial, c_before, proposed)?
    };
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
    shortfall = shortfall.saturating_sub(from_escrow);

    // (c) Member stake (reminder: stake is held inside the escrow vault
    //     at Step 4a — seizing it is another escrow transfer of the
    //     same underlying tokens). Track as a separate bookkeeping
    //     amount since stake_deposited is the invariant's "C" source.
    let c_after_escrow = c_before.saturating_sub(from_escrow);
    let from_stake = {
        let cap = member.stake_deposited.min(escrow_vault_amount.saturating_sub(from_escrow));
        let proposed = shortfall.min(cap);
        max_seizure_respecting_dc(d_initial, d_remaining, c_initial, c_after_escrow, proposed)?
    };
    if from_stake > 0 {
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

    let seized_total = from_solidarity
        .checked_add(from_escrow)
        .and_then(|v| v.checked_add(from_stake))
        .ok_or(error!(RoundfiError::MathOverflow))?;

    // ─── Final D/C invariant check (must still hold post-seizure) ───────
    let c_after = member.collateral_remaining();
    require!(
        dc_invariant_holds(d_initial, d_remaining, c_initial, c_after),
        RoundfiError::DebtCollateralViolation,
    );

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
        args.cycle, member.wallet, seized_total,
        from_solidarity, from_escrow, from_stake,
        d_remaining, c_initial, c_after,
    );

    // TODO(4d/wiring): CPI into roundfi-reputation::attest with
    //   schema_id = SCHEMA_DEFAULT,
    //   nonce     = (cycle as u64) << 32 | slot_index as u64,
    //   pool / pool_authority / pool_seed_id as in contribute,
    //   issuer    = pool PDA (signed via core).
    // Default is sticky in the reputation program: future positive
    // attestations for the same pool/subject are rejected.
    Ok(())
}

/// Cross-multiplied D/C invariant.
///
/// Returns `true` iff `D_rem * C_init <= C_rem * D_init`.
///
/// Special cases:
///   - D_init == 0 → trivially holds (no debt ever).
///   - C_init == 0 → means no collateral ever existed; any remaining
///     debt ratio > 0 violates (holds iff D_rem == 0).
fn dc_invariant_holds(d_init: u64, d_rem: u64, c_init: u64, c_rem: u64) -> bool {
    if d_init == 0 {
        return true;
    }
    if c_init == 0 {
        return d_rem == 0;
    }
    let lhs = (d_rem as u128).saturating_mul(c_init as u128);
    let rhs = (c_rem as u128).saturating_mul(d_init as u128);
    lhs <= rhs
}

/// Find the largest `seizure <= proposed` such that, after seizure,
/// `dc_invariant_holds(d_init, d_rem, c_init, c_before - seizure)` is true.
/// Uses closed-form arithmetic (no loop): seizure_max = max(0, c_before -
/// ceil(d_rem * c_init / d_init)).
fn max_seizure_respecting_dc(
    d_init: u64,
    d_rem: u64,
    c_init: u64,
    c_before: u64,
    proposed: u64,
) -> Result<u64> {
    if d_init == 0 {
        // No debt → no collateral requirement; full proposed seizure is fine.
        return Ok(proposed);
    }
    // Minimum collateral the invariant requires to remain post-seizure:
    //   c_min = ceil(d_rem * c_init / d_init)
    let numerator = (d_rem as u128)
        .checked_mul(c_init as u128)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    let c_min_ceil = numerator
        .checked_add(d_init as u128 - 1)
        .and_then(|v| v.checked_div(d_init as u128))
        .ok_or(error!(RoundfiError::MathOverflow))?;
    let c_min = u64::try_from(c_min_ceil).unwrap_or(u64::MAX);

    let max_allowed = c_before.saturating_sub(c_min);
    Ok(proposed.min(max_allowed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dc_invariant_trivial_cases() {
        assert!(dc_invariant_holds(0, 0, 0, 0));
        assert!(dc_invariant_holds(0, 100, 0, 0)); // no debt ever
        assert!(!dc_invariant_holds(100, 50, 0, 0)); // no collateral, debt remains
        assert!(dc_invariant_holds(100, 0, 0, 0)); // debt paid off, no collateral needed
    }

    #[test]
    fn dc_invariant_proportional() {
        // D_init=100, D_rem=60 (60%), C_init=200, C_rem=120 → 60/100 <= 120/200 ✓
        assert!(dc_invariant_holds(100, 60, 200, 120));
        // C_rem=119 → 60*200=12000 vs 119*100=11900 → 12000 > 11900 → fails
        assert!(!dc_invariant_holds(100, 60, 200, 119));
    }

    #[test]
    fn seizure_respects_dc_ceiling() {
        // D_init=100, D_rem=50, C_init=200 ⇒ c_min = ceil(50*200/100) = 100
        // c_before=180 → max_allowed = 80
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 180, 30).unwrap(), 30);
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 180, 100).unwrap(), 80);
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 100, 50).unwrap(), 0);
    }

    #[test]
    fn seizure_unrestricted_when_no_debt() {
        assert_eq!(max_seizure_respecting_dc(0, 0, 100, 100, 75).unwrap(), 75);
    }
}
