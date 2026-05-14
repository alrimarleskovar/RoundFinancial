//! Linear escrow-vesting schedule for `release_escrow`.

use crate::error::MathError;

/// Linear vesting schedule: of `principal` units, return how much is
/// cumulatively vested once `checkpoint` of `total_checkpoints` milestones
/// have passed. Floor rounding; the final checkpoint always returns
/// exactly `principal` (no rounding dust left behind).
pub fn cumulative_vested(
    principal: u64,
    checkpoint: u8,
    total_checkpoints: u8,
) -> Result<u64, MathError> {
    if total_checkpoints == 0 {
        return Err(MathError::InvalidPoolParams);
    }
    if checkpoint > total_checkpoints {
        return Err(MathError::EscrowLocked);
    }

    if checkpoint == 0 {
        return Ok(0);
    }
    if checkpoint == total_checkpoints {
        return Ok(principal);
    }

    let scaled = (principal as u128)
        .checked_mul(checkpoint as u128)
        .ok_or(MathError::Overflow)?
        .checked_div(total_checkpoints as u128)
        .ok_or(MathError::Overflow)?;
    u64::try_from(scaled).map_err(|_| MathError::Overflow)
}

/// Amount releasable on the *current* call — the delta between the
/// cumulative vested at `new_checkpoint` and what was already released at
/// `last_checkpoint`. Checked subtraction guards against monotonicity
/// violations elsewhere in the stack.
pub fn releasable_delta(
    principal: u64,
    last_checkpoint: u8,
    new_checkpoint: u8,
    total_checkpoints: u8,
) -> Result<u64, MathError> {
    if new_checkpoint <= last_checkpoint {
        return Err(MathError::EscrowNothingToRelease);
    }
    let vested_now = cumulative_vested(principal, new_checkpoint, total_checkpoints)?;
    let vested_prev = cumulative_vested(principal, last_checkpoint, total_checkpoints)?;
    vested_now.checked_sub(vested_prev).ok_or(MathError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vest_zero_at_start() {
        assert_eq!(cumulative_vested(10_000, 0, 24).unwrap(), 0);
    }

    #[test]
    fn vest_full_at_end() {
        assert_eq!(cumulative_vested(10_001, 24, 24).unwrap(), 10_001);
    }

    #[test]
    fn vest_linear_midpoint() {
        assert_eq!(cumulative_vested(10_000, 12, 24).unwrap(), 5_000);
    }

    #[test]
    fn releasable_delta_monotonic() {
        let d1 = releasable_delta(10_000, 0, 1, 24).unwrap();
        let d2 = releasable_delta(10_000, 1, 2, 24).unwrap();
        let d3 = releasable_delta(10_000, 2, 24, 24).unwrap();
        assert_eq!(d1 + d2 + d3, 10_000);
    }

    #[test]
    fn releasable_delta_rejects_backwards() {
        assert!(releasable_delta(10_000, 5, 4, 24).is_err());
        assert!(releasable_delta(10_000, 5, 5, 24).is_err());
    }

    #[test]
    fn vest_final_returns_exact_principal_without_dust() {
        assert_eq!(cumulative_vested(10_001, 24, 24).unwrap(), 10_001);
        assert_eq!(cumulative_vested(u64::MAX, 24, 24).unwrap(), u64::MAX);
    }

    #[test]
    fn vest_rejects_zero_total_checkpoints() {
        assert!(cumulative_vested(1_000, 0, 0).is_err());
        assert!(cumulative_vested(1_000, 1, 0).is_err());
    }

    #[test]
    fn vest_rejects_checkpoint_above_total() {
        assert!(cumulative_vested(1_000, 25, 24).is_err());
        assert!(cumulative_vested(1_000, u8::MAX, 24).is_err());
    }

    #[test]
    fn releasable_delta_sum_equals_principal_across_full_horizon() {
        for principal in [1u64, 24, 10_000, 10_001, 999_999, u64::MAX] {
            let mut sum: u64 = 0;
            for c in 1u8..=24 {
                sum = sum
                    .checked_add(releasable_delta(principal, c - 1, c, 24).unwrap())
                    .expect("sum overflow");
            }
            assert_eq!(sum, principal, "releasable sum != principal for {principal}");
        }
    }

    #[test]
    fn vest_at_boundary_checkpoint_matches_proportion() {
        assert_eq!(cumulative_vested(240, 1, 24).unwrap(), 10);
        assert_eq!(cumulative_vested(240, 6, 24).unwrap(), 60);
        assert_eq!(cumulative_vested(240, 12, 24).unwrap(), 120);
        assert_eq!(cumulative_vested(240, 23, 24).unwrap(), 230);
        assert_eq!(cumulative_vested(240, 24, 24).unwrap(), 240);
    }
}
