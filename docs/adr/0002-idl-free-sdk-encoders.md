# ADR 0002 — Hand-rolled IDL-free SDK encoders

**Status:** ✅ Accepted
**Date:** ~2026-04-15
**Decision-makers:** Engineering
**Related:** PR #138 / #139 / #182 — initial encoders; PR #260, #261, #265 — release_escrow + escape_valve_list + deposit_idle_to_yield encoders. Related issue: [#235](https://github.com/alrimarleskovar/RoundFinancial/issues/235).

## Context

The frontend (`app/`) needs to dispatch on-chain transactions: `contribute`, `claim_payout`, `release_escrow`, etc. Standard Anchor flow:

1. Build the program → produces `target/idl/*.json`
2. Use the IDL to construct an Anchor client (`new Program(idl, programId, provider)`)
3. Call methods via the client (`program.methods.contribute(cycle).accounts({...}).rpc()`)

But:

- Our `anchor build` is pinned to Solana 1.18.26 / Anchor 0.30.1 / `--no-idl` because Rust 1.95 + proc-macro2 1.0.106 panics in `Span::source_file` during IDL generation
- Without IDL generation, `app/public/idls/*` are empty stubs
- The Anchor client constructor fails without an IDL
- Waiting for Anchor 0.31+ (which fixes the panic) is gated on the Agave 2.x migration (issue #230) — multi-week lift

We need a working frontend path TODAY, not after #230 ships.

## Decision

**We will hand-roll IDL-free encoders for every user-facing instruction.**

Each encoder is ~120 LoC of TypeScript exposing:

- A `Build<Ix>Args` interface (typed args)
- A `build<Ix>Ix(args)` function returning a `TransactionInstruction`
- A `send<Ix>(args)` helper that wraps in a `Transaction` + dispatches via `wallet.sendTransaction`

The encoder's discriminator is precomputed via `sha256("global:<ix_name>")[..8]` (Anchor 0.30+ convention) and pinned as a constant. Account ordering is hand-verified against `programs/roundfi-core/src/instructions/<ix>.rs` (the `#[derive(Accounts)]` struct).

5 encoders shipped to date: `contribute`, `claim_payout`, `release_escrow`, `escape_valve_list`, `deposit_idle_to_yield`.

## Consequences

- ✅ Frontend unblocked TODAY — doesn't wait on Agave 2.x migration
- ✅ Each encoder is small + reviewable in isolation (~120 LoC each)
- ✅ Failure modes documented in JSDoc per encoder — modal renders clean errors
- ✅ Pure functions — easily unit-testable + composable
- ✅ Pattern proven: 5 encoders shipped, same shape, no production-side regressions
- ⚠️ Discriminator drift risk — if the instruction name changes on-chain, the precomputed discriminator stays stale. Mitigation: each encoder is renamed + recomputed together with the on-chain rename
- ⚠️ Account-order drift risk — if the `#[derive(Accounts)]` struct adds/reorders accounts, the encoder must be updated. Mitigation: PR review checklist + future bankrun smoke tests
- ❌ Manual labor — every new instruction needs ~2-3h of hand-rolling instead of `program.methods.X()`
- 🔄 **Reversible:** once Anchor 0.31+ lands via #230, we can swap to Anchor client. Migration is mechanical (the encoder signatures match Anchor's `program.methods.<ix>()` shape almost 1:1)

## Alternatives considered

### Wait for #230 (Agave 2.x migration) before building frontend

**Rejected** because: hackathon submission needs working frontend NOW. Multi-week delay would have killed M3 momentum + Colosseum submission.

### Generate IDL via a separate tool (e.g., anchor-syn fork)

**Rejected** because: fork maintenance is a multi-month commitment. The upstream Anchor 0.31 release will obsolete the fork anyway.

### Use Anchor 0.30 in a Docker shim that bypasses Rust 1.95

**Rejected** because: solves IDL generation but adds a Docker layer to every PR's CI. The hand-rolled approach is simpler and ships TODAY.

## References

- Encoders: `app/src/lib/contribute.ts`, `claim-payout.ts`, `release-escrow.ts`, `escape-valve-list.ts`, `deposit-idle-to-yield.ts`
- Discriminator computation: `node -e 'console.log(require("crypto").createHash("sha256").update("global:<ix>").digest().subarray(0,8).toString("hex"))'`
- Issue [#235](https://github.com/alrimarleskovar/RoundFinancial/issues/235) — full wiring scope
- Issue [#230](https://github.com/alrimarleskovar/RoundFinancial/issues/230) — Agave 2.x migration that unblocks Anchor 0.31+
- ADR [0004](./0004-extract-roundfi-math-crate.md) — pure-Rust math extraction; mirrors the hand-rolled philosophy on the Rust side
