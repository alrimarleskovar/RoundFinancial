//! Fuzz target for the sorteio (random-draw) ordering permutation.
//!
//! The one property that MUST hold for every seed and every pool size is
//! that `draw_slot_order` produces a **bijection over `0..n`** — every
//! payout slot filled exactly once, no member assigned two slots. A
//! violation would corrupt the `slot_index == cycle` invariant that
//! `claim_payout` / `crank_payout` rely on. Invariants asserted:
//!
//!   1. `draw_slot_order` never panics on any (seed, n).
//!   2. `n == 0` returns an explicit error (never a silent empty fill).
//!   3. For `1 <= n <= MAX_DRAW_MEMBERS`, the output is a permutation of
//!      `0..n`: every value < n, no duplicates, no gaps.
//!   4. The draw is deterministic — same (seed, n) yields the same order.

#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use roundfi_math::slot_draw::{draw_slot_order, MAX_DRAW_MEMBERS};

#[derive(Debug, Arbitrary)]
struct FuzzSlotDrawInput {
    seed: [u8; 32],
    n: u8,
}

fuzz_target!(|input: FuzzSlotDrawInput| {
    let n = input.n as usize;
    let mut order = vec![0u8; n];
    let res = draw_slot_order(&input.seed, &mut order);

    // Invariant 2: empty pool is an explicit error.
    if n == 0 {
        assert!(res.is_err(), "n == 0 must error, not silently succeed");
        return;
    }

    // Invariant 1 + 3: succeeds and the fill is a bijection over 0..n.
    assert!(res.is_ok(), "draw_slot_order errored for valid n={n}");
    let mut seen = [false; MAX_DRAW_MEMBERS];
    for &s in &order {
        let s = s as usize;
        assert!(s < n, "slot {s} out of range for n={n}");
        assert!(!seen[s], "slot {s} assigned twice");
        seen[s] = true;
    }
    assert!(
        seen[..n].iter().all(|&b| b),
        "a slot was left unfilled for n={n}"
    );

    // Invariant 4: determinism.
    let mut order2 = vec![0u8; n];
    draw_slot_order(&input.seed, &mut order2).unwrap();
    assert_eq!(
        order, order2,
        "non-deterministic draw for the same seed + n"
    );
});
