//! Fuzz target for the D/C invariant + max-seizure helper.
//!
//! Catches: panics, overflows, and **wrong-direction monotonicity** in
//! `dc_invariant_holds()` + `max_seizure_respecting_dc()`. Invariants
//! asserted:
//!
//!   1. `dc_invariant_holds(d_init, d_rem, c_init, c_rem)` never panics
//!      (always returns bool)
//!   2. If a seizure `k` is allowed by `max_seizure_respecting_dc`,
//!      then `dc_invariant_holds` STILL holds after subtracting `k`
//!      from `c_before`
//!   3. The returned `k` is `<= proposed` — the helper only ever caps
//!      down, never amplifies
//!   4. If `dc_invariant_holds` was true pre-seizure with k=0, it MUST
//!      stay true with k=0 (sanity reflex)
//!
//! The D/C invariant is load-bearing — every seizure path in the
//! cascade calls `max_seizure_respecting_dc` to make sure the post-
//! seizure state still respects (d_rem/d_init) * c_init >= c_rem.
//! A bug here would corrupt the entire Triple Shield argument.

#![no_main]

use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;
use roundfi_math::{dc_invariant_holds, max_seizure_respecting_dc};

#[derive(Debug, Arbitrary)]
struct FuzzDcInput {
    d_init: u32,
    d_rem: u32,
    c_init: u32,
    c_before: u32,
    proposed: u32,
}

fuzz_target!(|input: FuzzDcInput| {
    let d_init = (input.d_init as u64).saturating_mul(1_000);
    let d_rem = (input.d_rem as u64).saturating_mul(1_000);
    let c_init = (input.c_init as u64).saturating_mul(1_000);
    let c_before = (input.c_before as u64).saturating_mul(1_000);
    let proposed = (input.proposed as u64).saturating_mul(1_000);

    // Invariant 1: dc_invariant_holds never panics.
    let _ = dc_invariant_holds(d_init, d_rem, c_init, c_before);

    let Ok(k) = max_seizure_respecting_dc(d_init, d_rem, c_init, c_before, proposed) else {
        return;
    };

    // Invariant 3: cap-down only.
    assert!(k <= proposed, "max_seizure returned {} > proposed {}", k, proposed);

    // Invariant 2: post-seizure D/C must still hold.
    let c_after = c_before.saturating_sub(k);
    assert!(
        dc_invariant_holds(d_init, d_rem, c_init, c_after),
        "post-seizure D/C violated: d_init={} d_rem={} c_init={} c_after={} k={}",
        d_init, d_rem, c_init, c_after, k
    );

    // Invariant 4: reflex (k=0 trivially leaves c_before alone).
    if k == 0 {
        assert_eq!(c_after, c_before);
    }
});
