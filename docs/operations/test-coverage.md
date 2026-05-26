# Test Coverage Reports — RoundFi

> **Status:** initial coverage report shipped May 2026. Tracked in issue (TBD). Recurring CI publication pending.

## Current snapshot (2026-05-14)

### `roundfi-math` crate — **90.91% line coverage**

110 of 121 lines covered. Generated via:

```bash
cargo tarpaulin \
  --packages roundfi-math \
  --exclude-files "programs/**/*" \
  --out Lcov --output-dir coverage/math/
```

| File                                | Coverage   | Lines |
| ----------------------------------- | ---------- | ----- |
| `crates/math/src/bps.rs`            | **100%**   | 20/20 |
| `crates/math/src/cascade.rs`        | **100%**   | 14/14 |
| `crates/math/src/dc.rs`             | **100%**   | 21/21 |
| `crates/math/src/escrow_vesting.rs` | **100%**   | 21/21 |
| `crates/math/src/seed_draw.rs`      | **100%**   | 9/9   |
| `crates/math/src/waterfall.rs`      | **96.15%** | 25/26 |
| `crates/math/src/error.rs`          | 0%         | 0/10  |

**Note on `error.rs`:** the `MathError` enum's `Display` impl + `Error` trait impl are not exercised by tests today (callers use direct variant matching). Not a real coverage gap — the enum variants themselves ARE tested via the math modules that return them. Could add 6 `format!()` smoke tests in a follow-up if the 0% line bothers reviewers.

## Why only `roundfi-math` today

The `programs/roundfi-core` + `programs/roundfi-reputation` + `programs/roundfi-yield-{mock,kamino}` crates **do not compile on host x86_64** due to the mpl-core 0.8 ↔ solana-program 1.18 `Pubkey` type-confusion documented in [`.github/workflows/ci.yml:68-84`](../.github/workflows/ci.yml). They only compile to the SBF target.

`cargo tarpaulin` runs on the host target. So coverage is available **only for crates that have zero on-chain deps** — which today is exclusively `crates/math/`.

> **Runtime coverage of the on-chain path (separate from tarpaulin line coverage).** The mpl_core CPI path is no longer uncovered or bankrun-only: it now runs in a **required** `litesvm · mpl-core path` CI lane, which loads the SBFv2 `mpl_core.so` that bankrun's `solana-program-test 1.18` panics on and exercises the `create_pool` / `join_pool` NFT-minting lifecycle. The `bankrun · no-mpl-core` lane covers the no-mpl-core subset. These exercise the programs at runtime; the host-target tarpaulin line numbers below still wait on #230.

**Path to full workspace coverage:**

1. Land [#230](https://github.com/alrimarleskovar/RoundFinancial/issues/230) (Agave 2.x migration) — fixes the mpl-core ↔ solana-pubkey conflict at the host level
2. Then tarpaulin can run against the full workspace
3. Estimated coverage post-migration: high (most logic paths are exercised at runtime by `tests/security_*.spec.ts` via bankrun (`bankrun · no-mpl-core` lane) and by the mpl_core-dependent specs via the required `litesvm · mpl-core path` lane)

## How to regenerate

```bash
# One-shot, scoped to math crate (works today):
cargo tarpaulin --packages roundfi-math --exclude-files "programs/**/*" \
                --out Lcov --output-dir coverage/math/

# Full workspace (will work after #230 lands):
cargo tarpaulin --workspace --out Lcov --output-dir coverage/
```

## Follow-up

- **Issue (pending):** automate coverage report generation in CI; publish LCOV to Codecov or similar; track regressions per PR
- **Issue (pending):** add 6 smoke tests for `MathError::Display` to close the 9% gap in `error.rs`

## Cross-refs

- Issue [#229](https://github.com/alrimarleskovar/RoundFinancial/issues/229) — extracted `roundfi-math` crate (made this report possible)
- [`crates/math/`](../crates/math/) — the crate being measured
- [`docs/operations/agave-2x-migration-plan.md`](../docs/operations/agave-2x-migration-plan.md) — unblocks full-workspace coverage

---

_Last updated: 2026-05-14. Regenerate this report whenever `crates/math/` changes substantively._
