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
/// Position NFT asset PDA — `[b"position-asset", pool, slot_index]`. The
/// asset was previously a client-generated ephemeral keypair co-signing
/// join_pool; mobile wallets (MWA / in-app browsers) drop extra signers,
/// so the asset is now program-derived and signs its own CreateV2 CPI via
/// `invoke_signed`. Distinct prefix from SEED_POSITION: the same
/// `(pool, slot_index)` inputs already derive the position_authority PDA.
///
/// Uniqueness: within one Pool-PDA lifetime a slot is taken at most once
/// (`Pool::mark_slot_taken` never clears bits), so no live pool can mint
/// the same asset address twice. OPS CONSTRAINT: after the SEV-039 close
/// ceremony frees a Pool PDA, re-creating a pool with the SAME
/// (authority, seed_id) resurrects the same pool address — and the old,
/// never-burned position assets still occupy these PDAs, so every
/// previously-used slot would fail CreateV2 (AccountAlreadyInUse).
/// Never reuse a seed_id after closing a pool. (join_pool's lamport
/// pre-drain does NOT cover this case: the old asset is mpl-core-owned
/// with data, not a pre-funded empty account.)
pub const SEED_POSITION_ASSET: &[u8] = b"position-asset";
/// Per-pool payout-order draw result (sorteio policy, ADR pool_v2).
/// NOT b"draw" — that stem could be confused with SEED_DRAW_BPS's
/// seed-draw retention concept; "draw-result" is unambiguous.
pub const SEED_DRAW_RESULT: &[u8] = b"draw-result";

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
///
/// **Pre-Ceremony Beta exception (feature `devnet-canary`):** the
/// Genesis Canary phase uses cycle = 48h, which makes 7d grace
/// ridiculous (3.5× the cycle duration). The `devnet-canary` build
/// flag lowers the const to 86_400 (24h) for that phase only. The grace
/// floor guard is **config-split** (ECO-V52): the mainnet/default build
/// enforces a 48h floor (2× the canary override, so the 24h value can
/// never appear in a non-canary build), and the `devnet-canary` build
/// enforces the 24h canary minimum. Before the split the single floor was
/// 24h — exactly the canary value — so the SEV-002 net had zero headroom on
/// the mainnet build (a regression to 24h plus a matching pinning-test edit
/// slipped through). The "≠ 604_800" pinning is likewise feature-gated to
/// allow this devnet-only override.
///
/// NOTE: the feature is build-time, so a mainnet artifact accidentally
/// compiled `--features devnet-canary` is NOT caught by any unit test (it
/// runs the canary-config tests). The Cargo feature doc marks it "MUST NOT
/// be enabled in mainnet builds"; the operational guard is reproducible
/// verify-build + the canary pre-flight gate.
///
/// See docs/pt/pre-ceremony-beta-proposta.md §6.3 (Opção B). Per-pool
/// grace on-chain is the proper fix for mainnet — tracked separately
/// (ADR pending, depends on PR #401 ADR numbering).
#[cfg(not(feature = "devnet-canary"))]
pub const GRACE_PERIOD_SECS: i64 = 604_800;

/// Devnet Canary override. See main const doc above.
#[cfg(feature = "devnet-canary")]
pub const GRACE_PERIOD_SECS: i64 = 86_400;

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

// ─── 50-25-10-3 Rule — stake bps by reputation level (v5.2 four-tier) ───
// v5.2 ladder (06-team-decisions.md decisão 2): L2 dropped 30%→25% and an
// L4 "Elite" tier was added at 3%. L4 promotion is gated on a score
// threshold + cycles like L2/L3 (LEVEL_4_THRESHOLD in roundfi-reputation)
// — the proposal's metric-based Elite criteria (Reliability≥94 etc.) live
// off-chain and harden a future upgrade; this on-chain gate is the
// v1-provisional path.
pub const STAKE_BPS_LEVEL_1: u16 = 5_000; // 50%
pub const STAKE_BPS_LEVEL_2: u16 = 2_500; // 25%
pub const STAKE_BPS_LEVEL_3: u16 = 1_000; // 10%
pub const STAKE_BPS_LEVEL_4: u16 = 300; // 3% (Elite)

// ─── Ordering policy — who receives in which cycle (ADR pool_v2) ────────
// Per-pool policy deciding how payout order (`slot_index == cycle`) is
// assigned. Stored in `Pool.ordering_policy` (1 byte carved from the
// struct padding — old accounts read 0 = ArrivalOrder, today's behavior,
// so no migration). SDK mirror: `ORDERING_POLICY` (parity-tested).
//
//   0 = ArrivalOrder — slot picked at join (first free slot; the current
//       and only active behavior).
//   1 = Sorteio — payout order drawn at pool fill via
//       `roundfi_math::draw_slot_order` (bijection-guaranteed shuffle).
//       FAIL-CLOSED for now: `create_pool` rejects it with
//       `OrderingPolicyUnsupported` until the draw machinery (DrawResult
//       PDA + finalize_draw + cycle→seat translation in claim/crank)
//       lands. Defining the id first keeps SDK/parity/UI plumbing stable.
//
// Future ids reserved by the ADR (NOT implemented, NOT accepted):
// reputation-ordered, lance/auction.
pub const ORDERING_ARRIVAL_ORDER: u8 = 0;
pub const ORDERING_SORTEIO:       u8 = 1;

// ─── Bounds ─────────────────────────────────────────────────────────────
pub const MAX_MEMBERS:        u8  = 64;   // safety ceiling; protocol default 24
pub const MAX_BPS:            u16 = 10_000;

/// Minimum allowed `cycle_duration` on a `Pool`. **Adevar Labs SEV-023
/// fix** — was 60 seconds ("devnet test-friendly"), the same family of
/// devnet-patch-leaked-to-prod bug as SEV-002 (GRACE_PERIOD_SECS=60).
/// At 60s, a careless or hostile pool authority could create pools
/// where members had to contribute every minute — practically unusable
/// and a footgun even if not a direct fund-loss vector.
///
/// Reverted to 86_400 (1 day) — gives operators flexibility for short
/// cycles in canary / staging without permitting micro-cycles that
/// break the protocol's economic model. Devnet rehearsal scripts now
/// use a fast-forwarded clock at the test-harness layer rather than
/// micro-cycles.
pub const MIN_CYCLE_DURATION: i64 = 86_400; // 1 day

/// Timelock window for `fee_bps_yield` changes (Adevar Labs SEV-024
/// follow-up + W3 audit Risk #4). 1 day (86_400 seconds).
///
/// Rationale (docs/security/economic-config-governance.md):
///   - Authority rotation uses 7 days (irreversible, institutional users
///     need a coordinated migration window).
///   - Fee changes use 1 day — reversible, blast radius bounded by the
///     30% `MAX_FEE_BPS_YIELD` cap, but users still need a public window
///     to detect + opt out via the escape valve. 24h is sufficient.
///
/// Anyone can crank `commit_new_fee_bps_yield` after the eta, so the
/// change eventually lands even if the authority goes offline mid-window
/// — same shape as the treasury/authority rotation cranks.
pub const FEE_BPS_YIELD_TIMELOCK_SECS: i64 = 86_400;

/// Maximum allowed `fee_bps_yield` (Adevar Labs SEV-024 fix).
/// Default is 2_000 (20%); the previous cap was MAX_BPS = 10_000 (100%),
/// meaning a compromised authority could route 100% of every pool's
/// yield to treasury in a single tx with no public window. Tightened
/// to 3_000 (30%, 1.5x default) — bounds the immediate-blast-radius
/// of an authority compromise to a 50% yield surcharge over the
/// whitepaper's 20%, while leaving room for legitimate calibration.
///
/// A timelock on fee changes (deeper fix) is tracked as a follow-up
/// — would mirror the treasury rotation pattern. For now, the cap
/// alone closes the magnitude vector.
pub const MAX_FEE_BPS_YIELD: u16 = 3_000;

pub const MAX_URI_LEN:        usize = 200;

/// Look up stake bps from reputation level. Returns `None` for unknown levels.
pub fn stake_bps_for_level(level: u8) -> Option<u16> {
    match level {
        1 => Some(STAKE_BPS_LEVEL_1),
        2 => Some(STAKE_BPS_LEVEL_2),
        3 => Some(STAKE_BPS_LEVEL_3),
        4 => Some(STAKE_BPS_LEVEL_4),
        _ => None,
    }
}

#[cfg(test)]
// The constants here are intentional compile-time invariants — the
// `assert!(STAKE_BPS_LEVEL_1 > STAKE_BPS_LEVEL_2)` shape is what
// clippy::assertions_on_constants flags, but the value of the test is
// EXACTLY to catch accidental reordering or value drift in
// constants.rs itself. Suppress lint-wide for this module.
#[allow(clippy::assertions_on_constants)]
mod tests {
    use super::*;

    // ─── Stake tier bijective mapping (invariant #5) ────────────────────

    #[test]
    fn stake_tier_maps_exactly_four_levels() {
        assert_eq!(stake_bps_for_level(1), Some(STAKE_BPS_LEVEL_1));
        assert_eq!(stake_bps_for_level(2), Some(STAKE_BPS_LEVEL_2));
        assert_eq!(stake_bps_for_level(3), Some(STAKE_BPS_LEVEL_3));
        assert_eq!(stake_bps_for_level(4), Some(STAKE_BPS_LEVEL_4));
    }

    #[test]
    fn stake_tier_rejects_unknown_levels() {
        assert_eq!(stake_bps_for_level(0),   None);
        assert_eq!(stake_bps_for_level(5),   None);
        assert_eq!(stake_bps_for_level(100), None);
        assert_eq!(stake_bps_for_level(u8::MAX), None);
    }

    #[test]
    fn stake_tier_is_injective() {
        // No two levels map to the same bps value (bijection).
        let ls: [u16; 4] = [
            STAKE_BPS_LEVEL_1,
            STAKE_BPS_LEVEL_2,
            STAKE_BPS_LEVEL_3,
            STAKE_BPS_LEVEL_4,
        ];
        for i in 0..ls.len() {
            for j in (i + 1)..ls.len() {
                assert_ne!(ls[i], ls[j], "tiers {i} and {j} collide");
            }
        }
    }

    #[test]
    fn stake_tier_is_monotone_decreasing() {
        // Higher reputation = lower stake requirement (50-25-10-3 rule).
        assert!(STAKE_BPS_LEVEL_1 > STAKE_BPS_LEVEL_2);
        assert!(STAKE_BPS_LEVEL_2 > STAKE_BPS_LEVEL_3);
        assert!(STAKE_BPS_LEVEL_3 > STAKE_BPS_LEVEL_4);
    }

    #[test]
    fn stake_tier_values_match_whitepaper() {
        // 50-25-10-3 rule (v5.2) — hard-coded whitepaper values.
        assert_eq!(STAKE_BPS_LEVEL_1, 5_000); // 50%
        assert_eq!(STAKE_BPS_LEVEL_2, 2_500); // 25%
        assert_eq!(STAKE_BPS_LEVEL_3, 1_000); // 10%
        assert_eq!(STAKE_BPS_LEVEL_4, 300); // 3% (Elite)
    }

    #[test]
    fn stake_tier_all_under_max_bps() {
        // Sanity: no stake tier can exceed 100%.
        assert!(STAKE_BPS_LEVEL_1 <= MAX_BPS);
        assert!(STAKE_BPS_LEVEL_2 <= MAX_BPS);
        assert!(STAKE_BPS_LEVEL_3 <= MAX_BPS);
        assert!(STAKE_BPS_LEVEL_4 <= MAX_BPS);
    }

    #[test]
    fn veteran_leverage_is_ten_times_per_whitepaper() {
        // Canonical leverage framing per the whitepaper + pitch:
        //   "Veteran deposits 10% of the credit (carta) and accesses
        //    100% of it → 10× leverage over the stake."
        // i.e. credit / stake = 10_000 / 1_000 = 10.
        // v5.2 four-tier ladder:
        //   L1 (Iniciante):  10_000 / 5_000 = 2×
        //   L2 (Comprovado): 10_000 / 2_500 = 4×
        //   L3 (Veterano):   10_000 / 1_000 = 10×
        //   L4 (Elite):      10_000 /   300 ≈ 33×
        // Guard the headline claim so a future bps tweak doesn't
        // silently break the pitch number.
        assert_eq!(MAX_BPS / STAKE_BPS_LEVEL_3, 10);
        assert_eq!(MAX_BPS / STAKE_BPS_LEVEL_1, 2);
        assert_eq!(MAX_BPS / STAKE_BPS_LEVEL_2, 4); // L2 now exactly 4×
        assert_eq!(MAX_BPS / STAKE_BPS_LEVEL_4, 33); // Elite ≈ 33×
        // Monotone: higher tier → bigger leverage.
        assert!(MAX_BPS / STAKE_BPS_LEVEL_4 > MAX_BPS / STAKE_BPS_LEVEL_3);
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

    #[cfg(not(feature = "devnet-canary"))]
    #[test]
    fn grace_period_is_seven_days() {
        // Pinned by Adevar Labs SEV-002 fix: the constant was previously
        // 60s as a devnet demo patch, with a pinning test that asserted
        // == 60. Both shipped together — CI happily passed while the
        // demo value was embedded in production. Reverted to 7 days
        // (the original whitepaper value) and re-pinned correctly so
        // any future regression fails this test loudly rather than
        // silently passing.
        //
        // Gated by `not(feature = "devnet-canary")` — the Canary build
        // intentionally sets grace = 86_400 (24h), exactly at the
        // SEV-002 floor. The floor pinning test (below) still runs
        // in both configurations to guard against grace < 1 day.
        assert_eq!(GRACE_PERIOD_SECS, 7 * 24 * 60 * 60);
        assert_eq!(GRACE_PERIOD_SECS, 604_800);
    }

    #[cfg(feature = "devnet-canary")]
    #[test]
    fn grace_period_is_canary_24h() {
        // Mirror pinning for the Canary build. If anyone bumps the
        // value below 86_400, this and the floor test both fail —
        // double-layer SEV-002 regression guard.
        assert_eq!(GRACE_PERIOD_SECS, 86_400);
        assert_eq!(GRACE_PERIOD_SECS, 24 * 60 * 60);
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

// ─── Mainnet floor guard (constants-audit follow-up) ────────────────────
//
// **Why a separate module from the pinning tests above:**
//
// The tests above use `assert_eq!(GRACE_PERIOD_SECS, 604_800)` — a pinning
// shape that fails loudly on **any** change, even legitimate ones (a
// governance decision to extend grace to 14 days would need both the
// constant and its pinning test edited in the same commit). That's by
// design: pinning forces deliberate, audit-trail-friendly changes to
// production-economic values.
//
// **However:** the Adevar SEV-002 / SEV-023 family showed that pinning
// alone is not enough — a "MUST revert before mainnet" devnet patch was
// shipped to main together with its pinning test (`assert_eq!(..., 60)`).
// The pinning test happily passed CI while embedding the wrong value.
// The 2026-05 constants audit (`docs/security/constants-audit-2026-05.md`)
// recommends a **second**, weaker check that asserts production floors
// independent of the exact pinned value:
//
//   - Pinning test: "this is the canonical value, change deliberately"
//   - Floor guard:  "regardless of canonical value, never below mainnet floor"
//
// A regression to 60s now fails BOTH tests; a legitimate bump from 7d to
// 14d only fails the pinning (loud signal, expected) — the floor stays
// silent because 14d > 1d floor. This is the "if the pinning ever drifts
// again, the floor catches it" net.
#[cfg(test)]
// Same lint-suppress as `mod tests` above — `assert!(MIN_X >= FLOOR_X)`
// is intentional, not a clippy::assertions_on_constants smell.
#[allow(clippy::assertions_on_constants)]
mod floor_guards {
    use super::*;

    /// Grace window floor — **config-split** (ECO-V52, SEV-002 lineage).
    ///
    /// The `devnet-canary` feature lowers `GRACE_PERIOD_SECS` to 24h (86_400)
    /// for the Genesis Canary phase. That value sat EXACTLY at the old single
    /// 1-day floor, so the floor was vacuous at the canary edge: a regression
    /// that set the *mainnet* const to 24h — even paired with a matching edit
    /// to its pinning test (the exact SEV-002 double-edit that shipped a demo
    /// value to prod) — slipped through. Splitting the floor by config
    /// restores the headroom the SEV-002 net is supposed to provide.
    ///
    /// Mainnet / default build: grace must EXCEED the 24h canary override,
    /// floored at 48h (2× the override) so the devnet value can never satisfy
    /// the mainnet floor. (Residual: a mainnet artifact built `--features
    /// devnet-canary` runs the canary test below instead, so no unit test
    /// catches the feature leaking into a deploy — closed operationally by
    /// verify-build + the canary pre-flight gate; see the `GRACE_PERIOD_SECS`
    /// doc for the structural per-pool-grace follow-up.)
    #[cfg(not(feature = "devnet-canary"))]
    #[test]
    fn grace_period_above_mainnet_floor() {
        const FLOOR_SECS: i64 = 2 * 86_400; // 48h — 2× the canary override
        assert!(
            GRACE_PERIOD_SECS >= FLOOR_SECS,
            "GRACE_PERIOD_SECS = {} below mainnet floor {} (SEV-002/ECO-V52 — 24h is canary-only)",
            GRACE_PERIOD_SECS, FLOOR_SECS,
        );
    }

    /// Canary-build floor — grace cannot drop below the 24h Genesis Canary
    /// value (the documented SEV-002 floor). Lowering the override further
    /// (e.g. "12h for a faster demo") re-introduces the footgun and fails here.
    #[cfg(feature = "devnet-canary")]
    #[test]
    fn grace_period_above_canary_floor() {
        const FLOOR_SECS: i64 = 86_400; // 1 day — the canary minimum
        assert!(
            GRACE_PERIOD_SECS >= FLOOR_SECS,
            "GRACE_PERIOD_SECS = {} below canary floor {} (SEV-002 regression shape)",
            GRACE_PERIOD_SECS, FLOOR_SECS,
        );
    }

    /// Treasury rotation lock window — anything below 1 day reduces the
    /// user "detect malicious authority change and migrate funds" window
    /// to below practical reaction time. 7d is current; floor at 1d.
    #[test]
    fn treasury_timelock_above_mainnet_floor() {
        const FLOOR_SECS: i64 = 86_400;
        assert!(
            TREASURY_TIMELOCK_SECS >= FLOOR_SECS,
            "TREASURY_TIMELOCK_SECS = {} below mainnet floor {}",
            TREASURY_TIMELOCK_SECS, FLOOR_SECS,
        );
    }

    /// Reveal cooldown — must stay above ~10 slots (≈4s on Solana) to
    /// give the legitimate buyer a real head-start. Floor at 10s; 30s
    /// is the canary default per SEV/MEV reveal-front-running analysis.
    #[test]
    fn reveal_cooldown_above_floor() {
        const FLOOR_SECS: i64 = 10;
        assert!(
            REVEAL_COOLDOWN_SECS >= FLOOR_SECS,
            "REVEAL_COOLDOWN_SECS = {} below floor {}",
            REVEAL_COOLDOWN_SECS, FLOOR_SECS,
        );
    }

    /// `MIN_CYCLE_DURATION` is itself the floor against pool authority
    /// misconfiguration — but the constant value can drift downward
    /// the same way `GRACE_PERIOD_SECS` did (SEV-023 was exactly the
    /// "MIN_CYCLE_DURATION = 60s" version of SEV-002). Floor the floor.
    #[test]
    fn min_cycle_duration_above_mainnet_floor() {
        const FLOOR_SECS: i64 = 3_600; // 1 hour absolute minimum
        assert!(
            MIN_CYCLE_DURATION >= FLOOR_SECS,
            "MIN_CYCLE_DURATION = {} below mainnet floor {} (SEV-023 regression shape)",
            MIN_CYCLE_DURATION, FLOOR_SECS,
        );
    }

    /// `DEFAULT_CYCLE_DURATION` must respect `MIN_CYCLE_DURATION`
    /// (defaults cannot drift below the on-chain floor).
    #[test]
    fn default_cycle_duration_above_min() {
        assert!(
            DEFAULT_CYCLE_DURATION >= MIN_CYCLE_DURATION,
            "DEFAULT_CYCLE_DURATION = {} below MIN_CYCLE_DURATION {}",
            DEFAULT_CYCLE_DURATION, MIN_CYCLE_DURATION,
        );
    }

    /// `MAX_FEE_BPS_YIELD` is itself a ceiling but cannot drift above
    /// 50% — beyond that any authority compromise routes the majority
    /// of yield to treasury. The 30% canonical (SEV-024) is well below.
    #[test]
    fn max_fee_bps_yield_below_ceiling() {
        const CEILING_BPS: u16 = 5_000; // 50%
        assert!(
            MAX_FEE_BPS_YIELD <= CEILING_BPS,
            "MAX_FEE_BPS_YIELD = {} above ceiling {} (would permit majority-yield exfil)",
            MAX_FEE_BPS_YIELD, CEILING_BPS,
        );
    }

    /// Default product pool must remain viable: per-cycle pool float
    /// (`members × installment × (1 - sol - escrow)`) must clear the
    /// credit. SEV-025 lifted the installment to make this hold; the
    /// floor guard pins the invariant separately from the value-pin.
    #[test]
    fn default_pool_viability_holds() {
        let pool_float = (DEFAULT_MEMBERS_TARGET as u128)
            * (DEFAULT_INSTALLMENT_AMOUNT as u128)
            * ((MAX_BPS - SOLIDARITY_BPS - DEFAULT_ESCROW_RELEASE_BPS) as u128)
            / (MAX_BPS as u128);
        assert!(
            pool_float >= DEFAULT_CREDIT_AMOUNT as u128,
            "pool_float {} < credit {} (SEV-025 viability)",
            pool_float, DEFAULT_CREDIT_AMOUNT,
        );
    }
}
