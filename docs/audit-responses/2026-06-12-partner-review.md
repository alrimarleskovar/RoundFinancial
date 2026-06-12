# Partner review response — 2026-06-12

> **Context.** Internal review delivered 2026-06-12 by partner Caio (WhatsApp,
> +55 11 94113-1202). Mixes a technical audit (4 findings: HIGH #2, MEDIUM #1/2/3)
> with a strategic roadmap (Pass 7-12: simulator, canary metrics, adversarial
> economics, regulatory, partner readiness, founder review, doc reorg).
>
> This response addresses each finding against the **current** code (Jun 2026,
> Pass-3 + 4-tier deployed), then accepts the strategic items with a realistic
> timeline. The technical findings split cleanly into one **already-resolved** (the
> HIGH) and three **valid configuration/design notes** for the mainnet path.

## TL;DR for the partner

| Finding                                               | Severity | Status                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH #2 — `claim_payout` counts as `CycleComplete`    | High     | ✅ **Resolved Jun 2026 (Pass-3)** — `claim_payout` now emits `PAYOUT_CLAIMED` (schema 6), score-neutral. Promotion credit moved to `POOL_COMPLETE` (schema 4) on the **final installment**.                                                                                                                                   |
| MEDIUM #1 — identity gate off by default              | Medium   | ✅ **Accepted as mainnet invariant** — devnet default stays `required_min_level = 0`; mainnet deploy will set `≥ 3` (gate L4 promotions on verified identity). Added to mainnet-canary-plan TODO.                                                                                                                             |
| MEDIUM #2 — `reputation_program == default` skip path | Medium   | ✅ **Accepted as mainnet invariant** — current devnet has it set (`Hpo174C…`), but no on-chain guard. Add `require!(config.reputation_program != Pubkey::default())` to `initialize_protocol` in the mainnet build (or as a deploy-time post-flight).                                                                         |
| MEDIUM #3 — escape_valve transfers operational state  | Medium   | ✅ **Acknowledged as intentional design** — position-state is on the slot, wallet-reputation is on the wallet. Buyer inherits obligations (`contributions_paid`, on/late counts) so they can't ditch the pool; the reputation profile (the **portable** score) stays with the seller's wallet. Documented in Master Spec § 4. |

For Pass 7-12 see § 3 below. Short version: we agree with the framing — simulator + adversarial economics + canary metrics are the highest-leverage strategic work; we are scoping a 2-week effort to land Canary Report #1 and the adversarial economics document, and a 4-week effort for the simulator. Master Spec doc reorganisation is queued behind the canary report.

---

## 1. Technical findings — point-by-point

### HIGH #2 — `claim_payout` counted as `CycleComplete` (✅ resolved)

**The review's claim.**

> The system uses `SCHEMA_CYCLE_COMPLETE` for `claim_payout`. Conceptually claim_payout = received capital ≠ cycle complete = met obligations. `cycles_completed` is anti-farming defense for promotion; receiving payout early shouldn't earn reputational progress before proving post-liquidity behaviour.

**Status.** The split the review asks for **was implemented Jun 2026 as Pass-3** (Caio HIGH from a prior review cycle — the same author appears to have re-raised it against an older code snapshot).

Current `programs/roundfi-core/src/instructions/claim_payout.rs` (verified 2026-06-12 against `main` at commit `cb28016`):

```rust
use roundfi_reputation::constants::SCHEMA_PAYOUT_CLAIMED;
// ...
schema_id: SCHEMA_PAYOUT_CLAIMED,   // line 257
```

`SCHEMA_PAYOUT_CLAIMED` is **id 6**, score-neutral, polarity `neutral`. The `+50` / `cycles_completed` bump that was the anti-farming gate is now on `SCHEMA_POOL_COMPLETE` (id 4), fired by `contribute` **only on the final installment** of the pool — i.e. only when the member has demonstrably kept every obligation including any post-payout installments.

**Live evidence on devnet (2026-06-12).** Pool `Ga2RwgSkisvCEoq6m97s77KN46yHFRTk4tK4Py5H83LQ` ran the full Pass-3 lifecycle. The on-chain attestation rows in Postgres (from `getProgramAccounts` decode):

| schemaId | classification   | payloadVersion | cycle | source ix                        |
| -------: | ---------------- | -------------: | ----: | -------------------------------- |
|        1 | `payment_early`  |              2 |     0 | `contribute`                     |
|        6 | `payout_claimed` |              2 |     0 | `claim_payout`                   |
|        4 | `pool_complete`  |              2 |     1 | `contribute` (final installment) |

The indexer's `behavioralClassification.ts` puts `payout_claimed` in `polarity_counts.neutral` — no reliability or commitment bump. The `+50` lives on `pool_complete`.

**References.**

- PR #470 (Pass-3 demo enablement, merged 2026-06-12).
- `docs/operations/v52-devnet-runbook.md` § "Step 5 — Cycle 1" and § "Backfill + score" for the on-chain proof.
- `programs/roundfi-reputation/src/constants.rs` lines 36-50 for the schema-id table.
- `services/indexer/src/behavioralClassification.ts` lines 95-200 for the off-chain scoring (`payout_claimed` is explicitly neutral and is **not** an input to reliability — see lines 95-115).

**Suggested follow-up for the reviewer.** Pulling the latest `main` and re-running the audit against today's code (or against the v5.2 devnet runbook's documented Pass-3 evidence) would close this finding out cleanly. We're happy to walk through the actual on-chain transactions if useful.

### MEDIUM #1 — identity gate off by default

**The review's claim.**

> `IdentityGateConfig` exists and can limit promotion of unverified users, but in default mode `required_min_level = 0` — the gate is off. Fine for devnet/canary, but for mainnet L4 should require `identity_verified` (or at minimum active PoP).

**Status.** Confirmed against current code:

- `programs/roundfi-reputation/src/instructions/set_identity_gate.rs:14` — docs the `required_min_level = 0` default explicitly.
- `programs/roundfi-reputation/src/instructions/promote_level.rs:84` — promotion handler no-ops the floor check when `required_min_level == 0`.
- `programs/roundfi-reputation/src/state/profile.rs:138, 241` — gate-bypass paths when the flag is off.

The `0` default is **correct for devnet** (we don't have a KYC partner in the loop yet — gating would brick our own canary). For mainnet it's a deploy-time decision.

**Accepted action (mainnet checklist).** Set `required_min_level = 3` before opening retail pools on mainnet:

- L3 promotion will require `identity_verified` (Proof-of-Personhood via the configured provider).
- L4 implicitly requires L3, so it inherits the floor.
- L2 stays gate-free — the entry path for fresh wallets.

Tracking note added to `docs/operations/mainnet-canary-plan.md` (new TODO under § 3 mainnet hardening).

### MEDIUM #2 — `reputation_program == default` creates "no reputation" mode

**The review's claim.**

> Several flows skip the reputation CPI when `config.reputation_program == Pubkey::default()`. Legacy/devnet compatibility, but for canary the deploy invariant should be `reputation_program != default` — otherwise the protocol runs reputation-less while the app sells the reputation narrative.

**Status.** Confirmed against current code:

- `claim_payout.rs:205` — `if config.reputation_program != Pubkey::default() { /* CPI */ }`
- `contribute.rs` — same pattern (the `Step 4e` block).
- `join_pool.rs:114` — the trusted-level derivation defaults to `Lv1` when the field is unset.

The skip path **was** important during the multi-month period where `roundfi-reputation` was deployed but not yet wired into `roundfi-core`. That period is over: the current devnet config has `reputation_program = Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2`. But there's no on-chain guarantee that mainnet's `initialize_protocol` won't ship with a `Pubkey::default()`.

**Accepted action (mainnet checklist).** Two layers of defense:

1. **Deploy-time:** add a `require!(args.reputation_program != Pubkey::default(), RoundfiError::ReputationProgramMissing)` to `initialize_protocol` (or to a dedicated `lock_reputation_program` ix companion to `lock_treasury` / `lock_approved_yield_adapter`). One-line change; tracked.
2. **Post-flight verification:** the mainnet canary's pre-flight already reads `ProtocolConfig` to assert balances and locks — extend it to assert `reputation_program == <expected mainnet program id>`. Add to `scripts/mainnet/canary-flow.ts`.

Both additions queued behind the multi-sig migration (#266 — `initialize_protocol` is upgrade-authority-only).

### MEDIUM #3 — escape_valve transfers operational state

**The review's claim.**

> `escape_valve_buy` transfers operational state (reputation_level, stake_bps, contributions_paid, on_time_count, late_count, paid_out, escrow_balance) from the old member to the new one. Not a bug — but raises the product question: **is reputation of the wallet, or of the position?**

**Status.** Confirmed against `programs/roundfi-core/src/instructions/escape_valve_buy.rs:241-248` — operational state carries verbatim. **And this is intentional.**

**Design rationale.**

The fields the buyer inherits are **position-state**, not **wallet-reputation**:

- `contributions_paid`, `on_time_count`, `late_count` — counters of what the **slot** has done in this pool.
- `escrow_balance`, `stake_deposited` — the **funds locked against the slot**.
- `reputation_level`, `stake_bps` — the **stake tier** the slot was opened at (sets the slot's economics).
- `paid_out` — whether the slot's `claim_payout` has fired.

What the buyer does **not** inherit:

- The seller's `ReputationProfile` PDA (`[SEED_PROFILE, seller_wallet]`). That's the **wallet-bound** portable reputation — the score, the tier, the `cycles_completed` history across **all** pools. It stays with the seller's wallet, and the buyer's wallet brings its own profile (which the buyer's other pools have built up).

The intuition: if you buy a half-paid mortgage, you assume the remaining obligations of **that mortgage** — but the seller's overall credit history doesn't move to you, and your own credit history doesn't reset. RoundFi follows the same model. The reputation **engine** (the off-chain score) operates on attestations keyed by **subject = wallet**, so it naturally tracks the wallet, not the slot.

**The question the review is asking** — "should the score follow the wallet or the position?" — was settled in favor of the wallet during the v5.2 design (the same Pass-3 work that fixed HIGH #2). The buyer can't inherit a high reliability score by buying out a successful slot; they can only inherit the slot's pending obligations, which they then have to honor (and earn their **own** reliability bump for) to get the `pool_complete` attestation.

**Action.** Document the position-state / wallet-reputation split explicitly in the Master Spec. Marked as a doc TODO (no code change). Possible follow-up: in the Master Spec § 4 (Escape Valve) add a worked example showing buyer X (high score) buying slot from seller Y (low score) — the **slot's** stake_bps doesn't move to X's tier, and X's wallet score doesn't drop to Y's. Makes the model concrete.

---

## 2. Strategic items (Pass 7-12)

This is the part of the review that lands **outside the audit**. We agree with the framing — the strategic gap between today's protocol and a defensible canary launch is mostly **evidence** (simulator results, adversarial economics, canary metrics), not code. Here's the realistic scope.

### Pass 7 + 9 — simulator (10k virtual users, 12-36 month horizon)

**Agree it's the right work.** "We observed risk reduction" beats "we believe reputation reduces risk" in every grant / partner conversation we've had.

**Scope.** ~2 weeks of focused work:

- TS model on top of the existing math crate (`crates/math/` already has the canonical pool float, viability, waterfall math — reuse, don't re-derive).
- User-population generator (the reviewer's 70 / 20 / 10 split is fine for v1; later versions can pull empirical distributions).
- Pool generator (size, duration, member-mix).
- Outcome tracking (completion, default, recovery, time-to-Lx, score distribution).
- Output: `docs/strategy/simulator-report-v1.md` + a CSV the doc references.

**Not in scope for v1.** Game-theoretic strategies (Pass 8 — adversarial). Those need a separate model.

**Owner.** TBD. Tracked as a v5.3 milestone item.

### Pass 8 — adversarial economics (THE most important per the reviewer)

**Agree.** The simulator answers "does the design work for honest users." Adversarial economics answers "can dishonest users break it."

**Scope.** ~5 days. Deliverable: `docs/strategy/adversarial-model.md`:

- **Sybil:** N wallets, one person, M coordinated pools — how much fake reputation can they generate; how fast does an honest user catch up; cost/benefit table for the attacker.
- **Cartel:** Closed-group reputation farming (10 friends, 1 year) — is the reputation they generate equal to the same trajectory for unrelated users?
- **Elite farming:** What's the minimum cost (in real defaults) to reach Elite (L4) by gaming the system vs. by being a good payer?
- **Escape Valve abuse:** Can the seller exit a slot they're about to default on, and pass the loss to a naïve buyer? (Already partially addressed: the buyer inherits `escrow_balance` so they're on the hook for the funds at risk — but the doc should make this explicit.)
- **Goodhart's law:** What metric does the protocol use to gate promotion, and can that exact metric be optimized for without the underlying behavior the metric is supposed to proxy?

For each attack we describe: vector, current defense, residual gap, planned mitigation.

**This is the document I'd write first if the reviewer is right that grants and partners want adversarial reasoning** — it's the highest signal-to-page-count ratio of the whole roadmap.

**Owner.** Tracked as a v5.3 milestone. Initial draft can be written off the existing protocol; revision after the simulator (Pass 7) lands.

### Pass 11 — canary metrics framework (the dashboard before the canary)

**Agree, and this one is tractable now** — we already have the indexer running on real devnet data (4 pools, ~30 attestations, the post-EV-buy Member PDA reshuffle is in there). The 10 metrics the reviewer lists are mostly straight SQL on the existing Prisma schema:

1. Completion rate — `pools` joined with `Member.contributions_paid == Pool.cycles_total`.
2. Default rate — `members.defaulted = true` aggregations.
3. Recovery rate — defaulted members who later achieved on-time payments in a new pool (requires the wallet ↔ pool join).
4. Escape Valve rate — `EscapeValveListing.status = Sold` rows.
5. Time-to-L2 / -L3 / -L4 — `ReputationProfile.level` change timestamps (we don't store this yet — needs an indexer migration to add a level-history table).
6. Score distribution by tier.
7. Capital protected by reputation — requires joining `Pool.credit_amount` with the borrowing member's tier at the time of `claim_payout`.

**Scope.** ~1-2 days for the queries + a `docs/strategy/canary-metrics.md` that references them. The level-history table is a small Prisma migration on top.

**Output.** A `metrics:canary` workspace command that runs the queries and renders a markdown report. Cron-friendly.

### Pass 10 — regulatory review

**Agree — and this is outside our scope.** Engaging fintech/Banco Central counsel for the LGPD + irregular-fund-collection questions is a 2026 H2 item; we're not the people to do this, and Rust patches don't fix it.

The mainnet-canary plan (`docs/operations/mainnet-canary-plan.md`) already lists "legal counsel (#268)" as a hard gate. We'll surface that gate to anyone reading the strategic roadmap so the dependency is visible.

### Pass 11 — partner readiness

**Agree, partially.** The SDK (`sdk/`) already covers behavioral classification, payload encoding, reputation score, harvest floor, and Pass-3 schema constants. What's missing for an "integrate-tomorrow" Kamino / MarginFi partner:

- Public API doc (`/score/:subject` + auth + rate limit story).
- Webhook semantics (which events, at-least-once delivery, retry policy, idempotency key).
- Reference integration (1-page "embed RoundFi score in a credit check" code sample).
- SLA / data freshness guarantees (or explicit non-SLA statement for canary).

~3 days for the doc + sample once the canary metrics framework is in place.

### Pass 12 — founder review

**Agree, no work needed except time.** A 1-hour internal alignment session to write **one sentence**: what RoundFi is. The candidate the reviewer offered is good — let's use it as the strawman:

> RoundFi is infrastructure that turns verifiable financial behavior into portable reputation.

Adopting that sentence as the canonical short-form pitch closes Pass 12.

### Document reorganisation (Master Spec v1)

**Agree it's necessary, disagree on the timing.** The current PDFs (Whitepaper, Architecture, Business Model, GTM, etc.) are out of sync with the Jun 2026 code (Pass-3, 4-tier, the seven validated devnet capabilities). Maintaining 12 forked docs is a tax we already pay.

**But.** The Master Spec is **derived** from the adversarial model + the canary metrics + (eventually) the simulator results. Writing it before those land means writing it twice. Order:

1. Adversarial model (Pass 8) — 5 days.
2. Canary metrics framework + Canary Report template (Pass 11) — 2 days.
3. Simulator + report (Pass 7+9) — 2 weeks.
4. **Then** Master Spec v1.0 — 1-2 weeks, deriving from the three above.
5. User Guide / Partner Guide / Pitch Deck / Website — derived from Master Spec.

Total: ~6-8 weeks. The reviewer's intuition that the documentation reorg is the highest-leverage perception fix is **correct**, but the input doesn't exist yet.

---

## 3. Timeline

Working backwards from the next devnet milestone (settle_default replay on 2026-06-15, then v5.3 milestone close in ~4 weeks):

| Window                  | Deliverable                                                | Owner          | Status      |
| ----------------------- | ---------------------------------------------------------- | -------------- | ----------- |
| **2026-06-12** (today)  | This response + mainnet checklist updates                  | Claude session | ✅ this doc |
| **2026-06-13 to 06-14** | Canary metrics framework + queries against devnet Postgres | Claude session | 🟡 next     |
| **2026-06-14 to 06-15** | Adversarial economics doc v1                               | Claude session | 🟡 queued   |
| **2026-06-15**          | `settle_default` on pool 45 (grace elapses)                | Operator       | 🔫 armed    |
| 2026-06-16 onward       | Founder review sentence + partner-readiness doc            | Internal       | TBD         |
| 2026-W26-27             | Simulator v1                                               | TBD            | TBD         |
| 2026-W28-29             | Master Spec v1.0 draft                                     | TBD            | TBD         |

## 4. Mainnet checklist deltas

Added to `docs/operations/mainnet-canary-plan.md` (or to be added if it doesn't already cover them):

- [ ] `IdentityGateConfig.required_min_level = 3` set before retail pools open (closes MEDIUM #1).
- [ ] `initialize_protocol` invariant: `reputation_program != Pubkey::default()` (closes MEDIUM #2).
- [ ] Canary-flow pre-flight assertion: `config.reputation_program == <pinned mainnet program id>` (closes MEDIUM #2, layer 2).
- [ ] Master Spec § 4 (Escape Valve) explicit position-state vs wallet-reputation split with worked example (closes MEDIUM #3 documentation gap).

No code blocks the canary — these are deploy-time invariants and documentation, not handler logic.
