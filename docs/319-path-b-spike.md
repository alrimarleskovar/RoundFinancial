# Path B spike — escape mpl-core's `anchor` feature to close #319

> **TL;DR:** the borsh-version stalemate that killed PR #319 has a route around
> it that does not depend on Metaplex. Drop the `mpl-core/anchor` feature flag,
> opt into `mpl-core/borsh-v1` explicitly, bump the workspace to
> `anchor-lang 1.0` + `mpl-core 0.12`. `cargo check` then surfaces only
> mechanical API-migration errors — **no maybestd / borsh-version conflict
> anywhere in the dep graph**.

## Background

PR #319 documented an upstream-coordination problem: `mpl-core 0.12` and Anchor's
transitive `solana_pubkey` carry **different major versions of `borsh`** in the
same dep graph, and `cargo` can't unify them. The conclusion at the time was
"Path B" (refactor away from the `mpl-core/anchor` feature, ~200-400 LoC)
held as a fallback "if upstream stays cold for >60 days." Upstream has stayed
cold.

This spike validates Path B with empirical `cargo check` evidence, not
hypothesis.

## What the spike changed

Four `Cargo.toml` edits, no source-code edits:

```diff
 # programs/roundfi-core/Cargo.toml
-anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }
-anchor-spl  = { version = "0.30.1", features = ["token", "associated_token"] }
-mpl-core    = { version = "=0.8.0", features = ["anchor"] }
+anchor-lang = { version = "1.0", features = ["init-if-needed"] }
+anchor-spl  = { version = "1.0", features = ["token", "associated_token"] }
+mpl-core    = { version = "0.12", default-features = false, features = ["borsh-v1"] }

 # programs/roundfi-reputation/Cargo.toml
 # programs/roundfi-yield-kamino/Cargo.toml
 # programs/roundfi-yield-mock/Cargo.toml
-anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }
-anchor-spl  = { version = "0.30.1" }
+anchor-lang = { version = "1.0", features = ["init-if-needed"] }
+anchor-spl  = { version = "1.0" }
```

The critical move is on `mpl-core`:

- `default-features = false` drops `mpl-core 0.12`'s default `["borsh-v1"]`
  feature; we re-enable it explicitly so `RemainderVec<u8>` (kaigan) gets its
  `BorshSerialize` / `BorshDeserialize` impls.
- We do **not** opt into the `anchor` feature. That feature is what flips
  kaigan onto Anchor's reexported borsh 0.10 and creates the `maybestd`
  coexistence problem.

## Why this works (in one sentence)

`mpl-core`'s `anchor` feature only enabled Anchor-friendly Borsh derives on its
own types — it was never required by our actual usage, because all our calls
into mpl-core go through `instructions::*CpiBuilder` and `accounts::BaseAssetV1`,
not through Anchor's `#[account(...)]` macros (the position NFT is declared as
`UncheckedAccount<'info>` with a program-id pin, validated in handler-level
`require!`s).

We confirmed by dropping the feature on mpl-core 0.8 first
(`mpl-core = "=0.8.0", default-features = false`) — the workspace compiled
clean with zero warnings touching mpl-core types. That's the empirical proof
the feature is unused at our call sites.

## What still has to happen (the remaining 15 cargo-check errors)

These are **Anchor 0.30 → 1.0 API-migration patches**, not version-graph
problems. Each has a published mainstream fix:

| # | File | Pattern | Fix |
| - | ---- | ------- | --- |
| 1 | `programs/roundfi-yield-kamino/src/lib.rs:400, 530, 584` | `Context<'_, '_, '_, 'info, T>` (4 lifetimes) | Anchor 1.0 collapsed to one lifetime: `Context<'info, T>` |
| 2 | `programs/roundfi-yield-kamino/src/lib.rs:62` | `anchor_lang::solana_program::hash` (gone) | Add direct dep on `solana-program` or replace with `solana_program::hash::hashv` via SDK reexport |
| 3 | `programs/roundfi-yield-kamino/src/lib.rs:766, 850` | `sysvar::instructions::ID` (gone) | Use `solana_program::sysvar::instructions::id()` (function form) |
| 4 | `programs/roundfi-reputation/src/instructions/get_profile.rs:154` | `ProfileSnapshot::try_to_vec()` | borsh 1.x removed the method; use `borsh::to_vec(&value)?` |
| 5 | `programs/roundfi-reputation/...` | `__AccountInfo::realloc` (signature change) | Anchor 1.0 reroutes realloc; use `AccountInfo::realloc_unchecked` or the wrapper helper |
| 6 | `programs/roundfi-yield-{mock,kamino}/src/lib.rs:85, 156, 292` | `CpiContext::new` arg type mismatch | Probable cascade of #1 — fix Context lifetimes first and re-check |

**Estimated scope:** ~50-100 net LoC across 3 files. All mechanical. None
touches the protocol's economic logic (no math, no PDA seed changes, no
authority changes).

## What this spike does NOT prove

- **SBF compilation.** This spike only runs `cargo check` on the host x86_64
  target. The SBF target (`anchor build`) may surface additional issues,
  particularly around `solana-program 3.x`'s syscall ABI vs the 1.18-pinned
  CI/CD pipeline. Validate with `anchor build` end-to-end before declaring
  victory.
- **IDL generation.** Anchor 1.0 changed the IDL pipeline. The
  `idl-build` features stay set, but the actual generated IDL may differ from
  0.30's output; downstream SDK + frontend decoders may need regeneration.
- **Bytecode equivalence.** The post-migration binaries will not be
  byte-identical to the current 0.30 builds. OtterSec verify-build PDAs need
  refresh.
- **Tests.** All 314+ tests need to be re-run against the migrated builds;
  the bankrun harness and litesvm CI lane may need adjustments for the new
  Anchor types.

## Recommended next steps

1. **Land the 15 API-migration patches** on this branch
   (`claude/path-b-mpl-core-no-anchor-feature`). Each error in §"What still has
   to happen" is a self-contained surgery; no rebase risk between them.
2. **Run `anchor build` locally** with Agave 3.0.0 (already pinned in CI/CD).
3. **Run the bankrun + litesvm suites.** Expect IDL regeneration is needed
   for the JS-side encoders (`@roundfi/sdk`).
4. **Devnet redeploy + refresh OtterSec attestation PDAs** following
   `docs/operations/deploy-runbook.md`.
5. **Drop the cargo-audit ignore list** in `.github/workflows/ci.yml` — the
   11 RUSTSEC advisories tied to `solana-program 1.18.x` are no longer
   reachable from our dep graph.

When all five land, **#319 closes — without ever needing Metaplex to respond
to anything.**

## Honest framing

This spike's contribution is **information**, not a finished patch: the
borsh-version stalemate is escapable through Path B, the remaining errors are
mainstream API migrations with known fixes, and the recommended sequence is
mechanical surgery rather than waiting on upstream coordination.

The 15 remaining errors are real work — somewhere around 1-2 days of careful
on-chain code editing, anchor-build validation, and IDL regeneration. But
they're work the team can do unilaterally, on the team's timeline. That was
not true while the spike thesis was unconfirmed.

---

_Spike branch: `claude/path-b-mpl-core-no-anchor-feature`._
_Generated by [Claude Code](https://claude.ai/code/session_01YapZy1Z5gzbV5EammBkSQm)._
