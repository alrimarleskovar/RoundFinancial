---
title: "Behavioral Reputation Score"
subtitle: "How RoundFi turns pool behavior into a portable, on-chain credit signal"
author: "RoundFi"
date: "2026-06-23"
lang: "en"
...

> **Derived document.** This is a derivation of [`docs/spec/MASTER-SPEC.md`](../MASTER-SPEC.md)
> (§5 Reputation engine, §6 Reputation metrics, §9 Adversarial model). The Master
> Spec is the single source of truth; if a number here disagrees with it, the
> Master Spec wins. Every constant is pinned to the deployed Jun 2026 source
> (`programs/roundfi-reputation/`, `services/indexer/`).

## 1. The thesis

RoundFi's product is **not** the savings pool — it is the **reputation** the pool
produces. A rotating savings group (ROSCA) generates a stream of verifiable,
financially-consequential events: paid on time, paid late, completed the round,
defaulted. The reputation engine turns that stream into a **score**, a **tier**
(L1–L4), and four **behavioral metrics**, and feeds the tier back into the
protocol so that proven behavior lowers your cost of capital in the next pool.

The whole design rests on one separation: **receiving capital is not merit;
keeping your obligations after receiving it is.** Everything below enforces that
distinction on-chain.

## 2. The four-tier ladder

A member's tier sets the **stake** they must lock at join, as a fraction of the
credit (`carta`) they can draw. The ladder is the user-facing reward — climb it
and you free up capital.

| Tier | Name      | Stake (bps of credit) | Score threshold | Min completed pools | Identity            |
| ---- | --------- | --------------------: | --------------: | ------------------: | ------------------- |
| L1   | Iniciante |            5000 (50%) |               0 |                   0 | —                   |
| L2   | —         |            2500 (25%) |             500 |                   2 | gate-configurable   |
| L3   | Veteran   |            1000 (10%) |            2000 |                   3 | gate-configurable   |
| L4   | Elite     |              300 (3%) |            5000 |                   8 | **always required** |

Source: `roundfi-reputation/src/constants.rs` (`STAKE_BPS_LEVEL_*`,
`LEVEL_*_THRESHOLD`, `LEVEL_*_MIN_CYCLES`).

An L4 Elite member risks **3%** of the credit where an L1 risks **50%** — a ~94%
reduction in locked capital. That discount is the economic prize, which is
exactly why the upper tiers are the ones worth gaming. The anti-farming walls in
§4 are what make the discount safe to offer.

## 3. Score generation

The score is a single integer accumulated from attestations (see §5). The v1
schedule:

| Event                  | Score Δ |
| ---------------------- | ------: |
| On-time payment        |     +10 |
| Completed pool         |     +50 |
| Late payment           |    −100 |
| Default                |    −500 |

A late payment costs ten on-time payments; a default wipes most of a pool's
worth of progress. The asymmetry is deliberate — the score is meant to be **slow
to earn and fast to lose**, because that is how trust actually works.

For **unverified** wallets the positive increments are halved (sybil-dampening);
negative deltas are never dampened. A default zeroes the score outright and
re-derives the tier immediately (a defaulter cannot re-enter the next pool at the
cheaper L2/L3 stake — SEV-007).

## 4. Promotion is doubly-gated

`promote_level` (permissionless) advances a wallet to the **highest tier whose
score AND completed-pools thresholds are both met** (`resolve_level`), then
applies the identity cap (`cap_level_for_identity`). Two **independent**
anti-farming walls must both fall:

### 4.1 The score wall

Score alone is **farmable**: an operator can spin up parallel one-member pools
and harvest `+10`/`+50` in parallel. So score is necessary but never sufficient.

### 4.2 The completed-pools wall (the wall-clock defense)

`cycles_completed` only rises on a **`POOL_COMPLETE`** attestation — which fires
once per pool the member **paid through to the end** — and each one carries a
**30-day per-subject cooldown** (`MIN_POOL_COMPLETE_COOLDOWN_SECS`). This is the
unbypassable defense: it cannot be parallelized, because the same wallet's pools
are serialized by a 30-day wall clock.

The floors:

- **L2 needs 2 completed pools** (raised from 1 in **ECO-V52**, so the 4× stake
  discount is never reachable on a single self-dealt pool).
- **L3 needs 3.**
- **L4 needs 8** — roughly a multi-year honest history.

A score farm can buy points; it cannot buy time.

### 4.3 The identity hard floor

**L4 Elite always requires `identity_verified`**, independent of the configurable
identity gate (`IDENTITY_HARD_FLOOR_LEVEL`, `cap_level_for_identity`). L2/L3 are
governed by `IdentityGateConfig.required_min_level` (devnet `0` = open, mainnet
`3` = verified-only). An unverified wallet is capped at **L3** even with the gate
turned off — Elite is gated on proof-of-personhood by construction.

## 5. Attestation schemas (Pass-3 taxonomy)

Every consequential event emits an immutable on-chain attestation keyed by
**subject = wallet**. The Pass-3 taxonomy (Jun 2026) is built around the
"received vs kept" separation:

|  id | schema           | emitter                          | score Δ | `cycles_completed` | polarity      |
| --: | ---------------- | -------------------------------- | ------: | ------------------ | ------------- |
|   1 | `PAYMENT`        | `contribute` (on-time)           |     +10 | —                  | positive      |
|   2 | `LATE`           | `contribute` (late)              |    −100 | —                  | negative      |
|   3 | `DEFAULT`        | `settle_default`                 |    −500 | —                  | negative      |
|   4 | `POOL_COMPLETE`  | `contribute` (final installment) |     +50 | **+1**             | positive      |
|   5 | `LEVEL_UP`       | `promote_level`                  |       0 | —                  | informational |
|   6 | `PAYOUT_CLAIMED` | `claim_payout`                   |   **0** | —                  | **neutral**   |

**The critical correction (Pass-3):** `PAYOUT_CLAIMED` — the event of *receiving*
your carta — is **score-neutral and does not advance `cycles_completed`.** The
`+50` and the cycle bump live on `POOL_COMPLETE`, which only fires on a member's
**last** contribution of the pool — i.e. only after they have proven the
pay-*after*-receiving discipline that is RoundFi's entire thesis. Verified live
on devnet 2026-06-12 (pool `Ga2RwgSk…`): schemas 1, 6, and 4 emitted distinctly,
`payout_claimed` landing in the neutral bucket.

## 6. The four behavioral metrics

The off-chain scorer (`services/indexer/src/reputationMetrics.ts`) projects the
attestation history into four 0–100 metrics. Two are live; two ship as `null`
until the canary calibrates them.

### 6.1 Reliability — *live*

A weighted average over the most recent `RELIABILITY_WINDOW` reliability-bearing
events. `payout_claimed`, `pool_complete`, and `unspecified` carry **no**
reliability weight. A fresh wallet defaults to `reliability = 0` (no evidence —
not a penalty).

### 6.2 Punctuality — *live*

Derived from the average timing (paid-time minus due-time) over the recent
payment window, mapped piecewise:

| Avg timing       | Punctuality |
| ---------------- | ----------: |
| ≤ 3 days early   |         100 |
| early → on time  |    80 → 100 |
| on time          |          80 |
| up to 1 day late |     80 → 60 |
| 1–7 days late    |     60 → 30 |
| 7–30 days late   |      30 → 0  |
| > 30 days late   |           0 |

A **friction grace** treats any payment under 1h late as on-time (clock jitter,
gas timing). Fresh-wallet neutral default is 80.

### 6.3 Commitment & Recovery — *pending*

- **Commitment** — depth of obligation kept (completed pools, post-payout
  discipline). Fed by `pool_complete`.
- **Recovery** — did a defaulter come back and rebuild? The single most important
  metric for the "second chance" thesis.

Both surface as `null` in the score API until the canary produces enough real
default→recovery sequences to calibrate the weights. Shipping `null` rather than
a fabricated number is deliberate: we do not publish a metric we cannot yet
defend.

## 7. Why this resists farming

| Attack            | Why it fails                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Score farming** | The completed-pools floor + 30-day cooldown can't be parallelized; score alone never promotes.                          |
| **Sybil**         | Each wallet must independently accrue completed pools over wall-clock time; reputation is per-wallet, non-transferable.  |
| **Elite farming** | 8 completed pools (~years of honest history) **plus** the identity hard floor make Elite the most-defended tier.        |
| **Goodhart**      | Promotion is gated on *consequential* on-chain events (real USDC at stake), not a soft signal — gaming it requires actually keeping obligations. |

The portable output — a wallet's `{ tier, reliability, punctuality }` — is what an
external lender (Kamino, MarginFi, a fintech) can consume to price credit for a
borrower who would otherwise be invisible. That is the endgame the ladder exists
to serve.

---

_Cross-references: protocol mechanics → [`02-technical-whitepaper`](./02-technical-whitepaper.md);
program topology → [`03-architecture-spec`](./03-architecture-spec.md); solvency
math → [`05-stress-lab-economic-model`](./05-stress-lab-economic-model.md). Full
adversarial economics live in MASTER-SPEC §9._
