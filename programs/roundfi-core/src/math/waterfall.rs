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

    #[test]
    fn order_matches_spec() {
        // 1_000 yield, GF can absorb all of it → nothing flows further.
        let w = waterfall(1_000, 1_000, 2_000, 5_000).unwrap();
        assert_eq!(w, Waterfall { guarantee_fund: 1_000, protocol_fee: 0, good_faith: 0, participants: 0 });
    }

    #[test]
    fn gf_partial_then_fee_then_bonus_then_residual() {
        // 10_000 yield, GF needs only 2_000.
        // after_gf = 8_000
        // fee 20% of 8_000 = 1_600; after_fee = 6_400
        // good_faith 50% of 6_400 = 3_200; participants = 3_200
        let w = waterfall(10_000, 2_000, 2_000, 5_000).unwrap();
        assert_eq!(w, Waterfall {
            guarantee_fund: 2_000,
            protocol_fee:   1_600,
            good_faith:     3_200,
            participants:   3_200,
        });
        assert_eq!(w.total().unwrap(), 10_000);
    }

    #[test]
    fn gf_full_cap_skipped() {
        // GF already at cap → everything flows to fee+bonus+participants.
        let w = waterfall(5_000, 0, 2_000, 5_000).unwrap();
        assert_eq!(w.guarantee_fund, 0);
        assert_eq!(w.protocol_fee,   1_000);  // 20% of 5_000
        assert_eq!(w.good_faith,     2_000);  // 50% of 4_000
        assert_eq!(w.participants,   2_000);
        assert_eq!(w.total().unwrap(), 5_000);
    }

    #[test]
    fn zero_yield_zero_splits() {
        let w = waterfall(0, 100, 2_000, 5_000).unwrap();
        assert_eq!(w, Waterfall::default());
    }

    #[test]
    fn conservation_holds_for_random_inputs() {
        for y in [1u64, 7, 12345, 999_999_999, u64::MAX / 4] {
            let w = waterfall(y, y / 3, 2_000, 5_000).unwrap();
            assert_eq!(w.total().unwrap(), y, "y={}", y);
        }
    }

    #[test]
    fn gf_cap_computes_150_percent() {
        // 1000 cumulative fees, 150% bps → cap = 1500
        assert_eq!(guarantee_fund_cap(1_000, 15_000).unwrap(), 1_500);
        assert_eq!(guarantee_fund_room(1_000, 400, 15_000).unwrap(), 1_100);
        assert_eq!(guarantee_fund_room(1_000, 1_500, 15_000).unwrap(), 0);
        assert_eq!(guarantee_fund_room(1_000, 2_000, 15_000).unwrap(), 0);
    }
}

impl Default for Waterfall {
    fn default() -> Self {
        Self { guarantee_fund: 0, protocol_fee: 0, good_faith: 0, participants: 0 }
    }
}
