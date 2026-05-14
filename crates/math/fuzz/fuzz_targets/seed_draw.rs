//! Fuzz target for Shield 1 — Month-1 retention floor.
//!
//! Catches: panics, overflows, and **floor-relationship violations**
//! in `seed_draw_floor()` + `retained_meets_seed_draw()`. Invariants
//! asserted:
//!
//!   1. `seed_draw_floor(N, inst, bps)` never panics on any input;
//!      returns either an explicit MathError or a u64
//!   2. The floor is `<= members_target * installment` (the absolute
//!      ceiling — you can't retain more than was contributed)
//!   3. `retained_meets_seed_draw` agrees with the inequality:
//!      result == (retained_balance >= floor)
//!   4. `seed_draw_floor` with bps=0 returns 0 (no retention required)
//!   5. `seed_draw_floor` with installment=0 returns 0
//!
//! Shield 1 is the FIRST layer of the Triple Shield invariant set.
//! On the on-chain side it's checked inside `claim_payout` at cycle 0
//! only — see `programs/roundfi-core/src/instructions/claim_payout.rs`.
//! A subtle off-by-1 here lets a small-scale attack drain the seed
//! retention without tripping the guard.

#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use roundfi_math::constants::MAX_BPS;
use roundfi_math::seed_draw::{retained_meets_seed_draw, seed_draw_floor};

#[derive(Debug, Arbitrary)]
struct FuzzSeedDrawInput {
    members_target: u8,
    installment: u32,
    seed_draw_bps: u16,
    retained_balance: u32,
}

fuzz_target!(|input: FuzzSeedDrawInput| {
    // u32 → u64 ×1000 scaling.
    let installment = (input.installment as u64).saturating_mul(1_000);
    let retained = (input.retained_balance as u64).saturating_mul(1_000);
    let bps = input.seed_draw_bps % (MAX_BPS as u16 + 1);

    // ─── seed_draw_floor invariants ────────────────────────────────
    let floor_result = seed_draw_floor(input.members_target, installment, bps);

    let floor = match floor_result {
        Ok(f) => f,
        Err(_) => return, // Overflow on members_target * installment is acceptable
    };

    // Invariant 2: floor <= members_target * installment (sanity ceiling).
    let max_month1 = (input.members_target as u128)
        .checked_mul(installment as u128)
        .and_then(|v| u64::try_from(v).ok());
    if let Some(max) = max_month1 {
        assert!(
            floor <= max,
            "seed_draw_floor({}, {}, {}) = {} > max_month1 {}",
            input.members_target,
            installment,
            bps,
            floor,
            max,
        );
    }

    // Invariant 4: bps = 0 → floor = 0
    if bps == 0 {
        assert_eq!(floor, 0);
    }

    // Invariant 5: installment = 0 → floor = 0
    if installment == 0 {
        assert_eq!(floor, 0);
    }

    // ─── retained_meets_seed_draw invariants ───────────────────────
    let Ok(meets) =
        retained_meets_seed_draw(input.members_target, installment, bps, retained)
    else {
        return; // Same accepted-Err path as above
    };

    // Invariant 3: agreement with the underlying inequality.
    assert_eq!(
        meets,
        retained >= floor,
        "retained_meets_seed_draw({}, {}, {}, {}) = {} but retained {} >= floor {} is {}",
        input.members_target,
        installment,
        bps,
        retained,
        meets,
        retained,
        floor,
        retained >= floor,
    );
});
