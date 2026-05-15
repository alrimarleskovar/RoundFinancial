//! Re-exports from the pure-Rust `roundfi-math` crate, plus thin adapter
//! wrappers that map `MathError` → `anchor_lang::error::Error` so the
//! existing `instructions/*.rs` call sites stay unchanged.
//!
//! See `crates/math/src/lib.rs` for the actual implementations. Issue
//! #229 extracted the pure-math layer so host-side clippy + proptest
//! run without Solana deps.

use anchor_lang::prelude::*;

use crate::error::RoundfiError;

// Re-export the pure types so call-sites that referenced `math::Waterfall`,
// `math::CascadeInputs`, etc. keep working byte-for-byte.
pub use roundfi_math::{CascadeInputs, CascadeOutcome, MathError, Waterfall};

/// Map a `MathError` variant to the corresponding Anchor-wrapped
/// `RoundfiError`. Centralized here so the variant mapping has a single
/// source-of-truth — adding a new MathError variant requires updating
/// this match exhaustively (compiler-enforced).
#[inline]
fn map_err(e: MathError) -> anchor_lang::error::Error {
    match e {
        MathError::Overflow => error!(RoundfiError::MathOverflow),
        MathError::InvalidBps => error!(RoundfiError::InvalidBps),
        MathError::InvalidPoolParams => error!(RoundfiError::InvalidPoolParams),
        MathError::EscrowLocked => error!(RoundfiError::EscrowLocked),
        MathError::SeedDrawShortfall => error!(RoundfiError::SeedDrawShortfall),
        MathError::EscrowNothingToRelease => error!(RoundfiError::EscrowNothingToRelease),
        MathError::WaterfallUnderflow => error!(RoundfiError::WaterfallUnderflow),
        MathError::WaterfallNotConserved => error!(RoundfiError::WaterfallNotConserved),
    }
}

// ─── bps ────────────────────────────────────────────────────────────────

#[inline]
pub fn apply_bps(amount: u64, bps: u16) -> Result<u64> {
    roundfi_math::apply_bps(amount, bps).map_err(map_err)
}

#[inline]
pub fn split_installment(
    installment: u64,
    solidarity_bps: u16,
    escrow_deposit_bps: u16,
) -> Result<(u64, u64, u64)> {
    roundfi_math::split_installment(installment, solidarity_bps, escrow_deposit_bps).map_err(map_err)
}

// ─── dc ─────────────────────────────────────────────────────────────────

/// Pure predicate — never errors, so no adapter needed.
#[inline]
pub fn dc_invariant_holds(d_init: u64, d_rem: u64, c_init: u64, c_rem: u64) -> bool {
    roundfi_math::dc_invariant_holds(d_init, d_rem, c_init, c_rem)
}

#[inline]
pub fn max_seizure_respecting_dc(
    d_init: u64,
    d_rem: u64,
    c_init: u64,
    c_before: u64,
    proposed: u64,
) -> Result<u64> {
    roundfi_math::max_seizure_respecting_dc(d_init, d_rem, c_init, c_before, proposed)
        .map_err(map_err)
}

// ─── seed_draw ──────────────────────────────────────────────────────────

#[inline]
pub fn seed_draw_floor(
    members_target: u8,
    installment_amount: u64,
    seed_draw_bps: u16,
) -> Result<u64> {
    roundfi_math::seed_draw::seed_draw_floor(members_target, installment_amount, seed_draw_bps)
        .map_err(map_err)
}

#[inline]
pub fn retained_meets_seed_draw(
    members_target: u8,
    installment_amount: u64,
    seed_draw_bps: u16,
    retained_balance: u64,
) -> Result<bool> {
    roundfi_math::retained_meets_seed_draw(
        members_target,
        installment_amount,
        seed_draw_bps,
        retained_balance,
    )
    .map_err(map_err)
}

/// SEV-031 runtime viability check — see
/// `roundfi_math::seed_draw::pool_is_viable` for math + audit context.
#[inline]
pub fn pool_is_viable(
    members_target: u8,
    installment_amount: u64,
    credit_amount: u64,
    solidarity_bps: u16,
    escrow_release_bps: u16,
) -> Result<bool> {
    roundfi_math::pool_is_viable(
        members_target,
        installment_amount,
        credit_amount,
        solidarity_bps,
        escrow_release_bps,
    )
    .map_err(map_err)
}

// ─── escrow_vesting ─────────────────────────────────────────────────────

#[inline]
pub fn cumulative_vested(
    principal: u64,
    checkpoint: u8,
    total_checkpoints: u8,
) -> Result<u64> {
    roundfi_math::cumulative_vested(principal, checkpoint, total_checkpoints).map_err(map_err)
}

#[inline]
pub fn releasable_delta(
    principal: u64,
    last_checkpoint: u8,
    new_checkpoint: u8,
    total_checkpoints: u8,
) -> Result<u64> {
    roundfi_math::releasable_delta(principal, last_checkpoint, new_checkpoint, total_checkpoints)
        .map_err(map_err)
}

// ─── cascade ────────────────────────────────────────────────────────────

#[inline]
pub fn seize_for_default(ins: CascadeInputs) -> Result<CascadeOutcome> {
    roundfi_math::seize_for_default(ins).map_err(map_err)
}

// ─── waterfall ──────────────────────────────────────────────────────────

#[inline]
pub fn waterfall(
    yield_amount: u64,
    gf_target_remaining: u64,
    protocol_fee_bps: u16,
    lp_share_bps: u16,
) -> Result<Waterfall> {
    roundfi_math::waterfall(yield_amount, gf_target_remaining, protocol_fee_bps, lp_share_bps)
        .map_err(map_err)
}

#[inline]
pub fn guarantee_fund_cap(
    total_protocol_fee_accrued: u64,
    guarantee_fund_bps: u16,
) -> Result<u64> {
    roundfi_math::guarantee_fund_cap(total_protocol_fee_accrued, guarantee_fund_bps)
        .map_err(map_err)
}

/// Mirrors the on-chain wrapper: emit `msg!` warning when current > cap
/// (operational anomaly worth logging), then delegate to the pure helper.
#[inline]
pub fn guarantee_fund_room(
    total_protocol_fee_accrued: u64,
    current_gf_balance: u64,
    guarantee_fund_bps: u16,
) -> Result<u64> {
    let cap = guarantee_fund_cap(total_protocol_fee_accrued, guarantee_fund_bps)?;
    if current_gf_balance > cap {
        msg!(
            "roundfi-core: WARN guarantee_fund_room current={} > cap={} (bps={}); clamping room to 0",
            current_gf_balance, cap, guarantee_fund_bps,
        );
    }
    roundfi_math::guarantee_fund_room(
        total_protocol_fee_accrued,
        current_gf_balance,
        guarantee_fund_bps,
    )
    .map_err(map_err)
}
