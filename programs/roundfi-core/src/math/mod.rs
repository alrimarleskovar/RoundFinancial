//! Pure-math helpers. No account state, no CPIs — designed for unit testing
//! against the Rust↔TS parity fixtures in Step 5.

pub mod bps;
pub mod escrow_vesting;
pub mod waterfall;

pub use bps::*;
pub use escrow_vesting::*;
pub use waterfall::*;
