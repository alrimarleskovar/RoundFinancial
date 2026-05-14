//! Debt/Collateral (D/C) invariant math.
//!
//! The invariant that protects the pool on default is:
//!
//! ```text
//! D_remaining / D_initial  <=  C_remaining / C_initial
//! ```
//!
//! i.e. at every moment, the fraction of debt still owed must not exceed
//! the fraction of collateral still locked. We evaluate it in the strictly
//! equivalent cross-multiplied form, on `u128` intermediates, to avoid any
//! floating-point or ratio-rounding surprise:
//!
//! ```text
//! D_rem * C_init  <=  C_rem * D_init
//! ```
//!
//! `max_seizure_respecting_dc` solves for the largest seizure that keeps
//! the inequality true, using a closed-form (no loop):
//!
//! ```text
//! c_min = ceil(D_rem * C_init / D_init)
//! max_allowed = c_before - c_min
//! seizure = min(proposed, max_allowed)
//! ```
//!
//! Both functions are `pub` so unit tests can exercise them without
//! bringing up Anchor's runtime.

use crate::error::MathError;

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
) -> Result<u64, MathError> {
    if d_init == 0 {
        return Ok(proposed);
    }
    // c_min = ceil(d_rem * c_init / d_init). u128 intermediates keep every
    // input-combination of u64 safe; saturate on the try_from so callers
    // never see a panic from a silly fuzz input.
    let numerator = (d_rem as u128)
        .checked_mul(c_init as u128)
        .ok_or(MathError::Overflow)?;
    let c_min_ceil = numerator
        .checked_add(d_init as u128 - 1)
        .and_then(|v| v.checked_div(d_init as u128))
        .ok_or(MathError::Overflow)?;
    let c_min = u64::try_from(c_min_ceil).unwrap_or(u64::MAX);

    let max_allowed = c_before.saturating_sub(c_min);
    Ok(proposed.min(max_allowed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_when_no_debt_ever() {
        assert!(dc_invariant_holds(0, 0, 0, 0));
        assert!(dc_invariant_holds(0, 100, 0, 0));
        assert!(dc_invariant_holds(0, 0, 500, 0));
        assert!(dc_invariant_holds(0, u64::MAX, u64::MAX, 0));
    }

    #[test]
    fn holds_when_debt_fully_paid() {
        assert!(dc_invariant_holds(100, 0, 200, 0));
        assert!(dc_invariant_holds(100, 0, 0, 0));
        assert!(dc_invariant_holds(u64::MAX, 0, u64::MAX, 0));
    }

    #[test]
    fn fails_when_no_collateral_but_debt_remains() {
        assert!(!dc_invariant_holds(100, 1, 0, 0));
        assert!(!dc_invariant_holds(100, 50, 0, 0));
        assert!(!dc_invariant_holds(1, 1, 0, 0));
    }

    #[test]
    fn holds_at_exact_equality() {
        assert!(dc_invariant_holds(100, 50, 200, 100));
        assert!(dc_invariant_holds(100, 60, 200, 120));
    }

    #[test]
    fn holds_when_collateral_ratio_better_than_debt() {
        assert!(dc_invariant_holds(100, 10, 200, 100));
        assert!(dc_invariant_holds(100, 90, 200, 200));
    }

    #[test]
    fn fails_off_by_one_under_required_collateral() {
        assert!(dc_invariant_holds(100, 60, 200, 120));
        assert!(!dc_invariant_holds(100, 60, 200, 119));
    }

    #[test]
    fn fails_when_collateral_below_debt_ratio() {
        assert!(!dc_invariant_holds(100, 80, 200, 100));
        assert!(!dc_invariant_holds(100, 100, 200, 100));
    }

    #[test]
    fn survives_u64_max_inputs_without_overflow() {
        assert!(dc_invariant_holds(u64::MAX, u64::MAX, u64::MAX, u64::MAX));
        assert!(dc_invariant_holds(u64::MAX, u64::MAX - 1, u64::MAX, u64::MAX));
        assert!(!dc_invariant_holds(u64::MAX, u64::MAX, u64::MAX, u64::MAX - 1));
    }

    #[test]
    fn seizure_returns_proposed_when_no_debt() {
        assert_eq!(max_seizure_respecting_dc(0, 0, 100, 100, 75).unwrap(), 75);
        assert_eq!(
            max_seizure_respecting_dc(0, 999, 1, 1, u64::MAX).unwrap(),
            u64::MAX
        );
    }

    #[test]
    fn seizure_respects_ceiling() {
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 180, 30).unwrap(), 30);
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 180, 80).unwrap(), 80);
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 180, 100).unwrap(), 80);
        assert_eq!(
            max_seizure_respecting_dc(100, 50, 200, 180, u64::MAX).unwrap(),
            80
        );
    }

    #[test]
    fn seizure_returns_zero_when_at_min_collateral() {
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 100, 50).unwrap(), 0);
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 100, 1).unwrap(), 0);
    }

    #[test]
    fn seizure_returns_zero_when_already_below_min_collateral() {
        assert_eq!(max_seizure_respecting_dc(100, 50, 200, 50, 10).unwrap(), 0);
    }

    #[test]
    fn seizure_result_leaves_invariant_holding() {
        for d_init in [1u64, 2, 7, 100, 10_000] {
            for d_rem in [0u64, 1, d_init / 2, d_init] {
                for c_init in [1u64, 2, 100, 200, 10_000] {
                    for c_before in [0u64, 1, c_init / 2, c_init] {
                        // Skip states that ALREADY violate the invariant before
                        // any seizure happens — the helper saturates to zero
                        // seizure in those cases (correct) but it can't fix a
                        // pre-existing violation. On-chain `settle_default`
                        // never reaches this branch because join_pool enforces
                        // c_init coverage on entry.
                        if !dc_invariant_holds(d_init, d_rem, c_init, c_before) {
                            continue;
                        }
                        for proposed in [0u64, 1, c_before, u64::MAX] {
                            let seized = max_seizure_respecting_dc(
                                d_init, d_rem, c_init, c_before, proposed,
                            )
                            .unwrap();
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
        let base = (100u64, 50u64, 200u64, 180u64);
        let mut prev = 0u64;
        for p in (0u64..=200).step_by(5) {
            let s = max_seizure_respecting_dc(base.0, base.1, base.2, base.3, p).unwrap();
            assert!(s >= prev, "seizure went backwards: p={p} prev={prev} s={s}");
            prev = s;
        }
    }

    #[test]
    fn ceil_division_is_exact_when_divisible() {
        assert_eq!(max_seizure_respecting_dc(10, 5, 20, 15, 99).unwrap(), 5);
    }

    #[test]
    fn ceil_division_rounds_up_when_not_divisible() {
        assert_eq!(max_seizure_respecting_dc(7, 3, 20, 15, 99).unwrap(), 6);
        assert!(dc_invariant_holds(7, 3, 20, 9));
        assert!(!dc_invariant_holds(7, 3, 20, 8));
    }
}
