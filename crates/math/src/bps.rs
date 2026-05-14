//! Basis-point arithmetic for the protocol.
//!
//! Migrated from `programs/roundfi-core/src/math/bps.rs` to a pure-Rust
//! crate so host-side clippy + cargo test run without Solana deps
//! (issue #229). Behavior is byte-for-byte identical — only the error
//! type changed (`MathError` instead of `RoundfiError`).

use crate::constants::MAX_BPS;
use crate::error::MathError;

/// Multiply `amount` by `bps` / MAX_BPS with floor rounding and overflow
/// checks. Unlike a naive `amount * bps / 10_000`, this uses u128
/// intermediates to survive `amount == u64::MAX` and `bps == 10_000`.
#[inline]
pub fn apply_bps(amount: u64, bps: u16) -> Result<u64, MathError> {
    let scaled = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(MathError::Overflow)?
        .checked_div(MAX_BPS as u128)
        .ok_or(MathError::Overflow)?;
    u64::try_from(scaled).map_err(|_| MathError::Overflow)
}

/// Split an installment into three buckets: solidarity, escrow-deposit, and
/// pool float. The pool float absorbs any bps rounding residual so the
/// three buckets sum exactly to `installment` — a hard requirement for
/// invariant #3 (solidarity conservation).
#[inline]
pub fn split_installment(
    installment: u64,
    solidarity_bps: u16,
    escrow_deposit_bps: u16,
) -> Result<(u64, u64, u64), MathError> {
    let sum_bps = (solidarity_bps as u32)
        .checked_add(escrow_deposit_bps as u32)
        .ok_or(MathError::Overflow)?;
    if sum_bps > MAX_BPS as u32 {
        return Err(MathError::InvalidBps);
    }

    let solidarity_amt = apply_bps(installment, solidarity_bps)?;
    let escrow_deposit = apply_bps(installment, escrow_deposit_bps)?;
    let non_float = solidarity_amt
        .checked_add(escrow_deposit)
        .ok_or(MathError::Overflow)?;
    let pool_amt = installment.checked_sub(non_float).ok_or(MathError::Overflow)?;
    Ok((solidarity_amt, escrow_deposit, pool_amt))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_bps_basic() {
        assert_eq!(apply_bps(1_000, 100).unwrap(), 10); // 1%
        assert_eq!(apply_bps(1_000, 2_500).unwrap(), 250); // 25%
        assert_eq!(apply_bps(1_000, 10_000).unwrap(), 1_000); // 100%
        assert_eq!(apply_bps(1_000, 0).unwrap(), 0);
    }

    #[test]
    fn apply_bps_survives_u64_max() {
        // u64::MAX * 10_000 overflows u64 but fits in u128.
        let r = apply_bps(u64::MAX, 10_000).unwrap();
        assert_eq!(r, u64::MAX);
    }

    #[test]
    fn split_installment_conserves() {
        // 416 USDC, 1% solidarity, 25% escrow
        let (s, e, p) = split_installment(416_000_000, 100, 2_500).unwrap();
        assert_eq!(s, 4_160_000);
        assert_eq!(e, 104_000_000);
        assert_eq!(p, 416_000_000 - 4_160_000 - 104_000_000);
        assert_eq!(s + e + p, 416_000_000);
    }

    #[test]
    fn split_installment_rejects_oversplit() {
        // solidarity + escrow > 100% is rejected
        assert!(matches!(
            split_installment(1_000, 5_000, 6_000),
            Err(MathError::InvalidBps),
        ));
    }
}
