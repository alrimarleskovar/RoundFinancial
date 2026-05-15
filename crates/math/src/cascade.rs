//! Default-seizure cascade (Step 4c).
//!
//! Deterministic seizure order — enforced by `settle_default`:
//!
//!   (a) Solidarity vault     — up to `missed`.
//!   (b) Member escrow balance — up to `shortfall`, capped by D/C.
//!   (c) Member stake deposit  — remaining `shortfall`, capped by D/C.

use crate::dc::max_seizure_respecting_dc;
use crate::error::MathError;

/// Output of a single settle_default cascade pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CascadeOutcome {
    pub from_solidarity: u64,
    pub from_escrow: u64,
    pub from_stake: u64,
}

impl CascadeOutcome {
    pub fn total(&self) -> u64 {
        self.from_solidarity
            .saturating_add(self.from_escrow)
            .saturating_add(self.from_stake)
    }
}

/// Inputs to a cascade pass.
#[derive(Debug, Clone, Copy)]
pub struct CascadeInputs {
    pub d_init: u64,
    pub d_rem: u64,
    pub c_init: u64,
    pub c_before: u64,
    pub missed: u64,
    pub solidarity_available: u64,
    pub escrow_cap: u64,
    pub stake_cap: u64,
}

/// Simulate one settle_default seizure cascade.
pub fn seize_for_default(ins: CascadeInputs) -> Result<CascadeOutcome, MathError> {
    let from_solidarity = ins.missed.min(ins.solidarity_available);
    let shortfall_after_sol = ins.missed.saturating_sub(from_solidarity);

    let proposed_escrow = shortfall_after_sol.min(ins.escrow_cap);
    let from_escrow = max_seizure_respecting_dc(
        ins.d_init, ins.d_rem, ins.c_init, ins.c_before, proposed_escrow,
    )?;
    let c_after_escrow = ins.c_before.saturating_sub(from_escrow);
    let shortfall_after_escrow = shortfall_after_sol.saturating_sub(from_escrow);

    let proposed_stake = shortfall_after_escrow.min(ins.stake_cap);
    let from_stake = max_seizure_respecting_dc(
        ins.d_init, ins.d_rem, ins.c_init, c_after_escrow, proposed_stake,
    )?;

    Ok(CascadeOutcome { from_solidarity, from_escrow, from_stake })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dc::dc_invariant_holds;

    fn base_inputs() -> CascadeInputs {
        CascadeInputs {
            d_init: 10_000_000_000,
            d_rem: 6_240_000_000,
            c_init: 5_000_000_000,
            c_before: 5_000_000_000,
            missed: 416_000_000,
            solidarity_available: 0,
            escrow_cap: 0,
            stake_cap: 5_000_000_000,
        }
    }

    #[test]
    fn order_solidarity_satisfies_missed_alone() {
        let ins = CascadeInputs {
            solidarity_available: 10_000_000_000,
            escrow_cap: 5_000_000_000,
            ..base_inputs()
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, ins.missed);
        assert_eq!(o.from_escrow, 0);
        assert_eq!(o.from_stake, 0);
        assert_eq!(o.total(), ins.missed);
    }

    #[test]
    fn order_escrow_touched_only_after_solidarity_drained() {
        let ins = CascadeInputs {
            solidarity_available: 100_000_000,
            escrow_cap: 1_000_000_000,
            c_before: 6_000_000_000,
            c_init: 6_000_000_000,
            ..base_inputs()
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, 100_000_000);
        assert_eq!(o.from_escrow, 316_000_000);
        assert_eq!(o.from_stake, 0);
        assert_eq!(o.total(), ins.missed);
    }

    #[test]
    fn order_stake_touched_only_after_escrow_drained() {
        let ins = CascadeInputs {
            solidarity_available: 0,
            escrow_cap: 50_000_000,
            c_before: 5_050_000_000,
            c_init: 5_050_000_000,
            ..base_inputs()
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, 0);
        assert_eq!(o.from_escrow, 50_000_000);
        assert_eq!(o.from_stake, 366_000_000);
        assert_eq!(o.total(), ins.missed);
    }

    #[test]
    fn never_takes_more_than_missed() {
        let ins = CascadeInputs {
            solidarity_available: 999_000_000_000,
            escrow_cap: 999_000_000_000,
            c_before: 5_000_000_000,
            ..base_inputs()
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.total(), ins.missed);
    }

    #[test]
    fn caps_at_available_buckets_when_all_are_thin() {
        let ins = CascadeInputs {
            d_init: 0,
            d_rem: 0,
            c_init: 1_000,
            c_before: 1_000,
            missed: 1_000,
            solidarity_available: 10,
            escrow_cap: 10,
            stake_cap: 10,
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, 10);
        assert_eq!(o.from_escrow, 10);
        assert_eq!(o.from_stake, 10);
        assert_eq!(o.total(), 30);
    }

    #[test]
    fn post_seizure_invariant_holds() {
        let ins = CascadeInputs {
            d_init: 10_000,
            d_rem: 5_000,
            c_init: 10_000,
            c_before: 10_000,
            missed: 1_000,
            solidarity_available: 0,
            escrow_cap: 10_000,
            stake_cap: 0,
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_escrow, 1_000);
        assert!(dc_invariant_holds(
            ins.d_init,
            ins.d_rem,
            ins.c_init,
            ins.c_before - o.total(),
        ));
    }

    #[test]
    fn invariant_limits_seizure_even_if_buckets_are_deep() {
        let ins = CascadeInputs {
            d_init: 100,
            d_rem: 80,
            c_init: 100,
            c_before: 100,
            missed: 50,
            solidarity_available: 0,
            escrow_cap: 50,
            stake_cap: 50,
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, 0);
        assert_eq!(o.from_escrow, 20);
        assert_eq!(o.from_stake, 0);
        assert_eq!(o.total(), 20);
        assert!(dc_invariant_holds(
            ins.d_init,
            ins.d_rem,
            ins.c_init,
            ins.c_before - o.total(),
        ));
    }

    #[test]
    fn exhaustive_post_seizure_invariant_always_holds() {
        for d_init in [0u64, 100, 10_000] {
            for d_rem_ratio in [0u64, 1, 50, 99, 100] {
                let d_rem = d_init * d_rem_ratio / 100;
                for c_init in [0u64, 100, 10_000] {
                    for c_before_ratio in [0u64, 1, 50, 99, 100] {
                        let c_before = c_init * c_before_ratio / 100;
                        // Skip pre-existing violations — the cascade saturates
                        // to zero seizure in those cases (correct) but can't
                        // fix a violation present before its call.
                        if !dc_invariant_holds(d_init, d_rem, c_init, c_before) {
                            continue;
                        }
                        for missed in [0u64, 1, 100, 10_000] {
                            for sol in [0u64, 1, 10_000] {
                                for ec in [0u64, 50, c_before] {
                                    for sc in [0u64, 50, c_before.saturating_sub(ec)] {
                                        let o = seize_for_default(CascadeInputs {
                                            d_init,
                                            d_rem,
                                            c_init,
                                            c_before,
                                            missed,
                                            solidarity_available: sol,
                                            escrow_cap: ec,
                                            stake_cap: sc,
                                        })
                                        .unwrap();
                                        let total = o.total();
                                        assert!(total <= missed);
                                        assert_eq!(o.from_solidarity, missed.min(sol));
                                        let c_after = c_before
                                            .saturating_sub(o.from_escrow + o.from_stake);
                                        assert!(dc_invariant_holds(
                                            d_init, d_rem, c_init, c_after,
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

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
            escrow_cap: 0,
            stake_cap: 0,
            ..base_inputs()
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o, CascadeOutcome::default());
    }

    // ─── SEV-026 parity tests ───────────────────────────────────────────
    //
    // The on-chain `settle_default` handler was rewritten in this PR to
    // delegate to `seize_for_default` rather than re-implement the
    // cascade inline. These tests pin specific (inputs → outcome) tuples
    // that the on-chain bankrun coverage will exercise once #319
    // unblocks the bankrun-in-CI path (SEV-012). For now, they serve as
    // the canonical reference for what the on-chain handler MUST produce
    // — any future refactor that changes the math will fail these tests
    // loudly before reaching the chain.

    /// SEV-016 partial-default scenario (from the original release_escrow
    /// audit context): pool with a defaulted member, solidarity drained
    /// already, member has only partial escrow.
    #[test]
    fn sev_026_partial_escrow_drain_pinned() {
        let ins = CascadeInputs {
            d_init:               10_000_000_000,
            d_rem:                 6_240_000_000,
            c_init:                5_000_000_000,
            c_before:              5_000_000_000,
            missed:                  416_000_000,
            solidarity_available:           0,
            escrow_cap:             1_000_000_000,
            stake_cap:              4_000_000_000,
        };
        let o = seize_for_default(ins).unwrap();
        // Solidarity is empty; escrow has enough → cascade stops at escrow.
        assert_eq!(o.from_solidarity, 0);
        assert_eq!(o.from_escrow,     416_000_000);
        assert_eq!(o.from_stake,              0);
        assert_eq!(o.total(),         ins.missed);
        // Pinned for the on-chain handler to assert byte-for-byte.
    }

    /// Veteran (10% stake) edge case: deep stake, no escrow, draining
    /// stake alone must respect the D/C invariant.
    #[test]
    fn sev_026_veteran_stake_only_pinned() {
        let ins = CascadeInputs {
            d_init:               10_000_000_000,
            d_rem:                 6_240_000_000,
            c_init:                1_000_000_000, // 10% stake (L3 veteran)
            c_before:              1_000_000_000,
            missed:                  416_000_000,
            solidarity_available:           0,
            escrow_cap:                     0,
            stake_cap:              1_000_000_000,
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, 0);
        assert_eq!(o.from_escrow,     0);
        // D/C limits the seizure even though missed=416M and stake_cap=1B:
        // max c_after such that d_rem * c_init <= c_after * d_init
        // = 6.24e9 * 1e9 / 1e10 = 6.24e8 = 624M → max seizure = 1B − 624M = 376M
        assert_eq!(o.from_stake, 376_000_000);
        assert_eq!(o.total(), 376_000_000);
    }

    /// Cycle-0 with full solidarity → no escrow/stake touched.
    #[test]
    fn sev_026_full_solidarity_satisfies_pinned() {
        let ins = CascadeInputs {
            d_init:               10_000_000_000,
            d_rem:                10_000_000_000, // freshly joined, paid 0
            c_init:                5_000_000_000,
            c_before:              5_000_000_000,
            missed:                  416_000_000,
            solidarity_available:    500_000_000,
            escrow_cap:             4_000_000_000,
            stake_cap:              1_000_000_000,
        };
        let o = seize_for_default(ins).unwrap();
        assert_eq!(o.from_solidarity, 416_000_000);
        assert_eq!(o.from_escrow,             0);
        assert_eq!(o.from_stake,              0);
        assert_eq!(o.total(),         ins.missed);
    }
}
