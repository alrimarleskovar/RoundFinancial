//! `constants` — protocol-level limits and PDA seeds for roundfi-reputation.

/// PDA seeds.
pub const SEED_REP_CONFIG: &[u8] = b"rep-config";
pub const SEED_PROFILE:    &[u8] = b"reputation";
pub const SEED_ATTESTATION: &[u8] = b"attestation";
pub const SEED_IDENTITY:   &[u8] = b"identity";
pub const SEED_IDENTITY_GATE: &[u8] = b"identity-gate"; // SEV-047 identity-gate config (singleton)
pub const SEED_POOL:       &[u8] = b"pool"; // mirrored from roundfi-core for issuer-PDA derivation

/// Attestation schemas — stable integer IDs.
///
/// **Security review 2026-06-12 (Caio HIGH Pass-3) corrective taxonomy.**
/// The pre-Pass-3 schema conflated "received the payout" with "completed
/// the cycle of obligations" — every `claim_payout` emitted
/// `SCHEMA_CYCLE_COMPLETE` with `score +50` and `cycles_completed += 1`,
/// rewarding slot-0 members the moment they received their carta and
/// before any post-payout obligations had been kept. This let the central
/// thesis of RoundFi ("pay AFTER receiving") go unmeasured.
///
/// Pass-3 splits the two signals:
///   - `SCHEMA_PAYOUT_CLAIMED` (id 6, NEW) — emitted by `claim_payout`,
///     score delta 0, does NOT increment `cycles_completed`. Pure audit
///     trail: a member was drawn this cycle. Mortgage on future
///     obligations, not a reward.
///   - `SCHEMA_POOL_COMPLETE` (id 4, RENAMED, semantics changed) —
///     emitted by `contribute` ONLY when the member's last contribution
///     of the pool lands (`contributions_paid + 1 == cycles_total`).
///     Score `+50`, `cycles_completed += 1`. Now means what the name
///     promises: the member kept every obligation in this pool.
///
/// The id `4` is reused (no migration on existing attestation PDAs —
/// rare on devnet, value of preserving the audit trail is small). The
/// indexer distinguishes legacy `id=4` from new via `BehavioralPayload.version`
/// (v1 = legacy claim-emitted, v2 = new contribute-emitted).
pub const SCHEMA_PAYMENT:        u16 = 1;
pub const SCHEMA_LATE:           u16 = 2;
pub const SCHEMA_DEFAULT:        u16 = 3;
/// Renamed from `SCHEMA_CYCLE_COMPLETE`; semantics changed (Pass-3). Now
/// emitted by `contribute` at `contributions_paid + 1 == cycles_total`,
/// not by `claim_payout`. Re-uses id 4 — old PDAs keep their id but were
/// payload v1; new PDAs are payload v2 with `CLASS_POOL_COMPLETE`.
pub const SCHEMA_POOL_COMPLETE:  u16 = 4;
pub const SCHEMA_LEVEL_UP:       u16 = 5;
/// NEW (Pass-3). Emitted by `claim_payout` — informative audit trail of
/// "member drew their payout this cycle." Score delta 0, no
/// `cycles_completed` bump. The reputation handler treats it as a
/// score-neutral event (anti-farming cooldown still applies via the
/// admin-attest path).
pub const SCHEMA_PAYOUT_CLAIMED: u16 = 6;

/// Pre-Pass-3 alias — kept only so external tooling that read the
/// constant directly doesn't error during the canary cutover. New code
/// MUST use `SCHEMA_POOL_COMPLETE`. Removed in a follow-up wave.
#[deprecated(since = "0.5.0", note = "use SCHEMA_POOL_COMPLETE (Pass-3 rename)")]
pub const SCHEMA_CYCLE_COMPLETE: u16 = SCHEMA_POOL_COMPLETE;

/// Attestation payload size (fixed for rent predictability).
pub const ATTESTATION_PAYLOAD_LEN: usize = 96;

/// Anti-gaming cooldown — minimum real-time seconds between two
/// `POOL_COMPLETE` attestations for the same subject.
///
/// **Pass-3 update.** Under the pre-Pass-3 semantics (`CYCLE_COMPLETE`
/// emitted per payout), this was a 6-day floor decoupled from
/// `Pool.cycle_duration`. Under Pass-3 semantics, `POOL_COMPLETE` fires
/// only on the member's LAST contribution of a pool — and a legitimate
/// pool runs ≥6 months (24 cycles × ≥7-day `MIN_CYCLE_DURATION`). The
/// natural minimum cadence is therefore ~6 months, so the cooldown can
/// be raised aggressively without rejecting any honest event.
///
/// `MIN_POOL_COMPLETE_COOLDOWN_SECS` = 30 days. A sybil farm that
/// orchestrates 24-cycle parallel pools would still need to push the
/// schedule, and the floor catches it; an honest member who completes
/// two pools back-to-back hits it ~5x over.
pub const MIN_POOL_COMPLETE_COOLDOWN_SECS: i64 = 2_592_000;

/// Pre-Pass-3 alias — kept for external tooling during the cutover.
#[deprecated(since = "0.5.0", note = "use MIN_POOL_COMPLETE_COOLDOWN_SECS (Pass-3 rename)")]
pub const MIN_CYCLE_COOLDOWN_SECS: i64 = MIN_POOL_COMPLETE_COOLDOWN_SECS;

/// **Adevar Labs SEV-027 fix** — anti-spam cooldown for admin-issued
/// SCHEMA_PAYMENT attestations. Pool-PDA-issued attests are naturally
/// rate-limited by the cycle structure (one PAYMENT per member per
/// cycle), but admin-direct attests had no cooldown — admin could
/// pump score arbitrarily by issuing PAYMENT in a tight loop.
///
/// 60s minimum between admin-issued PAYMENT attestations for the
/// same subject. Tracked via `ReputationProfile.last_admin_attest_at`.
/// Conservative floor; not strict enough to block legitimate manual
/// corrections but enough to defeat trivial-loop score-pumping.
pub const MIN_ADMIN_ATTEST_COOLDOWN_SECS: i64 = 60;

/// Score deltas (v1 schedule — see architecture.md §4.2).
pub const SCORE_PAYMENT:        i64 =  10;
/// **Pass-3 rename** — was `SCORE_CYCLE_COMPLETE`. Same +50 magnitude,
/// but now applied at *pool completion* (last contribution lands), not
/// at payout claim. The "pay-after-receiving" thesis is now measured.
pub const SCORE_POOL_COMPLETE:  i64 =  50;
pub const SCORE_LATE:           i64 = -100;
pub const SCORE_DEFAULT:        i64 = -500;
/// **Pass-3** — `PAYOUT_CLAIMED` carries no score signal. Being drawn
/// is not merit; keeping obligations after being drawn IS.
pub const SCORE_PAYOUT_CLAIMED: i64 =   0;

/// Pre-Pass-3 alias — kept for external tooling during the cutover.
#[deprecated(since = "0.5.0", note = "use SCORE_POOL_COMPLETE (Pass-3 rename)")]
pub const SCORE_CYCLE_COMPLETE: i64 = SCORE_POOL_COMPLETE;

/// Level thresholds — `promote_level` advances to the highest level
/// whose threshold ≤ current score.
pub const LEVEL_2_THRESHOLD: u64 = 500;
pub const LEVEL_3_THRESHOLD: u64 = 2_000;
/// L4 "Elite" (v5.2 four-tier ladder). **v1-provisional gate:** on-chain
/// L4 is a score + cycles threshold like L2/L3. The proposal's
/// metric-based Elite criteria (Reliability≥94, Punctuality≥88,
/// Commitment≥90, 0 BadFaith) live off-chain in the indexer and will
/// harden this gate in a future upgrade once the weights are calibrated.
pub const LEVEL_4_THRESHOLD: u64 = 5_000;

/// **SEV-047 fix** — minimum `cycles_completed` per level, gating promotion
/// alongside the score threshold. Under Pass-3 semantics,
/// `cycles_completed` only rises on `SCHEMA_POOL_COMPLETE`, which fires
/// exactly once per pool that the member finished paying through —
/// rate-limited by `MIN_POOL_COMPLETE_COOLDOWN_SECS` (30 days).
/// `cycles_completed` is now a count of **pools completed end-to-end**,
/// not a count of payouts received. The floors below are intentionally
/// small because each unit is now a ~6-month commitment:
///   - L2 requires >= 2 completed pools. **ECO-V52: raised from 1.** L2 is
///     the first real leverage jump (50% → 25% stake = 4×), and a single
///     completed pool was farmable on the devnet / Canary path where the
///     configurable identity gate is off (`required_min_level = 0`) and L2
///     therefore needs no verified identity. Two full ROSCA rounds —
///     ≥ 30 days apart by `MIN_POOL_COMPLETE_COOLDOWN_SECS`, ≥ ~1 year of
///     honest history in practice — is a proportionate floor for the first
///     leverage upgrade. Legitimate members still hit it naturally; the
///     deeper large-`credit_amount` regime (where the stake discount scales
///     linearly) is an owner-level decision tracked separately (R1 in
///     `docs/security/reputation-farming-roi.md`).
///   - L3 requires >= 3 completed pools (≥ ~18 months of honest history).
///   - L4 requires >= 8 completed pools (Elite — ≥ ~4 years of honest
///     history; the strongest wall-clock floor).
/// Legitimate members hit these naturally; only sybil-farmers are blocked.
pub const LEVEL_2_MIN_CYCLES: u32 = 2;
pub const LEVEL_3_MIN_CYCLES: u32 = 3;
pub const LEVEL_4_MIN_CYCLES: u32 = 8;

/// Maximum levels supported. Level 0 is reserved for "never initialized".
pub const LEVEL_MIN: u8 = 1;
pub const LEVEL_MAX: u8 = 4;

/// Level at/above which identity verification is **always** required,
/// independent of `IdentityGateConfig.required_min_level`. The Elite tier
/// (L4) is never granted to an unverified wallet — even when the
/// configurable gate is off (the devnet default `required_min_level = 0`).
///
/// Partner review MEDIUM #1 (2026-06-12): the highest tier is the one most
/// worth gaming (largest stake discount, strongest credit signal), so it
/// gets a hard Proof-of-Personhood floor that no config value can disable.
/// L2/L3 stay governed by the configurable gate (devnet 0 = open, mainnet
/// 3 = verified-only). Verified wallets bypass this floor and can reach L4.
pub const IDENTITY_HARD_FLOOR_LEVEL: u8 = LEVEL_MAX;

/// Authority rotation timelock for the reputation program (Adevar Labs
/// SEV-021 fix). Same 7-day window used by roundfi-core's
/// TREASURY_TIMELOCK_SECS. Was previously zero (direct rotation via
/// `update_reputation_config`), asymmetric with core's protection;
/// auditor flagged a compromised key + 1 tx = irreversible attack.
/// 604_800 = 7 * 24 * 60 * 60 seconds.
pub const REPUTATION_AUTHORITY_TIMELOCK_SECS: i64 = 604_800;

/// Maximum forward horizon for a Passport attestation's `expires_at`,
/// in seconds from `now` at the moment of validation (Wave 9 hardening —
/// closes the T4 "future work" gap in
/// `docs/security/passport-bridge-threat-model.md`).
///
/// The bridge service's documented default TTL is 90 days. This bound
/// caps `expires_at - now` at **180 days** — 2× the bridge default,
/// generous enough to absorb refresh delays and clock skew while
/// neutralizing a compromised bridge that tries to mint a 10-year
/// attestation (the explicit attack the threat model flagged).
///
/// Symmetric pattern to the Wave 3 plausibility ceiling in the Kamino
/// adapter: don't try to detect the compromise, just reject the
/// physically-implausible value the compromise would write. Fail loud,
/// fail closed.
///
/// `MIN_PASSPORT_HORIZON_SECS` is a floor of 1 day so the bound is
/// non-trivial: a zero-or-negative max would accidentally reject every
/// attestation. Keep the two-tier floor + ceiling explicit.
pub const MAX_PASSPORT_HORIZON_SECS: i64 = 180 * 86_400; // 180 days

/// Passport attestation account size — 83 bytes.
///
/// Layout reused from the original Civic Gateway-Token v1 shape so the
/// byte-offset validator carries over unchanged after the Civic →
/// Human Passport provider migration (#227). The off-chain bridge
/// service that translates Human Passport score queries to on-chain
/// attestations writes accounts in this shape under its authority
/// pubkey. See `identity/passport.rs` for the validator + bridge
/// architecture rationale.
pub const PASSPORT_ATTESTATION_LEN: usize = 83;

// ─── Mainnet floor guard (constants-audit follow-up) ────────────────────
//
// Mirrors the floor guard pattern documented in
// `docs/security/constants-audit-2026-05.md` and applied to
// `programs/roundfi-core/src/constants.rs`. Pinning tests would catch
// a regression that flipped the constant to its prior value; floor
// guards catch a *new* devnet-shortcut value the same family of bug
// might invent (e.g. a future engineer trying "60s for testing").
//
// Two layers:
//   - Pinning (loud, deliberate change): forces explicit edits.
//   - Floor (silent until breach): catches regressions independent
//     of what the pinned value happens to be.
#[cfg(test)]
// `assert!(CONST >= FLOOR_CONST)` shape is what clippy::assertions_on_constants
// flags, but the value of the test is EXACTLY to catch accidental
// drift below the floor. Lint-suppress for this guard module.
#[allow(clippy::assertions_on_constants)]
mod floor_guards {
    use super::*;

    /// CycleComplete attestation cooldown — anti-sybil floor. 6 days
    /// is the canonical value; floor anything below 1 day (would
    /// permit rapid ladder-jumping via fake-pool farms).
    #[test]
    fn min_cycle_cooldown_above_mainnet_floor() {
        const FLOOR_SECS: i64 = 86_400; // 1 day
        assert!(
            MIN_CYCLE_COOLDOWN_SECS >= FLOOR_SECS,
            "MIN_CYCLE_COOLDOWN_SECS = {} below mainnet floor {}",
            MIN_CYCLE_COOLDOWN_SECS, FLOOR_SECS,
        );
    }

    /// Admin-direct PAYMENT attestation cooldown — anti-spam floor.
    /// 60s is the canonical floor; assert it cannot drop below 10s
    /// (anything below 10s is well within trivial-loop range).
    #[test]
    fn min_admin_attest_cooldown_above_floor() {
        const FLOOR_SECS: i64 = 10;
        assert!(
            MIN_ADMIN_ATTEST_COOLDOWN_SECS >= FLOOR_SECS,
            "MIN_ADMIN_ATTEST_COOLDOWN_SECS = {} below floor {}",
            MIN_ADMIN_ATTEST_COOLDOWN_SECS, FLOOR_SECS,
        );
    }

    /// Reputation authority rotation timelock — must give the user
    /// community at least 1 day to detect a malicious key handover
    /// and migrate. 7 days is canonical; floor 1 day.
    #[test]
    fn reputation_authority_timelock_above_floor() {
        const FLOOR_SECS: i64 = 86_400;
        assert!(
            REPUTATION_AUTHORITY_TIMELOCK_SECS >= FLOOR_SECS,
            "REPUTATION_AUTHORITY_TIMELOCK_SECS = {} below mainnet floor {}",
            REPUTATION_AUTHORITY_TIMELOCK_SECS, FLOOR_SECS,
        );
    }

    /// Level thresholds — guard the score ladder ordering. Each tier
    /// must require strictly more score than the one below it
    /// (v5.2 four-tier: L2 < L3 < L4).
    #[test]
    fn level_thresholds_strictly_increasing() {
        assert!(
            LEVEL_3_THRESHOLD > LEVEL_2_THRESHOLD,
            "level thresholds must be strictly increasing: L3={} L2={}",
            LEVEL_3_THRESHOLD, LEVEL_2_THRESHOLD,
        );
        assert!(
            LEVEL_4_THRESHOLD > LEVEL_3_THRESHOLD,
            "level thresholds must be strictly increasing: L4={} L3={}",
            LEVEL_4_THRESHOLD, LEVEL_3_THRESHOLD,
        );
    }

    /// Cycles floors mirror the score ladder ordering (L2 < L3 < L4).
    #[test]
    fn level_min_cycles_strictly_increasing() {
        assert!(LEVEL_3_MIN_CYCLES > LEVEL_2_MIN_CYCLES);
        assert!(LEVEL_4_MIN_CYCLES > LEVEL_3_MIN_CYCLES);
    }

    /// L2 cycles floor — anti-farming minimum (ECO-V52). L2 is the first
    /// leverage jump (4× / 25% stake) and was farmable at the prior value
    /// of 1 on the gate-off devnet path (one self-dealt pool, no identity).
    /// Floor it at 2 so a future "1 for testing" shortcut fails CI — same
    /// regression family as the `GRACE_PERIOD_SECS = 60` devnet leak
    /// (SEV-002). Pinning catches a deliberate flip; this floor catches a
    /// silent drift below the anti-farming minimum.
    #[test]
    fn level_2_min_cycles_above_floor() {
        const FLOOR: u32 = 2;
        assert!(
            LEVEL_2_MIN_CYCLES >= FLOOR,
            "LEVEL_2_MIN_CYCLES = {} below anti-farming floor {} (ECO-V52)",
            LEVEL_2_MIN_CYCLES, FLOOR,
        );
    }

    /// Max attestation horizon (Wave 9). Must be at least 2× the
    /// bridge's documented 90-day default TTL so a refresh-delayed but
    /// honest attestation never gets falsely rejected, and must be
    /// far below "implausible" values (e.g. 10 years) that signal a
    /// compromised bridge.
    #[test]
    fn passport_max_horizon_within_bounds() {
        const FLOOR_SECS: i64 = 90 * 86_400; // 2× bridge default
        const CEILING_SECS: i64 = 365 * 86_400; // 1 year
        assert!(
            MAX_PASSPORT_HORIZON_SECS >= FLOOR_SECS,
            "MAX_PASSPORT_HORIZON_SECS = {} below 2× bridge-default floor {}",
            MAX_PASSPORT_HORIZON_SECS,
            FLOOR_SECS,
        );
        assert!(
            MAX_PASSPORT_HORIZON_SECS <= CEILING_SECS,
            "MAX_PASSPORT_HORIZON_SECS = {} above 1y ceiling {} — defeats the cap",
            MAX_PASSPORT_HORIZON_SECS,
            CEILING_SECS,
        );
    }
}
