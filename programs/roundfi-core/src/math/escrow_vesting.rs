use anchor_lang::prelude::*;

use crate::error::RoundfiError;

/// Linear vesting schedule: of `principal` units, return how much is
/// cumulatively vested once `checkpoint` of `total_checkpoints` milestones
/// have passed. Floor rounding; the final checkpoint always returns
/// exactly `principal` (no rounding dust left behind).
///
/// Used by `release_escrow` to compute how much stake a member is entitled
/// to pull back after N on-time cycles, given a total horizon of
/// `cycles_total` cycles.
pub fn cumulative_vested(
    principal:         u64,
    checkpoint:        u8,
    total_checkpoints: u8,
) -> Result<u64> {
    require!(total_checkpoints > 0, RoundfiError::InvalidPoolParams);
    require!(
        checkpoint <= total_checkpoints,
        RoundfiError::EscrowLocked,
    );

    if checkpoint == 0 {
        return Ok(0);
    }
    if checkpoint == total_checkpoints {
        return Ok(principal);
    }

    // principal * checkpoint / total — u128 intermediate to avoid overflow.
    let scaled = (principal as u128)
        .checked_mul(checkpoint as u128)
        .ok_or_else(|| error!(RoundfiError::MathOverflow))?
        .checked_div(total_checkpoints as u128)
        .ok_or_else(|| error!(RoundfiError::MathOverflow))?;
    u64::try_from(scaled).map_err(|_| error!(RoundfiError::MathOverflow))
}

/// Amount releasable on the *current* call — the delta between the
/// cumulative vested at `new_checkpoint` and what was already released at
/// `last_checkpoint`. Checked subtraction guards against monotonicity
/// violations elsewhere in the stack.
pub fn releasable_delta(
    principal:         u64,
    last_checkpoint:   u8,
    new_checkpoint:    u8,
    total_checkpoints: u8,
) -> Result<u64> {
    require!(
        new_checkpoint > last_checkpoint,
        RoundfiError::EscrowNothingToRelease,
    );
    let vested_now  = cumulative_vested(principal, new_checkpoint,  total_checkpoints)?;
    let vested_prev = cumulative_vested(principal, last_checkpoint, total_checkpoints)?;
    vested_now
        .checked_sub(vested_prev)
        .ok_or_else(|| error!(RoundfiError::MathOverflow))
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
        // Final checkpoint returns principal, regardless of division dust.
        assert_eq!(cumulative_vested(10_001, 24, 24).unwrap(), 10_001);
    }

    #[test]
    fn vest_linear_midpoint() {
        // 24-cycle pool, checkpoint 12 = half of principal.
        assert_eq!(cumulative_vested(10_000, 12, 24).unwrap(), 5_000);
    }

    #[test]
    fn releasable_delta_monotonic() {
        let d1 = releasable_delta(10_000, 0, 1,  24).unwrap();
        let d2 = releasable_delta(10_000, 1, 2,  24).unwrap();
        let d3 = releasable_delta(10_000, 2, 24, 24).unwrap();
        assert_eq!(d1 + d2 + d3, 10_000);
    }

    #[test]
    fn releasable_delta_rejects_backwards() {
        assert!(releasable_delta(10_000, 5, 4, 24).is_err());
        assert!(releasable_delta(10_000, 5, 5, 24).is_err());
    }
}
