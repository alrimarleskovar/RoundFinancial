//! On-chain constants for roundfi-core.
//!
//! Mirrors `sdk/src/constants.ts` and `docs/architecture.md` §7.
//! Drift between this module and the TS SDK is an automatic bug caught by
//! the Rust↔TS parity tests landing in Step 5.

// ─── PDA seeds ──────────────────────────────────────────────────────────
pub const SEED_CONFIG:     &[u8] = b"config";
pub const SEED_POOL:       &[u8] = b"pool";
pub const SEED_MEMBER:     &[u8] = b"member";
pub const SEED_ESCROW:     &[u8] = b"escrow";
pub const SEED_SOLIDARITY: &[u8] = b"solidarity";
pub const SEED_YIELD:      &[u8] = b"yield";
pub const SEED_POSITION:   &[u8] = b"position";
pub const SEED_LISTING:    &[u8] = b"listing";   // 4c: escape valve listings

// ─── Step 4c: timing & defaults ─────────────────────────────────────────
/// Grace window after `pool.next_cycle_at` before `settle_default` is
/// callable. **7 days** — the production value.
///
/// **History (Adevar Labs SEV-002 Critical):** this constant was
/// previously patched to 60s ("DEVNET DEMO PATCH 2026-05-07") so the
/// settle_default flow could be exercised against a freshly-built
/// devnet pool within a single demo session. The patch was tracked
/// with a `MUST revert before mainnet` comment + a pinning test that
/// asserted `== 60`. Both shipped — the comment was a TODO never
/// closed, and the pinning test happily passed CI while embedding
/// the wrong value.
///
/// At `60s`, any cranker could `settle_default` a member 61 seconds
/// after `pool.next_cycle_at`. Consequences:
///   - Stake (50%/30%/10% of credit_amount, depending on level) seized
///   - Escrow balance seized
///   - SCHEMA_DEFAULT attestation written permanently
///   - Reputation score −500 + defaults count incremented
///   - settle_default deliberately bypasses the pause flag (see
///     settle_default.rs comment) so even an emergency pause does
///     NOT stop the flood
///
/// Combined with the permissionless crank, this enabled organized
/// griefing at near-zero cost: a botnet monitoring `next_cycle_at`
/// across all pools could destroy retention by liquidating any
/// member with 61s of connectivity slack.
///
/// Reverted to 604_800 (7 days) — matches the original whitepaper
/// design. The devnet rehearsal flow now compensates by using a
/// fast-forwarded clock on the test harness (per pool, not protocol-
/// wide) rather than a constant patch.
pub const GRACE_PERIOD_SECS: i64 = 604_800;

/// Time-lock on treasury rotation. Authority can `propose_new_treasury`
/// any time, but `commit_new_treasury` only succeeds after this window
/// has elapsed (`now >= pending_eta`). 7 days = 604_800 seconds. Gives
/// users a public window to detect a malicious authority change and
/// migrate funds before the swap takes effect. Combined with
/// `lock_treasury()` (one-way kill switch on `config.treasury_locked`)
/// for full post-deployment immutability when the team is confident.
pub const TREASURY_TIMELOCK_SECS: i64 = 604_800;

/// Anti-snipe cooldown applied to commit-reveal escape-valve listings
/// (#232). After `escape_valve_list_reveal` publishes the price, the
/// listing is **not buyable** for this many seconds.
///
/// Rationale: commit-reveal hides the listing price during the commit
/// phase. At reveal time the price becomes public — a searcher
/// monitoring the chain can race a legitimate buyer's tx at the
/// newly-public price. The cooldown gives the buyer (who knows the
/// price off-chain because the seller shared the salt) a fixed
/// head-start to land their `escape_valve_buy` tx before the public
/// race window opens. Pairs with operator-side Jito bundling for
/// stronger protection (see docs/security/mev-front-running.md § 2.2).
///
/// 30s is the canary default — about 75 slots, generous enough for a
/// human buyer to react via the UI without making the listing feel
/// dead. Tunable post-canary by changing this constant + a redeploy
/// (the value isn't in `ProtocolConfig` because it's a global
/// timing parameter, not an authority decision).
pub const REVEAL_COOLDOWN_SECS: i64 = 30;

/// Share of the post-fee-and-GF residual that routes to LPs / Anjos de
/// Liquidez (step 3 of the PDF-canonical yield waterfall). Default 65%
/// — matches the whitepaper's §6 distribution table:
/// fee 20% gross → GF cap → LPs 65% of residual → participants 35%.
pub const DEFAULT_LP_SHARE_BPS: u16 = 6_500;

// ─── Product defaults (USDC base units, 6 decimals) ─────────────────────
//
// **Adevar Labs SEV-025 fix** — the previous defaults formed an
// inviable pool: pool float per cycle was `24 × 416 × (1 - 1% solidarity
// - 25% escrow) ≈ 7388 USDC`, less than the 10_000 USDC credit. Cycle 0
// `claim_payout` would always fail with `WaterfallUnderflow` because the
// Seed Draw guard requires the pool to retain 91.6% of credit at first
// payout. Bumped DEFAULT_INSTALLMENT_AMOUNT 416 → 600 USDC so the
// product defaults form a viable pool out of the box:
//   pool_float per cycle = 24 × 600 × 0.74 = 10_656 USDC (>10_000 credit)
// Whitepaper credit + members + cycles unchanged; installment shifted
// to make the math close.
pub const DEFAULT_MEMBERS_TARGET:     u8  = 24;
pub const DEFAULT_INSTALLMENT_AMOUNT: u64 = 600_000_000;      // 600 USDC (SEV-025)
pub const DEFAULT_CREDIT_AMOUNT:      u64 = 10_000_000_000;   // 10_000 USDC
pub const DEFAULT_CYCLES_TOTAL:       u8  = 24;
pub const DEFAULT_CYCLE_DURATION:     i64 = 2_592_000;        // 30 days

// ─── Fee schedule (bps, 1 bp = 0.01%) ───────────────────────────────────
pub const DEFAULT_FEE_BPS_YIELD:      u16 = 2_000;   // 20% yield spread to protocol
pub const DEFAULT_FEE_BPS_CYCLE_L1:   u16 = 200;     // 2%  L1 per cycle
pub const DEFAULT_FEE_BPS_CYCLE_L2:   u16 = 100;     // 1%  L2 per cycle
pub const DEFAULT_FEE_BPS_CYCLE_L3:   u16 = 0;       // Veterans exempt
pub const DEFAULT_GUARANTEE_FUND_BPS: u16 = 15_000;  // 150% of protocol yield
pub const SEED_DRAW_BPS:              u16 = 9_160;   // 91.6% month-1 retention
pub const SOLIDARITY_BPS:             u16 = 100;     // 1% per installment
pub const DEFAULT_ESCROW_RELEASE_BPS: u16 = 2_500;   // 25% per milestone

// ─── 50-30-10 Rule — stake bps by reputation level ──────────────────────
pub const STAKE_BPS_LEVEL_1: u16 = 5_000; // 50%
pub const STAKE_BPS_LEVEL_2: u16 = 3_000; // 30%
pub const STAKE_BPS_LEVEL_3: u16 = 1_000; // 10%

// ─── Bounds ─────────────────────────────────────────────────────────────
pub const MAX_MEMBERS:        u8  = 64;   // safety ceiling; protocol default 24
pub const MAX_BPS:            u16 = 10_000;
pub const MIN_CYCLE_DURATION: i64 = 60;   // 1 min — devnet test-friendly
pub const MAX_URI_LEN:        usize = 200;

/// Look up stake bps from reputation level. Returns `None` for unknown levels.
pub fn stake_bps_for_level(level: u8) -> Option<u16> {
    match level {
        1 => Some(STAKE_BPS_LEVEL_1),
        2 => Some(STAKE_BPS_LEVEL_2),
        3 => Some(STAKE_BPS_LEVEL_3),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Stake tier bijective mapping (invariant #5) ────────────────────

    #[test]
    fn stake_tier_maps_exactly_three_levels() {
        assert_eq!(stake_bps_for_level(1), Some(STAKE_BPS_LEVEL_1));
        assert_eq!(stake_bps_for_level(2), Some(STAKE_BPS_LEVEL_2));
        assert_eq!(stake_bps_for_level(3), Some(STAKE_BPS_LEVEL_3));
    }

    #[test]
    fn stake_tier_rejects_unknown_levels() {
        assert_eq!(stake_bps_for_level(0),   None);
        assert_eq!(stake_bps_for_level(4),   None);
        assert_eq!(stake_bps_for_level(100), None);
        assert_eq!(stake_bps_for_level(u8::MAX), None);
    }

    #[test]
    fn stake_tier_is_injective() {
        // No two levels map to the same bps value (bijection).
        let ls: [u16; 3] = [STAKE_BPS_LEVEL_1, STAKE_BPS_LEVEL_2, STAKE_BPS_LEVEL_3];
        assert_ne!(ls[0], ls[1]);
        assert_ne!(ls[1], ls[2]);
        assert_ne!(ls[0], ls[2]);
    }

    #[test]
    fn stake_tier_is_monotone_decreasing() {
        // Higher reputation = lower stake requirement (50-30-10 rule).
        assert!(STAKE_BPS_LEVEL_1 > STAKE_BPS_LEVEL_2);
        assert!(STAKE_BPS_LEVEL_2 > STAKE_BPS_LEVEL_3);
    }

    #[test]
    fn stake_tier_values_match_whitepaper() {
        // 50-30-10 rule — hard-coded whitepaper values.
        assert_eq!(STAKE_BPS_LEVEL_1, 5_000); // 50%
        assert_eq!(STAKE_BPS_LEVEL_2, 3_000); // 30%
        assert_eq!(STAKE_BPS_LEVEL_3, 1_000); // 10%
    }

    #[test]
    fn stake_tier_all_under_max_bps() {
        // Sanity: no stake tier can exceed 100%.
        assert!(STAKE_BPS_LEVEL_1 <= MAX_BPS);
        assert!(STAKE_BPS_LEVEL_2 <= MAX_BPS);
        assert!(STAKE_BPS_LEVEL_3 <= MAX_BPS);
    }

    #[test]
    fn veteran_leverage_is_ten_times_per_whitepaper() {
        // Canonical leverage framing per the whitepaper + pitch:
        //   "Veteran deposits 10% of the credit (carta) and accesses
        //    100% of it → 10× leverage over the stake."
        // i.e. credit / stake = 10_000 / 1_000 = 10.
        // Same pattern for the other tiers:
        //   L1 (Iniciante):  10_000 / 5_000 = 2×
        //   L2 (Comprovado): 10_000 / 3_000 ≈ 3.33×
        //   L3 (Veterano):   10_000 / 1_000 = 10×
        // Guard the headline claim so a future bps tweak doesn't
        // silently break the pitch number.
        assert_eq!(MAX_BPS / STAKE_BPS_LEVEL_3, 10);
        assert_eq!(MAX_BPS / STAKE_BPS_LEVEL_1, 2);
        // L2 is 3.33×; integer division gives 3, just sanity-check
        // the ladder is monotone: higher tier → bigger leverage.
        assert!(MAX_BPS / STAKE_BPS_LEVEL_3 > MAX_BPS / STAKE_BPS_LEVEL_2);
        assert!(MAX_BPS / STAKE_BPS_LEVEL_2 > MAX_BPS / STAKE_BPS_LEVEL_1);
    }

    // ─── Fee schedule sanity ────────────────────────────────────────────

    #[test]
    fn cycle_fees_monotone_by_level() {
        // Higher reputation = lower cycle fee.
        assert!(DEFAULT_FEE_BPS_CYCLE_L1 > DEFAULT_FEE_BPS_CYCLE_L2);
        assert!(DEFAULT_FEE_BPS_CYCLE_L2 > DEFAULT_FEE_BPS_CYCLE_L3);
        assert_eq!(DEFAULT_FEE_BPS_CYCLE_L3, 0); // Veterans exempt
    }

    #[test]
    fn seed_draw_and_solidarity_in_range() {
        assert!(SEED_DRAW_BPS <= MAX_BPS, "seed_draw_bps must be <= 10_000");
        assert_eq!(SEED_DRAW_BPS, 9_160, "whitepaper locks seed-draw at 91.6%");
        assert!(SOLIDARITY_BPS < MAX_BPS);
        assert!(DEFAULT_ESCROW_RELEASE_BPS <= MAX_BPS);
    }

    #[test]
    fn guarantee_fund_bps_can_exceed_max() {
        // GF cap = 150% of fees, which is > 10_000 by design. Validate
        // the whitepaper value is preserved so governance drift is caught.
        assert_eq!(DEFAULT_GUARANTEE_FUND_BPS, 15_000);
    }

    #[test]
    fn grace_period_is_seven_days() {
        // Pinned by Adevar Labs SEV-002 fix: the constant was previously
        // 60s as a devnet demo patch, with a pinning test that asserted
        // == 60. Both shipped together — CI happily passed while the
        // demo value was embedded in production. Reverted to 7 days
        // (the original whitepaper value) and re-pinned correctly so
        // any future regression fails this test loudly rather than
        // silently passing.
        assert_eq!(GRACE_PERIOD_SECS, 7 * 24 * 60 * 60);
        assert_eq!(GRACE_PERIOD_SECS, 604_800);
    }

    #[test]
    fn pool_defaults_match_product_spec() {
        // 24 members × 24 cycles, 600 USDC installment (Adevar SEV-025
        // bumped from 416 — old value made the pool inviable: pool float
        // 24×416×0.74 = 7388 < 10_000 credit, cycle 0 always failed
        // Seed Draw guard), 10_000 USDC credit.
        assert_eq!(DEFAULT_MEMBERS_TARGET, 24);
        assert_eq!(DEFAULT_CYCLES_TOTAL,   24);
        assert_eq!(DEFAULT_INSTALLMENT_AMOUNT, 600_000_000);
        assert_eq!(DEFAULT_CREDIT_AMOUNT,      10_000_000_000);
        // 30 days per cycle.
        assert_eq!(DEFAULT_CYCLE_DURATION, 30 * 24 * 60 * 60);

        // Viability check: pool_float per cycle = members × installment
        // × (1 - solidarity_bps/MAX - escrow_release_bps/MAX) must be
        // ≥ credit so cycle 0 claim_payout passes the Seed Draw guard.
        let pool_float = (DEFAULT_MEMBERS_TARGET as u128)
            * (DEFAULT_INSTALLMENT_AMOUNT as u128)
            * ((MAX_BPS - SOLIDARITY_BPS - DEFAULT_ESCROW_RELEASE_BPS) as u128)
            / (MAX_BPS as u128);
        assert!(pool_float >= DEFAULT_CREDIT_AMOUNT as u128,
            "pool_float {} must be >= credit {} (Adevar SEV-025)",
            pool_float, DEFAULT_CREDIT_AMOUNT);
    }

    #[test]
    fn member_bound_respects_bitmap_width() {
        // slots_bitmap is [u8; 8] = 64 bits — any members_target above 64
        // would overflow the PDA slot tracking.
        assert!(MAX_MEMBERS <= 64);
    }
}
