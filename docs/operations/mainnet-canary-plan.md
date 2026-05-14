# Mainnet Canary Plan

> **What this is.** The plan for the first-ever mainnet `roundfi-core` write: a size-1 canary pool where the deployer self-pools, runs through every M3 instruction with real USDC, and proves mainnet conditions match devnet behavior **before** any retail pools open.
>
> **Why we need it.** Devnet validates the protocol against patched constants (`GRACE_PERIOD_SECS=60` instead of 7 days, mock yield adapter, low-jitter local clock). Mainnet runs with: real Kamino reserves, real mpl-core mainnet program, real USDC mint, real validator scheduling, real Jito searcher activity. A self-pool canary surfaces any drift before user funds are at stake.
>
> **Authoritative.** This is the source-of-truth runbook for mainnet day 1. The companion script (`scripts/mainnet/canary-flow.ts`) implements it; the post-run report template (`docs/operations/mainnet-canary-report-template.md`) captures the outcome.

**Status:** 🟡 plan written, run is hard-gated on audit clear (#267), multi-sig migration (#266), Agave 2.x toolchain (#230), Kamino harvest path (#233), legal counsel (#268).

**Tracks:** [#292](https://github.com/alrimarleskovar/RoundFinancial/issues/292). Mirrors `MAINNET_READINESS.md` §4.1 + §4.7.

---

## 1. Goal

Validate every active M3 protocol instruction against **real mainnet conditions** end-to-end before retail-facing pools open:

- `initialize_protocol` (one-time across protocol lifetime)
- `create_pool`
- `init_pool_vaults`
- `join_pool` (deployer joins their own pool — slot 0)
- `contribute` (1 cycle — solo)
- `claim_payout` (the deployer is also the sole recipient)
- `release_escrow` (since the member paid on-time, escrow vests)
- `close_pool` (balanced summary: `total_contributed == total_paid_out`)

Plus the yield branch if Kamino harvest path (#233) lands before canary:

- `deposit_idle_to_yield` × 1
- `harvest_yield` × 1 (with real Kamino reserve, slippage guard armed)

The canary is **not** a stress test. It's a smoke test that confirms the same code that's green on devnet works against mainnet's actual programs and validator clock.

---

## 2. Pool shape

| Field            | Value                                                     |
| ---------------- | --------------------------------------------------------- |
| Members          | 1 (the deployer self-pools)                               |
| Cycles           | 1                                                         |
| `credit_amount`  | $5 USDC                                                   |
| `installment`    | $5 USDC                                                   |
| Stake (Lv1, 50%) | $2.50 USDC                                                |
| Cycle duration   | 60 seconds (devnet patch retained for canary)             |
| Yield adapter    | Mock first; Kamino canonical USDC reserve once #233 ships |
| Pool authority   | Squads multi-sig PDA (post-#266) — **NOT** single keypair |
| Treasury         | Squads multi-sig PDA (post-#266)                          |

**Why 1 member.** Smallest possible TVL ($2.50 stake + $5 contribution = $7.50 protocol-side at peak). If anything goes wrong, the loss is bounded by lunch money. The protocol's invariants are exercised the same — 1 member is enough to fire Triple Shield, the waterfall, and the close_pool balance check.

**Why 1 cycle.** Smallest possible lifecycle that still exercises `claim_payout` + `release_escrow` + `close_pool`. A 2-cycle canary doubles wait time without exposing any new code path.

**Why 60s cycle duration.** Same as Pool 3 on devnet (`docs/devnet-deployment.md`). Lets the full sequence run in <5 minutes end-to-end. Mainnet GRACE_PERIOD_SECS reverts to 7d for retail pools; the canary patch is deliberately documented.

---

## 3. Pre-flight checklist

ALL items must be ✅ before running `scripts/mainnet/canary-flow.ts`. The script's preflight gate enforces these (refuses to proceed if any are missing).

### 3.1 Off-chain authorizations

- [ ] **External audit clear** — Adevar Labs / Halborn / Ottersec / Sec3 sign-off documented at `docs/security/audit-report-<firm>.pdf` ([#267](https://github.com/alrimarleskovar/RoundFinancial/issues/267))
- [ ] **Audit remediation re-review** — fixes for High/Critical findings re-audited (MAINNET_READINESS.md §1.7)
- [ ] **Legal counsel opinion BR + US** — written opinions covering LGPD + Bacen + CFTC ([#268](https://github.com/alrimarleskovar/RoundFinancial/issues/268))
- [ ] **DPIA filed** if BR launch — [#274](https://github.com/alrimarleskovar/RoundFinancial/issues/274)
- [ ] **Bug bounty live** on Immunefi / HackenProof — $50k initial pool (MAINNET_READINESS.md §1.8)
- [ ] **Privacy Policy + ToS published** — [#275](https://github.com/alrimarleskovar/RoundFinancial/issues/275)

### 3.2 On-chain prerequisites

- [ ] **Agave 2.x toolchain migration complete** — [#230](https://github.com/alrimarleskovar/RoundFinancial/issues/230). All 4 programs rebuilt + bytecode-attested under the new toolchain.
- [ ] **Squads multi-sig deployed** — 3-of-5 signer set, signers from at least 3 different geographies ([#266](https://github.com/alrimarleskovar/RoundFinancial/issues/266))
- [ ] **Upgrade authority rotated** to Squads PDA on all 4 mainnet programs (`roundfi-core`, `roundfi-reputation`, `roundfi-yield-mock`, `roundfi-yield-kamino`) — verify with `solana program show <id>`
- [ ] **Treasury authority on Squads PDA** — via `propose_new_treasury` → 7-day timelock → `commit_new_treasury` cycle (MAINNET_READINESS.md §3.7)
- [ ] **OtterSec verify-build attestation refreshed** on mainnet for all 4 programs post-deployment
- [ ] **`config.metaplex_core` pinned to mainnet mpl-core program** (`CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` — same as devnet but verify on-chain)
- [ ] **Kamino canonical USDC reserve allowlisted** in `config.yield_adapter_program` ([#233](https://github.com/alrimarleskovar/RoundFinancial/issues/233))
- [ ] **Mainnet USDC mint pinned** (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) — sanity check via `solana account`

### 3.3 Operational prerequisites

- [ ] **Monitoring stack live** — Grafana / Datadog / equivalent ([#271](https://github.com/alrimarleskovar/RoundFinancial/issues/271)). Per-instruction transaction count + Triple Shield error rate dashboards green.
- [ ] **PagerDuty rotation defined** — primary + secondary on-call for the 7-day soak window
- [ ] **CD pipeline approved + tested** — staging deploy via [#272](https://github.com/alrimarleskovar/RoundFinancial/issues/272) rehearsed at least once
- [ ] **Front-end mainnet hardening complete** — devnet/mainnet visual banner, RPC pinning, allowlist tests ([#249](https://github.com/alrimarleskovar/RoundFinancial/issues/249))
- [ ] **Indexer deployed + caught up** — finality gate active, RPC quorum active, reconciler running
- [ ] **Emergency-response runbook reviewed** by all on-call — [`emergency-response.md`](./emergency-response.md)
- [ ] **Pause-rehearsal completed** on mainnet (a real pause + unpause cycle with no canary impact)

### 3.4 Pre-flight test sequence (10 minutes, no protocol writes)

Before any canary write, the script runs read-only checks:

1. `solana cluster-version` → must return `mainnet-beta`
2. `getAccountInfo(config.protocol_config_pda)` → confirm `paused=false`
3. `getAccountInfo(usdc_mainnet_mint)` → confirm decimals = 6, supply > 0 (not a localnet clone)
4. `getAccountInfo(MPL_CORE_PROGRAM)` → confirm not `executable=false`
5. `getAccountInfo(KAMINO_USDC_RESERVE)` → confirm reserve is initialized + has liquidity
6. Deployer wallet SOL balance ≥ 0.5 SOL (covers 8 txs + headroom)
7. Deployer wallet USDC balance ≥ $10 (canary needs $7.50, padded for slippage)

If any check fails, abort with a clear message. Do not proceed.

---

## 4. Sequence

The script (`scripts/mainnet/canary-flow.ts`) is **idempotent**: each step checks if the on-chain state already reflects completion before re-running. A partial run can resume from where it left off.

### Step 1 — `initialize_protocol` (if not already done)

Already a one-time per-cluster setup. The script reads `ProtocolConfig` and skips this if the PDA exists and `authority == squads_pda`. If the PDA exists with a wrong authority, **abort** — manual intervention required (the deployer should NOT silently rotate).

Expected new state:

- `ProtocolConfig.paused == false`
- `ProtocolConfig.authority == squads_pda`
- `ProtocolConfig.treasury == squads_pda`

### Step 2 — `create_pool`

Submit `create_pool({ seed_id: 1, member_target: 1, cycles_total: 1, credit_amount: 5_000_000, installment_amount: 5_000_000, cycle_duration: 60 })`.

Expected new state:

- Pool PDA exists with `status == Forming`, `current_cycle == 0`, `cycles_total == 1`
- Pool PDA `pool.authority == squads_pda` (the create_pool tx must be signed by Squads)

**Multi-sig path.** `create_pool` is admin-gated. The script generates the tx but **does not** auto-submit it; the operator hands the tx to the Squads UI for the 3-of-5 approval flow. Once executed, the script polls for the Pool PDA and continues.

### Step 3 — `init_pool_vaults`

Submit `init_pool_vaults` to initialize the 4 vault ATAs (pool / escrow / solidarity / yield).

Expected new state:

- 4 USDC ATAs initialized for the pool's vault authority PDAs

### Step 4 — `join_pool` (deployer self-joins)

Submit `join_pool({ stake_amount: 2_500_000 })`. Deployer's wallet signs (this is _not_ admin-gated — it's a regular member join).

Expected new state:

- Member PDA at `(pool, deployer_wallet)` exists with `slot_index == 0`, `stake_deposited == 2_500_000`, `defaulted == false`
- Position NFT minted to deployer's wallet (frozen)
- Pool's `members_joined == 1`, `status == Active` (transitions when `members_joined == members_target`)

Wait for `pool.status == Active` before continuing.

### Step 5 — `contribute` cycle 0

Submit `contribute({ cycle: 0 })`. Deployer signs. Should be flagged on-time (the script runs all steps within the cycle window).

Expected new state:

- `Member.contributions_paid == 1`, `Member.on_time_count == 1`
- `Member.escrow_balance += $1.25` (25% of $5 installment)
- `Solidarity vault += $0.05` (1%)
- `Pool USDC vault += $3.70` (74%)
- Attestation PDA written under `SCHEMA_PAYMENT`

### Step 6 — `claim_payout` cycle 0 / slot 0

Submit `claim_payout({ cycle: 0 })`. Deployer signs (they are the slot-0 member).

**Solvency check ahead of time.** Pool USDC vault holds $3.70 from the contribution. `claim_payout` needs $5. The shortfall ($1.30) must be pre-floated from the deployer wallet via a separate top-up tx in the same cycle. The script does this automatically.

Expected new state:

- Pool USDC vault transfers $5 to deployer ATA
- `Member.paid_out == true`
- `pool.current_cycle` advances 0 → 1; but since `cycles_total == 1`, the handler sets `pool.status = Completed` instead

### Step 7 — `release_escrow` checkpoint 1

Submit `release_escrow({ checkpoint: 1 })`. Deployer signs.

Expected new state:

- $1.25 transferred from escrow vault to deployer ATA (full escrow released since cycle 1 / cycles_total 1 = 100%)
- `Member.last_released_checkpoint == 1`
- `Member.escrow_balance == 0`

### Step 8 (optional) — Yield branch

If [#233 Kamino harvest path](https://github.com/alrimarleskovar/RoundFinancial/issues/233) has shipped:

- Submit `deposit_idle_to_yield({ amount: ... })` — moves any idle pool float to Kamino
- Wait at least 10 minutes for accrued yield
- Submit `harvest_yield({ min_realized_usdc: 1 })` — slippage guard armed at $0.000001 (effectively just non-zero)
- Verify waterfall buckets per `roundfi-math/waterfall.rs` (20% protocol fee → treasury, 65% LP, 35% participants, 0% GF for Lv1)

If #233 has NOT shipped, the canary skips this step and the report records "harvest path deferred" — but every other M3 instruction still exercises.

### Step 9 — `close_pool`

Squads-signed close_pool tx. After step 6 set `pool.status = Completed`, the pool can be closed.

Expected new state + balanced summary log:

```
roundfi-core: close_pool summary
  pool=<addr>
  total_contributed=5_000_000  (= $5.00)
  total_paid_out=5_000_000     (= $5.00)
  cycles_total=1
  members_joined=1
```

The balance must match. If `total_contributed != total_paid_out`, **STOP** — protocol invariant violation. File a critical incident.

---

## 5. Acceptance criteria

Canary is **green** when:

- [ ] All 7 (or 9 if yield) steps land on mainnet with `confirmed` transaction status
- [ ] Every step's expected post-state assertion passes (the script does these checks automatically and aborts on mismatch)
- [ ] `close_pool` emits the balanced summary log (`total_contributed == total_paid_out == $5`)
- [ ] OtterSec verify-build attestation PDAs still resolve correctly after the run (no bytecode mismatch detected mid-canary)
- [ ] Indexer reconciler reports zero `_unresolved` rows for any canary-related event
- [ ] No PagerDuty alerts fired during the canary window
- [ ] No Triple Shield error firings (`WaterfallUnderflow`, `EscrowLocked`, `SettleDefaultGracePeriodNotElapsed`, `AssetNotRefrozen`) outside the deliberately-tested negative paths

Once green, capture the post-run report (template at `docs/operations/mainnet-canary-report-template.md`) and commit to `docs/operations/mainnet-canary-report.md`.

---

## 6. Kill criteria (during canary)

Halt the canary and **revert to paused state** if any of the following:

| Trigger                                                                                                              | Action                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Any tx fails with `MathOverflow`, `WaterfallNotConserved`                                                            | Pause protocol via Squads; file critical incident                                |
| `total_contributed != total_paid_out` on close                                                                       | Pause; file critical; treat as Triple Shield bypass until investigated           |
| OtterSec verify-build PDA mismatch detected post-step                                                                | Pause; emergency response runbook; do not retry until bytecode verified          |
| Indexer reports `_unresolved` events for >5 minutes                                                                  | Pause; investigate (likely reorg or RPC partition); fallback to direct RPC reads |
| Deployer wallet drained beyond canary budget                                                                         | Pause; investigate (possible front-running or unexpected fee bump)               |
| Real Kamino reserve responds with non-zero but unexpected `realized` value (>10% deviation from `min_realized_usdc`) | Pause harvest; investigate; out of #233 scope                                    |

Pause is via the existing `pause(true)` instruction (Squads-signed). Mass user impact: zero (canary is solo-deployer).

---

## 7. 7-day soak window

After the canary completes green, retail pools do **not** open immediately. Soak for **7 calendar days** to surface:

- Indexer rollover under fresh state
- Long-running monitoring infrastructure (alerts that only fire over multi-day windows)
- Any latent bug that needs > 1 cycle to manifest (escrow vesting math over a longer period, etc.)
- Audit firm review of canary report (give the auditor 5 business days)

During soak:

- Protocol stays in `paused == false` but no new pools open
- Monitoring stays green
- Daily check-ins logged to `docs/operations/mainnet-canary-soak-log.md`

If any day surfaces an issue, the soak window restarts at day 1.

---

## 8. Retail-pool ramp post-soak

Only after the 7-day soak completes green:

| Phase   | TVL cap   | Pool count cap | Window       |
| ------- | --------- | -------------- | ------------ |
| Wave 1  | $1,000    | 1 pool         | 7 days       |
| Wave 2  | $10,000   | 3 pools        | 14 days      |
| Wave 3  | $50,000   | 10 pools       | 30 days      |
| Wave 4+ | Unbounded | Unbounded      | After Wave 3 |

The protocol-level TVL cap (MAINNET_READINESS.md §4.3) enforces this on-chain. Per-pool TVL cap (§4.2) clamps single-pool exposure.

---

## 9. Roles & responsibilities

| Role               | Person / function                                                   |
| ------------------ | ------------------------------------------------------------------- |
| Canary operator    | Lead engineer; drives the script + Squads UI flow                   |
| Squads signers     | 3-of-5 multi-sig signers (per #266 setup)                           |
| Incident commander | On-call primary for the 7-day soak                                  |
| Audit liaison      | Contact at Adevar Labs / chosen firm for canary-report review       |
| Comms              | Founder / external comms for any user-facing messaging (Discord, X) |

---

## 10. References

- [`MAINNET_READINESS.md`](../../MAINNET_READINESS.md) §4 — canary phase checklist
- [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md) — formal audit scope + mainnet timeline
- [`docs/operations/emergency-response.md`](./emergency-response.md) — pause + escalation procedures
- [`docs/operations/deploy-runbook.md`](./deploy-runbook.md) — per-program deploy procedure
- [`docs/operations/key-rotation.md`](./key-rotation.md) — multi-sig rotation procedure (#266)
- [`docs/security/mev-front-running.md`](../security/mev-front-running.md) — MEV surface analysis for canary scenarios
- [`docs/security/bug-bounty.md`](../security/bug-bounty.md) — bug bounty severity scale for any canary-window finding
- [`scripts/mainnet/canary-flow.ts`](../../scripts/mainnet/canary-flow.ts) — companion script
- [`docs/operations/mainnet-canary-report-template.md`](./mainnet-canary-report-template.md) — post-run report template
- Issue [#292](https://github.com/alrimarleskovar/RoundFinancial/issues/292) — this plan

---

_Last updated: May 2026. Run is gated on #266 + #267 + #230 + #233 + #268. Operator: not yet assigned._
