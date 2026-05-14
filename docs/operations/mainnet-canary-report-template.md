# Mainnet Canary Run — Post-Run Report (TEMPLATE)

> Copy this file to `docs/operations/mainnet-canary-report.md` after the canary runs and fill in every section. The template format must be preserved — the report is part of the public security record + may be cited by the auditor in their re-audit pass.

---

## TL;DR

- **Run date:** `_FILL_ME_` (UTC)
- **Operator:** `_FILL_ME_` (handle / wallet pubkey)
- **Squads signers present:** `_FILL_ME_/5`
- **Cluster:** mainnet-beta · RPC: `_FILL_ME_`
- **Bytecode commit:** `_FILL_ME_` (matches OtterSec verify-build attestation)
- **Outcome:** ✅ green / ⚠️ partial / ❌ aborted — `_FILL_ME_`
- **Total wall-clock duration:** `_FILL_ME_` minutes
- **Total fees paid (deployer SOL):** `_FILL_ME_` SOL

---

## Pre-flight gate

All 20+ items in [`mainnet-canary-plan.md` §3](./mainnet-canary-plan.md#3-pre-flight-checklist) were verified green at:

| Category              | All green? | Time verified | Notes                          |
| --------------------- | :--------: | ------------- | ------------------------------ |
| §3.1 Off-chain auths  |     ✅     | `_FILL_ME_`   | Audit report ref: `_FILL_ME_`  |
| §3.2 On-chain prereqs |     ✅     | `_FILL_ME_`   | Squads PDA: `_FILL_ME_`        |
| §3.3 Operational      |     ✅     | `_FILL_ME_`   | PagerDuty primary: `_FILL_ME_` |
| §3.4 Read-only checks |     ✅     | `_FILL_ME_`   | 7/7 passed in `canary-flow.ts` |

---

## Step-by-step results

| #   | Instruction                    | Tx hash                                        |   Status    | Wall-clock   | Notes                                                         |
| --- | ------------------------------ | ---------------------------------------------- | :---------: | ------------ | ------------------------------------------------------------- |
| 1   | `initialize_protocol`          | `_FILL_ME_` or "skipped (already initialized)" |     ✅      | `_FILL_ME_`s | Authority confirmed = Squads PDA                              |
| 2   | `create_pool`                  | `_FILL_ME_`                                    |     ✅      | `_FILL_ME_`s | Multi-sig: Squads tx ID `_FILL_ME_`, signers: `_FILL_ME_`     |
| 3   | `init_pool_vaults`             | `_FILL_ME_`                                    |     ✅      | `_FILL_ME_`s | 4 USDC ATAs initialized                                       |
| 4   | `join_pool`                    | `_FILL_ME_`                                    |     ✅      | `_FILL_ME_`s | Stake deposited: $2.50; Position NFT minted: `_FILL_ME_`      |
| 5   | `contribute(cycle=0)`          | `_FILL_ME_`                                    |     ✅      | `_FILL_ME_`s | On-time: yes/no (`clock.unix_timestamp` vs `next_cycle_at`)   |
| 6a  | Pre-claim top-up               | `_FILL_ME_`                                    |     ✅      | `_FILL_ME_`s | $1.30 from deployer to pool USDC vault                        |
| 6b  | `claim_payout(cycle=0)`        | `_FILL_ME_`                                    |     ✅      | `_FILL_ME_`s | `pool.status` transitioned `Active` → `Completed`             |
| 7   | `release_escrow(checkpoint=1)` | `_FILL_ME_`                                    |     ✅      | `_FILL_ME_`s | $1.25 escrow released; `last_released_checkpoint` = 1         |
| 8a  | `deposit_idle_to_yield`        | `_FILL_ME_` or "skipped (#233 not landed)"     | `_FILL_ME_` | `_FILL_ME_`s | If present: amount + Kamino reserve                           |
| 8b  | `harvest_yield`                | `_FILL_ME_` or "skipped"                       | `_FILL_ME_` | `_FILL_ME_`s | `realized` = `_FILL_ME_`; slippage guard armed at `_FILL_ME_` |
| 9   | `close_pool`                   | `_FILL_ME_`                                    |     ✅      | `_FILL_ME_`s | Balanced summary: total_contributed = total_paid_out = $5     |

### Step assertions passed

For each step, post-state assertions ran automatically per the canary script. Confirm here:

- [ ] Step 2 — Pool PDA exists with `status == Forming`, `current_cycle == 0`
- [ ] Step 3 — 4 USDC vault ATAs exist
- [ ] Step 4 — Member PDA at `(pool, deployer)` exists, `slot_index == 0`, `stake_deposited == 2_500_000`
- [ ] Step 5 — `Member.contributions_paid == 1`, `Member.on_time_count == 1`
- [ ] Step 6b — `Member.paid_out == true`, `pool.status == Completed`
- [ ] Step 7 — `Member.escrow_balance == 0`, `Member.last_released_checkpoint == 1`
- [ ] Step 9 — `close_pool` summary log: `total_contributed == total_paid_out`

---

## Triple Shield guards observed

Even though the canary is the happy path, document any error firings (expected or unexpected):

- [ ] `WaterfallUnderflow` — _expected: 0; observed: `\_FILL_ME_`\_
- [ ] `EscrowLocked` — _expected: 0; observed: `\_FILL_ME_`\_
- [ ] `SettleDefaultGracePeriodNotElapsed` — _expected: 0 (no default in canary); observed: `\_FILL_ME_`\_
- [ ] `AssetNotRefrozen` — _expected: 0; observed: `\_FILL_ME_`\_
- [ ] `HarvestSlippageExceeded` — _expected: 0; observed: `\_FILL_ME_`\_

If any unexpected firings: file critical incident, abort canary, do NOT proceed to soak window.

---

## Off-chain observations

### Indexer

- **Lag during canary:** max `_FILL_ME_` slots
- **`_unresolved` events:** `_FILL_ME_` (target: 0 after 1 minute)
- **Reconciler errors:** `_FILL_ME_` (target: 0)

### Monitoring / alerting

- **PagerDuty alerts fired:** `_FILL_ME_` (target: 0)
- **Grafana dashboard observation:** _summarize_ `_FILL_ME_`

### Front-end

- **Mainnet banner visible:** ✅ / ❌
- **Wallet connect flow on `/home`:** ✅ / ❌ (deployer wallet connected, FeaturedGroup card rendered live Pool state)
- **Solscan link from tx:** ✅ / ❌

---

## Post-run state

Solscan / direct RPC verification:

- Pool PDA: [`_FILL_ME_`](https://solscan.io/account/_FILL_ME_) — `status == Completed`
- Deployer USDC balance delta:
  - Pre-canary: $`_FILL_ME_`
  - Post-canary: $`_FILL_ME_`
  - Net: $`_FILL_ME_` (expected: roughly zero modulo fees + accrued yield)
- Treasury (Squads PDA) USDC delta: $`_FILL_ME_` (expected: positive from cycle fee + harvest protocol fee)
- Guarantee Fund (Squads PDA) USDC delta: $`_FILL_ME_` (expected: zero or small post-harvest accrual)

---

## Bytecode + attestation integrity

- [ ] OtterSec verify-build PDA still resolves for all 4 programs post-canary
- [ ] No bytecode hash mismatch detected
- [ ] Re-run `solana-verify get-program-pda` — outputs match commit `_FILL_ME_`

---

## Issues surfaced

List any unexpected behavior, even if not blocking. Cross-link to GitHub issues opened.

| #   | Description | Severity    | GH issue    | Resolution path |
| --- | ----------- | ----------- | ----------- | --------------- |
| 1   | `_FILL_ME_` | `_FILL_ME_` | `_FILL_ME_` | `_FILL_ME_`     |

If no issues: write "No unexpected behavior observed."

---

## Decision

- [ ] Canary outcome is **green**. Proceed to 7-day soak window per `mainnet-canary-plan.md` §7.
- [ ] Canary outcome is **partial**. Investigate issues above; re-canary after fixes (re-running this script resumes idempotently).
- [ ] Canary outcome is **aborted**. Pause protocol. File critical incident. Do NOT proceed.

**Signed off by:**

- Operator: `_FILL_ME_` (handle, date)
- Incident commander: `_FILL_ME_` (handle, date)
- Audit liaison (review pass): `_FILL_ME_` (firm, date, audit report ref)

---

## 7-day soak window (begins now if green)

Daily check-in log goes in [`docs/operations/mainnet-canary-soak-log.md`](./mainnet-canary-soak-log.md) (create if not exists). One entry per UTC day for 7 days post-canary.

---

_Template generated by issue #292. Format owners: keep this in sync with `mainnet-canary-plan.md` §4 sequence._
