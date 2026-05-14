//! Fuzz target for linear escrow vesting math.
//!
//! Catches: panics, overflows, and **monotonicity / exact-principal
//! violations** in `cumulative_vested()` + `releasable_delta()`.
//! Invariants asserted:
//!
//!   1. `cumulative_vested(P, k, T)` is monotonic in `k`:
//!      `vested(k+1) >= vested(k)` for valid k
//!   2. `cumulative_vested(P, T, T) == P` — exact-principal rule at
//!      the final checkpoint (no rounding dust left behind, this is
//!      the load-bearing escrow-vesting invariant)
//!   3. `cumulative_vested(P, 0, T) == 0` — zero checkpoint releases
//!      nothing
//!   4. `releasable_delta(P, last, new, T) == vested(new) - vested(last)`
//!      when both succeed
//!   5. `cumulative_vested` never returns > principal
//!
//! These are the same shape as the existing proptest invariants for
//! waterfall — fuzzing them surfaces edge cases proptest's uniform
//! sampling rarely hits (e.g., very tiny principals where integer
//! division rounds to zero, near-overflow checkpoint products).

#![no_main]

use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;
use roundfi_math::{cumulative_vested, releasable_delta};

#[derive(Debug, Arbitrary)]
struct FuzzEscrowInput {
    principal: u32,
    checkpoint: u8,
    total_checkpoints: u8,
    last_checkpoint: u8,
}

fuzz_target!(|input: FuzzEscrowInput| {
    let p = (input.principal as u64).saturating_mul(1_000);
    let total = input.total_checkpoints;
    let k = input.checkpoint;
    let last = input.last_checkpoint;

    // total_checkpoints == 0 is rejected with InvalidPoolParams — not
    // interesting to fuzz, skip.
    if total == 0 {
        return;
    }

    let Ok(v_k) = cumulative_vested(p, k, total) else { return };

    // Invariant 5: vested <= principal.
    assert!(v_k <= p, "vested {} > principal {}", v_k, p);

    // Invariant 3: zero checkpoint → zero vested.
    if k == 0 {
        assert_eq!(v_k, 0);
    }

    // Invariant 2: final checkpoint releases exactly principal.
    if k == total {
        assert_eq!(v_k, p,
            "final-checkpoint exact-principal rule broken: vested {} principal {}", v_k, p);
    }

    // Invariant 1: monotonic in k (only test if k+1 doesn't overflow u8
    // and is <= total — otherwise vested returns Err, uninteresting).
    if k < u8::MAX && k + 1 <= total {
        if let Ok(v_next) = cumulative_vested(p, k + 1, total) {
            assert!(v_next >= v_k,
                "non-monotonic: vested({})={} > vested({})={}", k + 1, v_next, k, v_k);
        }
    }

    // Invariant 4: releasable_delta consistency.
    if last < k && k <= total {
        if let Ok(delta) = releasable_delta(p, last, k, total) {
            let Ok(v_last) = cumulative_vested(p, last, total) else { return };
            let expected = v_k.saturating_sub(v_last);
            assert_eq!(delta, expected,
                "releasable_delta({}, {}, {}, {})={} != vested({})-vested({})={}",
                p, last, k, total, delta, k, last, expected);
        }
    }
});
