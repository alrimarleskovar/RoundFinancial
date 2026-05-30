# PagerDuty Runbook — RoundFi Mainnet Alerts

> Companion to [`prometheus-alerts.yaml`](./prometheus-alerts.yaml). Every alert in that file links here via its `runbook_url` annotation. This doc has one section per alert with the exact response procedure.

## PagerDuty setup (one-time, pre-go-live)

1. Create PagerDuty service "RoundFi Mainnet"
2. Generate integration key (Events API v2, NOT Generic Webhook)
3. Configure Alertmanager:
   ```yaml
   receivers:
     - name: pagerduty-p1
       pagerduty_configs:
         - service_key: <P1_INTEGRATION_KEY>
           severity: critical
     - name: pagerduty-p2
       pagerduty_configs:
         - service_key: <P2_INTEGRATION_KEY>
           severity: error
     - name: slack-p3
       slack_configs:
         - api_url: <SLACK_WEBHOOK_URL>
           channel: "#roundfi-alerts"
   route:
     receiver: pagerduty-p1
     routes:
       - match: { severity: p1 }
         receiver: pagerduty-p1
       - match: { severity: p2 }
         receiver: pagerduty-p2
       - match: { severity: p3 }
         receiver: slack-p3
   ```
4. Set escalation policy (see below)
5. Run tabletop drill (see end of this doc)

## Escalation policy

| Tier | Who                        | Response SLA | Resolution SLA |
| ---- | -------------------------- | ------------ | -------------- |
| L1   | Primary on-call (rotating) | 15 min       | 60 min         |
| L2   | Tech lead                  | 30 min       | 4 hours        |
| L3   | Security advisor + founder | 1 hour       | 24 hours       |

P1 alerts escalate L1 → L2 → L3 if unack'd. P2 alerts page L1 only. P3 go to Slack and are reviewed business-hours next day.

## On-call rotation

| Week | Primary  | Backup   |
| ---- | -------- | -------- |
| 1    | _name 1_ | _name 2_ |
| 2    | _name 2_ | _name 1_ |

Rotation is weekly, hand-off Mondays 9am UTC. Update this table at hand-off.

---

## Alert response procedures

### 1. ProtocolConfigChanged

**Severity:** P1

**What it means:** Any field on the `ProtocolConfig` PDA mutated.

**First 5 minutes:**

1. Diff what changed:
   ```bash
   pnpm test:mainnet-hardening
   ```
2. Get the most recent tx that touched the config PDA:
   ```bash
   solana confirm <CONFIG_PDA> --url mainnet-beta | head -5
   solana confirm <recent_tx_sig> --url mainnet-beta
   ```
3. Confirm the signer was the Squads multisig PDA.

**Decision tree:**

- ✅ Squads PDA signed AND change is on schedule → ack alert, no further action
- ⚠️ Squads PDA signed BUT change is unscheduled → page L2, kick off intent investigation
- 🔴 Signer is NOT the Squads PDA → **authority compromise**. Pause protocol immediately:
  ```bash
  # From the recovery keypair (kept offline)
  pnpm tsx scripts/devnet/pause.ts --mainnet
  ```
  Then page L2 + L3.

### 2. TvlCapNearLimit

**Severity:** P2

**What it means:** `committed_protocol_tvl_usdc / max_protocol_tvl_usdc > 90%`.

**First 30 minutes:**

1. Check the current cap + utilization on Solscan
2. Review pending pool creations (any `init_pool_vaults` in flight?)
3. Choose:
   - **Raise cap** — requires governance proposal (1-day timelock on `fee_bps_yield` per SEV-024). Use `update_protocol_config` to set new `max_protocol_tvl_usdc`. Wait 24h.
   - **Pause new pool creation** — set `max_pool_tvl_usdc = 0` temporarily.
   - **Wait** — natural decrement via `close_pool` of mature pools.

Document the decision in `#incidents` channel.

### 3. KaminoCpiFailureSpike

**Severity:** P1

**What it means:** CPI failures into Kamino > 0.1/sec sustained 5 min.

**First 5 minutes:**

1. Pull the latest 5 failed txs:
   ```bash
   curl -s "https://api.helius.xyz/v0/transactions?api-key=$HELIUS_KEY" \
     -d '{"transactions": ["<tx_sigs>"]}' | jq '.[] | .meta.err'
   ```
2. Identify the failure class:
   - `InsufficientLiquidity` → Kamino reserve drained (Kamino-side incident, not ours)
   - `ReserveStale` → Kamino reserve hasn't been refreshed by anyone; we should ping Kamino team
   - `InvalidAccountData` → SEV-040/041-class regression — Kamino changed their interface
   - `Custom: <other>` → look up in `klend/src/lib.rs` LendingError enum
3. If 3rd or 4th class → **pause the kamino adapter**:
   ```bash
   # Flips approved_yield_adapter to Pubkey::default() (= disabled)
   pnpm tsx scripts/devnet/disable-yield-adapter.ts --mainnet
   ```
   Pools continue operating; just no new deposits to yield until fix lands.

### 4. HarvestRevertSpike

**Severity:** P2

**What it means:** `harvest_yield` reverting > 5 times/hr.

**First 30 minutes:**

1. Fetch last 3 reverted harvest txs + check failure class
2. If `HarvestSlippageExceeded` (PR #124 guard) → likely Kamino yield dropped below `min_realized_usdc` threshold; lower the threshold via governance.
3. If `PrincipalLoss` → ESCALATE TO ALERT #5 (PrincipalLossEvent).
4. If other class → diagnose via Solscan + ping L2.

### 5. PrincipalLoss event

**Severity:** P1

**What it means:** Our wrapper's `total_redeemed < tracked_principal` invariant failed — Kamino exchange rate moved against us.

**First 5 minutes:**

1. **IMMEDIATE PAUSE.** Stop further loss:
   ```bash
   pnpm tsx scripts/devnet/disable-yield-adapter.ts --mainnet
   ```
2. Snapshot the affected pool + adapter state:
   ```bash
   solana account <POOL_PDA> --url mainnet-beta --output json > incident-pool.json
   solana account <YIELD_VAULT_STATE_PDA> --url mainnet-beta --output json > incident-state.json
   ```
3. Page L2 + L3.

**First 4 hours:**

1. Reproduce the failure path:
   - Check Kamino's reserve state at the harvest slot — was there a known liquidation?
   - Compute expected `total_redeemed` from Kamino's exchange rate formula
   - Cross-check our `tracked_principal` against the deposit history
2. Determine if loss is:
   - **Kamino-side bug** → file with Kamino team, freeze our integration pending their fix
   - **Our accounting bug** → write the negative-regression test, fix, redeploy
   - **Genuine economic loss** → governance decision on whether to absorb or pass through

Post-mortem doc: `docs/operations/incident-postmortems/YYYY-MM-DD-principal-loss.md`.

### 6. VaultBalanceMismatch

**Severity:** P1

**What it means:** Pool's on-chain USDC balance ≠ protocol's accounted balance.

**First 5 minutes:**

1. Quantify drift direction:
   - **Positive** (more USDC on chain than accounted) — likely benign (donation, dust)
   - **Negative** (less USDC than accounted) — **CRITICAL**. Pause protocol.
2. If negative, identify the missing tx:
   ```bash
   solana confirm <POOL_USDC_VAULT_PDA> --url mainnet-beta | head -20
   # Look for SPL transfers OUT that don't correspond to a protocol ix
   ```

**Decision tree:**

- Drift ≤ 1 USDC and positive → likely dust; log + ack
- Drift > 1 USDC and positive → investigate before next harvest cycle
- ANY negative drift → pause + page L2 + L3 + incident response

### 7. ProtocolPauseStateChanged

**Severity:** P2

**What it means:** Someone called `pause` or unpause.

**Response:**

1. Confirm actor:
   ```bash
   solana confirm <recent_pause_tx> --url mainnet-beta | grep "Account 0"
   ```
2. If actor is Squads PDA → ack with note in #incidents
3. If actor is NOT Squads PDA → escalate to ALERT #1 (authority compromise path)
4. If state went `paused = true` → check #incidents for an active investigation
5. If state went `paused = false` → confirm the underlying fix was deployed + verified BEFORE the unpause

### 8. TreasuryOutflow

**Severity:** P2

**What it means:** Treasury USDC ATA had a USDC outflow.

**Response:**

1. Get tx details:
   ```bash
   solana confirm <recent_outflow_tx> --url mainnet-beta
   ```
2. Confirm:
   - Signer = Squads PDA (3-of-5 quorum)
   - Destination = authorized recipient (vendor invoice, bug bounty payout, etc — list maintained in `docs/operations/authorized-recipients.md`)
   - Amount matches scheduled disbursement
3. If all 3 ✅ → ack + log
4. If ANY ✗ → escalate to ALERT #1 (authority compromise) + page L3

---

## Tabletop drill (run before go-live AND every 6 months)

30-minute exercise to validate the alert pipeline + on-call response without live incidents.

**Setup (5 min):**

- Coordinator + 2-3 on-call rotating members
- One person plays "the alert", others play "on-call response"
- Use a private staging Slack channel to simulate `#incidents`

**Run (20 min):**

For each of 4 random alerts from the 8 above:

1. Coordinator triggers test alert (Alertmanager's `amtool alert add` or manual PagerDuty trigger)
2. On-call ack within SLA window (15 min for P1, 30 min for P2)
3. On-call walks through this runbook for that alert verbally
4. Coordinator evaluates: was the runbook clear? Were any steps missing?
5. Capture gaps in the post-drill notes

**Post-drill (5 min):**

- File `docs/operations/incident-drills/YYYY-MM-DD-tabletop.md` with:
  - Which 4 alerts tested
  - Response times (ack + resolution)
  - Runbook gaps identified
  - Action items (PR to fix runbook, retrain, etc)

## When to update this runbook

- New SEV-### closed via PR → if the SEV is operationally-relevant, add the recovery procedure to the appropriate alert section
- New external dependency added (Solend, Pyth, etc) → spawn new alert + section for it
- Tabletop drill identified a gap → update the gap-affected section
- Post-mortem reveals a missing alert → add new YAML rule + section here

## See also

- [`prometheus-alerts.yaml`](./prometheus-alerts.yaml) — the alert rules this runbook responds to
- [`grafana-dashboards.md`](./grafana-dashboards.md) — dashboards on-call inspects during triage
- [`../operations/emergency-response.md`](../operations/emergency-response.md) — broader emergency procedures
- [`../operations/indexer-reorg-recovery.md`](../operations/indexer-reorg-recovery.md) — indexer-specific recovery
- [`../operations/key-rotation.md`](../operations/key-rotation.md) — authority compromise response
