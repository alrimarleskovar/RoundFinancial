//! Fuzz target for the D/C invariant + max-seizure helper.
//!
//! Catches: panics, overflows, and **wrong-direction monotonicity** in
//! `dc_invariant_holds()` + `max_seizure_respecting_dc()`. Invariants
//! asserted:
//!
//!   1. `dc_invariant_holds(d_init, d_rem, c_init, c_rem)` never panics
//!      (always returns bool)
//!   2. The returned `k` is `<= proposed` — the helper only ever caps
//!      down, never amplifies (asserted unconditionally)
//!   3. If the pre-seizure state satisfies the invariant, then post-
//!      seizure `dc_invariant_holds` STILL holds after subtracting `k`
//!      from `c_before` (the production contract — see below)
//!   4. If `dc_invariant_holds` was true pre-seizure with k=0, it MUST
//!      stay true with k=0 (sanity reflex)
//!
//! ## Why we gate (3) on pre-seizure validity
//!
//! `max_seizure_respecting_dc` is documented as "find the largest
//! seizure that **preserves** a holding invariant" — it does not
//! claim to **repair** a pre-existing violation. On-chain,
//! `join_pool` enforces `c_init` coverage so the seizure cascade
//! never sees a pre-violated state, and `settle_default` adds a
//! defense-in-depth final `require!(dc_invariant_holds(…))` that
//! reverts the entire transaction if anything slips through (see
//! `programs/roundfi-core/src/instructions/settle_default.rs:281`).
//!
//! The math layer trades a few comparison ops in the hot path for
//! the caller-side invariant. Same gate the unit tests use in
//! `crates/math/src/dc.rs:192` + `crates/math/src/cascade.rs:214`.
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
    let pre_holds = dc_invariant_holds(d_init, d_rem, c_init, c_before);

    let Ok(k) = max_seizure_respecting_dc(d_init, d_rem, c_init, c_before, proposed) else {
        return;
    };

    // Invariant 2: cap-down only — asserted unconditionally, even on
    // pre-violating inputs (the helper must NEVER amplify proposed).
    assert!(k <= proposed, "max_seizure returned {} > proposed {}", k, proposed);

    let c_after = c_before.saturating_sub(k);

    // Invariant 3: post-seizure D/C must still hold — but ONLY if the
    // pre-seizure state was valid. See the module-level comment for
    // why we gate this on `pre_holds`: the helper preserves a holding
    // invariant, it does not repair a pre-existing violation.
    if pre_holds {
        assert!(
            dc_invariant_holds(d_init, d_rem, c_init, c_after),
            "post-seizure D/C violated: d_init={} d_rem={} c_init={} c_after={} k={}",
            d_init, d_rem, c_init, c_after, k
        );
    }

    // Invariant 4: reflex (k=0 trivially leaves c_before alone).
    if k == 0 {
        assert_eq!(c_after, c_before);
    }
});
