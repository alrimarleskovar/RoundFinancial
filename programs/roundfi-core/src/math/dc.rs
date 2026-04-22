//! Debt/Collateral (D/C) invariant math.
//!
//! The invariant that protects the pool on default is:
//!
//!     D_remaining / D_initial  <=  C_remaining / C_initial
//!
//! i.e. at every moment, the fraction of debt still owed must not exceed
//! the fraction of collateral still locked. We evaluate it in the strictly
//! equivalent cross-multiplied form, on `u128` intermediates, to avoid any
//! floating-point or ratio-rounding surprise:
//!
//!     D_rem * C_init  <=  C_rem * D_init
//!
//! `max_seizure_respecting_dc` solves for the largest seizure that keeps
//! the inequality true, using a closed-form (no loop):
//!
//!     c_min = ceil(D_rem * C_init / D_init)
//!     max_allowed = c_before - c_min
//!     seizure = min(proposed, max_allowed)
//!
//! Both functions are `pub` so unit tests (Step 5b) can exercise them
//! without bringing up Anchor's runtime.

use anchor_lang::prelude::*;

use crate::error::RoundfiError;

/// Cross-multiplied D/C invariant. Returns `true` iff
/// `D_rem * C_init <= C_rem * D_init`.
///
/// Trivial cases:
/// * `d_init == 0` → holds (no debt ever existed).
/// * `c_init == 0` → holds iff `d_rem == 0` (no collateral ever existed,
///   so any remaining debt violates).
///
/// Uses `saturating_mul` on `u128`: the largest product we can see in
/// practice is `u64::MAX * u64::MAX`, which fits in u128 exactly, so
/// saturation is a belt-and-braces guard against future refactors.
#[inline]
pub fn dc_invariant_holds(d_init: u64, d_rem: u64, c_init: u64, c_rem: u64) -> bool {
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
///
/// Closed-form (no loops): `c_min = ceil(d_rem * c_init / d_init)`,
/// `max_allowed = saturating_sub(c_before, c_min)`, `seizure =
/// min(proposed, max_allowed)`.
///
/// When `d_init == 0` there is no ratio to preserve — the full
/// `proposed` is returned unchanged.
#[inline]
pub fn max_seizure_respecting_dc(
    d_init: u64,
    d_rem: u64,
    c_init: u64,
    c_before: u64,
    proposed: u64,
) -> Result<u64> {
    if d_init == 0 {
        return Ok(proposed);
    }
    // c_min = ceil(d_rem * c_init / d_init). u128 intermediates keep every
    // input-combination of u64 safe; saturate on the try_from so callers
    // never see a panic from a silly fuzz input.
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

    // ─── dc_invariant_holds: trivial boundary cases ─────────────────────

    #[test]
    fn holds_when_no_debt_ever() {
        assert!(dc_invariant_holds(0, 0, 0, 0));
        assert!(dc_invariant_holds(0, 100, 0, 0));
        assert!(dc_invariant_holds(0, 0, 500, 0));
        assert!(dc_invariant_holds(0, u64::MAX, u64::MAX, 0));
    }

    #[test]
    fn holds_when_debt_fully_paid() {
        // D_rem == 0 → lhs == 0 <= rhs always. True even with no collateral.
        assert!(dc_invariant_holds(100, 0, 200, 0));
        assert!(dc_invariant_holds(100, 0, 0, 0));
        assert!(dc_invariant_holds(u64::MAX, 0, u64::MAX, 0));
    }

    #[test]
    fn fails_when_no_collateral_but_debt_remains() {
        // c_init == 0 branch — any remaining debt violates.
        assert!(!dc_invariant_holds(100, 1, 0, 0));
        assert!(!dc_invariant_holds(100, 50, 0, 0));
        assert!(!dc_invariant_holds(1, 1, 0, 0));
    }

    // ─── dc_invariant_holds: proportional cases ─────────────────────────

    #[test]
    fn holds_at_exact_equality() {
        // D_rem/D_init = C_rem/C_init exactly (50% / 50%).
        assert!(dc_invariant_holds(100, 50, 200, 100));
        // D_rem=60, D_init=100, C_rem=120, C_init=200 → 60*200 = 120*100.
        assert!(dc_invariant_holds(100, 60, 200, 120));
    }

    #[test]
    fn holds_when_collateral_ratio_better_than_debt() {
        // Debt-rem 10%, collateral-rem 50% → strictly safer.
        assert!(dc_invariant_holds(100, 10, 200, 100));
        // Full collateral, some debt repaid.
        assert!(dc_invariant_holds(100, 90, 200, 200));
    }

    #[test]
    fn fails_off_by_one_under_required_collateral() {
        // D_rem=60, D_init=100, C_init=200 ⇒ required C_rem >= 120.
        assert!( dc_invariant_holds(100, 60, 200, 120));
        assert!(!dc_invariant_holds(100, 60, 200, 119));
    }

    #[test]
    fn fails_when_collateral_below_debt_ratio() {
        // Debt-rem 80%, collateral-rem 50% → violation.
        assert!(!dc_invariant_holds(100, 80, 200, 100));
        // Debt-rem 100% (nothing paid), collateral-rem 50%.
        assert!(!dc_invariant_holds(100, 100, 200, 100));
    }

    #[test]
    fn survives_u64_max_inputs_without_overflow() {
        // Worst case: all four are u64::MAX → lhs == rhs (both equal to
        // u64::MAX as u128 squared), invariant holds.
        assert!(dc_invariant_holds(u64::MAX, u64::MAX, u64::MAX, u64::MAX));
        // Shift the balance by 1: D_rem one less → invariant still holds.
        assert!(dc_invariant_holds(u64::MAX, u64::MAX - 1, u64::MAX, u64::MAX));
        // Shift the balance by 1 in the other direction: C_rem one less
        // → invariant must fail.
        assert!(!dc_invariant_holds(u64::MAX, u64::MAX, u64::MAX, u64::MAX - 1));
    }

    // ─── max_seizure_respecting_dc: behaviour guarantees ────────────────

    #[test]
    fn seizure_returns_proposed_when_no_debt() {
        assert_eq!(max_seizure_respecting_dc(0, 0, 100, 100, 75).unwrap(), 75);
        assert_eq!(max_seizure_respecting_dc(0, 999, 1, 1, u64::MAX).unwrap(), u64::MAX);
    }

    #[test]
    fn seizure_respects_ceiling() {
        // D_init=100, D_rem=50, C_init=200 ⇒ c_min = ceil(50*200/100) = 100
        // c_before=180 ⇒ max_allowed = 80.
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 180,  30).unwrap(),  30);
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 180,  80).unwrap(),  80);
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 180, 100).unwrap(),  80);
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 180, u64::MAX).unwrap(), 80);
    }

    #[test]
    fn seizure_returns_zero_when_at_min_collateral() {
        // c_before == c_min → cannot seize even one unit without violating.
        // D_init=100, D_rem=50, C_init=200 ⇒ c_min = 100; c_before = 100.
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 100,  50).unwrap(), 0);
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 100,   1).unwrap(), 0);
    }

    #[test]
    fn seizure_returns_zero_when_already_below_min_collateral() {
        // c_before < c_min → saturating_sub returns 0; no seizure allowed.
        // (This state shouldn't exist on-chain — the invariant is checked
        // every settle_default — but the helper is defensive.)
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 50, 10).unwrap(), 0);
    }

    #[test]
    fn seizure_result_leaves_invariant_holding() {
        // Exhaustive small-space check: for every (d_init, d_rem, c_init,
        // c_before, proposed) in a compact grid, the post-seizure state
        // must pass dc_invariant_holds.
        for d_init in [1u64, 2, 7, 100, 10_000] {
            for d_rem in [0u64, 1, d_init / 2, d_init] {
                for c_init in [1u64, 2, 100, 200, 10_000] {
                    for c_before in [0u64, 1, c_init / 2, c_init] {
                        for proposed in [0u64, 1, c_before, u64::MAX] {
                            let seized = max_seizure_respecting_dc(
                                d_init, d_rem, c_init, c_before, proposed,
                            ).unwrap();
                            let c_after = c_before.saturating_sub(seized);
                            assert!(
                                dc_invariant_holds(d_init, d_rem, c_init, c_after),
                                "post-seizure invariant broken: d_init={d_init} d_rem={d_rem} c_init={c_init} c_before={c_before} proposed={proposed} seized={seized} c_after={c_after}",
                            );
                            assert!(seized <= proposed, "seized exceeded proposed");
                            assert!(seized <= c_before, "seized exceeded c_before");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn seizure_is_monotone_in_proposed() {
        // Increasing `proposed` can only ever increase (or leave equal)
        // the seizure amount — never decrease it.
        let base = (100u64, 50u64, 200u64, 180u64);
        let mut prev = 0u64;
        for p in (0u64..=200).step_by(5) {
            let s = max_seizure_respecting_dc(base.0, base.1, base.2, base.3, p).unwrap();
            assert!(s >= prev, "seizure went backwards when proposed grew: p={p} prev={prev} s={s}");
            prev = s;
        }
    }

    #[test]
    fn ceil_division_is_exact_when_divisible() {
        // D_rem * C_init is exactly divisible by D_init → c_min has no
        // +1 artifact from the ceiling.
        // D_init=10, D_rem=5, C_init=20 ⇒ c_min = 10 exactly.
        // c_before=15 ⇒ max_allowed = 5.
        assert_eq!(max_seizure_respecting_dc(10, 5, 20, 15, 99).unwrap(), 5);
    }

    #[test]
    fn ceil_division_rounds_up_when_not_divisible() {
        // D_init=7, D_rem=3, C_init=20 ⇒ exact = 60/7 = 8.571…; ceil = 9.
        // c_before=15 ⇒ max_allowed = 6.
        assert_eq!(max_seizure_respecting_dc(7, 3, 20, 15, 99).unwrap(), 6);
        // Verify: post-seizure c_rem = 9, invariant: 3*20 <= 9*7 → 60 <= 63 ✓.
        // Off-by-one the other way (ceil 8 would pick max_allowed=7, giving
        // c_rem=8 and 3*20=60 > 8*7=56 ✗).
        assert!( dc_invariant_holds(7, 3, 20,  9));
        assert!(!dc_invariant_holds(7, 3, 20,  8));
    }
}
