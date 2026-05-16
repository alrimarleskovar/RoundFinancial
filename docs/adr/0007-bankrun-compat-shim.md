# ADR 0007 — `bankrun_compat` Connection shim for time-warp-bound specs

**Status:** ✅ Accepted
**Date:** 2026-05-16
**Decision-makers:** Engineering
**Related:** PR [#360](https://github.com/alrimarleskovar/RoundFinancial/pull/360) (introduction), PR [#361](https://github.com/alrimarleskovar/RoundFinancial/pull/361) (test-fresh.sh complement)

## Context

The integration test suite has two distinct populations of specs:

| Population                     | Example specs                                                                                                   | Time dependency                                                                                                | Localnet status                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Stateless / fast-fail**      | `security_cpi.spec.ts`, `security_inputs.spec.ts`, `lifecycle.spec.ts`                                          | None (or sub-second)                                                                                           | ✅ Runs in seconds                                                 |
| **Cooldown- / boundary-bound** | `security_sev034_release_escrow_lifecycle.spec.ts`, `edge_grace_default.spec.ts`, `edge_cycle_boundary.spec.ts` | Hours to days (MIN_CYCLE_COOLDOWN_SECS=518_400s = 6d; CYCLE_DURATION=86_400s = 1d; GRACE_PERIOD=604_800s = 7d) | ❌ Unrunnable on localnet — wall-clock real-sleep impossible in CI |

The second population was effectively dead code for months. The SEV-034 author's docstring explicitly flagged this gap:

> _"pure-math simulators prove function properties, NOT on-chain behavior. Critical/High fixes need integration-level tests (bankrun, anchor ts-mocha against localnet)."_

`solana-bankrun` solves the time-warp problem (`setClock` jumps the on-chain clock instantly), but introduces a new one: bankrun's `BankrunConnectionProxy` only exposes **3 methods** (`getAccountInfo`, `getAccountInfoAndContext`, `getMinimumBalanceForRentExemption`). The existing `Env`-typed harness helpers (`createPool`, `joinMembers`, `contribute`, `fetchPool`, `fundUsdc`, etc., and downstream library code like `spl-token`'s `createMint` → `sendAndConfirmTransaction`) call dozens of `Connection` methods that aren't on the proxy: `getBalance`, `getLatestBlockhash`, `sendTransaction`, `simulateTransaction`, `confirmTransaction`, `requestAirdrop`, and more.

Two failed validation attempts pre-#360 confirmed the problem empirically:

1. Direct bankrun usage (`setupBankrunEnv`) — requires re-implementing every helper against bankrun's primitives. ~2x test code surface.
2. Localnet with cooldown-bound specs — `MIN_CYCLE_COOLDOWN_SECS=518_400` blocks back-to-back attestations; multi-cycle specs hang.

The forcing function for resolution was PR #360: integration-testing the SEV-034 fix surfaced **SEV-034b** (a Critical feature-break of `release_escrow`) that the pure-math suite couldn't catch. Validating Critical fixes via integration tests was no longer optional.

## Decision

**We will wrap bankrun's `BankrunConnectionProxy` in a `BankrunConnectionShim` that implements the full `Connection` surface used by `Env`-typed helpers.**

Implementation: [`tests/_harness/bankrun_compat.ts`](../../tests/_harness/bankrun_compat.ts) (~343 LoC). The shim:

- **Forwards** the 3 native proxy methods unchanged
- **Implements over `banksClient`** the methods bankrun could plausibly answer: `getBalance`, `getLatestBlockhash{,AndContext}`, `getRecentBlockhash`, `getSlot`
- **Re-implements** `sendTransaction` with `Connection` semantics: fetch latest blockhash if missing, set feePayer from `signers[0]`, sign with provided signers, then `banksClient.processTransaction`. This is what `spl-token`'s `sendAndConfirmTransaction` callers expect — bare `processTransaction` rejects unsigned/blockhash-less txs
- **Routes** `simulateTransaction` to `banksClient.simulateTransaction`, `confirmTransaction` to a no-op (bankrun txs are sync), `requestAirdrop` to `setAccount` with the requested lamports
- **Throws loudly** on any method not implemented via a bracket-indexed catch-all: `"Unsupported in bankrun connection shim: <method>"`. New methods accidentally invoked by upstream library updates surface immediately with the exact method name to add to the shim

The shim is exposed via `setupBankrunEnvCompat(): BankrunEnvCompat` where `BankrunEnvCompat extends Env`. Spec authors swap exactly one import line:

```diff
-import { setupEnv, type Env } from "./_harness/index.js";
+import { setupBankrunEnvCompat, type BankrunEnvCompat } from "./_harness/bankrun_compat.js";
```

`Env`-typed helpers Just Work. Specs that need clock-warp additionally import `setBankrunUnixTs` and call `await setBankrunUnixTs(env.context, BigInt(targetUnix))`.

## Consequences

- ✅ **3 specs migrated 2/2, 4/4, 3/3 green** post-shim — `security_sev034_release_escrow_lifecycle.spec.ts`, `edge_cycle_boundary.spec.ts`, `edge_grace_default.spec.ts` (the last via `setupBankrunEnv` direct, but same harness foundation). The two cooldown-bound specs ran in **1-2 seconds each** vs. unrunnable on localnet.
- ✅ **Surfaced SEV-034b** — running `security_sev034_release_escrow_lifecycle.spec.ts` end-to-end for the first time (only possible via bankrun_compat) caught the `total_escrow_deposited = stake_amount` init bug in `join_pool`. This was a Critical feature-break of `release_escrow` that the pure-math suite missed because the simulator started from manually-constructed `ted=0` state.
- ✅ **Surfaced latent SEV-031 fixture drift** — `edge_cycle_boundary.spec.ts`'s pre-existing fixture (`installment=1000, credit=2200, members=2`) violated the SEV-031 viability guard (`1480 < 2200`). The spec was dead code on localnet so the inviability stayed hidden; bankrun migration made it actually run and the SEV-031 runtime guard correctly rejected the fixture, prompting the bump to `installment=2000`.
- ✅ **Pattern generalizes** — the shim was designed for SEV-034 specifically but `edge_cycle_boundary` migration in PR #360 Item M used the same one-line import swap with zero shim modifications. Future cooldown- or wall-clock-bound specs follow the same template.
- ✅ **Audit trail preserved** — specs still read `env.connection.getAccountInfo(...)`; reviewers don't have to learn a new query API.
- ⚠️ **Shim must track Connection surface drift** — if `@solana/web3.js` `Connection` gains a new method that a helper starts using, the shim's catch-all throws `"Unsupported in bankrun connection shim: <method>"` at first invocation. Cost: explicit + loud, not silent corruption.
- ⚠️ **`requestAirdrop` via `setAccount`** — bankrun has no faucet; the shim just credits the requested pubkey directly. Behavior is observably correct (lamports appear) but bypasses the airdrop tx record. No spec asserts on airdrop signatures yet.
- ❌ **Specs that depend on real cross-program-invocation timing** (e.g., transaction history pagination) cannot migrate. Bankrun is in-memory and txs are sync. Acceptable: no spec in the current suite depends on this.

## Alternatives considered

### Rewrite all helpers against bankrun primitives directly

**Rejected.** Doubles the test surface (one Env per runtime). Helper changes have to be made twice. Spec authors have to choose at write-time which runtime they target. The wrapper one-line-import pattern keeps the choice at the spec entry point and the rest of the helper code unchanged.

### Fork `anchor-bankrun` and add the missing Connection methods upstream

**Rejected.** Upstream PR review cycles measured in weeks; SEV-034b was a Critical bug needing same-day validation. The shim lives in our repo, so we control the cadence of additions. If a future upstream version covers the full surface, we delete the shim with no spec changes.

### Use `solana-test-validator` with `--no-bpf-jit` + accept ~24h spec runs

**Rejected.** The grace-period leg of `edge_grace_default` needs to advance the clock 7 days; `edge_cycle_boundary` leg B needs 24h+. Both impossible in CI; both run in <1s under bankrun. The localnet path stays viable for stateless/fast-fail specs (covered by `scripts/test-fresh.sh`, PR #361) — bankrun is additive.

### Keep cooldown-bound specs as "documented but unrunnable" and rely on pure-math regression tests

**Rejected** — this was the pre-#360 state, and it's exactly the failure mode SEV-034b exposed: pure-math simulators prove function properties, not on-chain behavior. The author of the SEV-034 fix explicitly flagged this gap in their own spec docstring before SEV-034b was discovered. Bankrun_compat is the path the docstring prescribed.

## References

- Implementation: [`tests/_harness/bankrun_compat.ts`](../../tests/_harness/bankrun_compat.ts) (PR #360 commit `9104e5d`)
- `sendTransaction` semantics fix: PR #360 commit `66aca34`
- Underlying bankrun harness: [`tests/_harness/bankrun.ts`](../../tests/_harness/bankrun.ts) (PR #319 / spike, Item J of PR #360 session)
- Companion localnet path: [`scripts/test-fresh.sh`](../../scripts/test-fresh.sh) (PR #361 + drift-warning PR #362)
- Empirical validation of pattern generalization: PR #360 Item M — `edge_cycle_boundary` migration
- Critical bug surfaced: SEV-034b, tracked in [`docs/security/internal-audit-findings.md`](../security/internal-audit-findings.md)
- Spike that gates broader adoption: [#319](https://github.com/alrimarleskovar/RoundFinancial/issues/319) Agave 2.x migration (mpl-core 0.12 + anchor 0.31+ + solana 3.x simultaneous bump). Bankrun_compat works pre-#319 because it doesn't depend on Anchor IDL surface area beyond what works under the [`scripts/dev/patch-anchor-syn-319.sh`](../../scripts/dev/patch-anchor-syn-319.sh) registry workaround
- Related ADR: [0004](./0004-extract-roundfi-math-crate.md) — pure-math crate enables proptest fuzzing that complements (but doesn't replace) integration testing
