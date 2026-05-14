//! Yield-waterfall computation (PDF-canonical order, v1.1).
//!
//! Strict payment order locked by the canonical PDFs:
//!
//! 1. Protocol fee — `fee_bps_yield` on gross
//! 2. Guarantee Fund top-up — capped at 150% of credit; absorbs from
//!    the post-fee residual
//! 3. LP / Liquidity Angels — `lp_share_bps` of the residual after fee+GF
//! 4. Participants — residual
//!
//! Invariant: `protocol_fee + gf + lp_share + participants == yield_amount`.

use crate::bps::apply_bps;
use crate::error::MathError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Waterfall {
    pub protocol_fee: u64,
    pub guarantee_fund: u64,
    pub lp_share: u64,
    pub participants: u64,
}

impl Waterfall {
    pub fn total(&self) -> Option<u64> {
        self.protocol_fee
            .checked_add(self.guarantee_fund)?
            .checked_add(self.lp_share)?
            .checked_add(self.participants)
    }
}

pub fn waterfall(
    yield_amount: u64,
    gf_target_remaining: u64,
    protocol_fee_bps: u16,
    lp_share_bps: u16,
) -> Result<Waterfall, MathError> {
    let protocol_fee = apply_bps(yield_amount, protocol_fee_bps)?;
    let after_fee = yield_amount.checked_sub(protocol_fee).ok_or(MathError::WaterfallUnderflow)?;

    let gf = after_fee.min(gf_target_remaining);
    let after_gf = after_fee.checked_sub(gf).ok_or(MathError::WaterfallUnderflow)?;

    let lp_share = apply_bps(after_gf, lp_share_bps)?;
    let participants = after_gf.checked_sub(lp_share).ok_or(MathError::WaterfallUnderflow)?;

    let result = Waterfall { protocol_fee, guarantee_fund: gf, lp_share, participants };

    let total = result.total().ok_or(MathError::Overflow)?;
    if total != yield_amount {
        return Err(MathError::WaterfallNotConserved);
    }

    Ok(result)
}

/// Cap on how much can sit in the Guarantee Fund.
pub fn guarantee_fund_cap(
    total_protocol_fee_accrued: u64,
    guarantee_fund_bps: u16,
) -> Result<u64, MathError> {
    let numerator = (total_protocol_fee_accrued as u128)
        .checked_mul(guarantee_fund_bps as u128)
        .ok_or(MathError::Overflow)?;
    let cap = numerator.checked_div(10_000u128).ok_or(MathError::Overflow)?;
    u64::try_from(cap).map_err(|_| MathError::Overflow)
}

/// How much room the GF has before hitting its cap.
///
/// Returns 0 if the fund is already at-or-above the cap (saturating
/// clamp). Note: the on-chain version emits a `msg!()` warning when
/// `current > cap`; this pure-Rust version is silent — callers in
/// `programs/roundfi-core` wrap with their own logging at the boundary.
pub fn guarantee_fund_room(
    total_protocol_fee_accrued: u64,
    current_gf_balance: u64,
    guarantee_fund_bps: u16,
) -> Result<u64, MathError> {
    let cap = guarantee_fund_cap(total_protocol_fee_accrued, guarantee_fund_bps)?;
    Ok(cap.saturating_sub(current_gf_balance))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEE_BPS: u16 = 2_000;
    const LP_SHARE_BPS: u16 = 6_500;

    #[test]
    fn fee_runs_first_on_gross_amount() {
        let w = waterfall(10_000, 0, FEE_BPS, LP_SHARE_BPS).unwrap();
        assert_eq!(
            w,
            Waterfall {
                protocol_fee: 2_000,
                guarantee_fund: 0,
                lp_share: 5_200,
                participants: 2_800,
            }
        );
        assert_eq!(w.total().unwrap(), 10_000);
    }

    #[test]
    fn gf_takes_from_post_fee_residual() {
        let w = waterfall(10_000, 5_000, FEE_BPS, LP_SHARE_BPS).unwrap();
        assert_eq!(
            w,
            Waterfall {
                protocol_fee: 2_000,
                guarantee_fund: 5_000,
                lp_share: 1_950,
                participants: 1_050,
            }
        );
        assert_eq!(w.total().unwrap(), 10_000);
    }

    #[test]
    fn conservation_zero_yield() {
        let w = waterfall(0, 100, FEE_BPS, LP_SHARE_BPS).unwrap();
        assert_eq!(w, Waterfall::default());
        assert_eq!(w.total().unwrap(), 0);
    }

    #[test]
    fn conservation_single_unit() {
        let w = waterfall(1, 0, FEE_BPS, LP_SHARE_BPS).unwrap();
        assert_eq!(w.protocol_fee, 0);
        assert_eq!(w.participants, 1);
        assert_eq!(w.total().unwrap(), 1);
    }

    #[test]
    fn fee_bps_full_leaves_nothing_downstream() {
        let w = waterfall(1_000, 500, 10_000, LP_SHARE_BPS).unwrap();
        assert_eq!(w.protocol_fee, 1_000);
        assert_eq!(w.guarantee_fund, 0);
        assert_eq!(w.lp_share, 0);
        assert_eq!(w.participants, 0);
    }

    #[test]
    fn gf_cap_matches_150_percent_default() {
        assert_eq!(guarantee_fund_cap(1_000, 15_000).unwrap(), 1_500);
        assert_eq!(guarantee_fund_cap(0, 15_000).unwrap(), 0);
        assert_eq!(guarantee_fund_cap(1_000, 25_000).unwrap(), 2_500);
    }

    #[test]
    fn gf_room_clamps_at_zero_when_over_cap() {
        assert_eq!(guarantee_fund_room(1_000, 400, 15_000).unwrap(), 1_100);
        assert_eq!(guarantee_fund_room(1_000, 1_500, 15_000).unwrap(), 0);
        assert_eq!(guarantee_fund_room(1_000, 2_000, 15_000).unwrap(), 0);
    }

    #[test]
    fn gf_cap_overflow_rejected_cleanly() {
        assert!(guarantee_fund_cap(u64::MAX, 15_000).is_err());
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    fn safe_yield() -> impl Strategy<Value = u64> { 0u64..=(u64::MAX / 4) }
    fn safe_gf_room() -> impl Strategy<Value = u64> { 0u64..=(u64::MAX / 4) }
    fn fee_bps_strat() -> impl Strategy<Value = u16> { 0u16..=10_000 }
    fn lp_bps_strat() -> impl Strategy<Value = u16> { 0u16..=10_000 }
    fn gf_bps_strat() -> impl Strategy<Value = u16> { 0u16..=50_000 }

    proptest! {
        #[test]
        fn p_conservation(
            y in safe_yield(),
            gf in safe_gf_room(),
            fbps in fee_bps_strat(),
            lbps in lp_bps_strat(),
        ) {
            let w = waterfall(y, gf, fbps, lbps).unwrap();
            prop_assert_eq!(w.total().unwrap(), y);
        }

        #[test]
        fn p_gf_respects_caps(
            y in safe_yield(),
            gf in safe_gf_room(),
            fbps in fee_bps_strat(),
            lbps in lp_bps_strat(),
        ) {
            let w = waterfall(y, gf, fbps, lbps).unwrap();
            prop_assert!(w.guarantee_fund <= gf);
            prop_assert!(w.guarantee_fund <= y);
            prop_assert!(w.guarantee_fund <= y - w.protocol_fee);
        }

        #[test]
        fn p_no_bucket_exceeds_yield(
            y in safe_yield(),
            gf in safe_gf_room(),
            fbps in fee_bps_strat(),
            lbps in lp_bps_strat(),
        ) {
            let w = waterfall(y, gf, fbps, lbps).unwrap();
            prop_assert!(w.protocol_fee <= y);
            prop_assert!(w.guarantee_fund <= y);
            prop_assert!(w.lp_share <= y);
            prop_assert!(w.participants <= y);
        }

        #[test]
        fn p_fee_on_gross(
            y in safe_yield(),
            gf in safe_gf_room(),
            fbps in fee_bps_strat(),
            lbps in lp_bps_strat(),
        ) {
            let w = waterfall(y, gf, fbps, lbps).unwrap();
            let expected_fee = ((y as u128) * (fbps as u128) / 10_000u128) as u64;
            prop_assert_eq!(w.protocol_fee, expected_fee);
        }

        #[test]
        fn p_participants_monotonic_in_yield(
            y1 in 0u64..=(u64::MAX / 8),
            extra in 0u64..=1_000_000_000u64,
            gf in safe_gf_room(),
            fbps in fee_bps_strat(),
            lbps in lp_bps_strat(),
        ) {
            let y2 = y1.saturating_add(extra);
            let w1 = waterfall(y1, gf, fbps, lbps).unwrap();
            let w2 = waterfall(y2, gf, fbps, lbps).unwrap();
            prop_assert!(w2.participants >= w1.participants);
        }

        #[test]
        fn p_gf_room_saturates(
            total_fee in 0u64..(u64::MAX / 2),
            current in 0u64..(u64::MAX / 2),
            gf_bps in gf_bps_strat(),
        ) {
            if let Ok(cap) = guarantee_fund_cap(total_fee, gf_bps) {
                let room = guarantee_fund_room(total_fee, current, gf_bps).unwrap();
                if current >= cap {
                    prop_assert_eq!(room, 0);
                } else {
                    prop_assert_eq!(room, cap - current);
                }
            }
        }
    }
}
