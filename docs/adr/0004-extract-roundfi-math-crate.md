# ADR 0004 — Extract `roundfi-math` as standalone workspace crate

**Status:** ✅ Accepted
**Date:** 2026-05-14
**Decision-makers:** Engineering
**Related:** PR #257 (extraction), Issue [#229](https://github.com/alrimarleskovar/RoundFinancial/issues/229)

## Context

`programs/roundfi-core/src/math/` had grown to 6 modules / 1233 LoC of pure-math logic:

- `bps.rs` — basis-points arithmetic
- `cascade.rs` — Triple Shield seizure cascade
- `dc.rs` — D/C invariant
- `escrow_vesting.rs` — linear vesting math
- `seed_draw.rs` — Shield 1 floor
- `waterfall.rs` — yield distribution

These modules:

- **Don't use** Solana types (Pubkey, Account, Clock)
- **Don't use** mpl-core
- **Don't use** Anchor runtime (only the `Result` type alias + `error!()` macro)

But because they lived inside `programs/roundfi-core`:

- They couldn't run `cargo clippy --all-targets` on the host (mpl-core 0.8 ↔ solana-pubkey 1.18 type conflict surfaces only on x86_64)
- They couldn't run `cargo test` on the host — only via `cargo test-sbf` under the slow Anchor lane
- `cargo tarpaulin` (coverage) couldn't measure them
- Proptest fuzzing required bankrun setup

This blocked publishing test coverage % (a critical-review feedback item) + running host-side property-based fuzzing.

## Decision

**We will extract the pure-math modules into a standalone workspace crate at `crates/math/` with the package name `roundfi-math`.**

The crate has:

- Zero Solana / Anchor / mpl-core dependencies
- A native `MathError` enum (replaces Anchor's `Result<T>` + `error!()` macro)
- All 6 modules + their unit tests
- `proptest = "1"` as a dev-dependency for property-based fuzzing
- `#![forbid(unsafe_code)]` enforced at the crate root

`programs/roundfi-core/src/math/mod.rs` becomes a thin adapter layer:

- Re-exports types (`CascadeInputs`, `CascadeOutcome`, `Waterfall`, `MathError`)
- Wraps each pure function with `map_err(map_err_fn)` to convert `MathError` → `anchor_lang::error::Error` via the existing `RoundfiError` variants

Call-site code in `instructions/*.rs` is **unchanged byte-for-byte** — only 4 import paths needed updating (`crate::math::seed_draw::X` → `crate::math::X`).

## Consequences

- ✅ `cargo clippy -p roundfi-math --all-targets -- -D warnings` runs clean on host
- ✅ `cargo test -p roundfi-math` — 66 unit tests + 6 proptest invariants (~1500 random cases) in ~10ms (vs ~30s for the SBF equivalent)
- ✅ `cargo tarpaulin -p roundfi-math` — **90.91% coverage** measured (baseline for PR #269 coverage CI lane)
- ✅ Surface area for audit scope shrinks slightly (math layer becomes "pure-Rust, audit reviewed independently")
- ✅ Side discovery: D/C invariant exhaustive grid test surfaced 2 pre-existing latent bugs that the SBF tests had never exposed (pre-violation states the seizure helper can't fix; fixed with explicit `continue` gates)
- ⚠️ Cargo.lock changes — `roundfi_core.so` bytecode shifts slightly. Devnet redeploy + OtterSec attestation refresh required as part of the next deploy sprint
- ⚠️ Adapter wrapper boilerplate — ~190 LoC of wrap-and-rethrow in `programs/roundfi-core/src/math/mod.rs`. Costs slightly more code than direct calls but localizes the error conversion
- ❌ Future contributors must remember: NO Solana types in `roundfi-math/`. Enforced by `#![forbid(unsafe_code)]` + Cargo.toml has zero solana deps

## Alternatives considered

### Keep everything in `programs/roundfi-core/src/math/` and accept host-side untestability

**Rejected** because: test coverage % was a critical-review feedback item; the team needed a quantitative answer for auditors. Also, the math layer is exactly the kind of code where proptest shines (pure functions, deterministic, no I/O).

### Make the math crate a thin Rust library separate from the workspace

**Rejected** because: workspace path dependency is simpler than versioned cargo dep. No reason to publish `roundfi-math` to crates.io (it's not externally consumable in a meaningful way — couplings to `RoundfiError` constants like the bps denominator make it RoundFi-specific).

### Move math to a separate language (TypeScript, Python)

**Rejected** because: the `programs/roundfi-core` Anchor program IS the chain-side truth. The L1 simulator (`sdk/src/stressLab.ts`) already exists in TypeScript and parity-tests against the Rust side. Moving math out of Rust would break this parity.

## References

- Crate: `crates/math/`
- Adapter: `programs/roundfi-core/src/math/mod.rs`
- Workspace Cargo.toml entry
- Issue [#229](https://github.com/alrimarleskovar/RoundFinancial/issues/229) — original proposal
- Coverage report: [`docs/operations/test-coverage.md`](../operations/test-coverage.md)
- ADR [0002](./0002-idl-free-sdk-encoders.md) — companion pure-function philosophy on the TS side
