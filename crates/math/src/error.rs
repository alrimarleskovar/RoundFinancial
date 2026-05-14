//! Pure-Rust error type for the math crate.
//!
//! Replaces `anchor_lang::error::Error` + `RoundfiError` references that
//! the original math/ modules used. The on-chain crate maps these
//! variants 1:1 to `RoundfiError` via a `From` impl at the boundary.

use core::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    /// Arithmetic operation overflowed u64 or u128 saturating bounds.
    /// Maps to `RoundfiError::MathOverflow` at the on-chain boundary.
    Overflow,
    /// A basis-points argument exceeded `MAX_BPS = 10_000`, or the sum
    /// of multiple bps arguments did. Maps to `RoundfiError::InvalidBps`.
    InvalidBps,
    /// Vesting / pool parameters are inconsistent (e.g., `total_checkpoints == 0`).
    /// Maps to `RoundfiError::InvalidPoolParams`.
    InvalidPoolParams,
    /// A `checkpoint` argument was out of range for `release_escrow`.
    /// Maps to `RoundfiError::EscrowLocked`.
    EscrowLocked,
    /// Seed-draw retained-amount math produced a negative effective
    /// threshold. Maps to `RoundfiError::SeedDrawShortfall`.
    SeedDrawShortfall,
    /// Releasable-delta requested but vesting hasn't progressed since
    /// last release. Maps to `RoundfiError::EscrowNothingToRelease`.
    EscrowNothingToRelease,
    /// Waterfall step would underflow (subtraction below zero).
    /// Maps to `RoundfiError::WaterfallUnderflow`.
    WaterfallUnderflow,
    /// Sum of waterfall buckets does not equal the gross yield.
    /// Maps to `RoundfiError::WaterfallNotConserved`.
    WaterfallNotConserved,
}

impl fmt::Display for MathError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Overflow => write!(f, "math overflow"),
            Self::InvalidBps => write!(f, "invalid bps argument"),
            Self::InvalidPoolParams => write!(f, "invalid pool params"),
            Self::EscrowLocked => write!(f, "escrow locked"),
            Self::SeedDrawShortfall => write!(f, "seed-draw shortfall"),
            Self::EscrowNothingToRelease => write!(f, "escrow has nothing to release"),
            Self::WaterfallUnderflow => write!(f, "waterfall underflow"),
            Self::WaterfallNotConserved => write!(f, "waterfall not conserved"),
        }
    }
}

impl core::error::Error for MathError {}
