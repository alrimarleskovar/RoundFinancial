//! Yield-waterfall computation (PDF-canonical order, v1.1 of the
//! whitepaper / pitch deck / `docs/yield-and-guarantee-fund.md`).
//!
//! Strict payment order locked by the canonical PDFs:
//!
//!   1. Protocol fee           (fee_bps_yield on gross — primary revenue
//!                              from Phase 1 of the B2B plan)
//!   2. Guarantee Fund top-up  (capped at 150% of credit; absorbs from
//!                              the post-fee residual)
//!   3. LP / Liquidity Angels  (lp_share_bps of the residual after fee+GF;
//!                              the upside slice for external float
//!                              providers — Anjos de Liquidez)
//!   4. Participants           ("prêmio de paciência" — residual, pro-rata
//!                              by `claim_payout`)
//!
//! Invariant: `protocol_fee + gf + lp_share + participants == yield_amount`.
//! Reordering or skipping any step is a critical bug. Reject any result
//! that would leave a bucket mathematically negative (we saturate to
//! zero and push the remainder down the waterfall).
//!
//! Note on Cofre Solidário: it is funded ONLY from the 1% das parcelas
//! routing inside `contribute()` / `pay_installment()` — NOT from the
//! yield waterfall. Don't conflate the two; the v1.0 Rust code did, and
//! v1.1 (this file) corrects it by routing the `lp_share` slice to a
//! dedicated `lp_distribution_balance` earmark on the Pool.

use anchor_lang::prelude::*;

use crate::error::RoundfiError;
use crate::math::apply_bps;

/// Result of a waterfall split. Every field is in USDC base units.
/// Field order matches the execution order so `cargo fmt` keeps the
/// struct legible as documentation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Waterfall {
    /// Step 1 — amount routed to `treasury` (protocol fee).
    pub protocol_fee:   u64,
    /// Step 2 — amount routed to the Guarantee Fund.
    pub guarantee_fund: u64,
    /// Step 3 — amount earmarked for LPs / Anjos de Liquidez.
    pub lp_share:       u64,
    /// Step 4 — amount left in `pool_usdc_vault` for participants.
    pub participants:   u64,
}

impl Waterfall {
    /// Total distributed across all four buckets.
    pub fn total(&self) -> Option<u64> {
        self.protocol_fee
            .checked_add(self.guarantee_fund)?
            .checked_add(self.lp_share)?
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
/// * `lp_share_bps`           – share of the post-fee-and-GF residual
///                               that goes to LPs. Default 6500 (65%).
pub fn waterfall(
    yield_amount: u64,
    gf_target_remaining: u64,
    protocol_fee_bps: u16,
    lp_share_bps: u16,
) -> Result<Waterfall> {
    // ─── Step 1: Protocol fee (FIRST — on gross) ────────────────────────
    let protocol_fee = apply_bps(yield_amount, protocol_fee_bps)?;
    let after_fee = yield_amount
        .checked_sub(protocol_fee)
        .ok_or(error!(RoundfiError::WaterfallUnderflow))?;

    // ─── Step 2: Guarantee Fund top-up (cap-bound) ──────────────────────
    let gf = after_fee.min(gf_target_remaining);
    let after_gf = after_fee
        .checked_sub(gf)
        .ok_or(error!(RoundfiError::WaterfallUnderflow))?;

    // ─── Step 3: LP / Liquidity Angels share ────────────────────────────
    let lp_share = apply_bps(after_gf, lp_share_bps)?;
    let participants = after_gf
        .checked_sub(lp_share)
        .ok_or(error!(RoundfiError::WaterfallUnderflow))?;

    let result = Waterfall {
        protocol_fee,
        guarantee_fund: gf,
        lp_share,
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

    // Default protocol values — PDF-canonical (v1.1).
    const FEE_BPS:      u16 = 2_000;  // 20% protocol fee on gross
    const LP_SHARE_BPS: u16 = 6_500;  // 65% of post-fee-and-GF residual

    // ─── Ordering invariant ─────────────────────────────────────────────

    #[test]
    fn fee_runs_first_on_gross_amount() {
        // 10_000 yield, 0 GF room, 65% LP share.
        //   fee 20% of 10_000 = 2_000; after_fee = 8_000
        //   gf = 0; after_gf = 8_000
        //   lp = 65% of 8_000 = 5_200; participants = 2_800
        let w = waterfall(10_000, 0, FEE_BPS, LP_SHARE_BPS).unwrap();
        assert_eq!(w, Waterfall {
            protocol_fee:   2_000,
            guarantee_fund: 0,
            lp_share:       5_200,
            participants:   2_800,
        });
        assert_eq!(w.total().unwrap(), 10_000);
    }

    #[test]
    fn gf_takes_from_post_fee_residual() {
        // 10_000 yield, GF can absorb 5_000.
        //   fee 20% of 10_000 = 2_000; after_fee = 8_000
        //   gf = min(5_000, 8_000) = 5_000; after_gf = 3_000
        //   lp = 65% of 3_000 = 1_950; participants = 1_050
        let w = waterfall(10_000, 5_000, FEE_BPS, LP_SHARE_BPS).unwrap();
        assert_eq!(w, Waterfall {
            protocol_fee:   2_000,
            guarantee_fund: 5_000,
            lp_share:       1_950,
            participants:   1_050,
        });
        assert_eq!(w.total().unwrap(), 10_000);
    }

    #[test]
    fn small_yield_under_gf_room_still_pays_fee_first() {
        // 1_000 yield, GF room 5_000.
        //   fee = 200; after_fee = 800
        //   gf = min(5_000, 800) = 800; after_gf = 0
        //   lp = 0; participants = 0
        let w = waterfall(1_000, 5_000, FEE_BPS, LP_SHARE_BPS).unwrap();
        assert_eq!(w, Waterfall {
            protocol_fee:   200,
            guarantee_fund: 800,
            lp_share:       0,
            participants:   0,
        });
    }

    #[test]
    fn order_reordering_would_produce_different_splits() {
        // Ordering sentinel: spec says fee runs FIRST on the gross
        // amount. If GF ran first (old v1.0 order), fee would be
        // computed on a smaller base and the user would get different
        // splits.
        let w = waterfall(10_000, 2_000, FEE_BPS, LP_SHARE_BPS).unwrap();

        // PDF-canonical: fee runs first on full 10_000 → 2_000.
        assert_eq!(w.protocol_fee, 2_000);

        // Old v1.0 (GF-first): fee would have run on 8_000 → 1_600.
        let v1_fee_if_gf_first = (10_000u64 - 2_000u64) * FEE_BPS as u64 / 10_000;
        assert_eq!(v1_fee_if_gf_first, 1_600);
        assert_ne!(w.protocol_fee, v1_fee_if_gf_first);
    }

    // ─── Conservation invariant (total bucketed == yield) ───────────────

    #[test]
    fn conservation_zero_yield() {
        let w = waterfall(0, 100, FEE_BPS, LP_SHARE_BPS).unwrap();
        assert_eq!(w, Waterfall::default());
        assert_eq!(w.total().unwrap(), 0);
    }

    #[test]
    fn conservation_single_unit() {
        // Smallest non-zero yield. fee = floor(1 * 2_000 / 10_000) = 0;
        // after_fee = 1. gf room 0 → gf = 0; after_gf = 1.
        // lp = floor(1 * 6_500 / 10_000) = 0; participants = 1.
        let w = waterfall(1, 0, FEE_BPS, LP_SHARE_BPS).unwrap();
        assert_eq!(w.protocol_fee,   0);
        assert_eq!(w.guarantee_fund, 0);
        assert_eq!(w.lp_share,       0);
        assert_eq!(w.participants,   1);
        assert_eq!(w.total().unwrap(), 1);
    }

    #[test]
    fn conservation_holds_across_wide_input_grid() {
        // Every combination: yield × gf_room × fee_bps × lp_share_bps.
        let yields    = [0u64, 1, 7, 12_345, 999_999_999, u64::MAX / 4];
        let gf_rooms  = [0u64, 1, 1_000, u64::MAX];
        let fee_bpses = [0u16, 1, 2_000, 10_000];
        let lp_bpses  = [0u16, 1, 6_500, 10_000];
        for y in yields {
            for gf in gf_rooms {
                for fbps in fee_bpses {
                    for lbps in lp_bpses {
                        let w = waterfall(y, gf, fbps, lbps).unwrap();
                        assert_eq!(
                            w.total().unwrap(), y,
                            "conservation broken: y={y} gf={gf} fbps={fbps} lbps={lbps}",
                        );
                        // GF can only absorb up to gf_room or whatever
                        // remains after fee, whichever is smaller.
                        assert!(w.guarantee_fund <= gf, "GF exceeded room");
                        // And never more than yield itself.
                        assert!(w.guarantee_fund <= y, "GF exceeded yield");
                        // Fee runs on gross so it cannot exceed yield.
                        assert!(w.protocol_fee <= y, "fee exceeded yield");
                    }
                }
            }
        }
    }

    // ─── Extreme bps settings ───────────────────────────────────────────

    #[test]
    fn fee_bps_zero_routes_full_amount_through_gf_lp_participants() {
        let w = waterfall(1_000, 0, 0, LP_SHARE_BPS).unwrap();
        assert_eq!(w.protocol_fee,   0);
        assert_eq!(w.guarantee_fund, 0);
        assert_eq!(w.lp_share,       650);
        assert_eq!(w.participants,   350);
    }

    #[test]
    fn fee_bps_full_leaves_nothing_downstream() {
        let w = waterfall(1_000, 500, 10_000, LP_SHARE_BPS).unwrap();
        assert_eq!(w.protocol_fee,   1_000);
        assert_eq!(w.guarantee_fund, 0);
        assert_eq!(w.lp_share,       0);
        assert_eq!(w.participants,   0);
        assert_eq!(w.total().unwrap(), 1_000);
    }

    #[test]
    fn lp_share_bps_full_leaves_nothing_for_participants() {
        let w = waterfall(1_000, 0, FEE_BPS, 10_000).unwrap();
        assert_eq!(w.protocol_fee,   200);
        assert_eq!(w.guarantee_fund, 0);
        assert_eq!(w.lp_share,       800);
        assert_eq!(w.participants,   0);
    }

    #[test]
    fn lp_share_bps_zero_routes_full_residual_to_participants() {
        let w = waterfall(1_000, 0, FEE_BPS, 0).unwrap();
        assert_eq!(w.protocol_fee,   200);
        assert_eq!(w.guarantee_fund, 0);
        assert_eq!(w.lp_share,       0);
        assert_eq!(w.participants,   800);
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
            protocol_fee:   u64::MAX,
            guarantee_fund: 1,
            lp_share:       0,
            participants:   0,
        };
        assert_eq!(w.total(), None);
    }
}

impl Default for Waterfall {
    fn default() -> Self {
        Self { protocol_fee: 0, guarantee_fund: 0, lp_share: 0, participants: 0 }
    }
}
