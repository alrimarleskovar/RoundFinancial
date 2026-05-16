# Spike #319 — Agave 2.x migration: dependency map + effort estimate

> **What this is:** a planning spike — empirical investigation of what it takes
> to unblock the `anchor build` IDL path (currently worked around via
> [`scripts/dev/patch-anchor-syn-319.sh`](../scripts/dev/patch-anchor-syn-319.sh))
> by migrating the workspace to Anchor 0.31+ / Solana 3.x / mpl-core 0.12. NOT
> an implementation — produces dependency graph, captures exact failure modes,
> and estimates effort so a future implementation sprint has accurate scope.
>
> **Companion:**
>
> - [`scripts/dev/patch-anchor-syn-319.sh`](../scripts/dev/patch-anchor-syn-319.sh) — current registry-patch workaround for the IDL build (unblocks specs that need typed `Program` handles)
> - [`scripts/dev/rebuild-idls.sh`](../scripts/dev/rebuild-idls.sh) — wraps the patch + emits IDLs
> - [`MAINNET_READINESS.md`](../MAINNET_READINESS.md) row 1.7 — empirical confirmation note (May 2026)

## TL;DR

| Question                          | Answer                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Is #319 a 1-2 day fix?**        | **No.** Multi-day, multi-PR migration. Likely 3-5 working days for a focused sprint.                                                                                                                                                                                                                                              |
| **Why can't we bump piecemeal?**  | Cargo's version unifier deadlocks on `zeroize` / `curve25519-dalek` when `mpl-core 0.12` (`solana-program 3.x`) coexists with `anchor-lang 0.30.1` (`solana-program 1.17.x`). Captured failure output in §3 below.                                                                                                                |
| **Workaround viability**          | The current `patch-anchor-syn-319.sh` + `rebuild-idls.sh` combo unblocks every concrete need (bankrun specs, IDL gen). The spike's IDL files match Anchor.toml. The only thing `--no-idl + manual rebuild` doesn't give us is upstream IDL generation in CI — which is a separate, smaller fix.                                   |
| **What forces a real migration?** | Either: (a) we need an Anchor 0.31+ feature (none currently required), (b) we need mpl-core 0.12+ (no concrete blocker — current 0.8 covers position NFT minting + freeze/transfer delegate ops we use), (c) Agave 2.x deprecates 1.x program loader (per Anza roadmap; no hard date). **None is urgent for mainnet GA Q4 2026.** |

## 1. Current state (verified 2026-05-16)

| Component          | Workspace pin                                        | Latest available | Gap                                                                                                                                      |
| ------------------ | ---------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `anchor-lang`      | `0.30.1` (Cargo.toml + Anchor.toml `anchor_version`) | `0.31.x`         | 1 minor                                                                                                                                  |
| `solana-program`   | `1.18.26` (Cargo.lock, via anchor 0.30.1 transitive) | `3.0.x`          | 2 major                                                                                                                                  |
| `mpl-core`         | `=0.8.0` (Cargo.toml — explicit pin)                 | `0.12.x`         | 1 minor + breaking                                                                                                                       |
| `proc-macro2`      | `1.0.106` (Cargo.lock, transitive)                   | `1.0.106`        | up-to-date, but removed `Span::source_file()` post-1.0.94 → broke `anchor-syn 0.30.1` IDL builder. **This is the root surface of #319.** |
| Solana CLI / Agave | 3.0.0 installed on dev boxes                         | 3.0.x            | matches — toolchain itself is fine                                                                                                       |
| Rustc              | 1.94.1 stable                                        | 1.94.x           | matches                                                                                                                                  |

The Solana CLI / toolchain is already on Agave 3.x — what's blocked is the workspace dependency graph.

## 2. Workaround currently in main

`scripts/dev/patch-anchor-syn-319.sh` patches the cached `anchor-syn-0.30.1` source in `~/.cargo/registry/src` to swap the `#[cfg(procmacro2_semver_exempt)]` gate at `defined.rs:493` for `#[cfg(any())]` (always-false). The block that calls `proc_macro2::Span::call_site().source_file()` is excluded; rest of the IDL builder works. Tradeoff: external type-alias resolution in IDL gen is disabled — roundfi-\* programs don't use that pattern, so safe for this workspace.

Combined with `scripts/dev/rebuild-idls.sh` (which applies the patch then runs `anchor idl build --program-name <prog> -o target/idl/<prog>.json`), this gives us correct IDL JSONs with `address` matching Anchor.toml. Bankrun specs that need typed `Program` handles work end-to-end (validated in PR #360 Items L + M with 3 specs migrated 2/2 + 4/4 + 3/3 green).

**Caveat**: the workaround mutates the user's local Cargo registry cache. It's idempotent + reversible (`rm -rf ~/.cargo/registry/src/index.crates.io-*/anchor-syn-0.30.1/` re-extracts pristine on next `cargo fetch`), but it can't run in CI (CI's cargo cache is ephemeral). CI currently uses `anchor build --no-idl` and skips bankrun specs — same gap as pre-#360.

## 3. Why piecemeal bump fails — captured empirically

Attempted `mpl-core 0.8.0 → 0.12.0` while keeping `anchor-lang 0.30.1` (verbatim cargo output, 2026-05-16):

```
$ sed -i 's/mpl-core    = { version = "=0.8.0"/mpl-core    = { version = "=0.12.0"/' programs/roundfi-core/Cargo.toml
$ cargo update -p mpl-core
    Updating crates.io index
error: failed to select a version for `zeroize`.
    ... required by package `curve25519-dalek v3.2.1`
    ... which satisfies dependency `curve25519-dalek = "^3.2.1"` of package `solana-program v1.17.3`
    ... which satisfies dependency `solana-program = "^1.17.3"` of package `anchor-lang v0.30.1`
    ... which satisfies dependency `anchor-lang = "^0.30.1"` of package `roundfi-core v0.1.0`

versions that meet the requirements `>=1, <1.4` are: 1.3.0, 1.2.0, 1.1.1, 1.1.0, 1.0.0

all possible versions conflict with previously selected packages.

  previously selected package `zeroize v1.8.1`
    ... which satisfies dependency `zeroize = "^1"` of package `curve25519-dalek v4.1.3`
    ... which satisfies dependency `curve25519-dalek = "^4.1.3"` of package `solana-address v2.6.0`
    ... which satisfies dependency `solana-address = "^2.2.0"` of package `solana-account-info v3.1.1`
    ... which satisfies dependency `solana-account-info = "^3.0.0"` of package `solana-program v3.0.0`
    ... which satisfies dependency `solana-program = "^3.0.0"` of package `mpl-core v0.12.0`

failed to select a version for `zeroize` which could resolve this conflict
```

### Reading the conflict

Two version chains converge on `zeroize` with incompatible constraints:

**Old chain** (preserved by `anchor-lang 0.30.1`):

```
anchor-lang 0.30.1
    └── solana-program 1.17.3
            └── curve25519-dalek 3.2.1 → zeroize >=1, <1.4
```

**New chain** (introduced by `mpl-core 0.12.0`):

```
mpl-core 0.12.0
    └── solana-program 3.0.0
            └── solana-account-info 3.1.1
                    └── solana-address 2.6.0
                            └── curve25519-dalek 4.1.3 → zeroize ^1
```

Cargo's unifier picked `zeroize 1.8.1` first (satisfies `^1` from the new chain) and then can't backtrack — the old chain needs `<1.4`. Note that an intersection technically exists (`[1.0, 1.4)`) — Cargo's resolver doesn't downgrade once it's committed.

Even if we forced `zeroize = "=1.3.0"`, the underlying `curve25519-dalek 3.x` vs `4.x` mismatch would still prevent unification at the next level up.

### Why this isn't fixable with `[patch.crates-io]`

A `[patch.crates-io]` override on `zeroize`, `curve25519-dalek`, or `solana-program` would have to provide a single version satisfying ALL upstream consumers. There isn't one — `solana-program 1.x` and `solana-program 3.x` have incompatible public APIs (the `Pubkey` type moved from `solana-program::pubkey::Pubkey` in 1.x to a separate `solana-pubkey` crate in 3.x). You'd be patching two crates' worth of public API surface, not just version numbers.

## 4. What a real migration requires (sequenced)

The migration is all-or-nothing in dependency space but can be sequenced as 5 work-PRs:

| PR                              | Scope                                                                                                                                                                                                                              | Risk                                                                                                                                  | Est. time                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **A. anchor-lang 0.30 → 0.31**  | Bump Cargo.toml, fix `Accounts` macro breakage (PR #267 from anchor 0.31 release notes — `Box<Account<T>>` patterns + lifetime annotations on a few helpers)                                                                       | Medium — touches every account validation struct in `programs/roundfi-core/src/instructions/*.rs` (~20 files)                         | 1d                                                       |
| **B. solana-program 1.x → 3.x** | Triggered transitively by (A). Pubkey moves; account-info changes; `solana-pubkey` becomes separate import. Fix `programs/*/src/**` imports + the 10 `Box<>` workarounds documented in `docs/status.md` (row 10 Mainnet migration) | Medium-high — Pubkey type changes touch ~80% of `.rs` files                                                                           | 1-2d                                                     |
| **C. mpl-core 0.8 → 0.12**      | Unblocked by (B). Update `roundfi-core::instructions::join_pool` + `escape_valve_buy` to mpl-core 0.12's `CreateV1` / freeze/transfer plugin authority API (changed signatures vs 0.8)                                             | Medium — mpl-core 0.12 is API-stable but the auth-plugin re-approval pattern (PR #176) needs validation against the new transfer hook | 1d + devnet re-validation                                |
| **D. Re-deploy + canary**       | Fresh `anchor build` (full IDL gen now works without the patch), re-deploy 4 programs to devnet, re-run full M3 surface exercise from `docs/devnet-deployment.md`, capture new program IDs, OtterSec re-attestation                | Low (mechanical)                                                                                                                      | 0.5d + 2-3d operational lead time for OtterSec           |
| **E. Remove workarounds**       | Delete `scripts/dev/patch-anchor-syn-319.sh`, `scripts/dev/rebuild-idls.sh`, the `--no-idl` flag in CI ci.yml, the `bankrun_compat` shim's #319-related comments. Bankrun specs run in CI without registry patches.                | Low (cleanup)                                                                                                                         | 0.5d                                                     |
| **Total**                       |                                                                                                                                                                                                                                    |                                                                                                                                       | **4-7 working days** + OtterSec re-attestation lead time |

## 5. What forces this — and how urgent

| Forcing function                                                        | Concrete need today?                                                                                                | Mainnet GA blocker?                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Anchor 0.31+ features (`@_idl` macros, transaction-V0 generation, etc.) | No — we use plain `Accounts` + manual IDL via patch                                                                 | No                                     |
| mpl-core 0.12 features (e.g., new plugin types)                         | No — position NFT minting + FreezeDelegate + TransferDelegate all on 0.8                                            | No                                     |
| Solana CLI 3.x runtime compatibility                                    | Workspace already runs against CLI 3.0.0 (program loader compat is independent of crate versions on the build side) | No                                     |
| CI running bankrun specs                                                | Currently skipped; workaround can't run in CI (registry cache ephemeral). Spike fixes this.                         | Coverage-gap, not blocker (SEV-012 🟠) |
| Agave 1.x program loader deprecation                                    | None announced for Q4 2026 timeline                                                                                 | No, watch the Anza roadmap             |
| Auditor requirement                                                     | None expressed; Adevar engagement not started                                                                       | TBD post-Adevar                        |

**Conclusion**: #319 is not on the mainnet-GA critical path. It's tooling-polish that becomes urgent if any of the above shifts. Best-fit scheduling: between Adevar engagement close-out (when auditor recommendations may force one or more of the above) and mainnet deploy.

## 6. Recommended approach

**Don't do #319 now.** Reasons:

1. **Workaround is sufficient** for every concrete need (bankrun specs run locally with `bash scripts/dev/rebuild-idls.sh && pnpm exec mocha ...`)
2. **CI gap is real but bounded** — SEV-012 documents it, the integration-testing wave (PR #360) demonstrated bankrun specs surface real bugs even without CI lane (SEV-034b)
3. **Mainnet GA Q4 2026 doesn't depend on it** — none of the 6 forcing functions above are firing
4. **Adevar engagement may force a specific upgrade direction** — doing #319 pre-Adevar risks throwing away the work if they require a different path (e.g., a specific Anchor minor for some macro feature)

**When to revisit:**

- Adevar engagement closes with recommendations that require any of: Anchor 0.31+ features, mpl-core 0.12+ features, or specific Solana 3.x runtime gates
- Anza announces concrete deprecation timeline for Agave 1.x program loader
- bankrun-in-CI becomes a hard auditor requirement (would need to add a separate CI lane that does the registry patch + IDL rebuild + spec runs — small fix that doesn't require full #319)

**If forced to do it sooner**: budget the 4-7 working days above + OtterSec lead time. Do it as a single epic (PRs A-E above), not piecemeal. Empirically confirmed in §3 that piecemeal doesn't compile.

## 7. References

- Workaround: [`scripts/dev/patch-anchor-syn-319.sh`](../scripts/dev/patch-anchor-syn-319.sh) (idempotent registry patch)
- Workaround wrapper: [`scripts/dev/rebuild-idls.sh`](../scripts/dev/rebuild-idls.sh)
- Empirical confirmation note: [`MAINNET_READINESS.md`](../MAINNET_READINESS.md) row 1.7
- ADR 0007 — [`bankrun_compat`](./adr/0007-bankrun-compat-shim.md) — depends on this workaround, would simplify when #319 closes
- Anchor 0.31 release notes: <https://github.com/coral-xyz/anchor/releases/tag/v0.31.0>
- proc-macro2 deprecation of `Span::source_file`: <https://github.com/dtolnay/proc-macro2/blob/master/CHANGELOG.md> (search for `source_file`)
- mpl-core API changelog (0.8 → 0.12): <https://github.com/metaplex-foundation/mpl-core/blob/main/clients/rust/CHANGELOG.md>
- SEV-012 (bankrun-in-CI coverage gap) — [`docs/security/internal-audit-findings.md`](./security/internal-audit-findings.md) Medium section
