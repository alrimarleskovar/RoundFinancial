use anchor_lang::prelude::*;

/// Membership record. PDA seeds: `[b"member", pool, wallet]`.
#[account]
#[derive(Default)]
pub struct Member {
    pub pool:               Pubkey,
    pub wallet:             Pubkey,
    pub nft_asset:          Pubkey,   // Metaplex Core asset
    pub slot_index:         u8,       // 0..members_target-1 → determines payout cycle
    pub reputation_level:   u8,       // 1 | 2 | 3, snapshot at join
    pub stake_bps:          u16,      // 5000 | 3000 | 1000
    pub stake_deposited:    u64,
    pub contributions_paid: u8,
    pub total_contributed:  u64,
    pub total_received:     u64,
    pub escrow_balance:     u64,
    pub on_time_count:      u16,
    pub late_count:         u16,
    pub defaulted:          bool,
    pub paid_out:           bool,    // 4b: true after claim_payout transfers credit_amount
    pub last_released_checkpoint: u8, // 4b: highest checkpoint already released (0 = none)
    pub joined_at:          i64,
    // ─── Step 4c: default + escape-valve tracking ───────────────────────
    /// Stake at the moment of join_pool. Never mutated by contributions or
    /// escrow releases — used as `C_initial` in the D/C invariant.
    pub stake_deposited_initial: u64,
    /// Cumulative escrow deposited over the pool life (monotonic increments
    /// during contribute). Never decreased by release_escrow or seizure —
    /// the "escrow half" of `C_initial`.
    pub total_escrow_deposited:  u64,
    /// Timestamp the member was last re-anchored via escape_valve_buy.
    /// 0 = original buyer at join_pool.
    pub last_transferred_at:     i64,
    pub bump:               u8,
}

impl Member {
    pub const SIZE: usize =
          8                 // anchor discriminator
        + 32 * 3            // pool, wallet, nft_asset
        + 1 + 1 + 2         // slot, level, stake_bps
        + 8                 // stake_deposited
        + 1                 // contributions_paid
        + 8 + 8 + 8         // total_contributed, total_received, escrow_balance
        + 2 + 2             // on_time_count, late_count
        + 1                 // defaulted
        + 1 + 1             // paid_out, last_released_checkpoint (Step 4b)
        + 8                 // joined_at
        + 8 + 8 + 8         // 4c: stake_deposited_initial, total_escrow_deposited, last_transferred_at
        + 1                 // bump
        + 6;                // padding (was 14 in Step 4b — 24 bytes consumed by 4c, 8 retained for future)

    /// Scheduled debt remaining at a given pool cycle.
    /// D_initial = pool.credit_amount (the credit taken when it's the member's slot);
    /// D_remaining = (cycles_total - contributions_paid) * installment_amount.
    /// Used by settle_default to enforce the debt/collateral invariant.
    /// Initial debt = the member's TOTAL contribution obligation
    /// (`cycles_total × installment`) — the SAME unit `debt_remaining`
    /// counts down in, so `D_rem/D_init` starts at exactly 1 and falls
    /// with each payment.
    ///
    /// **SEV-054.** This was `pool_credit_amount`. Credit and the
    /// installment stream are DIFFERENT quantities on every
    /// constructible pool — create_pool's viability guard forces
    /// `credit ≤ members × installment × (1 − solidarity − escrow)`,
    /// i.e. credit < cycles × installment ALWAYS — so a member behind
    /// early/mid pool had `D_rem > D_init` while `C_rem ≤ C_init` by
    /// construction, the seizure floor `ceil(d_rem·c_init/d_init)` sat
    /// above the collateral ceiling, and every real mid-pool
    /// `settle_default` reverted `DebtCollateralViolation` (found live
    /// on pool7's first real default). Anchoring both sides in
    /// installment units restores the intended reading: collateral must
    /// proportionally cover the REMAINING obligation.
    pub fn debt_initial(cycles_total: u8, installment_amount: u64) -> u64 {
        (cycles_total as u64).saturating_mul(installment_amount)
    }

    pub fn debt_remaining(&self, cycles_total: u8, installment_amount: u64) -> u64 {
        let unpaid = (cycles_total as u64).saturating_sub(self.contributions_paid as u64);
        unpaid.saturating_mul(installment_amount)
    }

    /// Collateral initial = stake locked at join + total escrow ever deposited.
    pub fn collateral_initial(&self) -> u64 {
        self.stake_deposited_initial
            .saturating_add(self.total_escrow_deposited)
    }

    /// Collateral remaining = current stake + current escrow balance.
    pub fn collateral_remaining(&self) -> u64 {
        self.stake_deposited.saturating_add(self.escrow_balance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank(
        contributions_paid: u8,
        stake_deposited: u64,
        stake_initial: u64,
        escrow_balance: u64,
        escrow_deposited: u64,
    ) -> Member {
        Member {
            contributions_paid,
            stake_deposited,
            stake_deposited_initial: stake_initial,
            escrow_balance,
            total_escrow_deposited: escrow_deposited,
            ..Member::default()
        }
    }

    // ─── debt_initial / debt_remaining ──────────────────────────────────

    #[test]
    fn debt_initial_is_total_contribution_obligation() {
        // SEV-054: cycles × installment — the same unit debt_remaining
        // counts down in (NOT the credit, which is strictly smaller on
        // every constructible pool).
        assert_eq!(Member::debt_initial(24, 416_000_000), 24 * 416_000_000);
        assert_eq!(Member::debt_initial(0, 416_000_000), 0);
        assert_eq!(Member::debt_initial(24, 0), 0);
        // saturating_mul clamps instead of overflowing.
        assert_eq!(Member::debt_initial(2, u64::MAX), u64::MAX);
    }

    #[test]
    fn debt_initial_equals_debt_remaining_at_join() {
        // The anchor property that makes the D/C floor satisfiable: a
        // brand-new member starts at D_rem == D_init exactly.
        let m = blank(0, 0, 0, 0, 0);
        assert_eq!(
            m.debt_remaining(24, 416_000_000),
            Member::debt_initial(24, 416_000_000)
        );
    }

    #[test]
    fn debt_remaining_zero_when_all_paid() {
        // 24 cycles, 24 paid → 0 unpaid.
        let m = blank(24, 0, 0, 0, 0);
        assert_eq!(m.debt_remaining(24, 416_000_000), 0);
    }

    #[test]
    fn debt_remaining_full_when_nothing_paid() {
        let m = blank(0, 0, 0, 0, 0);
        assert_eq!(m.debt_remaining(24, 416_000_000), 24 * 416_000_000);
    }

    #[test]
    fn debt_remaining_linear_by_contributions() {
        let m = blank(10, 0, 0, 0, 0);
        // 14 unpaid × 416 USDC = 5_824 USDC.
        assert_eq!(m.debt_remaining(24, 416_000_000), 14 * 416_000_000);
    }

    #[test]
    fn debt_remaining_saturates_when_overpaid() {
        // Defensive — shouldn't happen on-chain but the helper uses
        // saturating_sub to guard against state bugs.
        let m = blank(30, 0, 0, 0, 0);
        assert_eq!(m.debt_remaining(24, 416_000_000), 0);
    }

    #[test]
    fn debt_remaining_handles_u64_installment() {
        // Edge: large installment, small cycle count — saturating_mul.
        let m = blank(0, 0, 0, 0, 0);
        // 2 cycles × u64::MAX would overflow; saturating_mul clamps to u64::MAX.
        assert_eq!(m.debt_remaining(2, u64::MAX), u64::MAX);
    }

    // ─── collateral_initial / collateral_remaining ──────────────────────

    #[test]
    fn collateral_initial_sums_stake_and_total_escrow_deposited() {
        // stake_initial=5_000, total_escrow_deposited=2_500 → C_init=7_500.
        let m = blank(0, 0, 5_000, 0, 2_500);
        assert_eq!(m.collateral_initial(), 7_500);
    }

    #[test]
    fn collateral_initial_never_decreases_with_releases() {
        // Initial: stake=5_000 stayed, escrow_deposited cumulative=2_500.
        // Now the member has withdrawn some escrow (escrow_balance=1_000)
        // — total_escrow_deposited is the "ever-deposited" tally and must
        // remain 2_500. collateral_initial must therefore still = 7_500.
        let m = blank(5, 5_000, 5_000, 1_000, 2_500);
        assert_eq!(m.collateral_initial(), 7_500);
    }

    #[test]
    fn collateral_remaining_sums_current_stake_and_escrow_balance() {
        // After partial release: stake=5_000, escrow_balance=1_000 → 6_000.
        let m = blank(5, 5_000, 5_000, 1_000, 2_500);
        assert_eq!(m.collateral_remaining(), 6_000);
    }

    #[test]
    fn collateral_remaining_zero_when_both_seized() {
        let m = blank(10, 0, 5_000, 0, 2_500);
        assert_eq!(m.collateral_remaining(), 0);
    }

    #[test]
    fn collateral_helpers_saturate_on_overflow() {
        // Defensive: saturating_add guards against bookkeeping bugs.
        let m = blank(0, u64::MAX, u64::MAX, u64::MAX, u64::MAX);
        assert_eq!(m.collateral_remaining(), u64::MAX);
        assert_eq!(m.collateral_initial(),   u64::MAX);
    }

    // ─── D/C invariant composition — ties member helpers to math/dc ─────

    #[test]
    fn new_member_at_cycle_zero_satisfies_invariant() {
        use crate::math::dc_invariant_holds;
        // Brand-new member: no contributions yet, full collateral posted.
        // With the SEV-054 anchor, D_rem == D_init exactly at join and
        // C_rem == C_init, so the invariant holds at equality — for ANY
        // pool economics, including the viability-constrained ones
        // (credit < cycles × installment) the old credit-anchored D_init
        // classified as violated from birth.
        let installment = 416_000_000u64;
        let cycles_total = 24u8;
        let stake_initial = 5_000_000_000u64; // 50% of a 10_000 credit
        let escrow_deposit = 0u64;             // nothing escrowed yet

        let m = blank(0, stake_initial, stake_initial, escrow_deposit, escrow_deposit);

        let d_init = Member::debt_initial(cycles_total, installment);
        let d_rem  = m.debt_remaining(cycles_total, installment);
        let c_init = m.collateral_initial();
        let c_rem  = m.collateral_remaining();

        assert_eq!(d_rem, d_init, "join starts at the D ratio boundary");
        assert!(dc_invariant_holds(d_init, d_rem, c_init, c_rem));
    }

    #[test]
    fn member_after_many_on_time_contributions_still_holds_invariant() {
        use crate::math::dc_invariant_holds;
        // 12 of 24 cycles paid + full escrow contributions → invariant
        // strengthens (debt ratio drops, collateral ratio actually RISES
        // as escrow deposits accumulate collateral).
        let installment = 416_000_000u64;
        let cycles_total = 24u8;
        let stake_initial = 5_000_000_000u64;
        // 12 cycles × 25% escrow-deposit of installment = 12 * 104_000_000.
        let escrow_deposited = 12u64 * 104_000_000;

        let m = blank(12, stake_initial, stake_initial, escrow_deposited, escrow_deposited);
        let d_init = Member::debt_initial(cycles_total, installment);
        let d_rem  = m.debt_remaining(cycles_total, installment);
        let c_init = m.collateral_initial();
        let c_rem  = m.collateral_remaining();

        assert!(dc_invariant_holds(d_init, d_rem, c_init, c_rem),
            "halfway member must satisfy invariant: d_init={d_init} d_rem={d_rem} c_init={c_init} c_rem={c_rem}",
        );
    }

    #[test]
    fn mid_pool_defaulter_on_viable_economics_is_settleable() {
        use crate::math::{dc_invariant_holds, max_seizure_respecting_dc};
        // SEV-054 regression at the unit level — the live pool7 shape:
        // credit 2_000, installment 1_000, 5 cycles (total obligation
        // 5_000 > credit, as the viability guard forces), member paid 2.
        // Old anchor (d_init = credit): d_rem 3_000 > 2_000 → floor above
        // ceiling → unsatisfiable. New anchor: floor is proportional and
        // a partial seizure down to it must satisfy the invariant.
        let installment = 1_000_000_000u64;
        let cycles_total = 5u8;
        let stake_initial = 1_000_000_000u64; // 50% of the 2_000 credit
        let escrow_deposited = 2 * 250_000_000u64; // 2 payments × 25%

        let m = blank(2, stake_initial, stake_initial, escrow_deposited, escrow_deposited);
        let d_init = Member::debt_initial(cycles_total, installment);
        let d_rem  = m.debt_remaining(cycles_total, installment);
        let c_init = m.collateral_initial();
        let c_before = m.collateral_remaining();

        // The floor is BELOW the current collateral — something is
        // seizable (the old anchor made this zero and the handler's
        // final check revert).
        let seizable =
            max_seizure_respecting_dc(d_init, d_rem, c_init, c_before, u64::MAX).unwrap();
        assert!(seizable > 0, "mid-pool defaulter must be partially seizable");
        assert!(dc_invariant_holds(d_init, d_rem, c_init, c_before - seizable));
    }
}
