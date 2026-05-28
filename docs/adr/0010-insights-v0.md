# ADR 0010 — Insights v0 (`/admin/ops/insights`) — analytics with honest sample-size gates

**Status:** 🟡 Proposed
**Date:** 2026-05-28
**Decision-makers:** Engineering (canary)
**Related:** ADR [0009](./0009-admin-ops-console.md) (admin/ops console + canonical events table), `sdk/src/behavioral.ts` (canonical timing semantics).

## Context

The 5-area `/admin/ops` console (ADR 0009) instruments the protocol's structural, behavioral, and economic state. What's missing is a separate **analytics** surface — the slice that turns the dataset into stories about reputation as a moat. The same dataset feeds it; the questions are different.

The risk is exactly the one that justified Insights being deferred from the first console cut: the devnet seed (9 members, 16 contributes, 1 default) does not produce a statistically valid insight. Any correlation computed off it is noise, and showing it as a number would lie about what the data supports.

We want to ship the **instrumentation** now (so the same panel measures mainnet, and so the analytical primitives are tested + auditable), while refusing to render any analytic number below a documented per-view sample-size threshold.

## Decision

We will build a read-only **Insights v0** area at `/admin/ops/insights`, backed by analytical primitives in `services/indexer/src/insights.ts`, with the same `requireAdmin` gate as the rest of the console (ADR 0009 §1). Four pre-defined questions only. Sample-size gates on every view. A loud devnet banner specific to Insights making the "no volume yet" stance unmistakable.

### 1. Methodology — pre-defined questions, no p-hacking

- The four views are **pinned in this ADR**. New questions require an ADR amendment, not an unannounced feature. This is the only defense against the obvious failure mode of analytics-on-thin-data: fishing for whichever correlation happens to look strong in 9 wallets.
- All timing semantics are sourced **only** from `sdk/src/behavioral.ts` (on-time = `delta_seconds ≤ 0`; grace = `late_within_grace`; behavioral.ts is the chain's voice on what "on time" means). Insights must never tell a different story than the chain.
- All primitives are **deterministic and rebuildable** from the `events` table + `Member` + `Pool` snapshots. No randomized samples, no shuffles, no time-windowed re-bucketing surface that could be tuned to make a number look better.

### 2. Sample-size gates (per view)

Every view has a numeric `n` and a `threshold`. The status is computed by `classifySample(n, threshold)`:

| Status         | Condition           | UI                                                                                              |
| -------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `insufficient` | `n < threshold`     | "insufficient data · need ≥ N samples" + progress (`n / threshold needed`). NO number rendered. |
| `preliminary`  | `n < 2 × threshold` | Number rendered with a "preliminary" badge + 95% Wilson CI where applicable.                    |
| `significant`  | `n ≥ 2 × threshold` | Number rendered with a "significant" badge + 95% Wilson CI where applicable.                    |

`insufficient` is non-negotiable: the API serves `null` for the metrics; the UI renders a progress card, not a placeholder digit. We never negotiate with noise.

Per-view thresholds:

- **Retention by level:** `n ≥ 30` distinct members **per cohort** (L1, L2, L3 each must clear independently).
- **Default predictor:** `n ≥ 100` wallets total before any bucket is rendered.
- **L1→L2→L3 progression:** `n ≥ 50` distinct wallets with ≥ 1 completed pool.
- **Behavioral improvement:** `n ≥ 30` distinct wallets with ≥ 3 pool memberships.

### 3. The four pre-defined views

1. **Retention by level (moat).** For each cohort `L ∈ {1,2,3}` (defined by `Member.reputationLevel` snapshot at join), compute completion rate (`paidOut`) and default rate (`defaulted`). 95% Wilson CI on each rate.

2. **Default predictor (cohort comparison only, no ML).** Per-wallet aggregates from the `events` table. The pre-defined features are exactly:
   - `late_gte_1` — wallet has ≥ 1 contribution with `delta_seconds > 0`.
   - `grace_used_gte_1` — wallet has ≥ 1 contribution with `grace_used = true`.
   - `late_gte_2` — wallet has ≥ 2 contributions with `delta_seconds > 0` (proxies for "delay habit").

   For each feature, render the default rate of wallets WITH the feature vs WITHOUT. No 4th feature gets added without an ADR amendment.

3. **L1→L2→L3 progression.** For each wallet with ≥ 1 completed pool (eligible cohort): the share that has ever reached L2 (any `Member.reputationLevel ≥ 2`), the share that has ever reached L3, and the mean number of pool memberships before reaching each tier.

4. **Behavioral improvement.** For each wallet with ≥ 3 pool memberships (ordered by `Member.joinedAt` ascending), the mean on-time rate at ordinal `k ∈ {1, 2, 3+}` computed from `Member.onTimeCount / Member.contributionsPaid`. The story is "the protocol improves behavior across pools," and we either have the evidence or we don't.

### 4. Data sources by view

| View        | Source                            | Behavioral semantics                                   |
| ----------- | --------------------------------- | ------------------------------------------------------ |
| Retention   | `Member` (per-membership truth)   | — (structural)                                         |
| Predictor   | `events` + per-wallet aggregation | `behavioral.ts` via `delta_seconds`, `grace_used`      |
| Progression | `Member` ordered by `joinedAt`    | — (structural; level history is the per-join snapshot) |
| Improvement | `Member` ordered by `joinedAt`    | — (`onTimeCount` is the chain counter)                 |

**Why `Member.reputationLevel` and not `ReputationProfile` directly.** The
on-chain `Member.reputation_level` field is the **snapshot the program writes at
join time** (`programs/roundfi-core/src/instructions/join_pool.rs ::
derive_trusted_reputation_level`). When the wallet has no `ReputationProfile`
PDA yet — the devnet baseline — the program **defaults to L1** and writes that
value to `Member`. Reading `Member.reputationLevel` therefore stays consistent
with the chain (including the L1 default), without requiring the indexer to
hydrate `ReputationProfile`. `retentionByLevel` also maps any `< 1` sentinel to
L1 as belt-and-suspenders against future "level unset" rows.

**Follow-up (not in v0).** Hydrate `ReputationProfile` PDAs via a dedicated
backfill pass (same shape as `Pool` / `Member`: `getProgramAccounts` against
`roundfi_reputation` filtered by the account discriminator). That lets a future
Insights amendment derive `progression` from the _current_ on-chain level
rather than the per-join snapshot. Out of scope for v0 — tracked as an ADR
0010 amendment when the data shape matters.

### 5. Confidence intervals

For proportions (retention rates, share-reached-level), we render a 95% **Wilson score** interval — honest near 0/1 where the Wald interval lies. CIs only render when status ≥ `preliminary`. For mean-pools-to-reach-L2/L3 we report the point estimate at 1 decimal; CIs on the mean are out of scope for v0.

### 6. Devnet posture

A loud amber banner specific to Insights: **"devnet · sem volume estatístico — instrumentação pronta, números reais com tráfego."** This is the same honest framing as Economy's banner (ADR 0009 amendment) but sharpened for Insights: even when a card has enough rows to render, on devnet it almost certainly will not, and the "insufficient data" empty state is the expected screen.

## Consequences

- The UI defaults to "insufficient data · need ≥ N samples" everywhere on devnet, and that is correct — we ship the panel, not the story.
- New questions cannot be added by editing the code alone — they require an amendment to this ADR. This is the discipline against p-hacking.
- The thresholds are conservative on purpose. A future amendment may justify raising them (e.g. to 50/200/100/50) once we have mainnet calibration; lowering them requires explicit justification.
- `sdk/src/behavioral.ts` remains the single source of timing truth — Insights never re-derives "on-time".
