# ADR 0003 — `mpl-core` for position NFTs (vs custom token mint)

**Status:** ✅ Accepted
**Date:** ~2026-04 (M2)
**Decision-makers:** Engineering
**Related:** PR #114 (real NFT transfer), PR #123 (mpl-core production bug fix), [`docs/security/self-audit.md` §6.1](../security/self-audit.md#61-mpl-core-transferv1-plugin-authority-reset)

## Context

When a member joins a ROSCA pool, the protocol mints them a **position NFT** representing their slot ownership. This NFT:

- Is **freezable** (member can't transfer it during the pool lifecycle without protocol consent)
- Is **transferable via `escape_valve_buy`** (atomic re-anchor: thaw → transfer → re-freeze + plugin re-approval)
- Carries position metadata (slot_index, pool, joined_at)
- Must reconcile with the on-chain `Member` PDA — same wallet must own the NFT and the Member account

Three implementation candidates were evaluated:

1. **Metaplex Token Metadata (legacy)** — battle-tested, large ecosystem
2. **mpl-core** — Metaplex's modern compressed-NFT-friendly API
3. **Custom SPL Token mint** — write our own freeze/transfer logic with raw SPL Token CPIs

## Decision

**We will use `mpl-core` for position NFTs.**

Specifically, `mpl-core 0.8.0` with the `anchor` feature, configured with two plugins per asset:

- `FreezeDelegate` — protocol PDA controls freeze state
- `TransferDelegate` — protocol PDA can authorize transfers

The position authority PDA (`[b"position", pool, slot_index]`) signs all plugin interactions.

## Consequences

- ✅ Less custom code = less audit surface than rolling our own freeze logic
- ✅ Plugin model lets us layer authorization without owning the NFT
- ✅ Compatible with future compression upgrade (mpl-core supports state compression)
- ✅ Wallets (Phantom, Solflare) render mpl-core assets without custom wallet adapters
- ⚠️ **Production bug surfaced + fixed** — `TransferV1` resets owner-managed plugin authorities (FreezeDelegate, TransferDelegate). Discovered during devnet exercising of `escape_valve_buy`. Fix shipped in PR #123: re-approve both plugins to the `position_authority` PDA post-transfer. See [`self-audit.md` §6.1](../security/self-audit.md#61-mpl-core-transferv1-plugin-authority-reset) for the full story
- ⚠️ Bankrun mock didn't catch the bug (mock != live program) — added the post-CPI invariant block (PR #123) as defense-in-depth: assert `asset.owner == buyer` + `FreezeDelegate.frozen == true` after the transfer CPI returns. New errors: `AssetTransferIncomplete`, `AssetNotRefrozen`
- ⚠️ `mpl-core 0.8.0` pin blocks the Agave 2.x migration (#230) until upstream ships a Solana-2.x-compatible release
- ❌ Adds an external dependency to the audit scope (mpl-core itself becomes part of the trust path)

## Alternatives considered

### Metaplex Token Metadata (legacy)

**Rejected** because: legacy API is being phased out by Metaplex; freeze/transfer plugin model exists in newer mpl-core but not legacy. Long-term migration cost outweighs short-term familiarity.

### Custom SPL Token mint with hand-rolled freeze/transfer

**Rejected** because: increases audit surface significantly (we'd own the freeze logic + the transfer logic + the metadata layout). The defense-in-depth in PR #123 against mpl-core's `TransferV1` bug is much cheaper than auditing a full custom NFT implementation. Plus wallets don't render custom mints without per-wallet adapter work.

## References

- Implementation: `programs/roundfi-core/src/instructions/{join_pool,escape_valve_list,escape_valve_buy}.rs`
- Cargo.toml pin: `mpl-core = { version = "0.8.0", features = ["anchor"] }`
- Production bug + fix: [`docs/security/self-audit.md` §6.1](../security/self-audit.md#61-mpl-core-transferv1-plugin-authority-reset)
- Migration blocker: [`docs/operations/agave-2x-migration-plan.md` R2](../operations/agave-2x-migration-plan.md)
- mpl-core repo: https://github.com/metaplex-foundation/mpl-core
