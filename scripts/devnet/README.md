# Devnet seed scripts

> **What this is.** TypeScript orchestrators that exercise every fund-movement instruction on `roundfi-core` against a real devnet pool. Each script is idempotent (re-running is safe), deterministic (same seed → same PDAs), and prints Solscan URLs so any reviewer can verify the on-chain effect.
>
> Used for: demo replays · operator dry-runs · regression-checking new bytecode after redeploys · the [pause-rehearsal](../../docs/operations/pause-rehearsal-procedure.md) drill's per-instruction verification step.

## Prerequisites

- `solana` CLI on PATH (Agave 3.0.0 toolchain)
- Deployer keypair at `~/.config/solana/id.json` (or `SOLANA_WALLET=/path` env override)
- Deployer balance ≥ 1 SOL devnet (`solana airdrop 5 --url devnet` if low)
- `pnpm install` ran successfully
- `pnpm devnet:init` once (initializes `ProtocolConfig` + `ReputationConfig` singletons — idempotent, but only needed the first time after a fresh deploy)

## Canonical flow (full ROSCA exercise)

Run in this order. Each step builds on the state from the previous one.

```bash
pnpm devnet:seed                    # 1. create_pool (3 members, $30 carta, 3 cycles, 60s cycle_duration)
pnpm devnet:seed-members            # 2. join_pool × 3 (each member stakes 15 USDC at Lv1)
pnpm devnet:seed-cycle              # 3. contribute × 3 (cycle 0 — all members pay their $10 installment)
pnpm devnet:seed-claim              # 4. claim_payout cycle 0 / slot 0 (winner receives $30 carta)
pnpm devnet:seed-release            # 5. release_escrow per member (vesting tranche unlocks)
pnpm devnet:seed-yield-init         # 6. init_vault on the yield adapter (mock by default)
pnpm devnet:seed-yield-deposit      # 7. deposit_idle_to_yield (parks pool float in the adapter)
pnpm devnet:seed-yield-harvest      # 8. harvest_yield (waterfall — protocol fee → GF → LPs → participants)
pnpm devnet:seed-topup              # 9. Adds $7.80 USDC to pool_usdc_vault — proxy for the Yield Cascade
                                    #    LP-distribution flow that would normally bridge this gap
pnpm devnet:seed-evlist             # 10. escape_valve_list — member 2 lists their slot for $5
pnpm devnet:seed-evbuy              # 11. escape_valve_buy — fresh buyer wallet buys the listing
pnpm devnet:seed-close              # 12. close_pool (after all cycles complete + no outstanding defaults)
```

### Alternative flow: settle_default

After steps 1-3, run **either** the happy path above **or** the default path:

```bash
pnpm devnet:seed-default            # settle_default with grace period elapsed —
                                    # drains solidarity vault first, then escrow, then stake;
                                    # writes SCHEMA_DEFAULT attestation PDA
```

The seed-default script is the **canonical Triple Shield exercise** — see [`docs/security/self-audit.md` §3.1](../../docs/security/self-audit.md#31-economic-invariants-triple-shield).

## Per-script reference

| Script                  | On-chain instruction(s)           | Pre-condition                                | Idempotent?                                                                 | Cost                        |
| ----------------------- | --------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- | --------------------------- |
| `seed-pool.ts`          | `create_pool` + 4 ATA inits       | Protocol initialized                         | ✅ — derives PDA with `seed_id=1`, prints "skipping" if exists              | ~0.04 SOL                   |
| `seed-members.ts`       | `join_pool` × 3                   | Pool exists, members have ≥ 15 USDC each     | ✅ — checks existing Member PDAs                                            | ~0.06 SOL                   |
| `seed-cycle.ts`         | `contribute` × N (for one cycle)  | Pool Active, members joined                  | ✅ — checks `cycle.contributions_paid == pool.current_cycle`                | ~0.005 SOL/member           |
| `seed-claim.ts`         | `claim_payout`                    | Cycle fully paid, slot member hasn't claimed | ✅ — checks `member.paid_out` flag                                          | ~0.003 SOL                  |
| `seed-release.ts`       | `release_escrow`                  | Vesting tranche elapsed                      | ✅ — checks `member.escrow_balance` vs vesting schedule                     | ~0.002 SOL/member           |
| `seed-yield-init.ts`    | `init_vault` (adapter-side)       | Pool exists, adapter program deployed        | ✅ — checks YieldVaultState PDA                                             | ~0.01 SOL                   |
| `seed-yield-deposit.ts` | `deposit_idle_to_yield`           | YieldVaultState initialized                  | ✅                                                                          | ~0.005 SOL                  |
| `seed-yield-harvest.ts` | `harvest_yield`                   | Yield adapter has tracked balance            | ✅ — short-circuits if `realized == 0`                                      | ~0.005 SOL                  |
| `seed-topup.ts`         | SPL transfer to `pool_usdc_vault` | Pool exists                                  | ✅ — just sends USDC                                                        | ~0.001 SOL (+ 7.80 USDC)    |
| `seed-evlist.ts`        | `escape_valve_list`               | Member is up-to-date on installments         | ✅ — checks `EscapeValveListing` PDA                                        | ~0.005 SOL                  |
| `seed-evbuy.ts`         | `escape_valve_buy`                | Listing exists, buyer has USDC               | ⚠️ — buyer must be a fresh wallet (PDA `[member, pool, buyer]` is one-shot) | ~0.005 SOL (+ listed price) |
| `seed-close.ts`         | `close_pool`                      | All cycles complete, no defaults             | ✅ — checks `pool.status == Completed`                                      | ~0.002 SOL                  |
| `seed-default.ts`       | `settle_default`                  | Grace period elapsed since missed cycle      | ⚠️ — one-way state change (member.defaulted=true)                           | ~0.005 SOL                  |
| `inspect-pool.ts`       | _(read-only)_                     | Pool exists                                  | ✅ — signs nothing, moves nothing                                           | free                        |
| `drive-pool.ts`         | orchestrates `contribute`+`claim` | Arrival-order pool, member keypairs on disk  | ✅ — reuses the idempotent primitives; stops at the first wall              | ~0.008 SOL/cycle            |

### Driving a stuck pool to term (`drive-pool.ts`)

A pool whose members are `keypairs/member-{N}.json` (script-seeded, not browser
wallets) can be pushed forward from the CLI. `drive-pool.ts` reads the chain,
auto-discovers the `MEMBER_INDEX_OFFSET` by matching local keypairs to on-chain
members, then loops **pay this cycle → claim (advance)** until the pool finishes
or hits a wall it can't pass (an underfunded float needing `settle_default`,
which is grace-gated — it prints the unlock time). Arrival-order only; sorteio
pools use the app's draw + Receber flow.

```bash
# preview the plan + discovered offset, sign nothing:
DRY_RUN=1 POOL_PDA=<pda> pnpm exec tsx scripts/devnet/drive-pool.ts
# actually drive it:
POOL_PDA=<pda> pnpm exec tsx scripts/devnet/drive-pool.ts
```

`POOL_PDA` (accepted by `inspect-pool`, `drive-pool`, and now `seed-cycle` /
`seed-claim`) targets a pool by address, so it works even when the pool's
authority isn't your local wallet — contribute/claim are signed by the member
keypairs, never the authority.

## Customization

Most scripts read params from env or have inline constants at the top:

| Env var                 | Used by           | Default                         |
| ----------------------- | ----------------- | ------------------------------- |
| `SOLANA_WALLET`         | All scripts       | `~/.config/solana/id.json`      |
| `ANCHOR_PROVIDER_URL`   | All scripts       | `https://api.devnet.solana.com` |
| `POOL_SEED_ID`          | `seed-pool.ts`    | `1`                             |
| `CYCLE_DURATION_SEC`    | `seed-pool.ts`    | `60` (minimum allowed)          |
| `MEMBER_COUNT`          | `seed-members.ts` | `3`                             |
| `SETTLE_DEFAULTER_SLOT` | `seed-default.ts` | `1`                             |

Bump `POOL_SEED_ID` to create additional pools on the same protocol — every script then targets the new pool's PDA without affecting Pool 1.

## Determinism

All Pool/Member/Listing PDAs are derived deterministically from:

- `seed_id` (env-configurable, default 1)
- The authority pubkey (the deployer wallet)
- The member wallets (saved to `keypairs/member-N.json` on first run; reused thereafter)

This means **same seed config + same machine → bit-identical PDAs + tx structure** across runs. Reviewers can clone the repo, set the same `POOL_SEED_ID`, and reproduce the canonical pool's full lifecycle.

The member wallets are deliberately committed in `keypairs/` (with the `.gitignore` carving out `keypairs/.gitkeep`) so the test fixtures travel with the repo. **These keypairs hold demo USDC on devnet only — not real assets, not for mainnet use.**

## Reset / fresh start

There's no destructive "reset" — Solana programs are append-only, and Pool state mutates monotonically forward. To start fresh:

1. Bump `POOL_SEED_ID` to a new value (e.g. `POOL_SEED_ID=2 pnpm devnet:seed`)
2. Run the chain from step 1 again — completely independent pool
3. Old pool stays addressable at its old PDA; no cleanup required

For demo recording: pick a clean `POOL_SEED_ID`, run the chain end-to-end, capture Solscan refs.

## Cross-links

- [`docs/devnet-deployment.md`](../../docs/devnet-deployment.md) — ledger of deployed program IDs + canonical tx Signatures from prior demo runs
- [`docs/operations/deploy-runbook.md`](../../docs/operations/deploy-runbook.md) — the deploy procedure these scripts run against
- [`docs/operations/pause-rehearsal-procedure.md`](../../docs/operations/pause-rehearsal-procedure.md) — uses several seed scripts to verify the pause gates fire
- [`docs/verified-build.md`](../../docs/verified-build.md) — reproducible-build flow (the bytecode these scripts call into)
