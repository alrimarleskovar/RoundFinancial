# ADR 0012 — Contemplation by lance (consórcio bidding) + installment prepayment

**Status:** ✅ Accepted — **all three phases implemented on-chain** (Jul 2026). See [Implementation outcome](#implementation-outcome): Phase 3 shipped in a **materially smaller** shape than the sketch below, and the sketch is kept as the historical record rather than edited into agreement.
**Date:** 2026-07-23 · _implementation outcome recorded 2026-07-30_
**Decision-makers:** RoundFi team (Alrimar, Caio)
**Related:** the sorteio draw machinery (`ordering_policy` + `finalize_draw` / `DrawResult`); the `contribute` cycle gate; escape-valve commit-reveal (#232, anti-snipe). **Phased** — Phase 1 (prepayment) had an implementing PR that this ADR gated; Phases 2–3 (lance) preceded their implementation and gated it.
**Open gate:** external review of [`docs/security/lance-contemplation.md`](../security/lance-contemplation.md) §5.5 (4 questions) remains **required before mainnet** for the lance surface.

## Context

RoundFi is a **consórcio on-chain**. A consórcio contemplates — hands the credit to — exactly one member per cycle. Today RoundFi selects the contemplation order via `pool.ordering_policy`:

- `0` (arrival) — payout follows join order.
- `1` (sorteio) — the order is drawn on-chain by `finalize_draw` when the pool fills.

Brazilian consórcio, though, contemplates through **two channels every assembly**: the **sorteio** (random draw) _and_ the **lance** (a bid). A member offers a lance — an amount they commit up front — and the highest bid is contemplated that cycle, alongside the drawn member. The lance is the consórcio's core liquidity/fairness lever: it lets a member who needs the credit sooner "pay to move up the queue," and it accelerates the whole group (more money in early → the pool contemplates faster).

RoundFi has neither the lance nor its prerequisite — **paying installments ahead**. Two member asks from live devnet testing surface the gap:

1. _"Quero pagar antecipado"_ — pre-fund future installments (get ahead, clear the obligation early). The `contribute` gate blocks it: `require!(args.cycle == pool.current_cycle, WrongCycle)` — you can only pay the current cycle.
2. _"Adotar o sistema de lances"_ — bid to be contemplated before the draw / arrival order would give it.

These are **related**: a _lance embutido_ (embedded bid) IS prepayment of your own future installments, offered as the bid. So prepayment is both a standalone feature and the substrate for the embedded lance.

The **pay-after-receiving thesis** (a member contemplated early MUST keep paying every remaining installment) is non-negotiable and must survive both features. A lance winner is contemplated early but still owes the full remainder — the lance changes _who_ is contemplated _when_, never _whether_ they must pay.

## Decision

Ship in **three phases**, smallest/safest first. Phase 1 has an implementing PR now; Phases 2–3 are designed here and gate their own implementation.

### Phase 1 — installment prepayment (this ADR's implementing PR)

Relax the `contribute` cycle gate so a member can pay their next unpaid installment even when it is **ahead** of the pool's current cycle:

- `require!(args.cycle == pool.current_cycle, WrongCycle)` → `require!(args.cycle >= pool.current_cycle, WrongCycle)`
- **Keep** `require!(args.cycle == member.contributions_paid, AlreadyContributed)` — pay strictly your next unpaid installment, no skipping.
- **Keep** `require!(args.cycle < pool.cycles_total, PoolClosed)` — caps prepayment at your final installment.

Why this is small, backward-compatible, and invariant-preserving:

- **Backward-compatible.** On the standard path `args.cycle == current_cycle == contributions_paid`, `>=` is identical to `==`. No existing flow, encoder, or parity test changes.
- **No back-pay, no skip.** A behind member (`contributions_paid < current_cycle`) still fails `args.cycle >= current_cycle`; the no-skip check is untouched. Prepayment only lets you go _further ahead_, never fill a past hole.
- **Funds are fungible in the vault.** Each `contribute` splits into solidarity / escrow / pool-float and the pool vault accumulates monotonically across cycles. A prepaid installment sits in the vault exactly like an on-schedule one; the claim waterfall reads the _vault balance_, not a per-cycle tally, so a later cycle's payout still finds the money. Prepaying can only _increase_ spendable float _earlier_ → strictly safer for viability, never worse.
- **"Ahead" is safe at every other call site.** `settle_default` keys off `contributions_paid < current_cycle` (an ahead member is the opposite of behind); `escape_valve_list` requires `contributions_paid >= current_cycle` (ahead satisfies it); `claim_payout` has no contributions gate. No call site assumes `contributions_paid <= current_cycle`.
- **Early POOL_COMPLETE is correct.** A member who prepays their final installment trips `is_final_installment` (`contributions_paid == cycles_total`) and earns the +50 / `cycles_completed` bump early. That is right — they have demonstrably kept every obligation; the reward attaches to the behaviour, not the pool's clock. It is not farmable (real USDC moved).

No new `RoundfiError` variant, no account-layout change, no new instruction — only a comparator relaxes. The app adds a "pagar adiantado" affordance that lets a current member pay `contributions_paid` even when it is `> current_cycle`. **Validation:** a **litesvm prepayment-lifecycle test** (one member races several cycles ahead; the pool still contemplates + completes correctly) must be green before this ships, and a devnet redeploy of `roundfi-core` is required for it to take effect on devnet.

### Phase 2 — lance embutido (embedded bid), builds on Phase 1

A member's bid for a cycle is the count of future installments they prepay in one shot — the funds are already accepted by Phase 1's `contribute`. The new surface is only the **contemplation** side: when a cycle is contemplated, the member with the largest embedded lance (most installments prepaid beyond the schedule) wins over the drawn / arrival candidate. Requires per-cycle "best embedded bid" tracking + a contemplation rule that consults it.

### Phase 3 — lance livre (free bid) + contemplation-by-bid, the full subsystem

The complete consórcio lance: a member bids **external** USDC (not just their own installments), locked for the cycle; the highest bidder is contemplated; the bid **amortizes** the winner's remaining obligation (reduces balance / term) and losing bids are refunded. This is the large surface:

- **New state:** a `Bid`/`Lance` account per `(pool, cycle)` (or a "best bid" slot on the pool) holding bidder, amount, and lock.
- **New instructions:** `place_bid` (lock USDC, record if it beats the current best), `settle_contemplation` (winner = drawn-or-highest-bid per policy → pay out, amortize, refund losers), `withdraw_bid` (reclaim a losing / expired bid).
- **Ordering policy** gains a value (e.g. `2` = sorteio + lance) or a per-cycle flag; the sorteio still fixes the drawn slot and the lance runs alongside it.
- **Anti-sniping** on the bid, in the spirit of the escape-valve commit-reveal (#232): a late high-bid must not steal the cycle at the buzzer — a commit-reveal or cool-down on the bid close.

Phase 3 **precedes implementation** with its own security design doc (`docs/security/lance-contemplation.md`): winner-selection rule, amortization math and its effect on `pool_is_viable`, the refund path, the reputation treatment (contemplation-by-bid still owes every installment), and the anti-sniping model. **No on-chain code for Phase 3 until that doc lands + is reviewed.**

## Implementation outcome

_Recorded 2026-07-30, after all three phases shipped. The Decision section above is the
record of what we **decided**; this section is what we **built**. Where they disagree,
this section is correct and the divergence is explained rather than papered over._

### Phase 1 — shipped as designed

The comparator relaxed exactly as written (`==` → `>=` on the cycle gate), no new error
variant, no layout change. Proven by `tests/litesvm_prepay_ahead.spec.ts`.

### Phase 2 — shipped as designed, with the tracking slot carved from padding

`place_embedded_bid` (no args, 5 accounts). The "per-cycle best embedded bid" became
**`pool.current_bid_depth: u8`**, carved out of `Pool`'s trailing padding so `Pool::SIZE`
is unchanged and pre-existing pools read a zeroed byte as the safe default. Bid depth is

```
depth = contributions_paid − current_cycle − 1
```

and the `−1` is load-bearing: `contributions_paid == current_cycle + 1` means you are
merely **current**, not ahead, so it must not count as bid material. Strictly-greater
wins; ties lose.

**The contemplation change is a swap, not a new payout path.** `DrawResult.order[seat] = cycle`
is a permutation; a winning bid swaps two entries so the bidder takes the current cycle and
the displaced seat inherits the bidder's former future cycle. A swap of two entries in a
permutation is still a permutation — so "everyone is contemplated exactly once" survives
**by construction**, and `claim_payout` / `crank_payout` needed no changes at all.

### Phase 3 — shipped **much smaller** than sketched

The sketch above called for three instructions (`place_bid`, `settle_contemplation`,
`withdraw_bid`), a bid vault holding locked external USDC, a refund path for losers,
amortization math against the winner's remaining obligation, and a new `ordering_policy`
value. **None of those shipped, and none of them are needed.** What shipped:

| Sketched                                            | Actually shipped                                                |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `place_bid`, `settle_contemplation`, `withdraw_bid` | `place_bid_commit` + `place_bid_reveal` (2 instructions)        |
| Bid vault holding locked USDC                       | **no vault**                                                    |
| Refund path for losing bids                         | **no refund path**                                              |
| Amortization of the winner's balance                | **no amortization** — the bid _is_ prepayment of K installments |
| `ordering_policy` gains a value (`2`)               | **unchanged** — the free bid rides the existing sorteio         |
| Cool-down / commit-reveal on bid close              | **disjoint temporal windows** (below)                           |

The collapse comes from one decision: **adjudicate before paying.** `place_bid_reveal`
verifies the envelope, then checks `depth > pool.current_bid_depth` **before any token
transfer**. A losing bid therefore _reverts_ — the USDC never leaves the bidder's wallet.
There is nothing to hold, so there is no vault; nothing was taken, so there is no refund;
the winner is known the moment the reveal succeeds, so there is no settlement step.

Writing §5 of the security doc is what surfaced this: the draft simultaneously specified a
bid vault with refunds _and_ conversion-at-reveal, which are mutually exclusive. Resolving
the contradiction **deleted** surface instead of adding it.

The second reduction: a free bid is not "external USDC" but **K installments prepaid
atomically**. So Phase 3 _compiles down to_ Phase 1 + Phase 2 plus a sealed envelope, and
introduces **no new contemplation math**. `BehavioralPayload.parcels_paid: u8` is what lets
K installments settle with **one** attestation rather than K.

**Anti-snipe is temporal, not a cooldown.** Commits require `clock < pool.next_cycle_at`;
reveals require `next_cycle_at ≤ clock < next_cycle_at + GRACE_PERIOD_SECS`. The windows are
**disjoint** — you cannot see a revealed bid and still place one. That is the whole
anti-snipe property, and it needs no extra state.

**New state:** a `Bid` PDA per `(pool, cycle, bidder)` (`SIZE = 131`) holding
`commit_hash: [u8; 32]`, `amount`, `parcels`, and a `BidState { Committed, Revealed }`.
Commit uses `init`, not `init_if_needed` — re-sealing is exactly what a commitment must forbid.

**New errors** (appended at the enum end, since `RoundfiError` variants are positional):
`BidWindowClosed`, `BidCommitMismatch`, `BidAlreadyRevealed`, `BidAmountNotMultiple`.

**Envelope recoverability.** The commit hash is `sha256(amount_le ‖ salt_le ‖ bidder)` over a
48-byte preimage. The salt is derived deterministically from a wallet signature over a
canonical per-`(pool, cycle)` message (ed25519 signing is deterministic per RFC 8032), and the
amount is recovered by scanning candidate `K` against the on-chain `commit_hash`. So losing
`localStorage` cannot strand a sealed envelope. The small amount space is simultaneously what
makes a weak salt dangerous and what makes recovery cheap — hence deriving the salt from a
signature rather than from the amount.

### Validation shipped with the phases

`tests/litesvm_prepay_ahead.spec.ts` (Phase 1), `tests/litesvm_lance_embutido.spec.ts`
(Phase 2), `tests/litesvm_lance_livre.spec.ts` (Phase 3, 9-case matrix),
`tests/lance_livre_hash.spec.ts` (21 tests pinning the TS↔Rust preimage byte-for-byte and
the deterministic-salt/recovery path), `tests/lance_ui.spec.ts` (38 tests over the pure
eligibility/window helpers).

## Consequences

- ✅ Phase 1 unlocks _"pagar antecipado"_ with a one-comparator, invariant-preserving relaxation — real member value at near-zero risk.
- ✅ Phases 2–3 make RoundFi a faithful consórcio (sorteio + lance) — the mechanism the target user already understands — a product-defining feature, not a bolt-on.
- ✅ Reuses proven substrate: prepayment rides `contribute`; the draw rides the sorteio machinery; anti-sniping rides the #232 commit-reveal shape.
- ⚠️ Prepayment changes the funding **timeline** (float arrives earlier, unevenly). It never reduces total float, but the parity model + the litesvm prepayment test must confirm the claim waterfall + viability hold when one member is several cycles ahead.
- ⚠️ Lance (Phase 3) adds on-chain surface — but **less than feared**: 1 new account + 2 instructions + 4 error variants, with **no policy branch, no refund path and no amortization math** (see [Implementation outcome](#implementation-outcome)). Still needs its own audit pass; the security doc's §5.5 review is the open gate.
- ⚠️ The `−1` in the bid-depth formula and the "adjudicate before transferring" ordering inside `place_bid_reveal` are both **load-bearing and easy to break silently**. Dropping the `−1` would let a merely-current member bid; moving the eligibility check after the transfers would reintroduce the refund problem the design deleted. Both are covered by the litesvm matrices.
- ❌ Contemplation-by-bid complicates the "everyone is treated equally" story: a wealthier member can bid to jump the queue. This is inherent to consórcio and bounded (the bid is real money that accelerates the whole pool); we document it rather than design it away.

## Alternatives considered

### Prepayment as a separate `contribute_ahead` instruction

Cleaner separation, but duplicates the entire transfer / split / attestation body of `contribute` for a one-comparator difference. Rejected: relaxing the gate is far less surface for identical behaviour.

### Lance without prepayment (bid = pure external escrow, never touches installments)

Simpler economically, but throws away the natural _lance embutido_ that consorciados expect and that Phase 1 gives us for free. Rejected as the v1 shape; free-bid is Phase 3 on top, not instead.

### Off-chain bid matching (indexer picks the winner, a crank commits it)

Less on-chain surface, but puts contemplation — a fund-movement decision — behind a trusted off-chain picker. Rejected: contemplation must be trustless / verifiable on-chain, same principle as `finalize_draw`.

### Do nothing

Keeps RoundFi a draw-only / arrival-only ROSCA. Rejected: prepayment is a direct member ask at trivial cost, and the lance is core to the consórcio identity.

## References

- Contribute gate: `programs/roundfi-core/src/instructions/contribute.rs` (the `WrongCycle` / `AlreadyContributed` / `PoolClosed` cycle-alignment block)
- Sorteio draw: `ordering_policy` + `finalize_draw` / `DrawResult`
- Anti-sniping pattern: escape-valve commit-reveal (#232)
- Viability / split math: `pool_is_viable`, `math::split_installment`
- Prepayment lifecycle proof: `tests/litesvm_prepay_ahead.spec.ts`
- Member asks: live devnet testing ("pagar antecipado", "sistema de lances")
- Security design (was: required before Phase 3 code; now: **§5.5 review is the open mainnet gate**): [`docs/security/lance-contemplation.md`](../security/lance-contemplation.md)
- Phase 2 implementation: `programs/roundfi-core/src/instructions/place_embedded_bid.rs`; `pool.current_bid_depth`
- Phase 3 implementation: `programs/roundfi-core/src/state/bid.rs`, `instructions/place_bid_commit.rs`, `instructions/place_bid_reveal.rs`
- Envelope primitives (TS): `sdk/src/lance.ts` (`freeBidCommitHash`, `bidEnvelopeMessage`, `saltFromSignature`, `recoverBidParcels`); `sdk/src/pda.ts` (`bidPda`)
- Front-end: `app/src/lib/lance.ts` (pure eligibility + window helpers), `app/src/lib/place-embedded-bid.ts`, `app/src/lib/place-bid.ts`, `app/src/components/modals/PlaceBidModal.tsx`, `app/src/components/modals/FreeBidModal.tsx`
