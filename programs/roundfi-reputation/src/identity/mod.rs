//! `identity` — provider validators.
//!
//! Each module here treats the external identity program as UNTRUSTED.
//! Validators always perform:
//!   1. Account owner check — the *program* that owns the account must
//!      be the provider program ID declared in `ReputationConfig`.
//!   2. Raw-byte deserialization against a fixed layout (no Anchor trust).
//!   3. Field-level invariant checks (status, expiry, network, subject).
//! On any mismatch they return `Err(ReputationError::InvalidIdentityProof)`.

pub mod passport;
pub use passport::*;
