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
        l4_threshold: u64,
        cycles_completed: u32,
        l2_min_cycles: u32,
        l3_min_cycles: u32,
        l4_min_cycles: u32,
    ) -> u8 {
        // v5.2 four-tier ladder. L4 (Elite) is gated on a score threshold
        // + cycles like L2/L3 — the v1-provisional on-chain path. The
        // proposal's metric-based Elite criteria are off-chain (indexer)
        // and will harden this in a future upgrade. The cycles floor is
        // the unbypassable wall-clock anti-farming defense at every tier.
        if score >= l4_threshold && cycles_completed >= l4_min_cycles {
            4
        } else if score >= l3_threshold && cycles_completed >= l3_min_cycles {
            3
        } else if score >= l2_threshold && cycles_completed >= l2_min_cycles {
            2
        } else {
            1
        }
    }

    /// SEV-047 defense-in-depth (identity gate). Caps the score/cycles-resolved
    /// level when the subject lacks a verified identity AND the protocol has
    /// enabled an identity floor via `IdentityGateConfig`.
    ///
    /// `required_min_level`:
    ///   - `0` → configurable gate disabled (devnet / Canary default). L2/L3 are
    ///     reachable without identity; L4 still requires it (elite hard floor).
    ///   - `N` (2..=LEVEL_MAX) → reaching level >= N requires `identity_verified`;
    ///     an unverified subject is capped at `N - 1` (and never above L3).
    ///
    /// Pure + monotonic-safe: only ever caps DOWN, never raises a level.
    /// Layered on top of the cycles gate (`resolve_level`) — the cycles gate is
    /// the unbypassable primary anti-farming defense; this adds an identity
    /// floor for the highest tiers.
    ///
    /// Two independent caps apply to an **unverified** subject; the tighter wins:
    ///
    ///   1. **Elite hard floor (partner review MEDIUM #1, 2026-06-12).** Levels
    ///      at/above `IDENTITY_HARD_FLOOR_LEVEL` (L4 Elite) are NEVER granted
    ///      without identity — even when the configurable gate is off
    ///      (`required_min_level == 0`, the devnet default). The top tier carries
    ///      the largest stake discount + strongest credit signal, so it's the
    ///      most worth gaming; no config value can disable its PoP requirement.
    ///   2. **Configurable gate (SEV-047).** When `required_min_level > 0`,
    ///      unverified subjects cap at `required_min_level - 1`.
    ///
    /// A `identity_verified` subject bypasses both and keeps `resolved_level`.
    pub fn cap_level_for_identity(
        resolved_level: u8,
        identity_verified: bool,
        required_min_level: u8,
    ) -> u8 {
        if identity_verified {
            return resolved_level;
        }
        // Unverified: take the tighter of the elite hard floor and the gate.
        let elite_cap = crate::constants::IDENTITY_HARD_FLOOR_LEVEL.saturating_sub(1);
        let gate_cap = if required_min_level == 0 {
            u8::MAX // gate disabled — no additional cap beyond the elite floor
        } else {
            required_min_level.saturating_sub(1)
        };
        resolved_level.min(elite_cap).min(gate_cap)
    }

    /// **SEV-E fix** — re-apply the identity floor to the STORED `level` after
    /// the subject's identity stops being verified (revoked / expired /
    /// unlinked).
    ///
    /// `cap_level_for_identity` runs at `promote_level`, but the resulting
    /// `level` is a *snapshot*: `roundfi-core::join_pool` consumes it directly
    /// and MUST NOT read the `IdentityRecord` (the architecture boundary in
    /// `state/identity.rs`). So when identity later lapses, the stale snapshot
    /// would still grant the identity-gated tier — most damagingly the L4
    /// Elite stake discount — on the next `join_pool`. The reputation program
    /// closes this by re-capping the snapshot HERE, at the moment identity loss
    /// is observed on-chain (`unlink_identity`, and `refresh_identity` when the
    /// re-read flips the record out of `Verified`).
    ///
    /// Caps DOWN only — never raises a level (promotion stays in
    /// `promote_level`). `now` is stamped onto `last_updated_at` only when the
    /// level actually changes, so a no-op call doesn't churn the record.
    /// Returns `true` iff the level changed.
    pub fn demote_to_identity_floor(&mut self, required_min_level: u8, now: i64) -> bool {
        // identity_verified = false: this is the lapsed-identity path.
        let capped = Self::cap_level_for_identity(self.level, false, required_min_level);
        if capped < self.level {
            self.level = capped;
            self.last_updated_at = now;
            true
        } else {
            false
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
        // (20 cycles >> any floor) — pure score-ladder behavior preserved.
        // Signature (v5.2): (score, l2_t, l3_t, l4_t, cycles, l2_c, l3_c, l4_c).
        let big = 20u32;
        let r = |score: u64| ReputationProfile::resolve_level(score, 500, 2_000, 5_000, big, 1, 3, 8);
        assert_eq!(r(0), 1);
        assert_eq!(r(499), 1);
        assert_eq!(r(500), 2);
        assert_eq!(r(1_999), 2);
        assert_eq!(r(2_000), 3);
        assert_eq!(r(4_999), 3);
        assert_eq!(r(5_000), 4); // L4 Elite threshold
        assert_eq!(r(u64::MAX), 4);
    }

    #[test]
    fn resolve_level_cycles_gate_sev047() {
        // SEV-047: score alone is no longer sufficient. The cycles_completed
        // floor gates promotion regardless of how high the (farmable) score is.
        // L2 floor = 2 (ECO-V52, raised from 1); L3 = 3; L4 = 8.
        let r = |score: u64, cycles: u32| {
            ReputationProfile::resolve_level(score, 500, 2_000, 5_000, cycles, 2, 3, 8)
        };

        // L2 score met (500) but < 2 cycles → stays L1 (the farming defense).
        assert_eq!(r(500, 0), 1);
        assert_eq!(r(500, 1), 1);
        // L2 score + exactly 2 cycles → L2 unlocks (ECO-V52 floor).
        assert_eq!(r(500, 2), 2);

        // L3 score met (2000) but only 2 cycles → capped at L2.
        assert_eq!(r(2_000, 2), 2);
        // L3 score + exactly 3 cycles → L3 unlocks.
        assert_eq!(r(2_000, 3), 3);

        // L4 score met (5000) but only 7 cycles → capped at L3.
        assert_eq!(r(5_000, 7), 3);
        // L4 score + exactly 8 cycles → L4 Elite unlocks.
        assert_eq!(r(5_000, 8), 4);

        // Farmed score (way past L4) but 0 cycles → still L1. This is the
        // exact attack vector closed: parallel 1-member pools give a huge
        // score in hours, but cycles_completed stays 0 (no CYCLE_COMPLETE).
        assert_eq!(r(50_000, 0), 1);
    }

    #[test]
    fn cap_level_for_identity_disabled_is_noop_sev047() {
        // required_min_level = 0 → configurable gate OFF (default). L1-L3 are
        // uncapped regardless of identity — the devnet / Canary path where
        // testers promote freely up to L3. (L4 is the exception — see
        // cap_level_for_identity_elite_hard_floor.)
        assert_eq!(ReputationProfile::cap_level_for_identity(3, false, 0), 3);
        assert_eq!(ReputationProfile::cap_level_for_identity(2, false, 0), 2);
        assert_eq!(ReputationProfile::cap_level_for_identity(1, false, 0), 1);
    }

    #[test]
    fn cap_level_for_identity_elite_hard_floor() {
        // Partner review MEDIUM #1: L4 (Elite) is NEVER granted to an
        // unverified wallet, even with the configurable gate off.
        assert_eq!(ReputationProfile::cap_level_for_identity(4, false, 0), 3); // gate off → still capped at L3
        assert_eq!(ReputationProfile::cap_level_for_identity(4, false, 3), 2); // gate L3 → tighter cap wins (L2)
        assert_eq!(ReputationProfile::cap_level_for_identity(4, false, 2), 1); // gate L2 → caps at L1
        // Verified wallets bypass the floor and reach L4.
        assert_eq!(ReputationProfile::cap_level_for_identity(4, true, 0), 4);
        assert_eq!(ReputationProfile::cap_level_for_identity(4, true, 3), 4);
        // The floor only bites at L4 — L3 stays reachable unverified when gate off.
        assert_eq!(ReputationProfile::cap_level_for_identity(3, false, 0), 3);
    }

    #[test]
    fn cap_level_for_identity_gates_unverified_sev047() {
        // floor = 2 (L2+ needs identity): unverified caps at L1; verified passes.
        assert_eq!(ReputationProfile::cap_level_for_identity(3, false, 2), 1);
        assert_eq!(ReputationProfile::cap_level_for_identity(2, false, 2), 1);
        assert_eq!(ReputationProfile::cap_level_for_identity(1, false, 2), 1);
        assert_eq!(ReputationProfile::cap_level_for_identity(3, true, 2), 3);
        assert_eq!(ReputationProfile::cap_level_for_identity(2, true, 2), 2);

        // floor = 3 (only L3 needs identity): unverified caps at L2.
        assert_eq!(ReputationProfile::cap_level_for_identity(3, false, 3), 2);
        assert_eq!(ReputationProfile::cap_level_for_identity(2, false, 3), 2);
        assert_eq!(ReputationProfile::cap_level_for_identity(1, false, 3), 1);
        assert_eq!(ReputationProfile::cap_level_for_identity(3, true, 3), 3);
    }

    #[test]
    fn demote_to_identity_floor_sev_e() {
        let mk = |level: u8| ReputationProfile {
            wallet: Pubkey::default(),
            level,
            cycles_completed: 0,
            on_time_payments: 0,
            late_payments: 0,
            defaults: 0,
            total_participated: 0,
            score: 0,
            last_cycle_complete_at: 0,
            first_seen_at: 0,
            last_updated_at: 0,
            bump: 0,
            last_admin_attest_at: 0,
            _padding: [0; 7],
        };

        // Gate OFF: the elite hard floor still demotes an unverified L4 → L3
        // and stamps last_updated_at. This is the exact verify→L4→unlink
        // exploit being closed.
        let mut p = mk(4);
        assert!(p.demote_to_identity_floor(0, 1_000));
        assert_eq!(p.level, 3);
        assert_eq!(p.last_updated_at, 1_000);

        // Idempotent: a second call at/below the floor is a no-op and does NOT
        // re-stamp last_updated_at (no churn).
        assert!(!p.demote_to_identity_floor(0, 2_000));
        assert_eq!(p.level, 3);
        assert_eq!(p.last_updated_at, 1_000);

        // Gate = 2 (L2+ needs identity): L2 → L1.
        let mut q = mk(2);
        assert!(q.demote_to_identity_floor(2, 5));
        assert_eq!(q.level, 1);

        // Gate = 3 (only L3 needs identity): L3 → L2; an L2 stays put.
        let mut r = mk(3);
        assert!(r.demote_to_identity_floor(3, 7));
        assert_eq!(r.level, 2);
        let mut s = mk(2);
        assert!(!s.demote_to_identity_floor(3, 9));
        assert_eq!(s.level, 2);

        // L1 never demotes under any gate.
        let mut t = mk(1);
        assert!(!t.demote_to_identity_floor(2, 11));
        assert_eq!(t.level, 1);
    }
}
