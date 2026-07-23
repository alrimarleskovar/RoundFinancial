# ADR 0012 — Contemplation by lance (consórcio bidding) + installment prepayment

**Status:** 🟡 Proposed
**Date:** 2026-07-23
**Decision-makers:** RoundFi team (Alrimar, Caio)
**Related:** the sorteio draw machinery (`ordering_policy` + `finalize_draw` / `DrawResult`); the `contribute` cycle gate; escape-valve commit-reveal (#232, anti-snipe). **Phased** — Phase 1 (prepayment) has an implementing PR that this ADR gates; Phases 2–3 (lance) precede their implementation and gate it.

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

## Consequences

- ✅ Phase 1 unlocks _"pagar antecipado"_ with a one-comparator, invariant-preserving relaxation — real member value at near-zero risk.
- ✅ Phases 2–3 make RoundFi a faithful consórcio (sorteio + lance) — the mechanism the target user already understands — a product-defining feature, not a bolt-on.
- ✅ Reuses proven substrate: prepayment rides `contribute`; the draw rides the sorteio machinery; anti-sniping rides the #232 commit-reveal shape.
- ⚠️ Prepayment changes the funding **timeline** (float arrives earlier, unevenly). It never reduces total float, but the parity model + the litesvm prepayment test must confirm the claim waterfall + viability hold when one member is several cycles ahead.
- ⚠️ Lance (Phase 3) adds material on-chain surface (new account + 3 instructions + policy branch + refund / amortization math) — its own audit + fuzz pass, gated by the security doc.
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
- Follow-up (required before Phase 3 code): `docs/security/lance-contemplation.md`
