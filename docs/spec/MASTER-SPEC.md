# RoundFi — Master Specification

> **Version:** v1.0 · **As of:** 2026-06-12 · **Status:** source of truth for the post-v5.2, post-four-tier, post-Pass-3 protocol.
>
> **What this is.** The single authoritative description of RoundFi: what it is, the protocol mechanics, the reputation engine, the economics, the adversarial model, the risk posture, and the roadmap. It supersedes the scattered overview / whitepaper / architecture / business-model PDFs as the canonical reference — those should be **derived** from this document, not maintained in parallel.
>
> **Accuracy.** Every constant, schema id, threshold, and percentage in this document is pinned to the deployed Jun 2026 source (`programs/`, `services/indexer/`, `crates/math/`). Where a value is provisional or off-chain, it is marked as such. Citations point at the source file so this document can be re-verified, not trusted.

## Table of contents

1. [One sentence](#1-one-sentence)
2. [Problem](#2-problem)
3. [Solution](#3-solution)
4. [Protocol](#4-protocol)
5. [Reputation engine](#5-reputation-engine)
6. [Reputation metrics](#6-reputation-metrics)
7. [Oracle roadmap](#7-oracle-roadmap)
8. [Economics](#8-economics)
9. [Adversarial model](#9-adversarial-model)
10. [Risk review](#10-risk-review)
11. [Deployed state & validated capabilities](#11-deployed-state--validated-capabilities)
12. [Roadmap](#12-roadmap)
13. [Regulatory considerations](#13-regulatory-considerations)

---

## 1. One sentence

> **RoundFi is infrastructure that turns verifiable financial behavior into portable, on-chain reputation.**

The protocol is a rotating savings-and-credit association (ROSCA — _consórcio_ / _junta_ in Brazil) implemented on Solana. The ROSCA is the **data engine**: it produces a stream of verifiable, financially-consequential behavioral events (paid on time, paid late, completed the round, defaulted). The reputation profile built from those events is the **product**: a portable credit signal a wallet carries across pools and, eventually, across protocols.

RoundFi is not "a savings app with a score bolted on." The savings mechanism exists to **generate behavior worth scoring**; the score exists to make future credit cheaper for people who have proven they pay.

## 2. Problem

Most of the world is **credit-invisible**. Thin-file and no-file individuals — the majority of adults in Brazil, Latin America, Africa, Southeast Asia — have no portable record of whether they keep financial commitments. They are not high-risk; they are **unmeasured**. The absence of a track record, not the presence of bad behavior, is what excludes them.

The informal instruments these populations already use — ROSCAs, _consórcios_, _tandas_, _susus_, _chamas_ — generate exactly the behavior a lender would want to see (recurring contributions, social-enforcement of repayment, completion of multi-month obligations). But that behavior **evaporates**: it lives in a WhatsApp group or a notebook, it doesn't survive the group dissolving, and it can't be presented to anyone outside the group.

The gap RoundFi closes: take an instrument people **already trust and use**, run it on rails that make every event **verifiable and durable**, and emit a **portable** reputation from it.

## 3. Solution

Three layers:

1. **The pool (ROSCA on-chain).** A fixed set of members each contribute a recurring installment; each cycle one member receives the pooled "carta" (credit). Stake, escrow, and a solidarity reserve protect the pool against defaults. Every contribution, payout, and default is a Solana transaction.

2. **The attestation layer.** Each consequential event emits a signed on-chain **attestation** (a behavioral record: paid / late / pool-completed / defaulted / payout-claimed). Attestations are keyed by **subject = wallet** and are immutable. This is the verifiable substrate.

3. **The reputation engine.** An off-chain scorer (and an on-chain level ladder) consumes the attestation stream and produces a score, a tier (L1-L4), and four behavioral metrics (Reliability, Punctuality, Commitment, Recovery). The tier feeds back into the protocol (higher tier ⇒ lower required stake) and is exposed to external consumers via an API.

The feedback loop is the whole point: **good behavior in the pool lowers your cost of capital in the next pool**, and the resulting reputation is yours to carry.

## 4. Protocol

All protocol logic lives in `roundfi-core` (`8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw` on devnet). Reputation lives in `roundfi-reputation` (`Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2`). Yield adapters: `roundfi-yield-mock` (`GPTMPgx…`) and `roundfi-yield-kamino` (`74izMa4W…`).

### 4.1 Pool lifecycle

`Forming → Active → Completed → Closed`.

| Transition         | Instruction                                                    | Notes                                                                                                               |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| (create) → Forming | `create_pool` + `init_pool_vaults`                             | Two ixs: PDA alloc, then the four USDC vault ATAs (split for stack-depth).                                          |
| Forming → Active   | `join_pool` (last member)                                      | Pool flips Active when `members_joined == members_target`.                                                          |
| (on fill, sorteio) | `finalize_draw`                                                | Permissionless. Draws the contemplation order into a `DrawResult` PDA when `ordering_policy == 1`. See §4.8.        |
| (per cycle)        | `contribute`, `claim_payout`                                   | A cycle's claim advances `current_cycle` and re-arms `next_cycle_at`. `crank_payout` is the permissionless variant. |
| (per cycle, lance) | `place_embedded_bid` · `place_bid_commit` + `place_bid_reveal` | Optional. Bids swap two entries of the drawn order — the payout path is untouched. See §4.8.                        |
| Active → Completed | `claim_payout` (final cycle)                                   | When `next_cycle ≥ cycles_total`.                                                                                   |
| Completed → Closed | `close_pool`                                                   | Pure terminal transition; decrements committed TVL. Moves no funds.                                                 |

**Hard geometry invariant:** `cycles_total == members_target` (`create_pool.rs:123`, SEV-038). Every slot is drawn exactly once; no orphan cycles.

**Cycle advancement is claim-driven, not time-driven.** `claim_payout` of cycle N sets `current_cycle = N+1` and `next_cycle_at += cycle_duration`. Time only governs the on-time/late classification and the default grace window — not whether the pool can progress.

### 4.2 The four vaults

Each pool owns four USDC token accounts, authorities are PDAs:

- **`pool_usdc_vault`** — the pool float; contributions land here net of the splits, payouts are drawn from here.
- **`escrow_vault`** — member stakes + the escrow slice of each contribution. The vesting / seizure surface.
- **`solidarity_vault`** ("Cofre Solidário") — the 1%-of-installment reserve that covers the first tranche of a default.
- **`yield_vault`** — idle USDC parked into the yield adapter.

### 4.3 Contribution split

Each `installment` is split on `contribute`:

| Slice      |                                       bps | Destination        |
| ---------- | ----------------------------------------: | ------------------ |
| Solidarity |                                  100 (1%) | `solidarity_vault` |
| Escrow     | `escrow_release_bps` (default 2500 = 25%) | `escrow_vault`     |
| Pool float |                   remainder (default 74%) | `pool_usdc_vault`  |

The 74% float retention is the basis of the **Seed Draw viability guard** (`crates/math/src/seed_draw.rs`): `members × installment × (MAX_BPS − solidarity_bps − escrow_release_bps) / MAX_BPS ≥ credit`. `create_pool` refuses to allocate a pool whose math doesn't close (`PoolNotViable`), so the cycle-0 claim can never under-run the float (`WaterfallUnderflow`).

### 4.4 Stake & the Triple Shield

A member stakes a fraction of the credit at join, sized by their reputation tier (see §5). The stake plus the escrow slice plus the solidarity reserve form the **Triple Shield** — the layered defense that makes a member's default recoverable for the pool. Seizure order on `settle_default`:

1. **Solidarity vault** — up to the missed installment.
2. **Member escrow balance** — up to the remaining shortfall.
3. **Member stake** — the remainder.

All seized USDC flows into `pool_usdc_vault` so the pool can still pay its drawn member; the defaulter is marked `defaulted = true` and a `SCHEMA_DEFAULT` attestation fires.

The mirror of seizure is **vesting**: an **on-time** member progressively releases their stake from escrow via `release_escrow(checkpoint)`, gated on `member.on_time_count ≥ checkpoint`. Pay on time ⇒ get your stake back in tranches; pay late ⇒ the stake stays locked (`EscrowLocked`). This is the on-chain expression of "discipline is rewarded, delinquency is collateralized."

### 4.5 Default settlement

`settle_default(cycle)` requires:

- `args.cycle == pool.current_cycle`
- `member.contributions_paid < pool.current_cycle` (genuinely behind)
- `now ≥ pool.next_cycle_at + GRACE_PERIOD_SECS` — **7 days** on the mainnet build, **1 day** on the `devnet-canary` build (`constants.rs`, cfg-gated). The grace window is generous on purpose: default is a last resort, not a tripwire.
- `!member.defaulted` (one-shot), pool `Active`.

### 4.6 Escape Valve (secondary market)

A member can exit a pool mid-life by selling their **position** (the slot + its NFT + its pending obligations) on a secondary market. Two listing paths:

- **Direct** — `escape_valve_list(price)` → `escape_valve_buy`. Listing is immediately `Active`.
- **Commit-reveal (anti-MEV, #232)** — `escape_valve_list_commit(hash)` hides the price behind `SHA-256(price ‖ salt)`; `escape_valve_list_reveal(price, salt)` publishes it and arms `buyable_after = now + REVEAL_COOLDOWN_SECS` (30s). The buyer, who already knows `(price, salt)` off-chain, lands their buy at the boundary ahead of any searcher reacting to the now-public price. `escape_valve_buy` enforces `now ≥ buyable_after` (`ListingNotBuyableYet`).

On `escape_valve_buy` the handler atomically: transfers `price` buyer→seller; closes the seller's `Member` PDA and creates the buyer's with the **position-state snapshot** carried over (`contributions_paid`, `escrow_balance`, `on_time_count`, `late_count`, `slot_index`, stake tier); thaws→transfers→re-freezes the position NFT (mpl-core CPIs via the slot's `position_authority`); and closes the listing.

**Position-state vs wallet-reputation (design note, partner review MEDIUM #3).** The buyer inherits the **slot's** operational state — the pending obligations they must now honor. They do **not** inherit the seller's `ReputationProfile` PDA (`[b"reputation", seller_wallet]`), which holds the **portable** score and tier and stays with the seller's wallet. The buyer brings their own profile. Buying a half-paid position assumes that position's remaining obligations; it does not transfer credit history in either direction. The reputation engine scores attestations keyed by **subject = wallet**, so reputation naturally tracks the wallet, not the slot.

### 4.7 Pause (circuit breaker)

`pause(bool)` (authority-gated) sets `config.paused`. While paused, **17 instructions** revert with `ProtocolPaused` at account-validation time (the `constraint = !config.paused` on the shared `config` account): `create_pool`, `join_pool`, `contribute`, `claim_payout`, `crank_payout`, `release_escrow`, `skip_defaulted_payout`, `deposit_idle_to_yield`, `harvest_yield`, all four Escape Valve paths (`escape_valve_list_commit`, `escape_valve_list_reveal`, `escape_valve_list`, `escape_valve_buy`), `cancel_pending_listing`, and **all three lance paths** (`place_embedded_bid`, `place_bid_commit`, `place_bid_reveal`).

Two instructions sit **outside** the pause gate, for different reasons:

- **`settle_default`** — a **deliberate carve-out**: a default in flight must still be settleable while paused. Tracked as SEV-018 (design-intentional).
- **`finalize_draw`** — takes **no `config` account at all**, so it is structurally un-pausable rather than deliberately exempted. It is permissionless and moves no funds — it only freezes a `DrawResult` for a pool that has filled — so a draw finalized during a pause cannot move money; every instruction that _would_ pay against that order is itself gated. Recorded here so the carve-out is documented rather than discovered; **whether `finalize_draw` should take `config` and gate on it is an open question for the external audit.**

### 4.8 Contemplation order & the lance

RoundFi is a **consórcio**: exactly one member is contemplated (handed the credit) per cycle.
Two questions decide who — in what order the pool contemplates, and whether a member may pay
to move up. Both are on-chain. Design record: [ADR 0012](../adr/0012-contemplation-lance-and-prepayment.md);
security analysis: [`docs/security/lance-contemplation.md`](../security/lance-contemplation.md).

**Ordering policy** (`pool.ordering_policy: u8`, carved from `Pool`'s trailing padding so
`Pool::SIZE` is unchanged — same pattern as `vaults_initialized`, Adevar SEV-004):

| Value | Policy  | Mechanism                                                                                          |
| ----: | ------- | -------------------------------------------------------------------------------------------------- |
|   `0` | arrival | Payout follows join order. The default; a zeroed byte on a pre-existing pool reads as this.        |
|   `1` | sorteio | `finalize_draw` draws the order on-chain when the pool fills and freezes it in a `DrawResult` PDA. |

Validation is **fail-closed**: an unknown policy value is rejected rather than silently
treated as arrival.

**`DrawResult.order[seat] = cycle` is a permutation**, and that is the load-bearing fact of
this whole subsystem: "every member is contemplated exactly once" is a structural property of
a bijection, not an invariant anyone has to check.

**The lance** lets a member bid to be contemplated earlier. A lance changes _who_ is
contemplated _when_ — never _whether_ they still owe every remaining installment
(the pay-after-receiving thesis is non-negotiable).

- **Prepayment** — `contribute` accepts your **next unpaid** installment even when it is ahead
  of `pool.current_cycle` (`args.cycle >= pool.current_cycle`). No skipping (`args.cycle ==
member.contributions_paid` still holds) and no back-pay: a behind member still fails the gate.
- **Lance embutido** — `place_embedded_bid` offers the installments you have already prepaid.
  Depth is `contributions_paid − current_cycle − 1`; the `−1` is load-bearing, because
  `contributions_paid == current_cycle + 1` means merely **current**, not ahead. Strictly
  greater than `pool.current_bid_depth` wins; ties lose. Required depth to take the cycle is
  therefore `current_bid_depth + 1`.
- **Lance livre (sealed)** — `place_bid_commit` writes a `Bid` PDA (`SIZE = 131`, seeds
  `[b"bid", pool, cycle, bidder]`) holding `commit_hash = sha256(amount_le ‖ salt_le ‖ bidder)`
  over a 48-byte preimage. `place_bid_reveal` opens it. The bid amount must be an exact
  multiple of the installment: a free bid **is** K installments prepaid atomically, settled with
  **one** attestation via `BehavioralPayload.parcels_paid: u8`.

**Contemplation is a swap, not a new payout path.** A winning bid swaps two entries of
`DrawResult.order` — the bidder takes the current cycle, the displaced seat inherits the
bidder's former future cycle. A transposition of a permutation is still a permutation, so
`claim_payout` and `crank_payout` required **no changes**.

**Anti-snipe is temporal.** Commits require `clock < pool.next_cycle_at`; reveals require
`next_cycle_at ≤ clock < next_cycle_at + GRACE_PERIOD_SECS`. The windows are **disjoint** —
you cannot observe a revealed bid and still place one.

**Losing costs nothing but the fee.** `place_bid_reveal` adjudicates (`depth >
pool.current_bid_depth`) **before** any token transfer, so a losing reveal reverts and the
USDC never leaves the bidder's wallet. This is why there is **no bid vault, no refund path and
no settlement instruction** — the free bid reduces to prepayment plus an embedded bid.

> ⚠️ **Open mainnet gate.** The lance surface ships on devnet but external review of
> [`lance-contemplation.md`](../security/lance-contemplation.md) §5.5 (reveal-window length;
> whether losing costing only the fee makes bidding too cheap; whether the indexer treats
> `parcels_paid > 1` as one event; whether hybrid embedded×free cycles are intended) is
> **required before mainnet**.

## 5. Reputation engine

### 5.1 The four-tier ladder

| Tier | Name      | Stake (bps of credit) | Score threshold | Min completed pools | Identity            |
| ---- | --------- | --------------------: | --------------: | ------------------: | ------------------- |
| L1   | Iniciante |            5000 (50%) |               0 |                   0 | —                   |
| L2   | —         |            2500 (25%) |             500 |                   2 | gate-configurable   |
| L3   | Veteran   |            1000 (10%) |            2000 |                   3 | gate-configurable   |
| L4   | Elite     |              300 (3%) |            5000 |                   8 | **always required** |

Source: `roundfi-reputation/src/constants.rs` (`STAKE_BPS_LEVEL_*`, `LEVEL_*_THRESHOLD`, `LEVEL_*_MIN_CYCLES`).

The tier sets the **stake discount**: an L4 Elite member risks 3% of the credit vs an L1's 50%. That discount is the economic reward for a proven track record, and it's why the upper tiers are the ones most worth gaming — hence the layered anti-farming defenses below.

### 5.2 Promotion is doubly-gated

`promote_level` (permissionless) advances a wallet to the highest tier whose **score AND cycles** thresholds are both met (`resolve_level`), then applies the identity cap (`cap_level_for_identity`). Two independent anti-farming walls:

- **Score** rises +10 per on-time payment, +50 per completed pool, −100 per late, −500 per default. Score alone is farmable (parallel 1-member pools).
- **Completed-pools floor** (`cycles_completed`) is the **unbypassable wall-clock defense**: it only rises on `SCHEMA_POOL_COMPLETE`, which fires once per pool the member paid through to the end, and carries a 30-day per-subject cooldown (`MIN_POOL_COMPLETE_COOLDOWN_SECS`). L2 needs 2 completed pools (ECO-V52, raised from 1 so the 4× tier is never reachable on a single self-dealt pool); L3 needs 3; L4 needs 8 — each a multi-month commitment. A score farm can't buy time.

**Identity hard floor (partner review MEDIUM #1, resolved in code).** L4 Elite **always** requires `identity_verified`, independent of the configurable identity gate (`IDENTITY_HARD_FLOOR_LEVEL`, `cap_level_for_identity`). L2/L3 are governed by the configurable `IdentityGateConfig.required_min_level` (devnet `0` = open, mainnet `3` = verified-only). An unverified wallet is capped at L3 even with the gate off.

### 5.3 Attestation schemas (Pass-3 taxonomy)

The correct separation of "received capital" from "kept obligations" is the heart of the v5.2 reputation design (Pass-3, Jun 2026).

|  id | schema           | emitter                          | score Δ | `cycles_completed` | polarity      |
| --: | ---------------- | -------------------------------- | ------: | ------------------ | ------------- |
|   1 | `PAYMENT`        | `contribute` (on-time)           |     +10 | —                  | positive      |
|   2 | `LATE`           | `contribute` (late)              |    −100 | —                  | negative      |
|   3 | `DEFAULT`        | `settle_default`                 |    −500 | —                  | negative      |
|   4 | `POOL_COMPLETE`  | `contribute` (final installment) |     +50 | **+1**             | positive      |
|   5 | `LEVEL_UP`       | `promote_level`                  |       0 | —                  | informational |
|   6 | `PAYOUT_CLAIMED` | `claim_payout`                   |   **0** | —                  | **neutral**   |

The critical correction (partner review HIGH #2, already resolved): **`PAYOUT_CLAIMED` (claim) is score-neutral and does not advance `cycles_completed`.** Receiving your carta is not merit; keeping your obligations _after_ receiving it is. The `+50` / cycles bump lives on `POOL_COMPLETE`, which only fires on a member's **last** contribution of the pool — i.e. only after they've proven the "pay-after-receiving" behavior that is RoundFi's entire thesis. Verified live on devnet 2026-06-12 (pool `Ga2RwgSk…`): schemas 1, 6, 4 emitted distinctly, `payout_claimed` in the neutral bucket.

## 6. Reputation metrics

The off-chain scorer (`services/indexer/src/reputationMetrics.ts`) projects the attestation history into four 0-100 metrics. Two are live; two are pending the canary.

### 6.1 Reliability (live)

A weighted average over the most recent `RELIABILITY_WINDOW` reliability-bearing events. Each classification carries a weight; `payout_claimed`, `pool_complete`, and `unspecified` carry **no** reliability weight (they're not reliability inputs). `reliability = ⌊Σ weights × 100 / (count × MAX_WEIGHT)⌋`, clamped 0-100. A fresh wallet defaults to `reliability = 0` (no evidence, not a penalty).

### 6.2 Punctuality (live)

Derived from the average `delta_seconds` (paid-time minus due-time) over the recent payment window, mapped piecewise (`punctualityOfAvg`):

| Avg timing       | Punctuality |
| ---------------- | ----------: |
| ≤ 3 days early   |         100 |
| early → on time  |    80 → 100 |
| on time          |          80 |
| up to 1 day late |     80 → 60 |
| 1–7 days late    |     60 → 30 |
| 7–30 days late   |      30 → 0 |
| > 30 days late   |           0 |

A **friction grace** treats any payment under 1h late as on-time (clock jitter, gas timing). Fresh-wallet neutral default is 80.

### 6.3 Commitment & Recovery (pending)

- **Commitment** — depth of obligation kept (completed pools, post-payout discipline). Fed by `pool_complete`.
- **Recovery** — did a defaulter come back and rebuild? The single most important metric for the "second chance" thesis.

Both are surfaced as `null` in the score API until the canary produces enough real default→recovery sequences to calibrate the weights. Shipping them as `null` rather than as a fabricated number is deliberate: we do not publish a metric we cannot yet defend.

## 7. Oracle roadmap

- **v1 (shipped)** — on-chain score ladder + the v1 score schedule (+10 / +50 / −100 / −500). Promotion gated on score + completed-pools. Reliability + Punctuality computed off-chain.
- **v1.5 (in progress)** — Commitment + Recovery calibrated from canary data; the off-chain metrics become an authoritative oracle feed.
- **v5.2 (current design)** — four-tier ladder, Pass-3 attestation taxonomy, identity hard floor for Elite, escape-valve secondary market with anti-MEV. The on-chain L4 gate is **v1-provisional** (score + cycles); the proposal's metric-based Elite criteria (Reliability ≥ 94, Punctuality ≥ 88, Commitment ≥ 90, zero bad-faith) live off-chain and will harden the on-chain gate once the weights are calibrated.

## 8. Economics

### 8.1 The Seed Draw guard

Already covered in §4.3: `members × installment × 0.74 ≥ credit`. This is what makes the pool **self-funding** — the float retained from contributions is enough to pay the drawn member every cycle without an external subsidy.

### 8.2 Yield Cascade

Idle pool float can be deposited into a yield adapter (`deposit_idle_to_yield`) and harvested (`harvest_yield`). The realized surplus runs a PDF-canonical waterfall:

1. **Protocol fee** — `DEFAULT_FEE_BPS_YIELD` = 20% of gross → treasury (the only physical outflow).
2. **Guarantee Fund** — logical earmark on `pool.guarantee_fund_balance`.
3. **LP slice** — `config.lp_share_bps` (default 65%) logical earmark on `pool.lp_distribution_balance` (the "Anjos de Liquidez" / liquidity angels).
4. **Residual** — stays in `pool_usdc_vault` as the participants' "prêmio de paciência" (patience premium).

A slippage floor (`harvest_yield(min_realized)`) protects against an adapter under-reporting yield. Adapters are pluggable; the mock is for devnet, Kamino is the mainnet target (on-chain CPI shipped, operational reserve pin pending).

### 8.3 Stake economics

The stake discount ladder (50% → 25% → 10% → 3%) is the user-facing reward. A member who reaches Elite frees ~94% of the capital an L1 must lock — a direct, legible incentive to build and keep reputation. The protocol's risk doesn't rise as stake falls, because the upper tiers are gated on a long completed-pool history that itself is the risk signal.

## 9. Adversarial model

The protocol is designed against a motivated attacker trying to manufacture reputation or extract value. This section is a summary; the full treatment is `docs/spec/adversarial-model.md` (planned).

| Attack                 | Vector                                                                | Current defense                                                                                                                                         | Residual gap                                                                         |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Score farming**      | Parallel 1-member pools, +10 each in parallel                         | Completed-pools floor (`cycles_completed`) + 30-day `POOL_COMPLETE` cooldown — score alone can't promote                                                | L4-provisional gate is score+cycles; metric-based Elite (off-chain) not yet on-chain |
| **Sybil**              | N wallets, one operator, coordinated pools                            | Each wallet must independently accrue completed pools over wall-clock time; reputation is per-wallet, non-transferable                                  | Cost/benefit table to be quantified by the simulator (Pass 8)                        |
| **Cartel**             | Closed group farms each other's reputation                            | Same wall-clock floor; no special weight for closed groups (a closed cartel earns the same trajectory as honest strangers)                              | Whether cartel-earned reputation should be _discounted_ is an open product question  |
| **Elite farming**      | Reach L4 cheaply to exploit the 3% stake                              | 8 completed pools (~4y honest history) + identity hard floor (PoP) — Elite is the most-defended tier                                                    | —                                                                                    |
| **Escape-valve abuse** | Seller exits a slot about to default, dumps the loss on a naïve buyer | Buyer inherits `escrow_balance` (the funds at risk are already locked against the slot); commit-reveal prevents price-sniping                           | Buyer-side UX must surface the inherited obligations clearly                         |
| **Goodhart**           | Optimize the promotion metric without the behavior it proxies         | Promotion is gated on _consequential_ on-chain events (real USDC at stake), not a soft signal — gaming the metric requires actually keeping obligations | The off-chain metric weights (v1.5) must be designed Goodhart-aware                  |

**The most important open work** (per the partner review, and we agree): quantify the sybil/cartel cost-benefit with a simulator (10k virtual users, 12-36 month horizon) and publish the adversarial economics. "We observed risk reduction" beats "we believe reputation reduces risk" for every grant and partner conversation.

## 10. Risk review

The protocol has been through multiple internal + external audit cycles (Adevar Labs SEV series, Caio HIGH/MEDIUM reviews). State as of 2026-06-12:

- **Closed in code:** the SEV series (SEV-002 grace leak, SEV-005/038 cycle/orphan guards, SEV-013 commit-reveal salt, SEV-016/029/034 escrow vesting math, SEV-024 fee timelock, SEV-027 admin-attest cooldown, SEV-031 pool viability, SEV-047 identity gate), Pass-3 (claim ≠ cycle-complete), and the L4 identity hard floor.
- **Mainnet checklist (config / deploy-time, not handler logic):** `IdentityGateConfig.required_min_level = 3` for L2/L3; `reputation_program != Pubkey::default()` invariant in `initialize_protocol`; treasury + upgrade authority on a Squads 3-of-5 multi-sig; external audit clear (#267); legal counsel (#268). Tracked in `docs/operations/mainnet-canary-plan.md`.
- **Non-code risk:** regulatory (LGPD, Bacen, irregular-fund-collection) — addressed by counsel, not Rust. A hard gate on mainnet.

## 11. Deployed state & validated capabilities

Seven of the eight protocol capability areas were exercised **end-to-end on devnet** on 2026-06-12 with real USDC; the eighth (default settlement) is armed and time-gated.

|   # | Capability                                                            | Pool             | Status                |
| --: | --------------------------------------------------------------------- | ---------------- | --------------------- |
|   1 | Full lifecycle + Pass-3 reputation scoring                            | `Ga2RwgSk…` (43) | ✅                    |
|   2 | `close_pool` (terminal Closed)                                        | 43               | ✅                    |
|   3 | Yield Cascade (init → deposit → harvest)                              | `4SZCKeQL…` (44) | ✅                    |
|   4 | Escape Valve — direct (list → buy)                                    | 44               | ✅                    |
|   5 | Pause circuit-breaker (pause → gate → unpause)                        | —                | ✅                    |
|   6 | Escrow vesting (`release_escrow`, on-time)                            | 44               | ✅                    |
|   7 | Escape Valve — commit-reveal (anti-MEV)                               | 44               | ✅                    |
|   8 | Rent-reclaim ceremony (`close_member` → `close_pool_vaults`, SEV-039) | 43               | ✅                    |
|   9 | Default settlement (`settle_default`)                                 | `Hg9AkTCg…` (45) | 🔫 armed; grace-gated |

The rent-reclaim ceremony (#8) is the **true** end of a pool's lifecycle: `close_pool` only flips status to `Closed`, but `close_member` × N (rent → members) then `close_pool_vaults` (residual USDC → treasury, vault ATAs + Pool PDA closed, rent → authority) reclaim everything. Validated on pool `Ga2RwgSk…` — the authority's SOL went **up** (+0.0108 net of fees).

Transaction signatures and the reproducible runbook: `docs/operations/v52-devnet-runbook.md`.

**Contemplation subsystem (Jul 2026, [ADR 0012](../adr/0012-contemplation-lance-and-prepayment.md)).** Sorteio ordering, installment prepayment, the embedded lance and the sealed free bid are **deployed on devnet** and covered by in-process lifecycle proofs rather than the capability table above — each is exercised by a litesvm spec that drives a whole pool (`litesvm_sorteio_draw`, `litesvm_ordering_policy`, `litesvm_prepay_ahead`, `litesvm_lance_embutido`, `litesvm_lance_livre`) plus `lance_livre_hash` pinning the TS↔Rust commit-hash preimage byte-for-byte. A devnet capability row lands once the pools driving it are replayed under the v5.2 runbook shape. **External review of the lance security doc §5.5 is an open mainnet gate** — see [`MAINNET_READINESS.md`](../../MAINNET_READINESS.md).

**Account types (`roundfi-core`).** `ProtocolConfig`, `Pool`, `Member`, `Listing`, `DrawResult`, `Bid` — 6 total. `Pool::SIZE` has been held constant across three field additions (`vaults_initialized`, `ordering_policy`, `current_bid_depth`) by carving each from trailing padding (7 → 6 → 5 → 4 bytes), so previously-created pools stay decodable and read a zeroed byte as the safe default. `RoundfiError` has **91 variants**; because Anchor error codes are positional (`6000 + index`), new variants are only ever **appended**.

**Deployed program IDs (devnet, shared across clusters):**

| Program                | ID                                             |
| ---------------------- | ---------------------------------------------- |
| `roundfi-core`         | `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw` |
| `roundfi-reputation`   | `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2` |
| `roundfi-yield-mock`   | `GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ` |
| `roundfi-yield-kamino` | `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb` |

## 12. Roadmap

| Window           | Milestone                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Now → 2026-06-15 | `settle_default` replay (grace elapses); canary-metrics framework; adversarial-model v1          |
| 2026 Q3          | Simulator v1 (10k users, 12-36 mo); Canary Report #1; partner-readiness doc + public score API   |
| 2026 Q3          | Mainnet canary (self-pool, 1 member, real USDC) — hard-gated on audit + multi-sig + legal        |
| 2026 Q4          | Metric-based Elite gate on-chain (v1.5 oracle); Kamino operational integration; retail pool ramp |

## 13. Regulatory considerations

RoundFi's primary regulatory surface is the **model**, not the code. Open questions, all requiring specialist counsel (not engineering):

- **LGPD** (Brazilian data protection) — reputation is personal data; portability, consent, and the right-to-explanation apply.
- **Captação irregular** (irregular fund collection) — a pooled-savings instrument touches Bacen / CVM perimeters depending on structure; the size-1 canary and the consortium framing are deliberate de-risking choices.
- **Cross-border** — US (CFTC/state money-transmission) exposure if non-BR users participate.

These are hard gates on the mainnet path (`docs/operations/mainnet-canary-plan.md § 3.1`, #268). The protocol is engineered to be **legible** to a regulator — every event is on-chain, attestations are auditable, and the reputation derivation is documented here — which is itself a compliance asset.

---

## Derived documents

This Master Spec is the source; the following are **derived** from it and should not duplicate its content:

- **User Guide** — how to join, pay, climb tiers (≤10 pages, no internals).
- **Partner Guide** — the score API, webhook semantics, a reference integration (Kamino / MarginFi / fintech consumer of `{ tier, reliability }`).
- **Adversarial Model** (`docs/spec/adversarial-model.md`) — the full §9 treatment with quantified attacker economics.
- **Canary Report #N** — the published evidence (`docs/strategy/canary-metrics.md` + the rendered reports).
- **Pitch deck / website / whitepaper** — narrative extractions.

> **Maintenance rule.** When the protocol changes, this document changes first; the derived documents follow. One source of truth, N derivations — never N sources.
