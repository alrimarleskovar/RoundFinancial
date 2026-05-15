//! `roundfi-math` — pure-Rust actuarial math for the RoundFi protocol.
//!
//! Extracted from `programs/roundfi-core/src/math/` (issue #229) so the
//! Triple Shield invariants compile + test on host `x86_64` without
//! pulling in Solana / Anchor / mpl-core dependencies. The on-chain
//! `roundfi-core` program re-exports from here via path dependency;
//! the BPF target uses the exact same compiled code.
//!
//! **Error strategy.** This crate defines its own [`MathError`] enum.
//! On the on-chain side, `programs/roundfi-core/src/math/mod.rs`
//! provides thin wrapper functions that map `MathError` → Anchor's
//! `Result<T, anchor_lang::error::Error>` at the boundary, so call
//! sites in `instructions/*.rs` are unchanged.
//!
//! **What's in scope here:**
//! - `bps` — basis-point arithmetic + installment split
//! - `cascade` — recursive Triple Shield default seizure waterfall
//! - `dc` — D/C invariant (debt-collateral cross-multiplied bound)
//! - `escrow_vesting` — linear vesting + release-on-checkpoint math
//! - `seed_draw` — Month-1 retention floor (Shield 1)
//! - `waterfall` — yield-distribution math (Fee → GF → LP → Participants)
//!
//! **What's NOT in scope:**
//! - PDA derivations (need `solana_program::Pubkey`)
//! - Account layouts (need `anchor_lang::AccountDeserialize`)
//! - Logging (no `msg!` macro available host-side)
//! - mpl-core asset semantics

#![forbid(unsafe_code)]
#![deny(rust_2018_idioms)]

pub mod bps;
pub mod cascade;
pub mod constants;
pub mod dc;
pub mod error;
pub mod escrow_vesting;
pub mod seed_draw;
pub mod waterfall;

pub use bps::{apply_bps, split_installment};
pub use cascade::{seize_for_default, CascadeInputs, CascadeOutcome};
pub use constants::MAX_BPS;
pub use dc::{dc_invariant_holds, max_seizure_respecting_dc};
pub use error::MathError;
pub use escrow_vesting::{
    compute_release_delta_target,
    cumulative_vested,
    derive_total_released,
    releasable_delta,
};
pub use seed_draw::{pool_is_viable, retained_meets_seed_draw, seed_draw_floor};
pub use waterfall::{guarantee_fund_cap, guarantee_fund_room, waterfall, Waterfall};
