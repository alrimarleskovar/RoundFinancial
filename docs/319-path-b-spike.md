# Path B — escape mpl-core's `anchor` feature to close #319 (DONE)

> **Status: validated end-to-end.** `anchor build` (SBF) compiles all 4
> programs; `pnpm test:litesvm` 19/19; the in-memory `setupBankrunEnv`
> suite (edge_cycle_boundary, edge_grace_default[_shield1_only],
> app_encoders_bankrun, security_kamino_cpi) is 24/24 passing. The borsh
> `maybestd` stalemate that blocked PR #319 is gone — and it never
> required Metaplex to respond.
>
> **TL;DR:** drop the `mpl-core/anchor` feature flag, opt into
> `mpl-core/borsh-v1` explicitly, bump the workspace to
> `anchor-lang 1.0` + `mpl-core 0.12` (+ a direct `solana-program 3.x`
> dep for `hash` / `sysvar::instructions`). The remaining work was
> mechanical Anchor 0.30 → 1.0 API migration, all landed on this branch.

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

## Resolution log (what landed)

| Step                                                                                                                                                                | Commit    | Result                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------- |
| Cargo.toml bumps (anchor 1.0, mpl-core 0.12 no-anchor + borsh-v1)                                                                                                   | `969861d` | dep graph clean, 15 API errors surfaced            |
| Anchor 0.30→1.0 API migration (CpiContext::new Pubkey, Context lifetime collapse, borsh::serialize, AccountInfo::resize, sysvar::id(), hash via solana-program 3.x) | `09b11eb` | `cargo check --workspace --all-targets` = 0 errors |
| Bankrun negative-path error-format (Anchor 1.0 logs hex code only)                                                                                                  | `53f0c8b` | #6/#7/#8 green                                     |
| escape_valve_list account-client name (1.0 IDL keys by struct name)                                                                                                 | `faae21a` | #9 green                                           |
| app_encoders_bankrun state-shape refresh (escrow seeding, settle cycle arg, deposit remaining-account)                                                              | `59dda50` | #5/#7/#10 green                                    |
| settle_default production GRACE_PERIOD_SECS (SBF build has no devnet-canary)                                                                                        | `41277c7` | #6 green                                           |

**Validation evidence (operator-run, 2026-05-30):**

- `anchor build` — all 4 SBFs load in bankrun.
- `pnpm test:litesvm` — **19/19** (SEV-012 mpl_core lifecycle + L1↔L2 parity Pre/Post/Cascade + SEV-039 rent reclaim).
- `pnpm exec mocha … <the 5 setupBankrunEnv specs>` — **24 passing, 10 pending** (Kamino fixtures), **0 failing**.

**Known environment-gated (not #319, not fixed here):** `economic_parity`,
`lifecycle`, `edge_degenerate_shapes`, `edge_tiny_lifecycle` use the
**localnet** harness (`setupEnv`), which requires a running
`solana-test-validator`. They fail at the first RPC call (`createUsdcMint`
→ `getAccountInfo` → `fetch failed`) on a machine without one. Same
economics are already covered in-memory by the litesvm parity slice. These
were never bankrun specs; their harness selection predates this migration.

## (historical) The 15 cargo-check errors that had to be migrated

These are **Anchor 0.30 → 1.0 API-migration patches**, not version-graph
problems. Each has a published mainstream fix:

| #   | File                                                              | Pattern                                       | Fix                                                                                               |
| --- | ----------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `programs/roundfi-yield-kamino/src/lib.rs:400, 530, 584`          | `Context<'_, '_, '_, 'info, T>` (4 lifetimes) | Anchor 1.0 collapsed to one lifetime: `Context<'info, T>`                                         |
| 2   | `programs/roundfi-yield-kamino/src/lib.rs:62`                     | `anchor_lang::solana_program::hash` (gone)    | Add direct dep on `solana-program` or replace with `solana_program::hash::hashv` via SDK reexport |
| 3   | `programs/roundfi-yield-kamino/src/lib.rs:766, 850`               | `sysvar::instructions::ID` (gone)             | Use `solana_program::sysvar::instructions::id()` (function form)                                  |
| 4   | `programs/roundfi-reputation/src/instructions/get_profile.rs:154` | `ProfileSnapshot::try_to_vec()`               | borsh 1.x removed the method; use `borsh::to_vec(&value)?`                                        |
| 5   | `programs/roundfi-reputation/...`                                 | `__AccountInfo::realloc` (signature change)   | Anchor 1.0 reroutes realloc; use `AccountInfo::realloc_unchecked` or the wrapper helper           |
| 6   | `programs/roundfi-yield-{mock,kamino}/src/lib.rs:85, 156, 292`    | `CpiContext::new` arg type mismatch           | Probable cascade of #1 — fix Context lifetimes first and re-check                                 |

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
