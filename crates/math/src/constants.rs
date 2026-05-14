//! Constants required by math modules.
//!
//! Intentionally a minimal subset — only the constants the pure-math
//! algebra depends on. PDA seeds, default pool parameters, fee
//! schedules etc. stay in `programs/roundfi-core/src/constants.rs`.

/// Basis-points denominator. `bps / MAX_BPS` is the fractional value.
/// Whitepaper-canonical 10_000 (i.e., 1 bps = 0.01%).
pub const MAX_BPS: u16 = 10_000;
