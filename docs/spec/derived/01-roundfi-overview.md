---
title: "RoundFi — Overview"
subtitle: "Turning the savings circles people already trust into portable, on-chain credit"
author: "RoundFi"
date: "2026-06-23"
lang: "en"
...

> **Derived document.** This is a derivation of [`docs/spec/MASTER-SPEC.md`](../MASTER-SPEC.md)
> (§1 One sentence, §2 Problem, §3 Solution, §11 Deployed state). The Master Spec
> is the single source of truth; if a number here disagrees with it, the Master
> Spec wins. Every claim of deployment is pinned to the validated devnet run of
> 2026-06-12 (`docs/operations/v52-devnet-runbook.md`).

## 1. The thesis, in one sentence

> **RoundFi is infrastructure that turns verifiable financial behavior into
> portable, on-chain reputation.**

Underneath the product is a **rotating savings-and-credit association** — the same
instrument known as a _consórcio_ or _junta_ in Brazil, a _tanda_ in Mexico, a
_susu_ in West Africa, a _chama_ in Kenya — implemented on Solana. But the ROSCA
is not the product. It is the **data engine**. Every cycle of a pool produces a
stream of verifiable, financially-consequential events: a member paid on time,
paid late, completed the round, or defaulted. The **reputation** built from that
stream is the product — a portable credit signal a wallet carries from pool to
pool and, eventually, from protocol to protocol.

The distinction matters because it inverts the usual pitch. RoundFi is **not** "a
savings app with a score bolted on." The savings mechanism exists to **generate
behavior worth scoring**; the score exists to make future credit cheaper for
people who have proven they pay. That is the entire business.

## 2. The problem: most of the world is credit-invisible

Thin-file and no-file individuals — the majority of adults across Brazil, Latin
America, Africa, and Southeast Asia — have **no portable record** of whether they
keep financial commitments. The crucial point, and the one most lending products
get wrong, is this: **they are not high-risk; they are unmeasured.** It is the
*absence of a track record*, not the presence of bad behavior, that excludes them
from affordable credit.

These same populations are not financially passive. They already run informal
credit instruments at scale — ROSCAs, _consórcios_, _tandas_, _susus_, _chamas_ —
and those instruments generate **exactly the behavior a lender would want to
see**: recurring contributions, social enforcement of repayment, and completion
of multi-month obligations.

The problem is that the behavior **evaporates**. It lives in a WhatsApp group or
a paper notebook. It does not survive the group dissolving. And it cannot be
presented to anyone outside the group — not to a bank, not to a lender, not to a
future pool of strangers. A person can complete a dozen honest savings circles
and arrive at a credit application with **nothing to show for it**.

The gap RoundFi closes is precise: take an instrument people **already trust and
use**, run it on rails that make every event **verifiable and durable**, and emit
a **portable reputation** from it.

## 3. The solution: three layers

RoundFi is built as three layers, each feeding the next.

### 3.1 Layer one — the pool (a ROSCA on-chain)

A fixed set of members each contribute a recurring installment. Each cycle, one
member receives the pooled **carta** (the credit draw). The pool is not a trust
exercise: it is protected by a layered defense the spec calls the **Triple
Shield** — a member **stake** locked at join, an **escrow** slice taken from each
contribution, and a **solidarity reserve** ("Cofre Solidário") that covers the
first tranche of any default. Every contribution, every payout, and every default
is a Solana transaction.

Crucially, the pool is **self-funding**. A viability guard checks that the float
retained from contributions is always enough to pay the drawn member every cycle,
with no external subsidy — RoundFi refuses to create a pool whose math does not
close. (The mechanics live in [`02-technical-whitepaper`](./02-technical-whitepaper.md)
and the solvency math in [`05-stress-lab-economic-model`](./05-stress-lab-economic-model.md).)

### 3.2 Layer two — the attestation layer

Each consequential event emits a signed, **immutable on-chain attestation**: a
behavioral record that says *paid*, *late*, *pool-completed*, *defaulted*, or
*payout-claimed*. Attestations are keyed by **subject = wallet**. This is the
verifiable substrate — the part that does **not** evaporate. Where a notebook
forgets and a WhatsApp group dissolves, an attestation is a permanent,
auditable fact.

### 3.3 Layer three — the reputation engine

An off-chain scorer and an on-chain level ladder consume the attestation stream
and produce three things: a **score**, a **tier** (L1–L4), and four **behavioral
metrics** (Reliability, Punctuality, Commitment, Recovery). The tier feeds back
into the protocol — a higher tier means a **lower required stake** — and the
reputation is exposed to external consumers (a lender, a fintech) via an API.
The full engine is documented in
[`04-behavioral-reputation-score`](./04-behavioral-reputation-score.md).

### 3.4 The design principle that holds it together

One separation runs through the entire protocol: **receiving capital is not
merit; keeping your obligations after receiving it is.** This is enforced
on-chain, not by convention. *Claiming* your carta is deliberately
**score-neutral** — the credit for completing a pool only lands once a member has
paid through to the **end**, after they already received their draw. You cannot
take the money and farm a reputation; the reputation is earned by paying it
*back*.

## 4. The feedback loop

The loop is the whole point, and it is short enough to state in one line:

> **Good behavior in the pool lowers your cost of capital in the next pool — and
> the resulting reputation is yours to carry.**

A member who climbs the ladder from L1 to L4 (Elite) goes from locking **50%** of
the credit as stake down to just **3%** — roughly a 94% reduction in the capital
they must put up. That discount is a direct, legible reward for a proven track
record, and the protocol's risk does **not** rise as the stake falls, because the
upper tiers are gated on a long history of completed pools that is itself the risk
signal.

The endgame extends past RoundFi's own pools. A wallet's portable output —
`{ tier, reliability, punctuality }` — is exactly what an external lender (Kamino,
MarginFi, a fintech) can consume to **price credit for a borrower who would
otherwise be invisible.** The savings circle becomes the on-ramp to the formal
credit system.

## 5. It's live: proof, not a deck

This is the part a deck cannot fake. RoundFi is **not** a roadmap of intentions —
the protocol is deployed and was exercised **end-to-end on devnet with real
USDC** on 2026-06-12. **Seven of the eight** protocol capability areas were run
through to completion; the eighth (default settlement) is armed and time-gated,
waiting only on its grace window to elapse.

| #   | Capability                                        | Status                |
| --: | ------------------------------------------------- | --------------------- |
| 1   | Full pool lifecycle + Pass-3 reputation scoring   | ✅                    |
| 2   | `close_pool` (terminal Closed state)              | ✅                    |
| 3   | Yield Cascade (init → deposit → harvest)          | ✅                    |
| 4   | Escape Valve — direct (list → buy)                | ✅                    |
| 5   | Pause circuit-breaker (pause → gate → unpause)    | ✅                    |
| 6   | Escrow vesting (on-time stake release)            | ✅                    |
| 7   | Escape Valve — commit-reveal (anti-MEV)           | ✅                    |
| 8   | Rent-reclaim ceremony (full teardown)             | ✅                    |
| 9   | Default settlement                                | 🔫 armed; grace-gated |

The rent-reclaim ceremony (#8) is the **true** end of a pool's life — not just
flipping status to `Closed`, but reclaiming every lamport of rent back to members
and the authority. On the validated run, the authority's SOL balance went **up**
(+0.0108 net of fees): the protocol cleans up after itself.

The reputation separation that is RoundFi's thesis was verified on-chain in the
same run (pool `Ga2RwgSk…`): the *payment*, *payout-claimed*, and *pool-complete*
events were emitted **distinctly**, with the payout-claimed event correctly
landing in the **neutral** bucket — receiving capital scored nothing, completing
the pool scored the reward.

The deployed programs (devnet, shared across clusters):

| Program                | ID                                             |
| ---------------------- | ---------------------------------------------- |
| `roundfi-core`         | `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw` |
| `roundfi-reputation`   | `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2` |
| `roundfi-yield-mock`   | `GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ` |
| `roundfi-yield-kamino` | `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb` |

Transaction signatures and the reproducible runbook live in
`docs/operations/v52-devnet-runbook.md` — every claim above can be re-verified,
not taken on trust.

## 6. What we are honest about

Credibility is also about what is *not* yet done. Two of the four behavioral
metrics — **Commitment** and **Recovery** — currently ship as `null` in the score
API. They are deliberately **not** fabricated: they will be calibrated from real
default-and-recovery sequences produced by the canary before they are published.
The on-chain Elite gate is **v1-provisional** (score + completed pools); the
sharper metric-based Elite criteria live off-chain until the weights are proven.
And the protocol's hardest gates to mainnet are **non-code**: regulatory review
(LGPD, Bacen) handled by counsel, an external audit, and a multi-sig on the
treasury.

We would rather ship a `null` we can defend than a number we cannot. That posture
— **legible, auditable, re-verifiable** — is the same property that makes the
reputation worth something to a lender in the first place.

---

_Cross-references: protocol mechanics → [`02-technical-whitepaper`](./02-technical-whitepaper.md);
program topology → [`03-architecture-spec`](./03-architecture-spec.md); the
reputation engine in full → [`04-behavioral-reputation-score`](./04-behavioral-reputation-score.md);
the devnet evidence → [`11-devnet-status-and-proof`](./11-devnet-status-and-proof.md).
The complete source of truth is MASTER-SPEC §1–3 and §11._
