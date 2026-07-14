//! Slot-draw permutation — the "sorteio" (random draw) ordering policy.
//!
//! Turns a 32-byte seed into a payout-order permutation for `n` pool
//! members. The output is a **bijection over `0..n`**: every payout slot
//! is filled exactly once and no member receives two slots. That
//! invariant is what keeps the ROSCA accounting sound no matter which
//! ordering policy a pool picks — a broken shuffle that double-assigns a
//! slot (or leaves one empty) would corrupt `slot_index == cycle`
//! downstream in `claim_payout` / `crank_payout`.
//!
//! **Scope boundary.** This module only turns bytes into a fair
//! permutation. It does **not** vouch for the seed's entropy — on-chain
//! the seed is expected to come from a verifiable randomness source (VRF)
//! bound at pool close, so no participant (or the pool authority) can
//! grind it. Feeding a predictable seed produces a predictable-but-still-
//! valid permutation; the fairness of the *draw* is only as good as the
//! fairness of the *seed*, which is the caller's responsibility.
//!
//! Pure + deterministic + allocation-free (the caller owns the output
//! slice), so it compiles to BPF unchanged and is fuzzable host-side.

use crate::error::MathError;

/// Upper bound on members a single draw supports. `members_target` is a
/// `u8` on-chain, so the largest real pool is 255; 256 is allowed here
/// only because member index `i` and slot value `i` both still fit `u8`
/// (max index `n - 1 = 255`).
pub const MAX_DRAW_MEMBERS: usize = 256;

/// One `splitmix64` step — a tiny, dependency-free PRNG. Chosen over
/// `rand` because that crate can't compile to the SBF target; splitmix64
/// is a single well-mixed 64-bit stream, more than enough entropy to
/// drive a Fisher–Yates over ≤ 256 elements.
#[inline]
fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Fold the 32-byte seed into a single `u64` PRNG state.
///
/// The four 8-byte chunks are XOR-mixed with a rotate between them so
/// they can't trivially cancel (e.g. two equal chunks XORing to zero).
/// An all-zero fold is nudged to a fixed non-zero constant so an
/// all-zero seed still yields a well-mixed stream rather than starting
/// splitmix at its fixed point.
#[inline]
fn seed_state(seed: &[u8; 32]) -> u64 {
    let mut s: u64 = 0;
    let mut i = 0;
    while i < 32 {
        let mut chunk = [0u8; 8];
        chunk.copy_from_slice(&seed[i..i + 8]);
        s ^= u64::from_le_bytes(chunk);
        s = s.rotate_left(17);
        i += 8;
    }
    if s == 0 {
        0x1234_5678_9ABC_DEF0
    } else {
        s
    }
}

/// Draw a payout-order permutation for `order.len()` members from `seed`.
///
/// Fills `order` in place so that `order[i] == j` means **member index
/// `i` receives in payout slot `j`** (slot `j` is contemplated in
/// cycle `j`). Because the result is a permutation of `0..n`, it inverts
/// cleanly: slot `j`'s recipient is the unique `i` with `order[i] == j`.
///
/// Uses the standard backward Fisher–Yates shuffle. The `% bound` step
/// carries a modulo bias of at most `bound / 2^64 ≤ 256 / 2^64 ≈ 1.4e-17`
/// — negligible, and it does not affect the bijection property (which is
/// exact regardless of bias).
///
/// # Errors
/// [`MathError::InvalidPoolParams`] if `order` is empty or longer than
/// [`MAX_DRAW_MEMBERS`].
pub fn draw_slot_order(seed: &[u8; 32], order: &mut [u8]) -> Result<(), MathError> {
    let n = order.len();
    if n == 0 || n > MAX_DRAW_MEMBERS {
        return Err(MathError::InvalidPoolParams);
    }

    // Identity permutation: member i → slot i (max i = n - 1 ≤ 255).
    for (i, slot) in order.iter_mut().enumerate() {
        *slot = i as u8;
    }

    // Backward Fisher–Yates: for i from n-1 down to 1, swap with a random
    // j in 0..=i. Produces a uniform permutation from a uniform PRNG.
    let mut state = seed_state(seed);
    let mut i = n - 1;
    while i >= 1 {
        let bound = (i as u64) + 1;
        let j = (splitmix64(&mut state) % bound) as usize;
        order.swap(i, j);
        i -= 1;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Assert `order` is a permutation of `0..order.len()`.
    fn assert_bijection(order: &[u8]) {
        let n = order.len();
        let mut seen = [false; MAX_DRAW_MEMBERS];
        for &s in order {
            let s = s as usize;
            assert!(s < n, "slot {s} out of range for n={n}");
            assert!(!seen[s], "slot {s} assigned twice");
            seen[s] = true;
        }
        // Every slot filled (no gaps).
        assert!(seen[..n].iter().all(|&b| b), "a slot was left unfilled");
    }

    #[test]
    fn empty_pool_is_rejected() {
        let seed = [7u8; 32];
        let mut order: [u8; 0] = [];
        assert_eq!(
            draw_slot_order(&seed, &mut order),
            Err(MathError::InvalidPoolParams)
        );
    }

    #[test]
    fn single_member_gets_slot_zero() {
        let seed = [0u8; 32];
        let mut order = [9u8; 1];
        draw_slot_order(&seed, &mut order).unwrap();
        assert_eq!(order, [0]);
    }

    #[test]
    fn draw_is_a_bijection_across_sizes() {
        for n in [2usize, 3, 5, 12, 64, 255] {
            let mut seed = [0u8; 32];
            seed[0] = n as u8;
            seed[13] = 0xAB;
            let mut order = vec![0u8; n];
            draw_slot_order(&seed, &mut order).unwrap();
            assert_bijection(&order);
        }
    }

    #[test]
    fn all_zero_seed_still_bijects_and_mixes() {
        // A degenerate all-zero seed must still produce a valid, non-identity
        // permutation for a reasonable n (the seed_state nudge guarantees the
        // stream isn't stuck at splitmix's fixed point).
        let seed = [0u8; 32];
        let mut order = vec![0u8; 16];
        draw_slot_order(&seed, &mut order).unwrap();
        assert_bijection(&order);
        let identity: Vec<u8> = (0..16u8).collect();
        assert_ne!(order, identity, "all-zero seed collapsed to the identity");
    }

    #[test]
    fn draw_is_deterministic() {
        let seed = [42u8; 32];
        let mut a = vec![0u8; 20];
        let mut b = vec![0u8; 20];
        draw_slot_order(&seed, &mut a).unwrap();
        draw_slot_order(&seed, &mut b).unwrap();
        assert_eq!(a, b, "same seed + n must yield the same order");
    }

    #[test]
    fn distinct_seeds_generally_differ() {
        let mut a = vec![0u8; 32];
        let mut b = vec![0u8; 32];
        draw_slot_order(&[1u8; 32], &mut a).unwrap();
        draw_slot_order(&[2u8; 32], &mut b).unwrap();
        assert_ne!(
            a, b,
            "different seeds should (overwhelmingly) differ for n=32"
        );
    }

    #[test]
    fn oversized_pool_is_rejected() {
        let seed = [1u8; 32];
        let mut order = vec![0u8; MAX_DRAW_MEMBERS + 1];
        assert_eq!(
            draw_slot_order(&seed, &mut order),
            Err(MathError::InvalidPoolParams)
        );
    }
}
