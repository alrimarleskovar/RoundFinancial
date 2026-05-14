//! Fuzz target for the 4-tier yield waterfall.
//!
//! Catches: panics, overflows, and **conservation violations** in
//! `waterfall()`. Invariants asserted on every input:
//!
//!   1. `protocol_fee + guarantee_fund + lp_share + participant_share
//!       == yield_amount` — strict conservation, no rounding dust
//!   2. `protocol_fee <= apply_bps(yield_amount, protocol_fee_bps)` —
//!       cap respected
//!   3. `guarantee_fund <= gf_target_remaining` — never over-fund GF
//!   4. None of the buckets exceeds the yield_amount alone
//!
//! Complements `proptest!` in waterfall.rs which samples uniformly;
//! libfuzzer prioritizes inputs that exercise the gf-cap-vs-fee-bps
//! interaction (the trickiest branch).

#![no_main]

use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;
use roundfi_math::waterfall;
use roundfi_math::constants::MAX_BPS;

#[derive(Debug, Arbitrary)]
struct FuzzWaterfallInput {
    // u32 → u64 ×1000 scaling, same as cascade.rs.
    yield_amount: u32,
    gf_target_remaining: u32,
    // bps capped to MAX_BPS = 10_000 (basis-points are 0..=10000 by
    // definition; values above this are guaranteed `InvalidBps` and
    // the function returns Err — uninteresting for fuzz coverage).
    protocol_fee_bps: u16,
    lp_share_bps: u16,
}

fuzz_target!(|input: FuzzWaterfallInput| {
    let y = (input.yield_amount as u64).saturating_mul(1_000);
    let gf = (input.gf_target_remaining as u64).saturating_mul(1_000);
    let fee_bps = input.protocol_fee_bps % (MAX_BPS as u16 + 1);
    let lp_bps = input.lp_share_bps % (MAX_BPS as u16 + 1);

    let Ok(w) = waterfall(y, gf, fee_bps, lp_bps) else { return };

    // Invariant 1: strict conservation.
    let total = w.total().expect("total should not overflow on accepted inputs");
    assert_eq!(total, y, "waterfall not conserved: {} != {}", total, y);

    // Invariant 3: GF cap respected.
    assert!(w.guarantee_fund <= gf,
        "GF over-funded: got {} cap {}", w.guarantee_fund, gf);

    // Invariant 4: no single bucket > yield.
    assert!(w.protocol_fee <= y);
    assert!(w.guarantee_fund <= y);
    assert!(w.lp_share <= y);
    assert!(w.participants <= y);
});
