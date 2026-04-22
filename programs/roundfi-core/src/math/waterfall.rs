//! Yield-waterfall computation (Step 4c).
//!
//! Strict payment order, locked by the user on 2026-04-22:
//!
//!   1. Guarantee Fund top-up  (FIRST — shock absorber funded before fees)
//!   2. Protocol fee            (fee_bps_yield on remaining)
//!   3. Good-faith bonus        (good_faith_share_bps on remaining)
//!   4. Participants            (residual, pro-rata by `claim_payout`)
//!
//! Invariant: `gf + protocol_fee + good_faith + participants == yield_amount`.
//! Reordering or skipping any step is a critical bug. Reject any result
//! that would leave a bucket mathematically negative (we saturate to
//! zero and push the remainder down the waterfall).

use anchor_lang::prelude::*;

use crate::error::RoundfiError;
use crate::math::apply_bps;

/// Result of a waterfall split. Every field is in USDC base units.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Waterfall {
    /// Step 1 — amount routed to the Guarantee Fund.
    pub guarantee_fund: u64,
    /// Step 2 — amount routed to `treasury`.
    pub protocol_fee:   u64,
    /// Step 3 — amount routed to the solidarity vault for on-time bonuses.
    pub good_faith:     u64,
    /// Step 4 — amount left in `pool_usdc_vault` for participants.
    pub participants:   u64,
}

impl Waterfall {
    /// Total distributed across all four buckets.
    pub fn total(&self) -> Option<u64> {
        self.guarantee_fund
            .checked_add(self.protocol_fee)?
            .checked_add(self.good_faith)?
            .checked_add(self.participants)
    }
}

/// Compute the waterfall for a harvested yield amount.
///
/// * `yield_amount`           – total USDC realized by `harvest()`.
/// * `gf_target_remaining`    – how much the GF can still absorb before
///                               it hits its cap. Caller computes
///                               `cap - current_balance` and clamps to 0.
/// * `protocol_fee_bps`       – `config.fee_bps_yield` (default 2000).
/// * `good_faith_share_bps`   – share of the post-fee residual that goes
///                               to solidarity. Default 5000 (50%).
pub fn waterfall(
    yield_amount: u64,
    gf_target_remaining: u64,
    protocol_fee_bps: u16,
    good_faith_share_bps: u16,
) -> Result<Waterfall> {
    // ─── Step 1: Guarantee Fund top-up (FIRST) ──────────────────────────
    let gf = yield_amount.min(gf_target_remaining);
    let after_gf = yield_amount
        .checked_sub(gf)
        .ok_or(error!(RoundfiError::WaterfallUnderflow))?;

    // ─── Step 2: Protocol fee (20% of remainder) ────────────────────────
    let protocol_fee = apply_bps(after_gf, protocol_fee_bps)?;
    let after_fee = after_gf
        .checked_sub(protocol_fee)
        .ok_or(error!(RoundfiError::WaterfallUnderflow))?;

    // ─── Step 3: Good-faith bonus share ─────────────────────────────────
    let good_faith = apply_bps(after_fee, good_faith_share_bps)?;
    let participants = after_fee
        .checked_sub(good_faith)
        .ok_or(error!(RoundfiError::WaterfallUnderflow))?;

    let result = Waterfall {
        guarantee_fund: gf,
        protocol_fee,
        good_faith,
        participants,
    };

    // ─── Conservation check ─────────────────────────────────────────────
    let total = result.total().ok_or(error!(RoundfiError::MathOverflow))?;
    require!(total == yield_amount, RoundfiError::WaterfallNotConserved);

    Ok(result)
}

/// Cap on how much can sit in the Guarantee Fund.
/// `cap = min(guarantee_fund_bps * total_protocol_fee_accrued / 10_000, u64::MAX)`.
/// Default bps is 15_000 (150% of fees).
pub fn guarantee_fund_cap(
    total_protocol_fee_accrued: u64,
    guarantee_fund_bps: u16,
) -> Result<u64> {
    // bps can exceed 10_000 here (default 15_000 = 150%).
    let numerator = (total_protocol_fee_accrued as u128)
        .checked_mul(guarantee_fund_bps as u128)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    let cap = numerator
        .checked_div(10_000u128)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    u64::try_from(cap).map_err(|_| error!(RoundfiError::MathOverflow))
}

/// How much room the GF has before hitting its cap.
/// Returns 0 if the fund is already at-or-above the cap.
pub fn guarantee_fund_room(
    total_protocol_fee_accrued: u64,
    current_gf_balance: u64,
    guarantee_fund_bps: u16,
) -> Result<u64> {
    let cap = guarantee_fund_cap(total_protocol_fee_accrued, guarantee_fund_bps)?;
    Ok(cap.saturating_sub(current_gf_balance))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Default protocol values locked in Step 4c.
    const FEE_BPS:        u16 = 2_000;  // 20%
    const GOOD_FAITH_BPS: u16 = 5_000;  // 50% of post-fee residual

    // ─── Ordering invariant ─────────────────────────────────────────────

    #[test]
    fn order_gf_first_swallows_small_yield() {
        // Any yield below the GF's remaining room goes entirely to GF.
        // If the fee step ever ran first, participants would receive a
        // non-zero slice here.
        let w = waterfall(1_000, 1_000, FEE_BPS, GOOD_FAITH_BPS).unwrap();
        assert_eq!(w, Waterfall {
            guarantee_fund: 1_000, protocol_fee: 0, good_faith: 0, participants: 0,
        });
    }

    #[test]
    fn order_gf_partial_then_fee_then_good_faith_then_participants() {
        // 10_000 yield, GF absorbs 2_000.
        //   after_gf = 8_000
        //   fee 20%     → 1_600; after_fee = 6_400
        //   good_faith 50% of 6_400 → 3_200
        //   participants = 3_200
        let w = waterfall(10_000, 2_000, FEE_BPS, GOOD_FAITH_BPS).unwrap();
        assert_eq!(w, Waterfall {
            guarantee_fund: 2_000,
            protocol_fee:   1_600,
            good_faith:     3_200,
            participants:   3_200,
        });
        assert_eq!(w.total().unwrap(), 10_000);
    }

    #[test]
    fn order_gf_empty_cap_skipped_to_fee_first() {
        // GF already at cap → GF=0, fee takes from full yield.
        let w = waterfall(5_000, 0, FEE_BPS, GOOD_FAITH_BPS).unwrap();
        assert_eq!(w.guarantee_fund, 0);
        assert_eq!(w.protocol_fee,   1_000);  // 20% of 5_000
        assert_eq!(w.good_faith,     2_000);  // 50% of 4_000
        assert_eq!(w.participants,   2_000);
        assert_eq!(w.total().unwrap(), 5_000);
    }

    #[test]
    fn order_reordering_would_produce_different_splits() {
        // This is the "ordering sentinel": the spec order GF→Fee→GoodFaith→
        // Participants must produce the unique canonical split below.
        // Any reordering (Fee first, GoodFaith first, etc.) would deliver
        // materially different GF or participant amounts.
        let w = waterfall(10_000, 2_000, FEE_BPS, GOOD_FAITH_BPS).unwrap();

        // If fee ran first (on 10_000, not 8_000), fee would be 2_000 not 1_600.
        let fee_if_ran_first = 10_000u64 * FEE_BPS as u64 / 10_000;
        assert_eq!(fee_if_ran_first, 2_000);
        assert_ne!(w.protocol_fee, fee_if_ran_first);

        // If good_faith ran first (on 10_000, not 6_400), it'd be 5_000.
        let gf_bonus_if_ran_first = 10_000u64 * GOOD_FAITH_BPS as u64 / 10_000;
        assert_eq!(gf_bonus_if_ran_first, 5_000);
        assert_ne!(w.good_faith, gf_bonus_if_ran_first);
    }

    // ─── Conservation invariant (total bucketed == yield) ───────────────

    #[test]
    fn conservation_zero_yield() {
        let w = waterfall(0, 100, FEE_BPS, GOOD_FAITH_BPS).unwrap();
        assert_eq!(w, Waterfall::default());
        assert_eq!(w.total().unwrap(), 0);
    }

    #[test]
    fn conservation_single_unit() {
        // Smallest non-zero yield. GF room=0 → 1 unit flows to fee path.
        // fee = floor(1 * 2_000 / 10_000) = 0; after_fee = 1.
        // good_faith = floor(1 * 5_000 / 10_000) = 0; participants = 1.
        let w = waterfall(1, 0, FEE_BPS, GOOD_FAITH_BPS).unwrap();
        assert_eq!(w.guarantee_fund, 0);
        assert_eq!(w.protocol_fee,   0);
        assert_eq!(w.good_faith,     0);
        assert_eq!(w.participants,   1);
        assert_eq!(w.total().unwrap(), 1);
    }

    #[test]
    fn conservation_holds_across_wide_input_grid() {
        // Every combination: yield × gf_room × fee_bps × good_faith_bps.
        let yields     = [0u64, 1, 7, 12_345, 999_999_999, u64::MAX / 4];
        let gf_rooms   = [0u64, 1, 1_000, u64::MAX];
        let fee_bpses  = [0u16, 1, 2_000, 10_000];
        let good_bpses = [0u16, 1, 5_000, 10_000];
        for y in yields {
            for gf in gf_rooms {
                for fbps in fee_bpses {
                    for gbps in good_bpses {
                        let w = waterfall(y, gf, fbps, gbps).unwrap();
                        assert_eq!(
                            w.total().unwrap(), y,
                            "conservation broken: y={y} gf={gf} fbps={fbps} gbps={gbps}",
                        );
                        // Strict ordering consequence: GF can only absorb up to gf_room.
                        assert!(w.guarantee_fund <= gf, "GF exceeded room");
                        // And never more than yield itself.
                        assert!(w.guarantee_fund <= y, "GF exceeded yield");
                    }
                }
            }
        }
    }

    // ─── Extreme bps settings ───────────────────────────────────────────

    #[test]
    fn fee_bps_zero_leaves_everything_for_good_faith_and_participants() {
        let w = waterfall(1_000, 0, 0, GOOD_FAITH_BPS).unwrap();
        assert_eq!(w.guarantee_fund, 0);
        assert_eq!(w.protocol_fee,   0);
        assert_eq!(w.good_faith,     500);
        assert_eq!(w.participants,   500);
    }

    #[test]
    fn fee_bps_full_leaves_nothing_downstream() {
        let w = waterfall(1_000, 0, 10_000, GOOD_FAITH_BPS).unwrap();
        assert_eq!(w.protocol_fee, 1_000);
        assert_eq!(w.good_faith,   0);
        assert_eq!(w.participants, 0);
        assert_eq!(w.total().unwrap(), 1_000);
    }

    #[test]
    fn good_faith_bps_full_leaves_nothing_for_participants() {
        let w = waterfall(1_000, 0, FEE_BPS, 10_000).unwrap();
        assert_eq!(w.protocol_fee, 200);
        assert_eq!(w.good_faith,   800);
        assert_eq!(w.participants, 0);
    }

    #[test]
    fn good_faith_bps_zero_routes_full_residual_to_participants() {
        let w = waterfall(1_000, 0, FEE_BPS, 0).unwrap();
        assert_eq!(w.protocol_fee, 200);
        assert_eq!(w.good_faith,   0);
        assert_eq!(w.participants, 800);
    }

    // ─── GF cap helpers ─────────────────────────────────────────────────

    #[test]
    fn gf_cap_matches_150_percent_default() {
        // Default DEFAULT_GUARANTEE_FUND_BPS = 15_000 → 150% of fees.
        assert_eq!(guarantee_fund_cap(1_000, 15_000).unwrap(), 1_500);
        assert_eq!(guarantee_fund_cap(0,     15_000).unwrap(), 0);
        // 200% cap (25_000 bps) is allowed at the math layer — the
        // governance layer in config rejects anything > 50_000.
        assert_eq!(guarantee_fund_cap(1_000, 25_000).unwrap(), 2_500);
    }

    #[test]
    fn gf_room_clamps_at_zero_when_over_cap() {
        assert_eq!(guarantee_fund_room(1_000, 400,   15_000).unwrap(), 1_100);
        assert_eq!(guarantee_fund_room(1_000, 1_500, 15_000).unwrap(), 0);
        assert_eq!(guarantee_fund_room(1_000, 2_000, 15_000).unwrap(), 0);
    }

    #[test]
    fn gf_cap_overflow_rejected_cleanly() {
        // u64::MAX * 50_000 overflows u128 only when the fee accrued side
        // equals u64::MAX; bps side caps at u16::MAX. Both factors are
        // bounded so the computed u128 fits; what breaks is the final
        // u64::try_from when the ratio exceeds u64::MAX.
        assert!(guarantee_fund_cap(u64::MAX, 15_000).is_err());
    }

    // ─── Waterfall::total overflow safety ───────────────────────────────

    #[test]
    fn total_reports_none_on_overflow_combination() {
        // Manually constructed bogus state that couldn't come from
        // waterfall() itself but guards against refactors.
        let w = Waterfall {
            guarantee_fund: u64::MAX,
            protocol_fee:   1,
            good_faith:     0,
            participants:   0,
        };
        assert_eq!(w.total(), None);
    }
}

impl Default for Waterfall {
    fn default() -> Self {
        Self { guarantee_fund: 0, protocol_fee: 0, good_faith: 0, participants: 0 }
    }
}
