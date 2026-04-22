//! Cross-Program Invocation helpers.
//!
//! All adapter integrations go through the wrappers in this module. Each
//! wrapper treats the target program as UNTRUSTED — it validates the
//! program id against an expected pubkey, snapshots balances before the
//! CPI, and returns the *actual* delta so callers never rely on the
//! adapter's return values for accounting.

pub mod yield_adapter;

pub use yield_adapter::*;
