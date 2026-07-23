# Lance contemplation — security design (ADR 0012 Phases 2–3)

**Status:** Phase 2 (lance embutido) — **implemented for devnet validation** (authorized by Alrimar, same canary posture as ADR 0013); **Caio's review of this document hard-gates mainnet**. Phase 3 (lance livre) — **design only; no on-chain code until this document is reviewed.**
**Date:** 2026-07-23
**Related:** ADR 0012 (phases + rationale); ADR pool_v2 (sorteio draw / `DrawResult`); ADR 0013 (grace catch-up — the BEHIND direction); #232 escape-valve commit-reveal (anti-snipe mold); LEAD-001 (payable-XOR-settleable).

## 1. The mechanism in one paragraph

A consórcio lance lets a member be contemplated **now** instead of at their drawn turn. RoundFi's `DrawResult.order` is a **bijection** seat→cycle (every member contemplated exactly once — the pool_v2 core guarantee). The lance is therefore implemented as a **swap of two entries** of that bijection: the bidder's seat takes the CURRENT cycle; the seat that held the current cycle takes the bidder's original (future) cycle. A permutation stays a permutation — so the "everyone exactly once" guarantee survives **by construction**, the displaced member keeps the same credit later, and every payout instruction (`claim_payout` / `crank_payout` / `skip_defaulted_payout`) reads the swapped truth through the existing `contemplated_cycle_for_seat` translation with **zero changes**.

## 2. Phase 2 — lance embutido (implemented)

**Bid material = prepayment.** The bid metric is `depth = contributions_paid − current_cycle − 1` — installments prepaid **beyond the one currently due** (> 0 only via ADR 0012 Phase 1 prepayment). The `−1` is load-bearing: `contributions_paid == current_cycle + 1` is the NORMAL paid-this-cycle state, and counting it as bid material would let any merely-paid-up member take the cycle with a zero bid. The funds were already accepted by `contribute` through the normal `split_installment` (solidarity / escrow / float shares preserved) — **`place_embedded_bid` moves no funds**; it only performs the swap.

**Surface (one new instruction, one Pool byte):**

- `place_embedded_bid` — signer = member wallet. Accounts: `config` (not paused), `pool` (mut; Active; `ordering_policy == SORTEIO`), `member` (PDA; wallet match; `!defaulted`), `draw` (mut; canonical `[b"draw-result", pool]` PDA; `draw.pool == pool`). Handler gates, in order: `!member.paid_out` → `EmbeddedBidUnavailable`; `depth ≥ 1` → `EmbeddedBidUnavailable`; `depth > pool.current_bid_depth` (strictly) → `EmbeddedBidTooShallow`; own drawn cycle `> current_cycle` → `EmbeddedBidUnavailable`. Effect: swap `order[bidder_seat] ↔ order[displaced_seat]`, set `pool.current_bid_depth = depth`, emit a `msg!` event (indexer-auditable).
- `Pool.current_bid_depth: u8` — carved from padding (5 → 4, SIZE unchanged; pre-existing pools read 0 = no bid). Per-cycle tracker, reset to 0 at every cycle advance (`claim_payout`, `crank_payout`, `skip_defaulted_payout`). Standing swaps persist in the `DrawResult`.
- Errors appended at the enum END (positional codes): `EmbeddedBidUnavailable`, `EmbeddedBidTooShallow`.

**Within-cycle competition.** Only a strictly deeper bid displaces the current holder (which may be the previous bidder — the chain of swaps is still permutation-preserving). Ties lose: first-to-depth keeps the slot, deterministic and grind-free.

## 3. Threat model (Phase 2)

| Threat                                                              | Outcome                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Double payout** (bid winner paid twice)                           | Blocked twice over: the swap preserves the bijection (each cycle exactly one seat, each seat exactly one cycle), and `!member.paid_out` bars an already-contemplated member from swapping back in.                                                                    |
| **Skip-forever** (displaced member never contemplated)              | Impossible by construction — the lance is a **swap**, not a steal: the displaced seat inherits the bidder's future cycle. Contrast with a "bid wins, drawn seat shifts down" design, which needs unbounded bookkeeping and was rejected.                              |
| **Bid-vs-claim race** (deep bid lands as the current holder claims) | Benign: both txs are individually valid; whichever lands first wins the slot and the other reverts (`NotYourPayoutSlot` for a claim whose seat lost the cycle; `EmbeddedBidUnavailable` for a bid whose target cycle advanced). No state corruption either way.       |
| **Last-second snipe** (outbid with no time to respond)              | **Accepted for the devnet canary** — the embedded bid's cost is the bidder's own future installments (sunk into their own obligation, not lost), so the snipe asymmetry is mild. Phase 3's free bids get commit-reveal (#232 mold) before shipping. Flagged for Caio. |
| **Depth spoofing**                                                  | `depth` derives on-chain from `member.contributions_paid` (program-owned) vs `pool.current_cycle` — no caller-supplied numbers.                                                                                                                                       |
| **Wrong-pool / forged draw**                                        | `draw` is a declared account with canonical PDA seeds + bump + `draw.pool == pool` — the #232-era `load_verified` checks, enforced by Anchor constraints.                                                                                                             |
| **Griefing via pause / default / behind states**                    | `config.paused`, `member.defaulted`, `depth ≥ 1` (a behind member saturates to 0) all gate before any mutation.                                                                                                                                                       |
| **Settlement interplay** (LEAD-001)                                 | None: the bid never touches `contributions_paid` or the settle gates. Payable-XOR-settleable (state) and catch-up-XOR-settle (time, ADR 0013) are both untouched.                                                                                                     |

**Invariants preserved:** DrawResult bijection; vault waterfall & `pool_is_viable` (no funds move); pay-after-receiving (a bid winner's prepayment IS their remaining obligation); seat identity (NFT / escape-valve listings stay keyed by `slot_index` — only _timing_ moved, exactly the property pool_v2 designed for).

## 4. Validation matrix (Phase 2 — `tests/litesvm_lance_embutido.spec.ts`)

- (i) depth-0 member (current, no prepay) → `EmbeddedBidUnavailable`;
- (ii) prepaid member places the first bid → both `DrawResult.order` entries swapped, `current_bid_depth` set, bijection intact;
- (iii) equal-depth counter-bid → `EmbeddedBidTooShallow` (strictly-greater rule);
- (iv) deeper counter-bid → second swap chains correctly (previous bidder displaced to the newcomer's old cycle);
- (v) the winning bidder **claims the current cycle** end-to-end (proves the payout path reads the swapped truth) and the advance resets `current_bid_depth` to 0;
- (vi) the pool then runs to completion with every member contemplated exactly once (bijection preserved through multiple swaps);
- (vii) arrival-order pool → `EmbeddedBidUnavailable` (policy gate).

## 5. Phase 3 — lance livre (design only; code gated on this doc's review)

Free bids bring **external USDC**, so Phase 3 = escrow + auction on top of Phase 2's settled swap mechanism:

- **`Bid` PDA** `[b"bid", pool, cycle, bidder]` — amount, commit hash, state (Committed / Revealed / Won / Refundable), bump. Rent by bidder.
- **`place_bid_commit(hash)`** during the cycle: locks USDC into a bid vault; stores `hash = sha256(amount ‖ salt ‖ bidder)` — commit-reveal in the #232 mold so a late bidder can't read the book and snipe.
- **`place_bid_reveal(amount, salt)`** inside a reveal window (ends ≥ N seconds before the claim becomes crankable): verifies the hash; converts the bid to **depth** — the locked USDC is applied as the bidder's next `⌊amount / installment⌋` prepaid installments **through the normal `split_installment` path** (so solidarity/escrow/float shares — and every Phase 1 safety argument — carry over verbatim), remainder refundable; then the winner adjudication + swap is **exactly Phase 2's** (`depth > current_bid_depth` → swap). This is the load-bearing design choice: _the free bid compiles down to prepayment + embedded bid_, so Phase 3 adds escrow/refund/reveal surface but **no new contemplation math**.
- **`withdraw_bid`** — losers (and expired commits) reclaim their full lock; `Won` bids have already been converted to installments (nothing to withdraw beyond the remainder).
- **Amortization** falls out for free: the winner's locked USDC became their future installments — balance reduced, term shortened, exactly the consórcio's _lance abate saldo_ semantics — with no separate amortization math to audit.
- **Unified metric:** free and embedded bids compete in the same unit (depth), so a hybrid cycle has one adjudication rule.
- **Viability:** unchanged — bids only accelerate float (the Phase 1 argument), never reduce it; losing bids never touch pool vaults (separate bid vault).
- **Open questions for the review:** reveal-window length + placement vs the SEV-053 re-anchored deadline; minimum bid (≥ 1 installment implicit — enough?); whether `Won` remainder auto-refunds in `settle` or stays in `withdraw_bid`; indexer/reputation treatment (bids are behaviorally interesting — new informational schema?).

## 6. Review checklist for Caio

1. Swap-preserves-bijection argument (§1) — is a two-entry swap of a verified permutation sufficient, given the `paid_out` gate?
2. Bid-vs-claim race classification as benign (§3) — any interleaving we missed?
3. Snipe acceptance for embedded bids on the canary (§3) — or should Phase 2 already take the commit-reveal?
4. Phase 3's "free bid compiles to prepayment" reduction (§5) — the whole Phase 3 audit surface hangs on it.
5. The per-cycle reset sites (3 payout instructions) — any advance path missed? (`close_pool` doesn't advance; `settle_default` doesn't advance.)
