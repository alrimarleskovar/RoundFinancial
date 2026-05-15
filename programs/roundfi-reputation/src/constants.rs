//! `constants` — protocol-level limits and PDA seeds for roundfi-reputation.

/// PDA seeds.
pub const SEED_REP_CONFIG: &[u8] = b"rep-config";
pub const SEED_PROFILE:    &[u8] = b"reputation";
pub const SEED_ATTESTATION: &[u8] = b"attestation";
pub const SEED_IDENTITY:   &[u8] = b"identity";
pub const SEED_POOL:       &[u8] = b"pool"; // mirrored from roundfi-core for issuer-PDA derivation

/// Attestation schemas — stable integer IDs.
pub const SCHEMA_PAYMENT:        u16 = 1;
pub const SCHEMA_LATE:           u16 = 2;
pub const SCHEMA_DEFAULT:        u16 = 3;
pub const SCHEMA_CYCLE_COMPLETE: u16 = 4;
pub const SCHEMA_LEVEL_UP:       u16 = 5;

/// Attestation payload size (fixed for rent predictability).
pub const ATTESTATION_PAYLOAD_LEN: usize = 96;

/// Anti-gaming cooldown — minimum real-time seconds between two
/// `CycleComplete` attestations for the same subject. Defaults to
/// 60% of a 10-day cycle = 518_400 seconds. Prevents a sybil farm
/// from rapidly completing 10 fake pools in a single slot and
/// ladder-jumping to level 3.
pub const MIN_CYCLE_COOLDOWN_SECS: i64 = 518_400;

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
pub const SCORE_CYCLE_COMPLETE: i64 =  50;
pub const SCORE_LATE:           i64 = -100;
pub const SCORE_DEFAULT:        i64 = -500;

/// Level thresholds — `promote_level` advances to the highest level
/// whose threshold ≤ current score.
pub const LEVEL_2_THRESHOLD: u64 = 500;
pub const LEVEL_3_THRESHOLD: u64 = 2_000;

/// Maximum levels supported. Level 0 is reserved for "never initialized".
pub const LEVEL_MIN: u8 = 1;
pub const LEVEL_MAX: u8 = 3;

/// Authority rotation timelock for the reputation program (Adevar Labs
/// SEV-021 fix). Same 7-day window used by roundfi-core's
/// TREASURY_TIMELOCK_SECS. Was previously zero (direct rotation via
/// `update_reputation_config`), asymmetric with core's protection;
/// auditor flagged a compromised key + 1 tx = irreversible attack.
/// 604_800 = 7 * 24 * 60 * 60 seconds.
pub const REPUTATION_AUTHORITY_TIMELOCK_SECS: i64 = 604_800;

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
