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

/// Pool viability check — **SEV-031 runtime guard**.
///
/// A pool is viable when the per-cycle pool float (member contributions
/// minus solidarity routing and escrow withholding) is at least the
/// credit amount due to each cycle's recipient. If the math doesn't
/// close, cycle-0 `claim_payout` always fails the Seed Draw retention
/// guard and the pool traps member contributions in the vaults until
/// the authority manually winds the pool down.
///
/// SEV-025 (W2) bumped the protocol defaults to satisfy this invariant;
/// SEV-031 (W3) lifts the same invariant into `create_pool` runtime so
/// custom pool args are also gated.
///
/// Formula:
///   pool_float = members × installment × (MAX_BPS − solidarity − escrow)
///              / MAX_BPS
///   viable ⇔ pool_float ≥ credit
///
/// Returns:
///   - `Ok(true)` if the pool would be viable
///   - `Ok(false)` if the math closes but the float is below credit
///   - `Err(InvalidPoolParams)` if `solidarity + escrow > MAX_BPS` (the
///     pool is trivially inviable; treat as bad args)
#[inline]
pub fn pool_is_viable(
    members_target: u8,
    installment_amount: u64,
    credit_amount: u64,
    solidarity_bps: u16,
    escrow_release_bps: u16,
) -> Result<bool, MathError> {
    let max_bps = crate::constants::MAX_BPS as u32;
    let retention = max_bps
        .checked_sub(solidarity_bps as u32)
        .and_then(|x| x.checked_sub(escrow_release_bps as u32))
        .ok_or(MathError::InvalidPoolParams)?;
    let pool_float = (members_target as u128)
        .checked_mul(installment_amount as u128)
        .ok_or(MathError::Overflow)?
        .checked_mul(retention as u128)
        .ok_or(MathError::Overflow)?
        .checked_div(max_bps as u128)
        .ok_or(MathError::Overflow)?;
    Ok(pool_float >= credit_amount as u128)
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

    // ─── SEV-031 viability check ────────────────────────────────────────

    /// Whitepaper default: 24 × 600 USDC × 0.74 = 10_656 ≥ 10_000 credit.
    /// Mirrors `programs/roundfi-core/src/constants.rs::pool_defaults_match_product_spec`.
    #[test]
    fn sev_031_protocol_defaults_are_viable() {
        let viable = pool_is_viable(
            24,            // members
            600_000_000,   // 600 USDC
            10_000_000_000, // 10_000 USDC credit
            100,           // 1% solidarity
            2_500,         // 25% escrow
        ).unwrap();
        assert!(viable, "protocol defaults must remain viable");
    }

    /// Pre-SEV-025 defaults: 24 × 416 USDC × 0.74 = 7388 < 10_000 credit.
    /// Test pins the failure case the W3 audit asked us to gate at runtime.
    #[test]
    fn sev_031_pre_sev_025_defaults_rejected_as_inviable() {
        let viable = pool_is_viable(
            24,
            416_000_000,    // old installment
            10_000_000_000,
            100,
            2_500,
        ).unwrap();
        assert!(!viable, "old (pre-SEV-025) defaults must now be rejected");
    }

    /// Single-member pool with 1 USDC installment cannot fund 1 USDC
    /// credit because solidarity + escrow take a slice.
    #[test]
    fn sev_031_tiny_pool_inviable() {
        let viable = pool_is_viable(1, 1_000_000, 1_000_000, 100, 2_500).unwrap();
        assert!(!viable);
    }

    /// Edge: zero installment is trivially inviable (no float).
    #[test]
    fn sev_031_zero_installment_inviable() {
        let viable = pool_is_viable(24, 0, 1, 100, 2_500).unwrap();
        assert!(!viable);
    }

    /// Edge: zero credit is trivially viable (any positive float clears it).
    #[test]
    fn sev_031_zero_credit_viable() {
        let viable = pool_is_viable(24, 600_000_000, 0, 100, 2_500).unwrap();
        assert!(viable);
    }

    /// solidarity + escrow > MAX_BPS would underflow — must error out.
    #[test]
    fn sev_031_underflow_rejected() {
        let result = pool_is_viable(24, 600_000_000, 10_000_000_000, 6_000, 6_000);
        assert!(result.is_err(), "underflow must surface as MathError::InvalidPoolParams");
    }

    /// Boundary: just-above-credit pool float is accepted.
    #[test]
    fn sev_031_just_above_credit_accepted() {
        // 1 member × 13_513 USDC × 0.74 ≈ 9_999.62 — round to integer.
        // Use exact match: members=1, installment=13_514_000_000 → float = 9_999.36 < 10_000
        // Try installment=13_513_514_000 → 0.74 × that = 9_999_900_360 < 10_000_000_000
        // Try installment=13_513_514_000 + epsilon: just make the test cover the >= boundary.
        // For simplicity, use the floor math directly:
        let credit = 10_000_000_000u64;
        let installment = 13_514_000_000u64; // > credit / 0.74
        let viable = pool_is_viable(1, installment, credit, 100, 2_500).unwrap();
        assert!(viable, "installment chosen to exceed credit / retention");
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
