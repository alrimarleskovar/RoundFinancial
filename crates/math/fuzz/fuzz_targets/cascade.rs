//! Fuzz target for the Triple Shield seizure cascade.
//!
//! Catches: panics, overflows, and **invariant violations** in
//! `seize_for_default()`. Invariants asserted on every input:
//!
//!   1. `outcome.total() <= ins.missed` — never seize more than owed
//!   2. `outcome.from_solidarity <= ins.solidarity_available`
//!   3. `outcome.from_escrow <= ins.escrow_cap`
//!   4. `outcome.from_stake <= ins.stake_cap`
//!   5. Solidarity is exhausted before escrow is touched (waterfall
//!      ordering): if `solidarity_available >= missed`, escrow + stake
//!      must both be 0
//!
//! Why coverage-guided fuzz (vs. proptest): the cascade has nested
//! branches that depend on D/C invariant checks inside
//! `max_seizure_respecting_dc`. proptest samples uniformly; libfuzzer
//! preferentially mutates inputs that cross those branch boundaries,
//! which is where latent bugs live.

#![no_main]

use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;
use roundfi_math::{seize_for_default, CascadeInputs};

#[derive(Debug, Arbitrary)]
struct FuzzCascadeInput {
    // u64s clamped to "realistic-range" — full u64 space is mostly
    // unrealistic (a million times the size of the planet's economy)
    // and would just trip overflow checks immediately without
    // exercising the cascade logic.
    d_init: u32,
    d_rem: u32,
    c_init: u32,
    c_before: u32,
    missed: u32,
    solidarity_available: u32,
    escrow_cap: u32,
    stake_cap: u32,
}

impl From<FuzzCascadeInput> for CascadeInputs {
    fn from(f: FuzzCascadeInput) -> Self {
        CascadeInputs {
            // Scale u32 → u64 by multiplying by 1_000 so we land in
            // typical USDC base-unit ranges (~$10K credit = 10^10 base
            // units; u32 max ≈ 4*10^9, ×1000 ≈ 4*10^12, well inside u64).
            d_init: f.d_init as u64 * 1_000,
            d_rem: f.d_rem as u64 * 1_000,
            c_init: f.c_init as u64 * 1_000,
            c_before: f.c_before as u64 * 1_000,
            missed: f.missed as u64 * 1_000,
            solidarity_available: f.solidarity_available as u64 * 1_000,
            escrow_cap: f.escrow_cap as u64 * 1_000,
            stake_cap: f.stake_cap as u64 * 1_000,
        }
    }
}

fuzz_target!(|input: FuzzCascadeInput| {
    let ins: CascadeInputs = input.into();

    // The function is allowed to return MathError on overflow / D/C
    // violation — we only care that it doesn't panic, and that when
    // it returns Ok, the outcome respects the invariants.
    let Ok(outcome) = seize_for_default(ins) else { return };

    // Invariant 1: never seize more than owed.
    assert!(outcome.total() <= ins.missed,
        "cascade seized {} > missed {}", outcome.total(), ins.missed);

    // Invariant 2-4: per-source caps respected.
    assert!(outcome.from_solidarity <= ins.solidarity_available);
    assert!(outcome.from_escrow <= ins.escrow_cap);
    assert!(outcome.from_stake <= ins.stake_cap);

    // Invariant 5: solidarity exhausted before escrow / stake touched.
    if ins.solidarity_available >= ins.missed {
        assert_eq!(outcome.from_escrow, 0, "escrow touched while solidarity sufficient");
        assert_eq!(outcome.from_stake, 0, "stake touched while solidarity sufficient");
    }
});
