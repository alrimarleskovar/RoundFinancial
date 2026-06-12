# Adversarial economics model

> **What this is.** The expanded treatment of Master Spec § 9 — for each attack class, the **vector** (how it works), the **economics** (what the attacker pays, what they get), the **current defense** (what the protocol does today to mitigate it), and the **residual gap** (what's still open). The simulator (Pass 7, planned ~2 weeks) will quantify the cost/benefit numbers that this document currently states qualitatively.
>
> **Source.** Partner review (2026-06-12) Pass-8 framing: _"This is provavelmente the most important pass of the whole project."_ We agree — the simulator answers "does this work for honest users"; this document answers "can dishonest users break it." Both go in Canary Report #1.
>
> **Threat actor.** Throughout, the attacker is a **motivated economic agent** — they will spend money to gain reputation if the expected return is positive. They are not a cryptographic attacker (we trust SHA-256, ed25519, Solana's BFT). They may control N wallets, K identities, and unlimited time, but every action costs real SOL + USDC and every wallet's behavior is on-chain and queryable.

## 1. Score farming (single-attacker, parallel-pool inflation)

### Vector

Spin up N independent 1-member (or 2-member confederate) pools. Pay one installment in each. Each contribution emits a `SCHEMA_PAYMENT` (id 1) attestation worth `+10` score. There is no global per-subject rate limit on `SCHEMA_PAYMENT`. With N pools running in parallel, the attacker accumulates `10 × N` score per cycle.

### Economics (attacker's POV)

- **Cost per pool:** stake (50% of credit for L1) + 1 installment + tx fees. At a $4 credit / $3 installment carta (the canary geometry), that's $5 stake + $3 installment ≈ $8 per pool per cycle.
- **Reward per pool:** +10 score.
- **Score-to-tier mapping (Master Spec § 5.1):** L3 requires score ≥ 2000 ⇒ 200 paid installments ⇒ 200 pools × $8 = $1,600 sunk capital.
- **Pre-defense return.** L3 unlocks 10% stake (vs L1's 50%) — on a $30 credit, $3 stake vs $15. Per future pool, the attacker frees $12 of working capital. At 200 fake pools / $1,600 sunk, payback in **133 future pools** … assuming the score actually translated to L3.

### Current defense — `cycles_completed` cycles floor (SEV-047)

The score alone **does not promote.** `promote_level` requires both `score ≥ threshold` AND `cycles_completed ≥ floor` (`programs/roundfi-reputation/src/state/profile.rs::resolve_level`). `cycles_completed` only rises on `SCHEMA_POOL_COMPLETE` (id 4), which fires once per pool the member paid through to its end. The schema carries `MIN_POOL_COMPLETE_COOLDOWN_SECS = 30 days` (`constants.rs:76`) per subject — a wall-clock floor that no amount of capital can compress.

**L3 requires 3 completed pools + 30-day cooldown ≥ 90 days** of honest history. **L4 requires 8 completed pools ≥ 240 days.** A parallel-pool score farm therefore caps at **L1** until calendar time has passed, at which point the farmer has accumulated 90+ days of real on-time obligations across multiple pools — a behavior pattern indistinguishable from a real honest user. **The attack collapses into the legitimate use case.**

### Residual gap

The L4-provisional gate is score + cycles (Master Spec § 7). The proposal's metric-based Elite gate (Reliability ≥ 94, Punctuality ≥ 88, Commitment ≥ 90) lives off-chain in the indexer and is not yet enforced on-chain at promotion time. Until it is, an attacker with infinite calendar time and infinite capital could reach L4 by buying time, even if their off-chain metric scores would not justify Elite. The follow-up is on the roadmap (v1.5 oracle, Master Spec § 7).

## 2. Sybil (multi-wallet, one operator)

### Vector

One person controls N wallets. They distribute themselves across many pools as if they were N independent users. Each wallet builds an independent reputation; the operator harvests the lower stake tier across all of them.

### Economics

The unit attacker's cost equals N × the single-wallet honest-user cost. There is **no economy of scale** from running N wallets vs N honest users — each wallet pays its own stake, each wallet completes its own cycles to promote, each wallet eats its own 30-day cooldowns.

### Current defense

**Reputation is per-wallet, non-transferable, non-aggregatable.** A wallet's score is in its own `ReputationProfile` PDA (`[b"reputation", wallet]`). There is no on-chain mechanism — and no off-chain authoritative read path — that combines N wallets into a single bigger reputation. An operator with 100 L2 wallets does **not** have an L4 wallet; they have 100 wallets at L2 each, each carrying L2's economics independently.

**Identity hard floor for L4 (PR #478).** An L4 wallet must have a verified identity (`identity_verified == true`). One human can presumably only verify one identity. A sybil operator with 100 wallets still cannot have 100 L4s — they get **one** L4 (the one they choose to attach their identity to) and 99 L1s/L2s/L3s. The economic ceiling for sybil is therefore L3-stake × N wallets, which is a linear scale of an honest user's economics, not an exponential.

### Residual gap (the quantification work)

The simulator (Pass 7) will produce a cost-benefit table for the attacker:

> "An operator with K wallets, R months of activity, reaches average reputation level X, and saves $Y in cumulative stake costs vs the L1 baseline."

Until the simulator runs, we state the qualitative result (sybil ≈ linear) but cannot quote the exponent. **Empirical falsification is the work of the simulator + canary.**

## 3. Cartel (closed-group reputation farming)

### Vector

10 (or 100) people form a closed group, ROSCA among themselves for 12 months, all pay on time, all reach L3 together. The reputation they emit is real (they really did pay, the on-chain record is honest); the question is whether their **trajectory** should count as much as the same trajectory for unrelated users.

### Economics

The cartel pays full honest cost. There is no subsidy, no exploit, no inflation. The objection is **not** that the reputation is fake — it's that the **risk-prediction power** of the cartel's reputation toward external lenders may be lower than its number suggests (a closed group can credibly enforce repayment via social pressure that doesn't generalise outside the group).

### Current defense

RoundFi does not differentiate cartel reputation from honest-stranger reputation. The protocol's posture is:

> "We measure what people actually did, not what we wish they had done. If 10 people paid each other for 12 months, that's 10 people who paid for 12 months. The question of _generalisation_ to external lending is the external lender's question — they integrate the score knowing the score is behavioral, not predictive of social context."

### Residual gap

Whether closed-group reputation should be discounted is a **product question, not a security one**. The case for not discounting: it overfits to a category we can't reliably detect (we'd be guessing who's friends with whom from on-chain co-occurrence patterns, with false-positive cost = punishing genuine community groups). The case for discounting: lenders may price-protect themselves by integrating co-occurrence as an off-chain feature alongside the RoundFi score.

**Decision deferred to canary data.** If the canary shows that cartel-shaped wallets default at the same rate as non-cartel-shaped wallets when later integrated into bigger pools, no discount is needed. If they default at materially higher rates, a co-occurrence dampener becomes an off-chain feature of the score endpoint (not the on-chain protocol).

## 4. Elite farming

### Vector

Reach L4 cheaply, then exploit the 3% stake to lever up an arbitrarily large credit position with minimal capital at risk, then default and exit with the credit.

### Economics

At L4: stake = 3% of credit. A $100 credit costs $3 stake. An attacker pays $3, draws $100, defaults — net $97 profit.

### Current defense

**Three independent walls:**

1. **8 completed pools cycles floor.** L4 requires ≥ 8 `POOL_COMPLETE` attestations with 30-day cooldowns. **Minimum calendar time to L4 ≈ 240 days.** The attacker pre-pays 8 full pool cycles of honest behavior before they're allowed near the 3% stake.
2. **Identity hard floor (PR #478).** L4 requires `identity_verified`. The attacker burns their identity on the attack; future L4 attempts from the same human are blocked.
3. **Default at L4 reveals the attack.** The on-chain `SCHEMA_DEFAULT` (id 3) fires with `-500` score and `defaulted = true` is sticky — the attacker's L4 wallet is permanently scorched. The 8 honest pools they ran becomes 8 _lost_ pools (their stake is seized).

**The economics for the attacker** with these defenses: pre-pay 8 × ($30 credit × 50% L1 stake → 25% L2 → 10% L3 → 3% L4 over time) ≈ $50+ in sunk stake + 8 months of honest behavior + burn one verified identity. Then one $100 credit defaulted recovers $97 net — but the rolling balance across the 8 honest pools is `-$50 sunk stake + $97 stolen − Triple-Shield seizures`. The Triple Shield typically seizes the full stake + a portion of escrow, so the net is closer to break-even than to profit.

### Residual gap

At canary scale, run the actual numbers in the simulator. Specifically: with the v1 score schedule (`+10 / +50 / -100 / -500`) and the cycles floors, what is the cheapest L4-default sequence and what does it net? If the answer is meaningfully positive, the L4 stake bps should rise from 3% toward 5–10%. The v5.2 design picked 3% under the assumption that the cycles floor makes the attack unprofitable; the simulator verifies that assumption.

## 5. Escape Valve abuse (seller dump, buyer trap)

### Vector

A member who is about to default — they know they can't make the next installment — lists their slot on the secondary market (`escape_valve_list` or its commit-reveal variant). A naïve buyer who only looks at the listing price (and not at the slot's pending obligations) pays for the slot and inherits the impending default.

### Current defense

**`escape_valve_buy` atomically transfers position-state including the escrow obligations.** `programs/roundfi-core/src/instructions/escape_valve_buy.rs` lines 241-256 snapshot the seller's `contributions_paid`, `escrow_balance`, `on_time_count`, `late_count`, `slot_index`, `paid_out` into the buyer's new `Member` PDA. The buyer is now on the hook for the same pending installments the seller was; the buyer's **escrow_balance** is what they staked + what the seller already had locked. The seller cannot dump risk-free; the buyer cannot accidentally inherit a free position.

**Commit-reveal anti-MEV (#232).** The buyer who already knows the price + salt off-chain lands at `buyable_after` ahead of any searcher reacting to the now-public reveal. This protects the _legitimate_ buyer (who has done due diligence on the slot's state) from a _MEV searcher_ who would otherwise blindly snipe.

### Residual gap

The buyer's UX (front-end / SDK) must **clearly surface the inherited obligations** before the buy tx is signed. Specifically: "this slot has K pending installments worth $X total, with the next one due at T." This is an SDK / UX deliverable, not a protocol one — and it's where the partner-readiness doc (Pass 11) lands.

There is **no on-chain check** that the buyer has the USDC for the future installments; the protocol only checks they have the **listing price** at buy time. A buyer who can pay the price but not the future installments will themselves end up defaulting and being seized. The current posture: this is the buyer's risk, surfaced by UX, not the protocol's risk to prevent.

## 6. Goodhart's law (the metric vs the behavior)

### Vector

_"When a measure becomes a target, it ceases to be a good measure."_ The promotion gate is the metric; the attacker optimizes for the metric without the behavior it proxies (keeping financial obligations).

### Current defense

RoundFi's deliberate design choice: **promotion is gated on consequential on-chain events with real economic stake**, not on a soft signal. Specifically:

- `SCHEMA_POOL_COMPLETE` (the cycles-floor input) only fires when a member _actually completes a pool_, including any post-payout installments. Faking this requires running a real pool with real installments.
- `SCHEMA_PAYMENT` fires only on `contribute` which moves real USDC into `pool_usdc_vault`. Faking it requires real USDC and real signing.
- `SCHEMA_DEFAULT` fires on `settle_default` which _seizes funds_. Faking absence of default requires not actually defaulting.

The metric **is** the behavior — they are not separable in the way Goodhart's law usually criticizes. The score is a function of _consequential_ events; you can't game the score without also paying the consequential cost.

### Residual gap (the v1.5 oracle)

When the metric-based Elite gate (Reliability ≥ 94, Punctuality ≥ 88, Commitment ≥ 90) lands on-chain (Master Spec § 7), Goodhart applies more directly to those soft metrics. The off-chain scorer derives Reliability from a weighted history window — an attacker who optimizes for "the latest 30 events look good" could decouple their _recent_ reliability from their _lifetime_ reliability.

**Mitigation we plan to design with Goodhart awareness.** The weight schedule will:

- Not exponentially-decay the way pre-Pass-3 reputation did, so old bad events don't fade.
- Penalize the variance of the window, not just the mean — a wallet that alternates "honest year, default month" should not score the same as a wallet with steady on-time behavior.
- Be public + auditable so partners can verify the formula.

Tracked. Until v1.5 ships, Reliability and Punctuality are surfaced through the API but the _promotion_ gate uses score + cycles (the consequential events), which is Goodhart-resistant by construction.

---

## 7. Open questions for the simulator

The simulator (Pass 7) should produce numerical answers to:

1. **Sybil exponent.** For an operator with K wallets, what's the cumulative reputational value they extract vs K honest users? Goal: prove the exponent is ≤ 1 (sub-linear or linear, not super-linear).
2. **Elite farming break-even.** What's the minimum cost (in real defaults + lost stakes) to reach L4 via gaming? Goal: prove it's higher than the value of one L4-stake default.
3. **L4 saturation.** At steady state, what fraction of the wallet population reaches L4? Target: < 5%. If it's > 20%, L4 is too easy to reach and the protocol's tier signal has been diluted.
4. **Time-to-default distribution by cohort.** Do attackers default earlier (cohort statistically distinguishable)? If yes, the off-chain scorer can apply an early-default surcharge.

The output of the simulator + this document = Canary Report #1's adversarial section.

## 8. What this document is NOT

This document does **not** claim the protocol is unbreakable. It claims that we have identified the attack classes, applied a layered defense for each, and committed to quantifying the residuals before mainnet retail pools open. The simulator and the canary together provide the empirical proof — this document provides the framework that the simulator + canary fill in.
