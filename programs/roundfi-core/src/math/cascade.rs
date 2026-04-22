//! Default-seizure cascade (Step 4c).
//!
//! Deterministic seizure order — enforced by `settle_default`:
//!
//!   (a) Solidarity vault     — up to `missed`.
//!   (b) Member escrow balance — up to `shortfall`, capped by D/C.
//!   (c) Member stake deposit  — remaining `shortfall`, capped by D/C.
//!
//! The order is a protocol invariant: reordering would let a bad actor
//! drain personal stake before the pooled solidarity buffer, violating
//! Step 4c's "per-member-local" cascade guarantee. This module encodes
//! the arithmetic of that cascade as a pure function so unit tests can
//! validate it without bringing up an Anchor runtime.
//!
//! `seize_for_default` returns the exact `(from_solidarity, from_escrow,
//! from_stake)` tuple that the on-chain handler computes for the same
//! inputs — the arithmetic is lifted out verbatim from the handler's
//! inline sequence. Tests below exercise order, conservation, D/C
//! enforcement, and exhaustive small-grid coverage without needing a
//! Solana runtime.

use anchor_lang::prelude::*;

use crate::error::RoundfiError;
use crate::math::dc::max_seizure_respecting_dc;

/// Output of a single settle_default cascade pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CascadeOutcome {
    pub from_solidarity: u64,
    pub from_escrow:     u64,
    pub from_stake:      u64,
}

impl CascadeOutcome {
    /// Total seized across all three buckets.
    pub fn total(&self) -> u64 {
        self.from_solidarity
            .saturating_add(self.from_escrow)
            .saturating_add(self.from_stake)
    }
}

/// Inputs to a cascade pass. Keeping them in a struct makes the call-site
/// readable and the test-grid compact.
#[derive(Debug, Clone, Copy)]
pub struct CascadeInputs {
    /// Initial debt (D_init), = pool.credit_amount.
    pub d_init: u64,
    /// Debt remaining now (D_rem).
    pub d_rem:  u64,
    /// Initial collateral (C_init), = stake_initial + total_escrow_deposited.
    pub c_init: u64,
    /// Collateral remaining before seizure (C_before).
    pub c_before: u64,
    /// Amount the member should have paid this cycle but didn't.
    /// Capped at `d_rem` upstream.
    pub missed: u64,
    /// USDC currently held in the solidarity vault.
    pub solidarity_available: u64,
    /// Max that can be pulled from member.escrow_balance
    /// (respecting both member bookkeeping AND escrow vault balance).
    pub escrow_cap: u64,
    /// Max that can be pulled from member.stake_deposited
    /// (after the escrow-balance draw, since both live in the escrow vault).
    pub stake_cap: u64,
}

/// Simulate one settle_default seizure cascade. Returns the amounts taken
/// from each bucket. Never takes more than `missed` in total, never breaks
/// the D/C invariant post-seizure, and always takes from solidarity first.
pub fn seize_for_default(ins: CascadeInputs) -> Result<CascadeOutcome> {
    // (a) Solidarity — no D/C check (pool's own funds, not member collateral).
    let from_solidarity = ins.missed.min(ins.solidarity_available);
    let shortfall_after_sol = ins.missed.saturating_sub(from_solidarity);

    // (b) Member escrow — D/C-aware. c_before is the full collateral
    //     pre-seizure; seizure reduces it by at most max_allowed.
    let proposed_escrow = shortfall_after_sol.min(ins.escrow_cap);
    let from_escrow = max_seizure_respecting_dc(
        ins.d_init, ins.d_rem, ins.c_init, ins.c_before, proposed_escrow,
    )?;
    let c_after_escrow = ins.c_before.saturating_sub(from_escrow);
    let shortfall_after_escrow = shortfall_after_sol.saturating_sub(from_escrow);

    // (c) Member stake — D/C-aware against the updated c_after_escrow.
    let proposed_stake = shortfall_after_escrow.min(ins.stake_cap);
    let from_stake = max_seizure_respecting_dc(
        ins.d_init, ins.d_rem, ins.c_init, c_after_escrow, proposed_stake,
    )?;

    Ok(CascadeOutcome { from_solidarity, from_escrow, from_stake })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::dc::dc_invariant_holds;

    fn base_inputs() -> CascadeInputs {
        // Reference: 10_000 USDC credit, halfway through a 24-cycle pool,
        // 5_000 USDC stake, no escrow yet, 416 USDC missed installment.
        CascadeInputs {
            d_init:               10_000_000_000,
            d_rem:                 6_240_000_000, // 15 * 416_000_000
            c_init:                5_000_000_000,
            c_before:              5_000_000_000,
            missed:                  416_000_000,
            solidarity_available:  0,
            escrow_cap:            0,
            stake_cap:             5_000_000_000,
        }
    }

    // ─── Order invariant: solidarity FIRST, then escrow, then stake ─────

    #[test]
    fn order_solidarity_satisfies_missed_alone() {
        // Solidarity has enough to cover the whole missed installment.
        // Nothing should be taken from escrow or stake.
        let ins = CascadeInputs {
            solidarity_available: 10_000_000_000,
            escrow_cap:           5_000_000_000,
            ..base_inputs()
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, ins.missed);
        assert_eq!(o.from_escrow,     0);
        assert_eq!(o.from_stake,      0);
        assert_eq!(o.total(),         ins.missed);
    }

    #[test]
    fn order_escrow_touched_only_after_solidarity_drained() {
        // Solidarity partial (100 USDC), escrow fills remainder.
        let ins = CascadeInputs {
            solidarity_available: 100_000_000,
            escrow_cap:           1_000_000_000,
            c_before:             6_000_000_000,  // stake 5_000 + escrow 1_000
            c_init:               6_000_000_000,
            ..base_inputs()
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, 100_000_000);
        assert_eq!(o.from_escrow,     316_000_000);
        assert_eq!(o.from_stake,      0);
        assert_eq!(o.total(),         ins.missed);
    }

    #[test]
    fn order_stake_touched_only_after_escrow_drained() {
        // Solidarity=0, escrow=50 USDC, stake absorbs the rest.
        let ins = CascadeInputs {
            solidarity_available: 0,
            escrow_cap:           50_000_000,
            c_before:             5_050_000_000,
            c_init:               5_050_000_000,
            ..base_inputs()
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, 0);
        assert_eq!(o.from_escrow,     50_000_000);
        assert_eq!(o.from_stake,      366_000_000);
        assert_eq!(o.total(),         ins.missed);
    }

    // ─── No over-seizure ────────────────────────────────────────────────

    #[test]
    fn never_takes_more_than_missed() {
        // All buckets flush with cash — but seizure still caps at missed.
        let ins = CascadeInputs {
            solidarity_available: 999_000_000_000,
            escrow_cap:           999_000_000_000,
            c_before:             5_000_000_000,
            ..base_inputs()
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.total(), ins.missed);
    }

    #[test]
    fn caps_at_available_buckets_when_all_are_thin() {
        // Solidarity=10, escrow_cap=10, stake_cap=10, missed=1_000.
        // Total seized capped at 30.
        let ins = CascadeInputs {
            d_init: 0, // disables D/C gating — pure availability test
            d_rem:  0,
            c_init: 1_000,
            c_before: 1_000,
            missed: 1_000,
            solidarity_available: 10,
            escrow_cap: 10,
            stake_cap:  10,
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, 10);
        assert_eq!(o.from_escrow,     10);
        assert_eq!(o.from_stake,      10);
        assert_eq!(o.total(),         30);
    }

    // ─── D/C invariant always holds post-seizure ───────────────────────

    #[test]
    fn post_seizure_invariant_holds() {
        // Scenario: halfway cycle, solidarity empty, escrow+stake provide
        // collateral. The cascade must not seize so aggressively that
        // C_rem / C_init drops below D_rem / D_init.
        let ins = CascadeInputs {
            d_init: 10_000,
            d_rem:   5_000, // 50% debt remains
            c_init: 10_000,
            c_before: 10_000,
            missed: 1_000,
            solidarity_available: 0,
            escrow_cap: 10_000,
            stake_cap:  0,
        };
        let o = seize_for_default(ins).unwrap();
        // Required floor: c_min = 5_000 → max allowed seize = 5_000.
        // Proposed escrow = min(1_000, 10_000) = 1_000 < 5_000 → seize 1_000.
        assert_eq!(o.from_escrow, 1_000);
        assert!(dc_invariant_holds(
            ins.d_init, ins.d_rem, ins.c_init, ins.c_before - o.total(),
        ));
    }

    #[test]
    fn invariant_limits_seizure_even_if_buckets_are_deep() {
        // D_rem=80%, C_rem=100% → required floor c_min = 80.
        // c_before=100, missed=50 → without invariant we'd seize all 50.
        // Invariant allows only 20 from escrow/stake (100 - 80 = 20).
        let ins = CascadeInputs {
            d_init: 100,
            d_rem:   80,
            c_init: 100,
            c_before: 100,
            missed:  50,
            solidarity_available: 0,
            escrow_cap: 50,
            stake_cap:  50,
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, 0);
        // from_escrow caps at 20 (max seizure under D/C).
        assert_eq!(o.from_escrow, 20);
        // After escrow: c_after_escrow=80, c_min still 80 → no more stake room.
        assert_eq!(o.from_stake, 0);
        assert_eq!(o.total(), 20);
        assert!(dc_invariant_holds(
            ins.d_init, ins.d_rem, ins.c_init, ins.c_before - o.total(),
        ));
    }

    // ─── Exhaustive invariant preservation across a small grid ──────────

    #[test]
    fn exhaustive_post_seizure_invariant_always_holds() {
        for d_init in [0u64, 100, 10_000] {
            for d_rem_ratio in [0u64, 1, 50, 99, 100] {
                let d_rem = d_init * d_rem_ratio / 100;
                for c_init in [0u64, 100, 10_000] {
                    for c_before_ratio in [0u64, 1, 50, 99, 100] {
                        let c_before = c_init * c_before_ratio / 100;
                        for missed in [0u64, 1, 100, 10_000] {
                            for sol in [0u64, 1, 10_000] {
                                for ec in [0u64, 50, c_before] {
                                    for sc in [0u64, 50, c_before.saturating_sub(ec)] {
                                        let o = seize_for_default(CascadeInputs {
                                            d_init, d_rem, c_init, c_before,
                                            missed,
                                            solidarity_available: sol,
                                            escrow_cap: ec, stake_cap: sc,
                                        }).unwrap();
                                        let total = o.total();
                                        assert!(total <= missed,
                                            "over-seized: total={total} missed={missed}");
                                        // Solidarity-first guarantee.
                                        assert_eq!(
                                            o.from_solidarity,
                                            missed.min(sol),
                                            "solidarity-first broken: o={o:?} ins(sol={sol},missed={missed})",
                                        );
                                        let c_after = c_before
                                            .saturating_sub(o.from_escrow + o.from_stake);
                                        assert!(
                                            dc_invariant_holds(d_init, d_rem, c_init, c_after),
                                            "post-seizure invariant broke: d_init={d_init} d_rem={d_rem} c_init={c_init} c_after={c_after} outcome={o:?}",
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ─── Default: trivial/edge inputs ───────────────────────────────────

    #[test]
    fn zero_missed_yields_zero_seizure() {
        let ins = CascadeInputs {
            missed: 0,
            solidarity_available: 100_000,
            escrow_cap: 100_000,
            ..base_inputs()
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o, CascadeOutcome::default());
    }

    #[test]
    fn empty_buckets_yield_zero_seizure() {
        let ins = CascadeInputs {
            solidarity_available: 0,
            escrow_cap:           0,
            stake_cap:            0,
            ..base_inputs()
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o, CascadeOutcome::default());
    }
}
