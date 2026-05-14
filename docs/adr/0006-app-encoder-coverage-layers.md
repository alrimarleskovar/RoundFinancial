# ADR 0006 — Three-layer coverage for front-end IDL-free encoders

**Status:** ✅ Accepted
**Date:** 2026-05-14
**Decision-makers:** Engineering
**Related:** PRs #285, #287, #291 (structural), #297, #301, #305, #306 (bankrun happy-path), #303 (negative-path); Issues [#283](https://github.com/alrimarleskovar/RoundFinancial/issues/283), [#290](https://github.com/alrimarleskovar/RoundFinancial/issues/290); ADR [0002](./0002-idl-free-sdk-encoders.md)

## Context

The front-end ships **7 hand-rolled IDL-free instruction encoders** under `app/src/lib/*.ts`:

- `contribute.ts`, `claim-payout.ts`, `release-escrow.ts`, `escape-valve-list.ts`, `escape-valve-buy.ts`, `settle-default.ts`, `deposit-idle-to-yield.ts`

These are structurally duplicated from `sdk/src/actions.ts`'s SDK-side encoders (precomputed Anchor discriminator + manual account list mirroring the program's `<Accounts>` struct). They exist because:

- Anchor 0.30.1 IDL gen is broken on Rust 1.95 + proc-macro2 1.0.106 (`Span::source_file()` removed) — the browser can't load `app/public/idls/*` because they don't generate
- The SDK helpers import Anchor's `Program` client, which is React-unfriendly + heavy
- Per [ADR 0002](./0002-idl-free-sdk-encoders.md), the protocol commits to IDL-free encoders as the canonical browser-signing path

**The problem this ADR addresses:** how do we verify that 7 hand-rolled encoders — duplicated from the SDK + maintained by hand — stay byte-compatible with the on-chain program?

The original (M3) state had **only one verification layer**: a real Phantom-signed devnet round-trip per encoder. That works but is:

- Slow (~30s per round-trip, manual)
- Brittle (devnet RPC flakes, wallet UX state)
- Single-developer (only the dev with Phantom + devnet USDC can verify)
- Doesn't catch silent drift (a typo in account[12] still produces a tx that **the on-chain handler eventually rejects** — but the rejection error code might be misleading)

The team review (2026-05-14) flagged: "Testes estruturais não substituem bankrun round-trip ... Cada novo encoder = bankrun spec que valida encoding contra Anchor IDL real."

## Decision

**We will maintain three independent coverage layers for every front-end IDL-free encoder, in order of speed:**

| Layer                                | Where                                |           Speed | What it proves                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------ | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. Structural parity**             | `tests/app_encoders.spec.ts`         |        < 100 ms | Encoder bytes match the spec — discriminator = sha256(global:ix)[:8], account count = `<Accounts>` struct length, signer at index 0 + isSigner + isWritable, every PDA derives from `@roundfi/sdk/pda` |
| **2. Happy-path bankrun round-trip** | `tests/app_encoders_bankrun.spec.ts` |  ~1-2 s/encoder | On-chain program **accepts** the encoder's bytes against valid state. Full state delta asserted (member.contributions_paid, pool.total_contributed, USDC vault flows, etc.)                            |
| **3. Negative-path bankrun**         | `tests/app_encoders_bankrun.spec.ts` | ~1-2 s/scenario | On-chain program **correctly rejects** the encoder's bytes against invalid state (wrong cycle, already paid, monotonic violation). Regex-matched against expected Anchor error names                   |

Each layer is necessary; none is sufficient.

### Why three layers

- **Layer 1 alone** misses runtime issues — a discriminator-correct + account-count-correct instruction can still revert at runtime if the actual Anchor `<Accounts>` constraint logic rejects (e.g., wrong `seeds = [...]`, mint mismatch, `constraint = ...` predicate).
- **Layer 2 alone** misses negative-path coverage — it only proves the encoder works when the state is valid. A future refactor that silently breaks a runtime guard (e.g., drops a `require!()`) wouldn't be caught.
- **Layer 3 alone** misses structural drift on the happy path — a working error-rejection doesn't prove the encoder's bytes are correct on the success path.

Combined, the three layers catch:

- Account-order swaps (discriminator + structural — Layer 1)
- Account-count drift (a future PR adds an account to `<Accounts>` but not the encoder — Layer 1)
- PDA derivation drift (e.g., a seed prefix change — Layer 1)
- Runtime acceptance under valid state — Layer 2
- Runtime rejection under invalid state — Layer 3
- Subtle Anchor constraint additions (`seeds = [...]` enforcement, mint constraints) — Layers 2 + 3

### Encoder API for testability

All 7 encoders accept optional `programIds?` + `usdcMint?` arguments (backward-compatible — production callers don't pass them). Tests pass `{ core: env.ids.core, reputation: env.ids.reputation }` + `usdcMint: <bankrun-mint>` to route the same encoded bytes against the bankrun-deployed program set.

This is the smallest API contract that lets the same encoder code run in both production (against `DEVNET_PROGRAM_IDS`) and tests (against bankrun-deployed pubkeys), with no test-mode flag or branch.

## Consequences

- ✅ **6 of 7 encoders fully covered** at all three layers (structural + happy-path bankrun + structural negative-path). The 7th (`escape_valve_buy`) is bankrun-blocked by the harness's mpl-core exclusion — covered via Pool 2 devnet round-trip instead.
- ✅ Fast PR-time gate: Layer 1 runs on every PR in < 100 ms (58 tests). Catches the most common drift class (discriminator / account count / PDA) before merge.
- ✅ Deep gate: Layers 2 + 3 run under `pnpm test:bankrun` lane (anchor build required). Catches runtime correctness across happy + negative paths.
- ✅ Audit narrative: the layered coverage table appears in `docs/security/audit-readiness.md` TL;DR + `self-audit.md` §10 — auditors see the three-layer story before diving into the code.
- ⚠️ **Cost: ~250 LoC of fixture setup per encoder.** Each bankrun spec spins up `setupBankrunEnv()` + seeds `ProtocolConfig` + `Pool` + `Member` + 3-4 vault ATAs. Some fixtures are reused (the chained contribute → claim_payout → release_escrow path), but `escape_valve_list` + `settle_default` + `deposit_idle_to_yield` each need their own pool fixture because they need different terminal state.
- ⚠️ **`escape_valve_buy` is permanently bankrun-deferred.** The bankrun harness header explicitly excludes mpl-core ("Metaplex isn't loaded in the bankrun workspace"). Covered via `scripts/devnet/seed-evbuy.ts` instead, with the live Pool 2 receipt in `docs/devnet-deployment.md`.
- ⚠️ **Future encoders inherit the three-layer expectation.** A new encoder shipping without all three layers should be tracked as a follow-up issue, not blocked at merge.

## Alternatives considered

### Single-layer: only structural (Layer 1)

**Rejected** because: the team review explicitly called this insufficient. Structural tests don't catch runtime issues — see "Why three layers" above.

### Single-layer: only bankrun round-trip (Layer 2)

**Rejected** because: bankrun specs are 10-100× slower than structural specs. The fast PR-time gate is genuinely useful — Layer 1 catches the most common drift class in <100ms, which is fast enough to run on every commit, not just every PR.

### Two-layer: structural + happy-path bankrun, skip negative-path

**Rejected** after the team review. The team specifically asked for "bankrun spec que valida encoding contra Anchor IDL real" + the negative-path layer was the natural extension once happy-path was in place. The marginal cost is small (~150 LoC of extra test cases reusing the same fixture).

### Move encoders entirely into the SDK (deduplicate)

**Rejected** because: the SDK helpers depend on Anchor's `Program` client, which is React-unfriendly + heavy in browser bundles. Per [ADR 0002](./0002-idl-free-sdk-encoders.md), the front-end commits to IDL-free encoders. The duplication is acknowledged; the three-layer test gate is the mitigation.

## References

- ADR [0002](./0002-idl-free-sdk-encoders.md) — IDL-free SDK encoders (philosophy + pattern)
- ADR [0004](./0004-extract-roundfi-math-crate.md) — companion three-layer math coverage (proptest + cargo-fuzz + bankrun)
- `tests/app_encoders.spec.ts` — Layer 1, 58 tests, < 100 ms
- `tests/app_encoders_bankrun.spec.ts` — Layers 2 + 3, ~11 tests + 1 negative-path describe block
- `app/src/lib/*.ts` — the 7 IDL-free encoders being tested
- [`docs/security/audit-readiness.md`](../security/audit-readiness.md) TL;DR — auditor-facing coverage table
- [`docs/security/self-audit.md` §10](../security/self-audit.md#10-external-auditor-self-attestation-matrix) — auditor self-attestation matrix
- Issue [#283](https://github.com/alrimarleskovar/RoundFinancial/issues/283) — original structural proposal
- Issue [#290](https://github.com/alrimarleskovar/RoundFinancial/issues/290) — bankrun roundtrip extension (W1 contribute + claim_payout; W2 release_escrow + escape_valve_list; W3 settle_default + deposit_idle_to_yield)
- Team review feedback (2026-05-14) — the prompt for adding Layers 2 + 3
