# Canary metrics framework

> **What this is.** The dashboard before the canary. Ten metrics, each backed by a real SQL query against the deployed indexer Postgres schema (`services/indexer/prisma/schema.prisma`). Every query in this document is **runnable today** against the live devnet database (`postgres://postgres:roundfi@localhost:5432/postgres`) — the canary report is then just a templated rendering of these queries against the post-launch database.
>
> **Source.** Partner review (2026-06-12) Pass-11 framing — answers the question "what do we measure when the canary starts?" before the answer requires a war room.
>
> **Status.** v1. Reliability + Punctuality time series available now; Commitment + Recovery are scaffolded with the queries that will run once the indexer ships their incremental projection (currently surfaced as `null` in the score API — see Master Spec § 6.3).

## How to run

Postgres is up via Docker on devnet (see `v52-devnet-runbook.md`). Each query block here is copy-paste runnable:

```bash
docker exec roundfi-pg psql -U postgres -d postgres -A -F'|' -c "<query>"
```

The framework script `scripts/canary/metrics.ts` (to be written; tracked) wraps these into a single `pnpm metrics:canary` command that renders the markdown report.

## Geometry of the schema

The four tables we read from:

- **`pools`** — one row per pool created; mutable state (status, currentCycle, balances) refreshed on every event.
- **`members`** — one row per `(pool, wallet)` join; carries `defaulted`, `onTimeCount`, `lateCount`, `contributionsPaid`, `totalReceived`.
- **`attestations`** — one row per on-chain attestation, with the decoded BehavioralPayload (`classification`, `deltaSeconds`, `cycle`, `slotIndex`, `payloadVersion`).
- **`contribute_events` / `claim_events` / `default_events`** — append-only event log for per-tx detail.

Pass-3 schema ids (Master Spec § 5.3):

- `1` = PAYMENT (positive)
- `2` = LATE (negative)
- `3` = DEFAULT (negative)
- `4` = POOL_COMPLETE (positive — the `+50` / `cycles_completed` bump)
- `5` = LEVEL_UP (informational)
- `6` = PAYOUT_CLAIMED (**neutral**, the audit-only claim event)

## 1. Completion rate

> Of the pools that have run their full course (reached `Completed` or `Closed`), what fraction did so without any default?

```sql
WITH terminal AS (
  SELECT id, "defaultedMembers"
  FROM pools
  WHERE status IN ('Completed', 'Closed')
)
SELECT
  count(*)                                                AS terminal_pools,
  count(*) FILTER (WHERE "defaultedMembers" = 0)          AS clean_completions,
  ROUND(100.0 * count(*) FILTER (WHERE "defaultedMembers" = 0) / NULLIF(count(*), 0), 1)
                                                          AS completion_rate_pct
FROM terminal;
```

**Interpretation.** A completion rate ≥ 90% on the canary is the headline claim we make to grants and partners. Below 70% is the kill criterion — see `mainnet-canary-plan.md § 6`.

## 2. Default rate

> Of all members who ever joined a pool, what fraction defaulted?

```sql
SELECT
  count(*)                                                AS total_members,
  count(*) FILTER (WHERE defaulted)                       AS defaulted_members,
  ROUND(100.0 * count(*) FILTER (WHERE defaulted) / NULLIF(count(*), 0), 2)
                                                          AS default_rate_pct
FROM members;
```

**Lift filter (membership tenure ≥ 1 cycle).** Filtering by `"contributionsPaid" >= 1` excludes members who joined and never paid even once (probably a UX or wallet-funding failure, not a credit failure).

## 3. Recovery rate

> Of members who defaulted on **some** pool, how many later achieved on-time payments in a **subsequent** pool? (The second-chance thesis.)

```sql
WITH defaulters AS (
  SELECT DISTINCT wallet, MIN("joinedAt") AS first_default_join_ts
  FROM members
  WHERE defaulted
  GROUP BY wallet
),
post_default_activity AS (
  SELECT m.wallet,
         bool_or(m."onTimeCount" > 0 AND m."joinedAt" > d.first_default_join_ts) AS recovered
  FROM members m
  JOIN defaulters d ON m.wallet = d.wallet
  GROUP BY m.wallet
)
SELECT
  count(*)                                                AS distinct_defaulters,
  count(*) FILTER (WHERE recovered)                       AS recovered,
  ROUND(100.0 * count(*) FILTER (WHERE recovered) / NULLIF(count(*), 0), 1)
                                                          AS recovery_rate_pct
FROM post_default_activity;
```

**Note.** This is the **single most important metric for the "second chance" thesis** of RoundFi. A non-zero recovery rate at canary scale is the empirical evidence we need to claim that the protocol turns delinquency into rehabilitable history rather than permanent exclusion.

## 4. Escape Valve rate

> Of all members who joined a pool, what fraction exited mid-pool via the secondary market?

```sql
SELECT
  count(*) FILTER (WHERE "paidOut" = false AND "contributionsPaid" > 0
                   AND p.status IN ('Completed','Closed','Active'))   AS sold_or_in_progress,
  count(DISTINCT m."lastTransferredAt")                               AS members_with_transfers
FROM members m
JOIN pools p ON p.id = m."poolId"
WHERE m."lastTransferredAt" > 0;
```

**A more precise query** once `escape_valve_events` (a planned event log) lands: count of `EscapeValveBuy` events / total members joined. Current schema needs `lastTransferredAt` as a proxy.

## 5. Time to L2

> Distribution of (`first attestation timestamp` → `level reached 2 timestamp`) for promoted wallets.

```sql
WITH first_attestation AS (
  SELECT subject, MIN("issuedAt") AS first_ts
  FROM attestations
  WHERE revoked = false
  GROUP BY subject
),
level_history AS (
  -- TODO(indexer): a `reputation_levels` change-log table would let us
  -- read promotion timestamps directly. For v1 we approximate by joining
  -- against the wallet's most recent member row.
  SELECT
    m.wallet AS subject,
    MIN(m."joinedAt") AS approx_promotion_ts
  FROM members m
  WHERE m."reputationLevel" >= 2
  GROUP BY m.wallet
)
SELECT
  count(*)                                                AS l2_wallets,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (lh.approx_promotion_ts - fa.first_ts))
                                                          AS median_seconds_to_l2,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY (lh.approx_promotion_ts - fa.first_ts))
                                                          AS p90_seconds_to_l2
FROM first_attestation fa
JOIN level_history lh USING (subject);
```

> **Indexer follow-up needed.** A proper `level_change_events` table (small Prisma migration) replaces the `approx_promotion_ts` heuristic and makes this query exact. Tracked.

## 6. Time to L3

Same query as § 5 with `"reputationLevel" >= 3`. The structural difference at L3 is the **3-completed-pools cycles floor** — a wallet needs ≥ 3 `POOL_COMPLETE` attestations spaced ≥ 30 days apart, so time-to-L3 has a hard minimum of ~90 days.

## 7. Time to L4

Same query as § 5 with `"reputationLevel" = 4`. Hard minimum **~240 days** (8 pools × 30-day cooldown), plus the **identity verification** floor — an L4 wallet is by construction an identity-verified wallet (PR #478). Time-to-L4 is the metric that proves the "Elite is hard to fake" claim.

## 8. Level distribution

> Snapshot of the live wallet population.

```sql
SELECT "reputationLevel",
       count(*)                                          AS wallets,
       ROUND(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct_of_total
FROM (
  SELECT DISTINCT ON (wallet) wallet, "reputationLevel"
  FROM members
  ORDER BY wallet, "joinedAt" DESC
) latest_membership
GROUP BY "reputationLevel"
ORDER BY "reputationLevel";
```

**Reference target distribution** (post-canary, ~12 months): L1 ≈ 70%, L2 ≈ 20%, L3 ≈ 9%, L4 ≈ 1%. If after 90 days the distribution is L1 ≈ 99%, the score schedule is too punitive. If L4 > 10% in <6 months, the cycles floor is leaking.

## 9. Mean score by group

> Average score for the four canonical user-behavior cohorts.

```sql
-- Requires the indexer to materialize per-wallet score; for v1 we
-- derive a proxy from on-chain counters in the latest member row.
WITH wallet_history AS (
  SELECT m.wallet,
         max(m."onTimeCount")              AS on_time,
         max(m."lateCount")                AS late,
         bool_or(m.defaulted)              AS ever_defaulted
  FROM members m
  GROUP BY m.wallet
),
proxy_score AS (
  SELECT wallet,
         on_time, late,
         CASE
           WHEN ever_defaulted THEN 'defaulted'
           WHEN late = 0 AND on_time >= 8 THEN 'gold (elite track)'
           WHEN late = 0 AND on_time >= 1 THEN 'good (on-time always)'
           WHEN late > 0 AND on_time > late THEN 'mixed (mostly on-time)'
           ELSE 'underperformer'
         END                               AS cohort,
         on_time * 10 - late * 100         AS proxy_score
  FROM wallet_history
)
SELECT cohort,
       count(*)              AS wallets,
       round(avg(proxy_score)) AS mean_score,
       round(stddev(proxy_score)) AS stddev_score
FROM proxy_score
GROUP BY cohort
ORDER BY mean_score DESC;
```

**The query above is a v1 proxy.** Replace with a direct read of `reputation_profile.score` once the indexer exports it as a column (currently it's only on-chain).

## 10. Capital protected by reputation

> The metric the partner review calls "my favorite." For every USDC of credit ever paid out, what fraction went to a member whose `reputationLevel` at the moment of `claim_payout` was ≥ L2?

```sql
SELECT
  sum(p."creditAmount") FILTER (WHERE m."reputationLevel" >= 2)            AS credit_to_reputable,
  sum(p."creditAmount")                                                    AS credit_total,
  ROUND(100.0 * sum(p."creditAmount") FILTER (WHERE m."reputationLevel" >= 2)
        / NULLIF(sum(p."creditAmount"), 0), 1)                              AS pct_protected
FROM members m
JOIN pools p ON p.id = m."poolId"
WHERE m."paidOut" = true;
```

**Why this matters.** This is the metric a lender, a fintech partner, or a regulator actually cares about: "your protocol moves capital — does it move it to people who have evidence of paying?" Even at canary scale, a number in the 80–95% range is a real claim — RoundFi can defensibly say _"we measured that N% of capital advanced was advanced to members with prior on-chain track records."_

---

## The published report

`docs/strategy/canary-report-template.md` (to write) renders the 10 metrics above + the narrative wrap-up:

> RoundFi Canary Report #1 — 90 days, N pools, M wallets.
> Completion rate: X%. Default rate: Y%. Capital protected by reputation: Z%.
> L1: a%, L2: b%, L3: c%, L4: d%.
> Wallets with ≥ 3 completed cycles showed K% lower default rate than first-cycle wallets.

The point is the transition the partner review describes: **"we observed X" beats "we believe X"** in every grant, partner, and regulator conversation. The dashboard turns hypothesis into evidence.

## Indexer follow-ups blocking exact metrics

The queries above use proxies where the v1 schema doesn't yet emit a needed field. Tracked Prisma migrations:

- [ ] `level_change_events` table — `(wallet, fromLevel, toLevel, atTs, txSig)` rows on every `promote_level` tx. Makes §§ 5–7 exact.
- [ ] `reputation_profile_cache` view or materialised table — denormalises `score / level / cycles_completed / total_participated` per wallet, refreshed from on-chain on each attestation. Replaces the proxy in § 9.
- [ ] `escape_valve_events` table — `(pool, slot, seller, buyer, price, at)` rows. Makes § 4 exact.

None of these are blocking the framework itself — the queries run today against the existing schema with the documented v1 caveats.
