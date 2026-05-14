//! Seed-draw invariant math (§7, whitepaper).
//!
//! On the very first payout (cycle 0), the pool must still hold at least
//! `SEED_DRAW_BPS * members_target * installment_amount / 10_000` USDC
//! across `pool_usdc_vault + escrow_balance`. Default bps is 9_160 →
//! 91.6%. This guarantees the recipient's credit can be paid out of
//! month-1 collections alone, with Week-1 attrition budgeted in.
//!
//! The floor is floor-rounded (via `apply_bps`) and the comparison is
//! inclusive (`>=`), so exactly-at-floor is accepted.

use crate::bps::apply_bps;
use crate::error::MathError;

/// Required USDC floor (in base units) for the cycle-0 payout.
///
/// Returns `members_target * installment * seed_draw_bps / 10_000` with
/// floor rounding. `u128` intermediate survives the `u64::MAX` extreme.
#[inline]
pub fn seed_draw_floor(
    members_target: u8,
    installment_amount: u64,
    seed_draw_bps: u16,
) -> Result<u64, MathError> {
    let max_month1 = (members_target as u128)
        .checked_mul(installment_amount as u128)
        .and_then(|v| u64::try_from(v).ok())
        .ok_or(MathError::Overflow)?;
    apply_bps(max_month1, seed_draw_bps)
}

/// `true` iff retained balance (vault + escrow) satisfies the seed-draw
/// floor for this pool.
#[inline]
pub fn retained_meets_seed_draw(
    members_target: u8,
    installment_amount: u64,
    seed_draw_bps: u16,
    retained_balance: u64,
) -> Result<bool, MathError> {
    let floor = seed_draw_floor(members_target, installment_amount, seed_draw_bps)?;
    Ok(retained_balance >= floor)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MEMBERS: u8 = 24;
    const INST: u64 = 416_000_000;
    const BPS: u16 = 9_160;
    const MAX_M1: u64 = 9_984_000_000;
    const FLOOR_91_6: u64 = 9_984_000_000u64 * 9_160 / 10_000;

    #[test]
    fn floor_matches_whitepaper_reference() {
        let floor = seed_draw_floor(MEMBERS, INST, BPS).unwrap();
        assert_eq!(floor, 9_145_344_000);
        assert_eq!(FLOOR_91_6, 9_145_344_000);
    }

    #[test]
    fn retained_exactly_at_floor_passes() {
        let floor = seed_draw_floor(MEMBERS, INST, BPS).unwrap();
        assert!(retained_meets_seed_draw(MEMBERS, INST, BPS, floor).unwrap());
    }

    #[test]
    fn retained_one_below_floor_fails() {
        let floor = seed_draw_floor(MEMBERS, INST, BPS).unwrap();
        assert!(!retained_meets_seed_draw(MEMBERS, INST, BPS, floor - 1).unwrap());
    }

    #[test]
    fn retained_one_above_floor_passes() {
        let floor = seed_draw_floor(MEMBERS, INST, BPS).unwrap();
        assert!(retained_meets_seed_draw(MEMBERS, INST, BPS, floor + 1).unwrap());
    }

    #[test]
    fn retained_full_max_passes() {
        assert!(retained_meets_seed_draw(MEMBERS, INST, BPS, MAX_M1).unwrap());
    }

    #[test]
    fn retained_zero_fails() {
        assert!(!retained_meets_seed_draw(MEMBERS, INST, BPS, 0).unwrap());
    }

    #[test]
    fn bps_zero_floor_is_zero() {
        assert_eq!(seed_draw_floor(MEMBERS, INST, 0).unwrap(), 0);
        assert!(retained_meets_seed_draw(MEMBERS, INST, 0, 0).unwrap());
    }

    #[test]
    fn bps_ten_thousand_requires_full_max() {
        assert_eq!(seed_draw_floor(MEMBERS, INST, 10_000).unwrap(), MAX_M1);
        assert!(retained_meets_seed_draw(MEMBERS, INST, 10_000, MAX_M1).unwrap());
        assert!(!retained_meets_seed_draw(MEMBERS, INST, 10_000, MAX_M1 - 1).unwrap());
    }

    #[test]
    fn members_zero_floor_is_zero() {
        assert_eq!(seed_draw_floor(0, INST, BPS).unwrap(), 0);
    }

    #[test]
    fn single_member_single_unit_rounds_down() {
        assert_eq!(seed_draw_floor(1, 1, BPS).unwrap(), 0);
        assert!(retained_meets_seed_draw(1, 1, BPS, 0).unwrap());
    }

    #[test]
    fn overflow_when_max_month1_exceeds_u64() {
        assert!(seed_draw_floor(u8::MAX, u64::MAX, BPS).is_err());
    }

    #[test]
    fn retained_boundary_sweep_around_floor() {
        let floor = seed_draw_floor(MEMBERS, INST, BPS).unwrap();
        for delta in 1..=10u64 {
            assert!(
                !retained_meets_seed_draw(MEMBERS, INST, BPS, floor - delta).unwrap(),
                "expected fail at floor - {delta}",
            );
            assert!(
                retained_meets_seed_draw(MEMBERS, INST, BPS, floor + delta).unwrap(),
                "expected pass at floor + {delta}",
            );
        }
    }
}
