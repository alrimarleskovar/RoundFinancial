# RoundFi — MEV & Front-Running Review

> **Scope:** ordering-dependent attacks on RoundFi instructions — `claim_payout`, `escape_valve_buy`, `settle_default`, `harvest_yield`, `deposit_idle_to_yield`, `join_pool`. Explicitly **deferred to mainnet** per [`self-audit.md §7`](./self-audit.md#7-out-of-scope-future-work) + [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md) "Out of scope". This doc consolidates MEV-specific threats previously summarized in [`adversarial-threat-model.md §6`](./adversarial-threat-model.md#6-mev--front-running) and tracked under [Issue #232](https://github.com/alrimarleskovar/RoundFinancial/issues/232).
>
> **Why this doc exists:** Solana doesn't have a public mempool the way Ethereum does, but it has Jito searchers, leader-rotated block production, and parallel scheduling — enough to create ordering-dependent extraction vectors. The on-chain audit will look at this code; this doc gives auditors the **pre-analyzed MEV surface** so audit hours focus on creative ordering attacks, not enumeration.

**Today's posture:** All ordering attacks fall into one of three categories:

1. **Bounded griefing** (attacker pays for the right to be annoying, can't extract value) — mostly fine for canary, monitor for mainnet
2. **Latent extraction** (no extraction today because devnet has no real value flow) — needs mitigation for mainnet
3. **Already-mitigated by Triple Shield invariants** (the protocol-level invariants make extraction impossible regardless of ordering) — fine

**Mainnet GA dependency:** Cross-referenced from [`MAINNET_READINESS.md §5.4`](../../MAINNET_READINESS.md). Per-vector mitigation status below; canary smoke can proceed with monitoring + alerting in place.

---

## 1. The Solana ordering model (background)

Unlike Ethereum's public mempool, Solana ordering is determined by:

- **Leader schedule** — block leader is known ahead of time, rotates every 4 slots (~1.6s). Leaders order txs in their own block.
- **Jito searchers + bundles** — bundles of txs land atomically; searchers compete for slots within a block via tips. **This is the closest analog to MEV** in the Solana model.
- **Parallel scheduling** — non-conflicting txs run in parallel; ordering only matters between txs that touch the same accounts.
- **No re-org-based extraction** — finalized is finalized; reorgs are rare and shallow.

**What this means for RoundFi:** ordering attacks happen at the **leader+searcher** layer, not the mempool. Mitigation patterns (commit-reveal, batched ordering, Jito-bundle-friendly design) differ from Ethereum's.

---

## 2. Surface enumeration

### 2.1 `claim_payout` — slot-cycle ordering

**Vector:** A searcher observes a pending `claim_payout(cycle=K)` for slot K's owner. They want to race a `contribute` from a member who is behind to manipulate `pool_usdc_vault.amount` between the seed-draw check and the transfer.

**Source path:**

- `claim_payout.rs:93-95` — cycle / slot validation (`require!(args.cycle == pool.current_cycle, WrongCycle)`)
- `claim_payout.rs:97-118` — Seed Draw invariant at cycle 0 only
- `claim_payout.rs:120-131` — Solvency Guard
- `claim_payout.rs:133+` — transfer

**Attack model:**

| Step | Attacker action                                           | What they want                                                                 |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | Observe slot K owner's pending `claim_payout` for cycle K | —                                                                              |
| 2    | Bundle their own `contribute` ahead of the claim          | Inflate `pool_usdc_vault.amount` so the claim succeeds even if member is short |
| 3    | OR: bundle their own `contribute` after the claim         | Avoid the seed-draw failure path that they would otherwise trigger             |

**Why this is mostly fine today:**

- `member.slot_index == args.cycle` constraint binds the claimer to **their own** slot. A searcher can't claim someone else's payout.
- Seed Draw fires **only at cycle 0**, not later cycles — so race window is one cycle wide per pool.
- Solvency Guard (`spendable >= credit_amount`) is checked **inside** the same atomic instruction — searchers can't drain between check and transfer.
- `member.paid_out` flag prevents replay.

**Residual risk on mainnet:**

- A searcher can **bundle ahead** a `contribute` they would have submitted anyway to **avoid griefing themselves**. This is rational, not extractive.
- A searcher could **delay** their own honest `contribute` to push another member's `claim_payout` into the `WaterfallUnderflow` failure path. **Cost = the delayed contribution's late fee** (loss of on-time attestation weight). Bounded griefing.

**Mitigation status:** 🟡 **Acceptable for canary with monitoring.** No active mitigation needed today — the bounded griefing is economically self-aligned (searcher loses more than the victim). For mainnet, add `claim_payout` event alerting: flag when a `claim_payout` lands in the same block as a non-claimer `contribute` to the same pool. **Long-term mitigation:** Jito-bundle-friendly batching (process all cycle-K contributes atomically before any claim).

### 2.2 `escape_valve_buy` — listing-race

**Vector:** A buyer wants to buy a listed position at a favorable price. A searcher observes the listing PDA + price + buyer's pending tx and races to buy first.

**Source path:**

- `escape_valve_list.rs` — seller creates `Listing` PDA with `(pool, slot, price)`
- `escape_valve_buy.rs` — buyer signs over `price` (must match listing); PDA seeds bind `(pool, slot_index)`
- Post-CPI invariant block (PR #123) — asserts NFT transferred + re-frozen

**Attack model:**

| Step | Attacker action                                            | What they want                                     |
| ---- | ---------------------------------------------------------- | -------------------------------------------------- |
| 1    | Watch the listings PDA derivation for `(pool, slot_index)` | Find listings at favorable prices                  |
| 2    | Front-run a pending buyer's `escape_valve_buy`             | Acquire the slot at the listed price; resell later |
| 3    | Race the seller's price-update tx                          | Buy at stale price                                 |

**Why this is real:**

- Listings are **public state** — anyone can scan `Listing` PDAs and identify mispriced ones
- Price is **fixed** in the listing PDA — buyer signs over the listing PDA, so any buyer can submit a buy at the listed price
- No tx-private routing — buyer's intent is visible the moment they sign

**Residual risk on mainnet:**

- **Sniper bots** for under-priced listings — searcher races every legitimate buyer
- **Sandwich on price updates** — if seller submits a `cancel + relist at new price`, searcher buys at old price between the two

**Mitigation candidates (ranked):**

| #   | Mitigation                                                                                              | Trade-off                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **Commit-reveal listing** — seller commits hash of `(price, salt)`, reveals later; buyer sees only hash | Adds 2-step UX; doesn't help if the listing has been open for hours and the price is on the front-end               |
| 2   | **Time-locked auction** (Dutch / English) — price descends over time, first valid bid wins              | Better price discovery, but adds latency to seller's exit                                                           |
| 3   | **Whitelisted buyer** (private buy path) — listing can specify a buyer wallet                           | Defeats the secondary-market liquidity purpose                                                                      |
| 4   | **Jito-bundle preference** — buyer pays a tip to land in the same bundle as the seller's listing        | Doesn't solve the steady-state problem (existing listings remain exploitable); helps for the cancel/relist sandwich |
| 5   | **Listing fee** — small fee discourages spam listings + sniper-friendly low prices                      | Already partially covered by SOL rent on the PDA; effective for spam but not for sniping mispriced listings         |

**Mitigation status:** 🔵 **Pending — pre-mainnet research item.** Recommend **#1 (commit-reveal)** + **#4 (Jito bundles for cancel/relist)**. Tracked under [#232](https://github.com/alrimarleskovar/RoundFinancial/issues/232).

### 2.3 `settle_default` — crank race

**Vector:** `settle_default` is permissionless (anyone can crank after grace period). Multiple cranks can race; a member can race their own `contribute` against the cranker's `settle_default`.

**Source path:**

- `settle_default.rs:163-170` — grace period check (`clock.unix_timestamp >= pool.next_cycle_at + GRACE_PERIOD_SECS`)
- `settle_default.rs:174-282` — Triple Shield waterfall (solidarity → escrow → stake) capped by D/C invariant

**Attack model:**

| Step | Attacker action                                                           | What they want                                   |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| 1    | Detect member is `defaulted=false` but missed cycle K's contribute        | —                                                |
| 2    | Wait for `clock.unix_timestamp >= pool.next_cycle_at + GRACE_PERIOD_SECS` | Window opens                                     |
| 3    | Bundle `settle_default(K)` ahead of the member's `contribute(K)`          | Force seizure even though member would have paid |
| 4    | Vice versa: member bundles their `contribute(K)` ahead                    | Avoid seizure                                    |

**Why this is mostly fine today:**

- **Triple Shield invariants are deterministic.** Whichever tx lands first, the protocol math is correct: if `contribute` lands first, no default; if `settle_default` lands first, member is defaulted and Triple Shield applies.
- **No extraction.** Cranker pays gas, gets no fee. Pure griefing.
- **D/C invariant caps the seizure.** Even in the worst-case ordering (member pays after seizure), the seizure was bounded — they're not over-seized.
- **Grace period (`GRACE_PERIOD_SECS = 7 days`)** is wide enough that legitimate `contribute` won't race a cranker by accident.

**Residual risk on mainnet:**

- **Reputation grief.** Cranker times their `settle_default` to land **exactly** when a `contribute` is in flight from a Lv2/Lv3 member. The member's `defaulted=true` flag carries reputation consequences (level demotion). Cost-of-griefing: 7 days of waiting + gas. Reward: damage a specific competitor's reputation.

**Mitigation candidates:**

| #   | Mitigation                                                                                                                                                                      | Trade-off                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | **`settle_default` grace extension** — require an additional `contribute_window` (e.g., 1 hour) past `GRACE_PERIOD_SECS` before crank can fire                                  | Reduces race window but extends time-to-resolution            |
| 2   | **Cranker bond + cooldown** — crank costs a small stake, returned if `settle_default` succeeds, forfeited if a `contribute` for the same cycle lands within N slots after       | Discourages opportunistic griefing                            |
| 3   | **Member self-default override** — member can submit a `contribute(K)` with an explicit "rescue from default" flag that requires a slightly higher fee, lands in the same block | Member pays for the privilege of avoiding seizure when racing |

**Mitigation status:** 🟡 **Acceptable for canary; pre-mainnet research item.** Recommend monitoring + **#2 (cranker bond)** for mainnet.

### 2.4 `harvest_yield` + `deposit_idle_to_yield` — Kamino sandwich

**Vector:** When the harvest path lands (today: stubbed, see [`#233`](https://github.com/alrimarleskovar/RoundFinancial/issues/233)), `harvest_yield` will read realized yield from Kamino. Adversaries can sandwich Kamino's price/rate updates around the harvest.

**Source path (future):**

- `roundfi-yield-kamino/src/lib.rs` — harvest CPI (today: stub returning realized=0)
- `harvest_yield.rs` — slippage guard (`min_realized_usdc` from PR #124) caps the lower bound

**Attack model:**

| Step | Attacker action                                                                                  | What they want              |
| ---- | ------------------------------------------------------------------------------------------------ | --------------------------- |
| 1    | Detect pending `harvest_yield` via tx-prep stage                                                 | —                           |
| 2    | Bundle a Kamino-side action that reduces realized yield (front-run withdrawal at favorable rate) | Lower the harvest reading   |
| 3    | After harvest, restore the position                                                              | Net: extract the difference |

**Why this is mostly fine today:**

- **Harvest is stubbed.** No real Kamino CPI = no extractable surface yet.
- **Slippage guard (`min_realized_usdc`).** Caller provides minimum expected yield; harvest reverts if below. This is the **direct** mitigation against under-reporting adapters (PR #124).

**Residual risk on mainnet:**

- **Kamino reserve manipulation.** Searchers with Kamino positions can influence reserve composition around RoundFi's harvest window. Slippage guard limits the damage to `realized - min_realized`, which is small per-harvest but compounds over time.

**Mitigation candidates:**

| #   | Mitigation                                                                                                | Trade-off                                                                              |
| --- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | **Slippage guard** (✅ shipped, PR #124)                                                                  | Already in place                                                                       |
| 2   | **TWAP-style harvest window** — `harvest_yield` only succeeds if Kamino rate has been stable for N blocks | Adds harvest latency; rejects valid harvests under volatile market conditions          |
| 3   | **Permissioned harvest cranker** — only an allowlisted bundler can call `harvest_yield`                   | Defeats the "permissionless crank" model; introduces a trusted operator                |
| 4   | **Jito bundle for harvest** — bundle Kamino position read + harvest atomically                            | Reduces searcher window; doesn't help if Kamino itself is sandwiched in the same block |

**Mitigation status:** 🔵 **Pending — lands with harvest path** ([#233](https://github.com/alrimarleskovar/RoundFinancial/issues/233)). Recommend **#1 + #4** combined.

### 2.5 `join_pool` — slot allocation race

**Vector:** A pool with K open slots; N>K wallets racing to join. Searchers preference for low-index slots (`slot_index=0`) which gets paid out first.

**Source path:**

- `join_pool.rs` — slot bitmap allocation (member gets next available slot via deterministic seek)

**Attack model:**

| Step | Attacker action                        | What they want               |
| ---- | -------------------------------------- | ---------------------------- |
| 1    | Watch a pool entering `Forming` status | —                            |
| 2    | Bundle their `join_pool` with high tip | Get slot 0 (paid in cycle 0) |

**Why this is mostly fine today:**

- **Slot is paid out independently of "first to join."** All slots get paid eventually (cycles 0 through N-1).
- **Slot 0 isn't more valuable** in steady state — it gets credit sooner but contributes for fewer cycles. Cycle 0 is also Seed-Draw-protected (Shield 1) which gates the early payout.
- **Devnet test pools** are seeded by the protocol authority, not open enrollment, so this surface isn't live today.

**Residual risk on mainnet:**

- **Cycle 0 advantage.** Statistically, slot-0 holders get their credit sooner = earlier capital deployment = more time for outside investment. Real expected-value gap is small (~1 month).
- **Bot-driven join sniping.** If pools fill in seconds, retail users may never get in. UX problem, not security.

**Mitigation candidates:**

| #   | Mitigation                                                                                       | Trade-off                                                                                     |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 1   | **Random slot assignment** — slot is randomly assigned at `start_pool` rather than in join order | Already partially the case via cycle 0 lottery in some pool variants; needs spec confirmation |
| 2   | **Whitelist-first cooldown window** — pool admin can pre-register members, then open public      | Introduces gatekeeping; only for trusted operators                                            |
| 3   | **Time-locked join** — pool enters `Forming` 24h before `Open`, members commit during forming    | Better UX (no sniping) but slower pool lifecycle                                              |

**Mitigation status:** 🟡 **Acceptable today (admin-seeded pools).** Becomes relevant when Community Pool variant ships post-mainnet.

---

## 3. Summary — MEV surface vs mitigation

| Instruction             | Vector class                | Extractable today? | Mainnet mitigation                                             |
| ----------------------- | --------------------------- | :----------------: | -------------------------------------------------------------- |
| `claim_payout`          | Bounded griefing (rational) |         ❌         | Monitoring + alerting; Jito bundle batching long-term          |
| `escape_valve_buy`      | Sniper / listing-race       |  ⚠️ Yes — bounded  | Commit-reveal listings + Jito bundles for cancel/relist (#232) |
| `settle_default`        | Reputation grief            |         ❌         | Cranker bond + cooldown (post-canary)                          |
| `harvest_yield`         | Kamino sandwich             |     ❌ (stub)      | Slippage guard ✅ + Jito-bundled harvest read (with #233)      |
| `deposit_idle_to_yield` | Kamino sandwich             |     ❌ (stub)      | Same as harvest                                                |
| `join_pool`             | Slot-0 race                 | ❌ (admin-seeded)  | Random slot assignment (Community Pool variant)                |

**Big picture:** the Triple Shield design **already constrains** the extraction surface to bounded griefing on most instructions. The exception is `escape_valve_buy` listing-race, which is the **single non-bounded extraction vector** in the protocol and the priority mitigation work for mainnet.

---

## 4. Recommended audit focus (for the firm)

Auditor hours on the MEV surface should target:

1. **`escape_valve_buy` listing-race + Jito-bundle interaction** — the only real extraction vector
2. **`settle_default` race conditions** — specifically the cracker race vs member's contribute, and whether the Triple Shield invariants hold under adversarial ordering of contribute + settle in the same block
3. **`harvest_yield` post-#233** — when the real Kamino CPI lands, re-review slippage assumptions against Kamino reserve manipulation
4. **Cross-instruction atomic bundles** — can a searcher bundle `escape_valve_list + escape_valve_buy + settle_default` to do something the per-instruction analysis missed?

Out of scope for MEV review (already covered elsewhere):

- Per-instruction signer / seeds / mint constraints — `self-audit.md §10` + `tests/security_inputs.spec.ts`
- D/C invariant correctness — `self-audit.md §3.1` Shield 3 + `tests/economic_parity.spec.ts`
- Adversarial economic scenarios (Sybil, farming) — `adversarial-threat-model.md`

---

## 5. Methodology gaps (honest framing)

- **No bundle-simulation harness.** We don't run a Jito-bundle-style test that pre-orders a sequence of txs and checks invariants under every permutation. `tests/security_economic.spec.ts` tests per-tx; bundle ordering is not exercised.
- **No leader-rotation simulation.** Solana's 4-slot leader rotation isn't modeled. Searchers timing tx submission to favorable leaders is not tested.
- **No Jito searcher economics model.** What tip can a searcher afford on an `escape_valve_buy` race? We assume "small fraction of listing value" without a model.
- **No formal commit-reveal proof.** If commit-reveal is the chosen mitigation, the binding + hiding properties need formal verification.

These are the post-audit research items. The on-chain audit firm should not be expected to fill them.

---

## 6. Out of scope for this doc

- **Front-end signing UX** — covered by [`frontend-security-checklist.md`](./frontend-security-checklist.md)
- **Indexer reorg + replay** — covered by [`indexer-threat-model.md`](./indexer-threat-model.md)
- **Sybil + reputation farming + Community Pool griefing** — covered by [`adversarial-threat-model.md`](./adversarial-threat-model.md)
- **Direct economic invariants (Triple Shield)** — covered by [`self-audit.md §3`](./self-audit.md#3-invariants--enforcement)

---

_Last updated: May 2026. Cross-ref: [Issue #232](https://github.com/alrimarleskovar/roundfinancial/issues/232), [`MAINNET_READINESS.md §5.4`](../../MAINNET_READINESS.md), [`adversarial-threat-model.md §6`](./adversarial-threat-model.md#6-mev--front-running), [`self-audit.md §7`](./self-audit.md#7-out-of-scope-future-work)._
