# ADR 0005 — Indexer reconciler finality gate at 32 slots

**Status:** ✅ Accepted
**Date:** 2026-05-14
**Decision-makers:** Engineering
**Related:** PR #258 (reconciler implementation), Issue [#234](https://github.com/alrimarleskovar/RoundFinancial/issues/234), [`docs/security/indexer-threat-model.md` §2.2](../security/indexer-threat-model.md)

## Context

The off-chain indexer (`services/indexer/`) accepts Helius webhook deliveries at `commitment: "confirmed"` so the webhook path is fast (single INSERT per event). But:

- **Reorg risk** — a tx confirmed at slot S can be orphaned if S' replaces S in finalized chain
- **B2B oracle (Phase 3) reads** must be reorg-safe — a wrong score returned to a neobank is a business-impacting bug
- **Helius webhook delivery is best-effort** — no guarantees about ordering or finality

The reconciler (PR #258) is the join layer between `_unresolved` event rows (webhook-written) and canonical Pool / Member rows. It needs a **finality gate** before joining.

Solana's commitment levels:

| Level       | Slot count behind | Reorg probability      |
| ----------- | ----------------- | ---------------------- |
| `processed` | 0-1               | Very high (~50%)       |
| `confirmed` | ~2-32             | Low but non-zero (~1%) |
| `finalized` | 32+               | Effectively zero       |

Solana's `finalized` commitment requires ≥ 32 slots of confirmations (2/3 of validators) past the tx's slot. After finality, a tx is essentially permanent.

## Decision

**The reconciler will wait `FINALITY_GATE_SLOTS = 32` past an event's slot before joining it to canonical Pool/Member rows.**

Events younger than 32 slots stay in `_unresolved` state (counted as `pending` in the reconciler result).
Events 32-256 slots old are checked via RPC quorum; if `confirmationStatus === "finalized"` per ≥ ceil(N/2) RPCs, they're joined.
Events older than `ORPHAN_GRACE_SLOTS = 256` that still don't return `finalized` are marked `orphaned = true` (their tx was either dropped or reorged out).

The reconciler runs every 30s (`RECONCILER_INTERVAL_MS`).

## Consequences

- ✅ B2B oracle reads (Phase 3) are guaranteed to read only finalized state
- ✅ Reorg events (rare) auto-resolve — orphaned tx markers prevent score poisoning
- ✅ RPC quorum (cross-validation against 2+ RPCs) catches single-RPC fork-following
- ✅ Latency cost is bounded — 32 slots × ~400ms/slot = ~13 seconds between event arrival and canonical join. Acceptable for ROSCA flows (cycle duration is days/weeks)
- ⚠️ Latency cost is NOT acceptable for real-time UX — front-end reads on-chain directly today, doesn't wait for the indexer
- ⚠️ "Eventual consistency" — the indexer DB is always ~30s behind chain truth. Documented in `docs/operations/indexer-reorg-recovery.md` so on-call understands the lag
- ⚠️ Orphan-grace at 256 slots is conservative — most reorgs resolve in <100 slots. We accept the longer wait to minimize false orphan markers
- ❌ Adds complexity to the indexer (3 cron loops: backfill, reconciler, cross-validation)

## Alternatives considered

### Wait for `confirmed` only (no finality gate)

**Rejected** because: confirmed-but-not-finalized window is exactly the reorg attack surface from R3 in the threat model. B2B oracle reading at confirmed level = poisoned score on reorg.

### Wait `64` slots instead of `32`

**Considered** but rejected: 32 is the canonical Solana finality threshold per [the Solana docs](https://docs.solana.com/cluster/commitments). Waiting longer adds latency without measurable additional safety.

### Wait at the **webhook ingest** layer (don't write `_unresolved` rows at all)

**Rejected** because: would block the webhook handler on RPC calls. Webhook would 5xx under load → Helius retries → cascade. The fast-write / slow-reconcile split is the standard pattern for high-throughput ingestion.

### Use a single RPC for finality check (no quorum)

**Rejected** because: hostile RPC could lie about finality. RPC quorum (`checkFinalizedQuorum` in `reconciler.ts`) prevents single-source-of-truth attacks on the finality decision. See [`docs/security/indexer-threat-model.md` §2.2](../security/indexer-threat-model.md) R2.

## References

- Implementation: [`services/indexer/src/reconciler.ts`](../../services/indexer/src/reconciler.ts)
- Threat model: [`docs/security/indexer-threat-model.md`](../security/indexer-threat-model.md) §2.2
- Runbook: [`docs/operations/indexer-reorg-recovery.md`](../operations/indexer-reorg-recovery.md)
- Issue [#234](https://github.com/alrimarleskovar/RoundFinancial/issues/234) — original proposal
- Solana commitment docs: https://docs.solana.com/cluster/commitments
