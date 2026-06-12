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
without burning unnecessary devnet USDC:

| Param                     | Value | Why                                                                    |
| ------------------------- | ----: | ---------------------------------------------------------------------- |
| `MEMBERS_TARGET`          |     2 | Smallest that satisfies `cycles_total == members_target` AND Seed Draw |
| `CYCLES_TOTAL`            |     2 | Forced equal to `MEMBERS_TARGET`                                       |
| `INSTALLMENT_AMOUNT_USDC` |    21 | `2 × 21 × 0.74 = 31.08 ≥ 30 credit` ✓                                  |
| `CREDIT_AMOUNT_USDC`      |    30 | Default; the carta size                                                |
| `CYCLE_DURATION_SEC`      | 86400 | On-chain MIN                                                           |
| `POOL_SEED_ID`            |    42 | Any value ≠ existing pools (1, 2, 3 are May fixtures)                  |

**Total USDC required:** 2 members × (1 stake 15 + 2 installments 21) =
`2 × 57 = 114 USDC` net of carry-over from claims. Realistically each
member needs ~57 USDC funded once; the claim returns the credit (30) to
the winner. **You'll need ~12 hits on `faucet.circle.com`** (10 USDC per
hit per address) — 6 hits per member.

> Want fewer USDC hits? Bump `MEMBERS_TARGET=3 INSTALLMENT_AMOUNT_USDC=15`
> (180 USDC total). The faucet rate-limit decides which is faster.

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

## Step 2 — Members + USDC funding

```bash
pnpm devnet:seed-members
```

The script prints the 2 member wallets and exits if USDC is short:

```
member 0 USDC: 0.00 (need 15.00) ⚠ insufficient — fund via https://faucet.circle.com
member 1 USDC: 0.00 (need 15.00) ⚠ insufficient — fund via https://faucet.circle.com
```

**Open https://faucet.circle.com in a browser**, paste each member
pubkey, and request 10 USDC per hit. With `INSTALLMENT=21`, each member
needs **57 USDC** = 6 hits (rate-limited; spread across faucet sessions
if needed).

When all members have `≥ 57 USDC`, re-run:

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

Expected log:

```
{"event_type":"backfill_attestations_complete","attestationsTouched":N}
```

`N` should be ≥ 6 (2 PAYMENTs cycle 0 + 2 POOL_COMPLETEs cycle 1 + 2
PAYOUT_CLAIMEDs).

```bash
pnpm --filter @roundfi/indexer dev    # terminal 1 — :8787
# terminal 2 — replace <member0> with the pubkey seed-members printed
curl -s http://localhost:8787/score/<member0> | jq
```

⭐⭐⭐ **The final Pass-3 proof:** the JSON should contain
`classification_counts` with `pool_complete` and `payout_claimed` —
the new Pass-3 taxonomy. Reliability should reflect 1 PAYMENT (+10) +
1 POOL_COMPLETE (+50, in the reputation arithmetic) for the
on-time-then-final-payment member.

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
