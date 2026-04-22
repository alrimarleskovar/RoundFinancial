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

    pub _padding: [u8; 15],
}

impl ReputationProfile {
    /// discriminator(8) + wallet(32) + level(1) + 5*u32(20) + total_part(4)
    ///   + score(8) + 3*i64(24) + bump(1) + padding(15) = 8+32+1+20+4+8+24+1+15
    /// = 113. We round to 120 via padding for alignment safety.
    pub const LEN: usize = 8 + 32 + 1 + 20 + 4 + 8 + 24 + 1 + 15;

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
    pub fn resolve_level(
        score: u64,
        l2_threshold: u64,
        l3_threshold: u64,
    ) -> u8 {
        if score >= l3_threshold {
            3
        } else if score >= l2_threshold {
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
            _padding: [0; 15],
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
            _padding: [0; 15],
        };
        p.apply_score_delta(100);
        assert_eq!(p.score, u64::MAX);
    }

    #[test]
    fn resolve_level_thresholds() {
        assert_eq!(ReputationProfile::resolve_level(0,    500, 2_000), 1);
        assert_eq!(ReputationProfile::resolve_level(499,  500, 2_000), 1);
        assert_eq!(ReputationProfile::resolve_level(500,  500, 2_000), 2);
        assert_eq!(ReputationProfile::resolve_level(1999, 500, 2_000), 2);
        assert_eq!(ReputationProfile::resolve_level(2000, 500, 2_000), 3);
    }
}
