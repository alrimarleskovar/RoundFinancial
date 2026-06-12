# RoundFi v5.2 devnet demo — operator runbook (Jun 2026)

Compact, copy-paste runbook for the Pass-3 + 4-tier on-chain demo
against the deployed Jun 2026 programs. Replaces the pre-Pass-3 demo
notes in `reputation-canary-demo.md` for the current binaries.

## Why this exists

The seed scripts were written in May 2026. Between May and Jun the core
program added 3 new validations that break the old defaults:

- `MIN_CYCLE_DURATION = 86_400s` (1 day) — was 60s
- `cycles_total == members_target` — strict equality
- `members × installment × (1 − solidarity_bps − escrow_bps) ≥ credit` (Seed Draw guard)

This runbook uses params that satisfy all three.

## Demo geometry

The smallest pool that proves **all three Pass-3 schemas** (`PAYMENT`
mid-pool, `POOL_COMPLETE` final-installment, `PAYOUT_CLAIMED` at claim)
without burning unnecessary devnet USDC.

**Low-budget geometry (faucet-blocked — RECOMMENDED).** The Circle
faucet (`faucet.circle.com`) fires a bot-detection challenge under
repeated hits, and the deployer often carries only a few USDC. This
geometry runs the entire demo on ~24 USDC of pre-existing balances —
**zero faucet hits** — and was the one validated end-to-end on
2026-06-12 (pool `Ga2RwgSk…`):

| Param                     | Value | Why                                                                    |
| ------------------------- | ----: | ---------------------------------------------------------------------- |
| `MEMBERS_TARGET`          |     2 | Smallest that satisfies `cycles_total == members_target` AND Seed Draw |
| `CYCLES_TOTAL`            |     2 | Forced equal to `MEMBERS_TARGET`                                       |
| `CREDIT_AMOUNT_USDC`      |     4 | Carta size — kept tiny so members fund from existing balances          |
| `INSTALLMENT_AMOUNT_USDC` |     3 | viability: `floor(2 × 3 × 0.74) = 4 ≥ 4 credit` ✓                      |
| `CYCLE_DURATION_SEC`      | 86400 | On-chain MIN                                                           |
| `POOL_SEED_ID`            |    43 | Any value ≠ existing pools (1, 2, 3 May; 42 was a credit=30 attempt)   |

Per member = `2 stake + 2 × 3 installments = 8 USDC`; two members = 16
USDC. The `fund-members` script (Step 2.5) tops members up from the
deployer — no faucet. Viability factor is `(MAX_BPS − SOLIDARITY_BPS −
escrow_release_bps)/MAX_BPS = (10000 − 100 − 2500)/10000 = 0.74`
(`crates/math/src/seed_draw.rs`). There is **no on-chain minimum** on
`credit_amount` / `installment_amount` beyond `> 0`, so you can shrink
the pool as far as the math closes.

**Original geometry (when the faucet works).** credit=30, install=21
→ 57 USDC/member, ~12 faucet hits. Heavier but a more "realistic"
carta size. Keep `cycles_total == members_target` and satisfy the
0.74 viability factor for any custom sizing.

> ⚠️ **Reused wallets carry history.** `keypairs/member-*.json` persist
> across runs; if a wallet was a subject in an earlier pool its old
> attestations show up in `/score` as `unspecified` (legacy payload
> format, neutral polarity — they don't corrupt the Pass-3 proof but
> they inflate `event_count`). For a pristine profile, point at unused
> wallets with `MEMBER_INDEX_OFFSET=N` (loads `member-N`, `member-N+1`,
> …) — but those need funding too.

## Pre-flight (once)

```bash
cd ~/RoundFinancial

# Branch with the env-configurable seed scripts + migrate_protocol_config
git checkout claude/migrate-protocol-config
git pull --ff-only

# Pin the deployed program IDs (Jun 2026)
export ROUNDFI_CORE_PROGRAM_ID=8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw
export ROUNDFI_REPUTATION_PROGRAM_ID=Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2

# Geometry — set once, every seed-* respects these.
export POOL_SEED_ID=42
export MEMBERS_TARGET=2
export CYCLES_TOTAL=2
export INSTALLMENT_AMOUNT_USDC=21
export CYCLE_DURATION_SEC=86400

# Postgres (for the off-chain demo)
docker ps --filter name=roundfi-pg --format '{{.Status}}' | grep -q Up || \
  docker run -d --name roundfi-pg -e POSTGRES_PASSWORD=roundfi -p 5432:5432 postgres:16
export DATABASE_URL='postgresql://postgres:roundfi@localhost:5432/postgres'

# Apply indexer schema (idempotent)
pnpm --filter @roundfi/indexer prisma:migrate
```

## Step 1 — Pool

```bash
pnpm devnet:seed
```

Expected last lines:

```
→ calling roundfi_core.create_pool(...)
  Pool PDA: <new pubkey ≠ 5APoECXz>
```

> **First time only:** if you see `AccountDidNotDeserialize` on a pre-Jun
> ProtocolConfig, run `pnpm devnet:migrate-config` once and retry. The
> deployer key (`keypairs/deployer.json` = `64XM177…`) must exist.

## Step 2 — Member keypairs (prints pubkeys, exits if USDC short)

```bash
pnpm devnet:seed-members
```

First run generates `keypairs/member-{0,1}.json`, prints the wallets,
and exits because they have no USDC yet:

```
member 0 USDC: 0.00 (need 2.00) ⚠ insufficient — fund via https://faucet.circle.com
member 1 USDC: 0.00 (need 2.00) ⚠ insufficient — fund via https://faucet.circle.com
```

Note the script's faucet hint is the on-chain stake only; the full
per-member target (stake + all installments) is what `fund-members`
sizes. Don't faucet manually unless `fund-members` tells you the
deployer is short.

## Step 2.5 — Fund members from the deployer (no faucet)

```bash
pnpm devnet:fund-members
```

Transfers SOL + USDC deployer → members for the full demo target
(`stake + cycles × installment` = 8 USDC each in the low-budget
geometry). Idempotent; skips members already at target. If it reports
the **deployer** is short, that's the only address you faucet —
`faucet.circle.com` is less likely to bot-block a single wallet, and
the deployer usually has carry-over USDC from earlier seeds.

Expected:

```
→ Per-member target: 8.00 USDC
  ✓ member 0 funded (+0.0000 SOL, +3.00 USDC)
  ✓ member 1 already at target — skip
✓ Funding complete.
```

Then join the pool:

```bash
pnpm devnet:seed-members
```

Expected last lines:

```
✓ joined member 0
✓ joined member 1
```

## Step 3 — Cycle 0 (mid-pool — proves PAYMENT schema)

```bash
pnpm devnet:seed-cycle    # both members contribute → SCHEMA_PAYMENT × 2
pnpm devnet:seed-claim    # slot 0 claims → SCHEMA_PAYOUT_CLAIMED ⭐ (Pass-3)
```

⭐ **The `seed-claim` is the first Pass-3 proof on-chain.** Look at the
Solscan link it prints — the attestation PDA should be derived under
schema_id=6 (PAYOUT_CLAIMED). Old behavior would have been schema_id=4
with +50 score. The reputation profile of slot 0 should show
**unchanged score** post-claim.

## Step 4 — No wait needed (the claim advances the cycle)

**Cycle advancement is claim-driven, not time-driven.** `claim_payout`
of cycle N sets `pool.current_cycle = N+1` and bumps `next_cycle_at +=
cycle_duration` (`claim_payout.rs:186-196`). So Step 3's `seed-claim`
already moved the pool into cycle 1 — you do NOT wait `CYCLE_DURATION`.

`on_time` is `now <= pool.next_cycle_at` (`contribute.rs:189`), and
`next_cycle_at` was seeded at join to `join_time + cycle_duration` then
extended by the cycle-0 claim to `join_time + 2 × cycle_duration`. So a
cycle-1 contribute run immediately after the claim is still **on-time**
(you're well inside the 48h window). Run Step 5 right away.

## Step 5 — Cycle 1 (final — proves POOL_COMPLETE schema)

```bash
pnpm devnet:seed-cycle    # both members' FINAL installment → SCHEMA_POOL_COMPLETE ⭐⭐ (Pass-3)
pnpm devnet:seed-claim    # slot 1 claims → SCHEMA_PAYOUT_CLAIMED
```

⭐⭐ **The `seed-cycle` log should include:**

```
ⓘ final installment → POOL_COMPLETE (schema=4)
```

for each member. The on-chain attestation is derived with schema_id=4
(POOL_COMPLETE under the new semantics — Pass-3 reused id 4 from
CYCLE_COMPLETE), and the reputation profile's `cycles_completed`
**should bump by 1** (the new semantic) AND score `+50`.

## Step 6 — Backfill + score

```bash
ROUNDFI_REPUTATION_PROGRAM_ID=$ROUNDFI_REPUTATION_PROGRAM_ID \
  pnpm --filter @roundfi/indexer backfill
```

`backfill` reads pools + members FIRST, then attestations (the member
FK resolves cleanly without a separate `ingest` step). Expected log:

```
{"event_type":"backfill_attestations_fetched","count":N}
{"event_type":"backfill_attestations_complete","attestationsTouched":N}
```

`N` is the cluster-wide attestation count (≥ 6 from this demo: 2
PAYMENTs cycle 0 + 2 POOL_COMPLETEs cycle 1 + 2 PAYOUT_CLAIMEDs, plus
any from prior pools).

```bash
pnpm --filter @roundfi/indexer dev    # terminal 1 — :8787
# terminal 2 — replace <member0> with the pubkey seed-members printed
curl -s http://localhost:8787/score/<member0> | jq
```

⭐⭐⭐ **The final Pass-3 proof.** A fresh wallet's `classification_counts`
is exactly:

```json
{ "payment_early": 1, "pool_complete": 1, "payout_claimed": 1 }
```

with `polarity_counts` putting **`payout_claimed` in the `neutral`
bucket** — that's the whole point of Pass-3: the claim no longer scores
`+50`; the completion credit moved to `pool_complete` on the final
installment. Under the old taxonomy the claim was `CYCLE_COMPLETE`
(positive, `+50`).

> A **reused** wallet (see the geometry caveat) also shows
> `unspecified: K` from prior-pool attestations in legacy payload
> format — neutral polarity, so the proof still holds, but `event_count`
> is `3 + K`. The 2026-06-12 validation run on reused wallets returned
> `payment_early:1, pool_complete:1, payout_claimed:1, unspecified:5`
> with `polarity_counts {positive:2, neutral:6, negative:0}` — the three
> Pass-3 classes all correctly bucketed.

If the seed-cycle ran LATE on cycle 0 (you skipped the 24h wait), the
member's first event is `LATE` (-100) and only the POOL_COMPLETE (+50)
follows — reliability is lower but the **structural Pass-3 proof
still lands**.

## Troubleshooting

| Symptom                                            | Cause                                                | Fix                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `AccountDidNotDeserialize (3003)` on any ix        | ProtocolConfig is pre-Jun layout (317 bytes)         | `pnpm devnet:migrate-config`                                                                    |
| `InvalidCycleDuration (6033)` on create_pool       | Old `CYCLE_DURATION_SEC=60`                          | `export CYCLE_DURATION_SEC=86400`                                                               |
| `PoolNotViable (6072)` on create_pool              | `members × installment × 0.74 < credit`              | Bump `INSTALLMENT_AMOUNT_USDC`                                                                  |
| `cycles_total != members_target` revert            | Mismatched env                                       | Set both equal: `MEMBERS_TARGET=2 CYCLES_TOTAL=2`                                               |
| `ConstraintSeeds (2006)` on contribute final cycle | Schema mismatch (seed-cycle didn't escalate)         | Pull latest `seed-cycle.ts` — the env-configurable version auto-escalates the final installment |
| `ConstraintSeeds (2006)` on claim                  | Schema mismatch (seed-claim used old CYCLE_COMPLETE) | Pull latest `seed-claim.ts` — uses PAYOUT_CLAIMED                                               |

## What's deferred

- Same-pool default → `seed-default` exercise. The Pass-3 changes
  didn't touch the DEFAULT schema; the May script works.
- Yield Cascade demo (`seed-yield-*`). Independent of Pass-3.
- Escape Valve demo (`seed-evlist` + `seed-evbuy`). Independent of Pass-3.
