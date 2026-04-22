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
/// Grace window after `pool.next_cycle_at` before settle_default is callable.
/// 7 days = 604_800 seconds. Protocol constant — not per-pool overridable.
pub const GRACE_PERIOD_SECS: i64 = 604_800;

/// Step in the yield waterfall that routes to good-faith bonuses. Default 50%
/// of the residual after GF top-up + protocol fee — tuned to match the
/// whitepaper's §6 distribution table.
pub const DEFAULT_GOOD_FAITH_SHARE_BPS: u16 = 5_000;

// ─── Product defaults (USDC base units, 6 decimals) ─────────────────────
pub const DEFAULT_MEMBERS_TARGET:     u8  = 24;
pub const DEFAULT_INSTALLMENT_AMOUNT: u64 = 416_000_000;      // 416 USDC
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
