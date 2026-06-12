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

# Geometry — set once, every seed-* respects these. Low-budget /
# faucet-blocked values (see "Demo geometry"); zero faucet hits.
export POOL_SEED_ID=43
export MEMBERS_TARGET=2
export CYCLES_TOTAL=2
export CREDIT_AMOUNT_USDC=4
export INSTALLMENT_AMOUNT_USDC=3
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
| `ConstraintMut (2000)` on `config` in close_pool   | `seed-close` passed config read-only                 | Fixed in #471 — config is `mut` (handler decrements committed TVL)                              |

## Close the pool (terminal state)

After the final claim flips the pool to `Completed`, close it:

```bash
pnpm devnet:seed-close      # Completed → Closed (POOL_SEED_ID must match)
```

Moves no funds — pure terminal transition that decrements
`committed_protocol_tvl_usdc` (symmetric with init_pool_vaults) and sets
`status = Closed`. Single-shot: a second call reverts (PoolNotCompleted).
Validated 2026-06-12 on pool `Ga2RwgSk…` — the full lifecycle is then
Forming → Active → Completed → Closed.

## Yield Cascade demo (validated 2026-06-12, pool `4SZCKeQL…`)

Independent of Pass-3. Needs a **separate Active pool with float** (a
Closed pool can't deposit — `deposit_idle_to_yield` requires
`status == Active`). Build a fresh pool through Step 3's `seed-cycle`
(no claim — claiming would advance/complete the pool), then:

```bash
export YIELD_DEPOSIT_USDC=4     # must be ≤ pool_usdc_vault float
                                # (1 cycle of 2× installment-3 = 4.44 float)
pnpm devnet:seed-yield-init     # YieldVaultState PDA + vault ATA (roundfi-yield-mock)
pnpm devnet:seed-yield-deposit  # float → yield vault + YIELD_PREFUND_USDC (0.5) simulated yield
pnpm devnet:seed-yield-harvest  # realize surplus through the waterfall
```

The harvest waterfall on the realized surplus (e.g. 0.5 USDC):

- **Protocol fee** `DEFAULT_FEE_BPS_YIELD` = 20% → `treasury_usdc`
  (the only physical outflow; `treasury_usdc.key()` must equal
  `config.treasury`, which the script reads from
  `program-ids.devnet.json::initialized.treasuryAta`).
- **Guarantee Fund** + **LP slice** (`config.lp_share_bps`, 65%) →
  logical earmarks on `pool.guarantee_fund_balance` /
  `pool.lp_distribution_balance` (no physical transfer).
- **Residual** ("prêmio de paciência") stays in `pool_usdc_vault`.

So `pool_usdc_vault` nets `+realized − protocol_fee`. The slippage floor
is computed from the live on-chain surplus
(`yield_vault.amount − tracked_principal`) × `(1 − tolerance_bps)`, so
`realized ≥ floor` holds for the mock (which returns the full surplus).
The three yield scripts carried **no May→Jun drift** — they ran as-is.

## Escape Valve demo (validated 2026-06-12, pool `4SZCKeQL…`)

Secondary market for ROSCA positions. Runs on any **Active pool with
positions** — reuse the Yield Cascade pool (still Active, both members
hold their slot NFTs). The direct `escape_valve_list` path is still
wired in `lib.rs` (the newer `escape_valve_list_commit` + `_reveal`
anti-MEV flow is an _alternative_, not a replacement), so the May seed
scripts run as-is — **no drift**.

```bash
export EVLIST_SLOT_INDEX=1      # seller = slot 1 = member-1.json
export EVLIST_PRICE_USDC=2      # small for a credit=4 pool (default 14 is for credit=30)
export EVBUY_SLOT_INDEX=1       # must match the listing slot

pnpm devnet:seed-evlist         # member 1 lists slot 1 (creates EscapeValveListing PDA)
pnpm devnet:seed-evbuy          # fresh buyer (deployer-funded) buys
```

Eligibility (on `escape_valve_list`): pool Active, member not defaulted,
not behind (`contributions_paid ≥ pool.current_cycle`), no existing
active listing for the slot.

`seed-evbuy` is **self-funding** — it generates a fresh buyer wallet
(`keypairs/evbuy-pool{N}-slot{S}.json`), tops up its SOL + the price in
USDC from the deployer (only falls back to the faucet if the _deployer_
is short), then `escape_valve_buy` does it all in one tx:

1. Transfers `price_usdc` buyer → seller.
2. Closes the seller's Member PDA, creates the buyer's with the seller's
   snapshot carried over verbatim (`contributions_paid`,
   `escrow_balance`, `slot_index`).
3. Thaws → transfers → re-freezes the position NFT (3 mpl-core CPIs
   signed by the slot's `position_authority` PDA).
4. Closes the listing.

Validated run: member 1 (`Bb3EXaq9…`) listed slot 1 at 2 USDC; fresh
buyer `J1fJVSF7…` paid 2 USDC (seller 5 → 7), inherited Member PDA
`DQacU3Pm…` + NFT `EY5WLu5n…`. The 15-account `escape_valve_buy` ix was
already aligned with the Jun program — no client changes.

### Commit-reveal variant (anti-MEV, #232)

The seller can hide the price until a reveal step that arms a 30s
anti-snipe cooldown — `seed-evlist-commit` (written this session; the
direct path had a script, this one didn't) runs both halves:

```bash
export POOL_SEED_ID=44
export EVLIST_SLOT_INDEX=0      # seller = slot 0 = member-0.json
export EVLIST_PRICE_USDC=2
pnpm devnet:seed-evlist-commit  # commit (Pending, price hidden) + reveal (Active, +30s cooldown)
# wait ~30s
EVBUY_SLOT_INDEX=0 POOL_SEED_ID=44 pnpm devnet:seed-evbuy
```

- **commit:** `escape_valve_list_commit(commit_hash)` stores only
  `SHA-256(price.to_le_bytes() ‖ salt.to_le_bytes())` (salt is a
  crypto-random non-zero u64 — `salt = 0` is rejected on reveal,
  SEV-013). Listing is `Pending`, `price_usdc = 0` on-chain.
- **reveal:** `escape_valve_list_reveal(price, salt)` recomputes the
  hash, asserts it matches (any price change → `InvalidCommitHash`),
  publishes the price, flips to `Active`, sets
  `buyable_after = now + REVEAL_COOLDOWN_SECS` (30s).
- **buy:** `escape_valve_buy` enforces `now ≥ buyable_after` —
  reverts `ListingNotBuyableYet` inside the window. The legitimate
  buyer, already holding (price, salt) off-chain, lands at the boundary
  ahead of any searcher reacting to the just-public price.

Validated run: member 0 (`7RvpGyDP…`) committed
`d806aa15…` then revealed price 2 / salt `1553749233912736511`; after the
cooldown a fresh buyer (`7BUQ8nX2…`) bought slot 0 (seller 4 → 6),
inheriting Member PDA `7ku1hKcb…` + NFT `HgCqnixu…`. The client-side
hash matched the on-chain recomputation byte-for-byte (the reveal would
revert `InvalidCommitHash` otherwise).

## Escrow vesting demo (validated 2026-06-12, pool `4SZCKeQL…`)

`release_escrow` lets an **on-time** member progressively vest their
stake back out of the escrow vault — the positive arm of the "Triple
Shield". `seed-release` is dual-path: it reads the member's
`on_time_count` and runs the positive path (release succeeds) when
`on_time_count ≥ checkpoint`, or the negative path (lands a reverted
`EscrowLocked` tx as durable evidence) when the member paid late.

```bash
export POOL_SEED_ID=44          # an Active pool whose member 0 paid on-time
unset MEMBER_INDEX_OFFSET       # target member-0.json (TARGET_SLOT_INDEX=0)
pnpm devnet:seed-release        # checkpoint 1
```

On-chain guard (`release_escrow.rs`): `member.on_time_count ≥
args.checkpoint`, `checkpoint ≤ pool.current_cycle + 1`, `checkpoint >
last_released_checkpoint`, member not defaulted, protocol not paused.
No status gate — works on any Active pool. The 9-account ix was already
aligned with the Jun program — no client changes.

Validated run: member 0 (`7RvpGyDP…`) had `on_time_count = 1`,
`escrow_balance = 2.75`; `release_escrow(1)` vested **1.00 USDC**
(half the 2.00 stake — 1 of 2 checkpoints) back to its ATA,
`escrow_balance 2.75 → 1.75`, `last_released_checkpoint 0 → 1`.
Checkpoint 2 needs `current_cycle` to advance (a claim) first.

## Default settlement — pool 45 ARMED 2026-06-12 (replay after grace)

The setup is done; only the multi-day grace wait remains. Pool 45
(`Hg9AkTCgNRNbVZqtZrHZpQbCuFeJnxDxhrJjUcW5TjZ9`) is a 3-member / 3-cycle
pool (credit 4, install 3) on fresh wallets `member-20/21/22`
(`MEMBER_INDEX_OFFSET=20`, no reputation carryover):

- slots 0+1 (`member-20/21`) contributed cycle 0; slot 0 claimed →
  `current_cycle = 1`. Float was `2 × 3 × 0.74 = 4.44 ≥ 4`, so the claim
  needed no top-up.
- **slot 2 (`member-22`, `6Ttytsby…`) never contributed** →
  `contributions_paid = 0 < current_cycle = 1` → behind, the defaulter.

`settle_default` needs `now ≥ next_cycle_at + GRACE_PERIOD_SECS`. After
the cycle-0 claim `next_cycle_at = 1781476051` (2026-06-14 22:27 UTC).
GRACE is cfg-gated (`constants.rs`), so the valid-from time is:

| Build             |         GRACE | settle_default valid from       |
| ----------------- | ------------: | ------------------------------- |
| `devnet-canary`   |  86 400 (1 d) | **2026-06-15 22:27 UTC** (~3 d) |
| default / mainnet | 604 800 (7 d) | **2026-06-21 22:27 UTC** (~9 d) |

We don't know which the deployed binary is — try the canary timing
first; if the on-chain reverts on grace, it's the 7-day build.

**Replay (after the grace window):**

```bash
git checkout claude/devnet-seed-default-grace-fix   # or main, once merged
export POOL_SEED_ID=45
export MEMBER_INDEX_OFFSET=20
GRACE_PERIOD_SECS=86400 DEFAULT_SLOT_INDEX=2 pnpm devnet:seed-default
```

`seed-default` seizes (Triple Shield order) solidarity vault → member 22's
escrow → stake to cover the missed installment, flips
`member.defaulted = true`, and fires a `SCHEMA_DEFAULT` (id 3)
reputation attestation. The 18-account ix was verified aligned; the only
client fix this needed was the stale 60s grace constant (this branch).
