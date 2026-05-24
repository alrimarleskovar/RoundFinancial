//! `ReputationProfile` — per-wallet on-chain score + anti-gaming counters.
//! PDA seeds: `[b"reputation", wallet]`.
//!
//! Absence of this account ≡ a fresh wallet with level 1 and score 0.
//! The stake-bps snapshot in `roundfi-core::join_pool` treats a missing
//! profile as level 1, so onboarding does not require a bootstrap tx.

use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct ReputationProfile {
    pub wallet: Pubkey,

    /// 1..=3. Promoted permissionlessly via `promote_level`.
    pub level: u8,

    /// Lifetime counters — additive-only for `cycles_completed` /
    /// `on_time_payments`, and non-negative for the *_count fields.
    pub cycles_completed: u32,
    pub on_time_payments: u32,
    pub late_payments:    u32,
    pub defaults:         u32,

    /// Unique pools this wallet has ever participated in. Incremented on
    /// the FIRST `CycleComplete` per (subject, pool). Duplicate-suppressed
    /// via the default-sticky bit and the cooldown guard.
    pub total_participated: u32,

    /// Saturating non-negative score.
    pub score: u64,

    /// Anti-gaming: timestamp of last `CycleComplete` attestation. Used
    /// to enforce `MIN_CYCLE_COOLDOWN_SECS` between two cycle closures
    /// for the same subject, even across pools.
    pub last_cycle_complete_at: i64,

    /// Bookkeeping.
    pub first_seen_at:   i64,
    pub last_updated_at: i64,

    /// PDA bump.
    pub bump: u8,

    /// **Adevar Labs SEV-027 fix** — anti-spam cooldown for admin-
    /// issued attestations. Updated on every attest where issuer ==
    /// config.authority (the admin path). Pool-PDA-issued attests
    /// have natural cooldown via the per-cycle structure of the
    /// core pool, so they do NOT bump this field.
    ///
    /// Used in attest.rs handler: admin-issued SCHEMA_PAYMENT requires
    /// `now - last_admin_attest_at >= MIN_ADMIN_ATTEST_COOLDOWN_SECS`.
    /// Without this, admin could pump score arbitrarily by issuing
    /// PAYMENT attestations in a tight loop.
    pub last_admin_attest_at: i64,

    pub _padding: [u8; 7],
}

impl ReputationProfile {
    /// discriminator(8) + wallet(32) + level(1) + 5*u32(20) + total_part(4)
    ///   + score(8) + 3*i64(24) + bump(1) + last_admin_attest_at(8) + pad(7)
    /// = 113. SEV-027 consumed 8 of the original 15 pad bytes; LEN unchanged.
    pub const LEN: usize = 8 + 32 + 1 + 20 + 4 + 8 + 24 + 1 + 8 + 7;

    /// Apply a signed score delta saturating at 0 on the low end and
    /// u64::MAX on the high end.
    pub fn apply_score_delta(&mut self, delta: i64) {
        if delta >= 0 {
            self.score = self.score.saturating_add(delta as u64);
        } else {
            let dec = delta.unsigned_abs();
            self.score = self.score.saturating_sub(dec);
        }
    }

    /// Resolve the canonical level for the current score.
    ///
    /// **SEV-047 fix** — promotion now requires BOTH a score threshold AND a
    /// minimum `cycles_completed` count. The score alone was farmable:
    /// `SCORE_PAYMENT` (+10) has no global per-subject rate-limit, so an
    /// attacker could spin up N independent 1-member pools, contribute once
    /// in each (+10 apiece in parallel), and reach `LEVEL_3_THRESHOLD` (2000
    /// = 200 payments) within hours — then exploit the L3 stake discount
    /// (10% vs 50%) via early-payout-then-default.
    ///
    /// `cycles_completed` only increments on `SCHEMA_CYCLE_COMPLETE`, which
    /// carries a 6-day per-subject cooldown (`MIN_CYCLE_COOLDOWN_SECS` in
    /// attest.rs). Gating promotion on it means L3 needs >= L3_MIN_CYCLES
    /// real completed cycles spaced >= 6 days apart — minimum ~18 days of
    /// farming for L3, which destroys the attack economics. Legitimate
    /// members are unaffected: `cycles_completed` rises naturally with use.
    pub fn resolve_level(
        score: u64,
        l2_threshold: u64,
        l3_threshold: u64,
        cycles_completed: u32,
        l2_min_cycles: u32,
        l3_min_cycles: u32,
    ) -> u8 {
        if score >= l3_threshold && cycles_completed >= l3_min_cycles {
            3
        } else if score >= l2_threshold && cycles_completed >= l2_min_cycles {
            2
        } else {
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_delta_saturates_low() {
        let mut p = ReputationProfile {
            wallet: Pubkey::default(),
            level: 1,
            cycles_completed: 0,
            on_time_payments: 0,
            late_payments: 0,
            defaults: 0,
            total_participated: 0,
            score: 10,
            last_cycle_complete_at: 0,
            first_seen_at: 0,
            last_updated_at: 0,
            bump: 0,
            last_admin_attest_at: 0,
            _padding: [0; 7],
        };
        p.apply_score_delta(-500);
        assert_eq!(p.score, 0);
    }

    #[test]
    fn apply_delta_saturates_high() {
        let mut p = ReputationProfile {
            wallet: Pubkey::default(),
            level: 1,
            cycles_completed: 0,
            on_time_payments: 0,
            late_payments: 0,
            defaults: 0,
            total_participated: 0,
            score: u64::MAX - 5,
            last_cycle_complete_at: 0,
            first_seen_at: 0,
            last_updated_at: 0,
            bump: 0,
            last_admin_attest_at: 0,
            _padding: [0; 7],
        };
        p.apply_score_delta(100);
        assert_eq!(p.score, u64::MAX);
    }

    #[test]
    fn resolve_level_thresholds() {
        // Baseline: score thresholds with cycles_completed satisfied
        // (10 cycles >> any floor) — pure score-ladder behavior preserved.
        let big = 10u32;
        assert_eq!(ReputationProfile::resolve_level(0,    500, 2_000, big, 1, 3), 1);
        assert_eq!(ReputationProfile::resolve_level(499,  500, 2_000, big, 1, 3), 1);
        assert_eq!(ReputationProfile::resolve_level(500,  500, 2_000, big, 1, 3), 2);
        assert_eq!(ReputationProfile::resolve_level(1999, 500, 2_000, big, 1, 3), 2);
        assert_eq!(ReputationProfile::resolve_level(2000, 500, 2_000, big, 1, 3), 3);
    }

    #[test]
    fn resolve_level_cycles_gate_sev047() {
        // SEV-047: score alone is no longer sufficient. The cycles_completed
        // floor gates promotion regardless of how high the (farmable) score is.

        // L2 score met (500) but 0 cycles → stays L1 (the farming defense).
        assert_eq!(ReputationProfile::resolve_level(500, 500, 2_000, 0, 1, 3), 1);
        // L2 score + exactly 1 cycle → L2 unlocks.
        assert_eq!(ReputationProfile::resolve_level(500, 500, 2_000, 1, 1, 3), 2);

        // L3 score met (2000) but only 2 cycles → capped at L2.
        assert_eq!(ReputationProfile::resolve_level(2_000, 500, 2_000, 2, 1, 3), 2);
        // L3 score + exactly 3 cycles → L3 unlocks.
        assert_eq!(ReputationProfile::resolve_level(2_000, 500, 2_000, 3, 1, 3), 3);

        // Farmed score (way past L3) but 0 cycles → still L1. This is the
        // exact attack vector closed: 200 parallel 1-member pools give score
        // 2000+ in hours, but cycles_completed stays 0 (no CYCLE_COMPLETE).
        assert_eq!(ReputationProfile::resolve_level(50_000, 500, 2_000, 0, 1, 3), 1);
    }
}
