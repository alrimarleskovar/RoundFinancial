# Treasury Management Runbook

> **Scope:** day-to-day operations of the RoundFi treasury — the USDC ATA at `ProtocolConfig.treasury`. Covers **disbursement workflow** (how USDC leaves the treasury), **accounting + audit trail** (the off-chain record that pairs with each on-chain Squads proposal), and **operational sanity checks** (balance reconciliation, fee-flow verification).
>
> **What this doc is NOT:**
>
> - **Not the custody decision** — that's [ADR 0008](../adr/0008-treasury-custody-squads-multisig.md). Read that first if you're new.
> - **Not the rotation procedure** — that's [`squads-multisig-procedure.md`](./squads-multisig-procedure.md) (ceremony) and [`key-rotation.md`](./key-rotation.md) §(b) (generic). This runbook assumes the treasury is already custodied on the Squads vault PDA.
> - **Not the founder/team compensation policy** — deferred to a future ADR per [ADR 0008](../adr/0008-treasury-custody-squads-multisig.md) "Decision". When that lands, payroll disbursements use the workflow below; the policy is what's missing, not the mechanism.
> - **Not the incident-response path** — emergency treasury moves during a SEV-0 / SEV-1 follow the [`emergency-response.md`](./emergency-response.md) procedure, not this one.

---

## Mental model

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    Treasury inflow (passive, automatic)                  │
└──────────────────────────────────────────────────────────────────────────┘

  harvest_yield  ──► waterfall split (roundfi-math/waterfall.rs)
                       │
                       ├──► 20%  protocol fee   ──► ProtocolConfig.treasury  ◄── treasury ATA
                       ├──► 65%  LP             ──► pool USDC vault
                       └──► 35%  participants   ──► escrow vaults / direct payouts

  (No manual step. Fees accrue every harvest_yield call.)

┌──────────────────────────────────────────────────────────────────────────┐
│              Treasury outflow (active, gated by Squads 3-of-5)           │
└──────────────────────────────────────────────────────────────────────────┘

  Disbursement need ──► §1 propose ──► §2 review ──► §3 Squads tx
                                                          │
                                                          ├──► §4 execute (3-of-5)
                                                          ├──► §5 verify on-chain
                                                          └──► §6 log
```

The treasury **fills passively** (no operational decisions per harvest) and **drains actively** (every outflow is a deliberate Squads proposal). The asymmetry is intentional: inflows are protocol-driven and predictable; outflows are governance-driven and auditable.

---

## §1 — Disbursement workflow

Every USDC outflow from the treasury follows the same 6-step sequence regardless of size or purpose (vendor payment, audit invoice, infrastructure bill, future payroll). **No shortcuts** — the audit trail is the value of the workflow.

### 1.1 Propose (off-chain)

Before opening any Squads tx, the requester writes the disbursement entry in [`docs/operations/disbursement-log.md`](./disbursement-log.md) (created lazily — append-only; first disbursement adds the file with the schema below). Required fields:

| Field            | Example                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`             | `DISB-2026-001` (monotonic, year-prefixed)                                                                                                       |
| `date_proposed`  | `2026-MM-DD` (UTC)                                                                                                                               |
| `requester`      | Signer pubkey or GitHub handle of who's asking for the disbursement                                                                              |
| `recipient`      | Counterparty name + USDC mainnet ATA                                                                                                             |
| `amount_usdc`    | Decimal, 6 dp precision (e.g. `12500.000000`)                                                                                                    |
| `purpose`        | One-line free text (e.g. "Adevar Labs audit invoice — milestone 1 of 2")                                                                         |
| `category`       | `audit` / `legal` / `infra` / `bounty` / `payroll` / `tax` / `reimbursement` / `other`                                                          |
| `supporting_doc` | Link to invoice PDF / contract clause / bounty submission. Stored under `docs/operations/disbursement-attachments/<id>/` (gitignored if private) |
| `notes`          | Anything an auditor would want to know post-hoc                                                                                                  |

This entry is created **before** the Squads proposal so that the recipient + amount can be reviewed in PR (the disbursement-log entry goes in via a regular GitHub PR if the disbursement is non-routine; routine recurring categories can append directly with sign-off in commit message).

### 1.2 Review (off-chain)

For disbursements ≥ $5,000 USDC OR for any disbursement in the `legal` / `audit` / `payroll` / `tax` categories: **at least one Squads signer other than the requester** must comment-approve the disbursement-log entry before the Squads proposal opens. The review check is: "does the amount + recipient + supporting doc make sense, and is the recipient ATA correct?"

For disbursements < $5,000 USDC in `infra` / `bounty` / `reimbursement` categories: no pre-proposal review required (the Squads 3-of-5 quorum IS the review). Still requires the log entry per §1.1.

### 1.3 Propose (on-chain, Squads)

Open the Squads UI ([app.squads.so](https://app.squads.so)) on the protocol multisig PDA. Propose a new transaction:

- **Instruction type:** SPL Token Transfer
- **Source:** treasury ATA (`getAssociatedTokenAddressSync(USDC_MINT, <vault_pda>, true)`)
- **Destination:** recipient ATA from §1.1
- **Amount:** lamports = `amount_usdc * 10^6` (USDC has 6 decimals on Solana)
- **Memo:** the `DISB-YYYY-NNN` id from §1.1 (Squads supports memo field; if not, include in proposal title)

Triple-check the destination ATA pubkey against §1.1 before submitting the proposal. An attacker who compromises ONE signer can't drain the treasury (3-of-5), but they CAN inject a wrong destination at the propose stage — the 3 other signers are then the only check against a typo'd or substituted recipient.

### 1.4 Execute (3-of-5 quorum)

Ping the 5 signers via the established emergency channel (Signal group per [`emergency-response.md`](./emergency-response.md) "Who can pause"). Each signer independently:

1. Opens the Squads UI
2. **Reads the proposal text + destination + amount** (does NOT skip)
3. Cross-references against the `DISB-YYYY-NNN` entry in `disbursement-log.md`
4. Approves (or rejects with a comment if the on-chain proposal doesn't match the log entry — this is the second-line defense against the §1.3 attack)

After 3 approvals, the proposal becomes executable; any signer (typically the requester) clicks "Execute" to submit the on-chain tx.

**Time-to-completion SLA:** routine disbursements should complete within 24h of proposal open. Urgent ones (vendor about to suspend service, time-sensitive bounty payment) should complete within 4h — on-call rotation guarantees 3-signer reachability inside 30 minutes per [`emergency-response.md`](./emergency-response.md).

### 1.5 Verify on-chain

After execution, the requester verifies the outflow landed:

```bash
# Solscan link by tx signature
echo "https://solscan.io/tx/<sig>?cluster=mainnet-beta"

# OR programmatic
solana confirm <sig> --url mainnet-beta --output json | jq .
```

Required checks:

| Check                  | Expected                                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| Tx status              | `confirmed` or `finalized`                                              |
| Source ATA delta       | `-<amount_usdc>` (raw lamports = `-amount_usdc * 10^6`)                 |
| Destination ATA delta  | `+<amount_usdc>` (same)                                                 |
| Source ATA post-balance | Matches expected (pre-balance minus disbursement; sanity vs §3 reconciliation) |
| Memo / inner ix        | Contains `DISB-YYYY-NNN` reference                                      |

If any check fails (wrong amount landed, wrong recipient, partial transfer): **immediately open an incident** per [`emergency-response.md`](./emergency-response.md) SEV-2 — the disbursement-log entry now diverges from on-chain reality and the gap must be reconciled before any further disbursements.

### 1.6 Log close

Update the `disbursement-log.md` entry to add:

| Field           | Example                                                            |
| --------------- | ------------------------------------------------------------------ |
| `tx_sig`        | `5j…` (mainnet tx signature)                                       |
| `executed_at`   | `2026-MM-DD HH:MM UTC`                                             |
| `status`        | `executed` (was `proposed`)                                        |
| `squads_url`    | Link to the executed proposal in the Squads UI                     |

Commit the updated log via PR (or direct push for routine append-only updates per repo convention). The disbursement is now closed; the audit trail is complete.

---

## §2 — Accounting + audit trail

### 2.1 What lives on-chain

Every USDC inflow to the treasury is a `harvest_yield` `Transfer` ix to the treasury ATA. Every outflow is a Squads-executed SPL `Transfer` ix from the treasury ATA. Both are queryable via standard Solana RPC + Solscan with no special indexing — the treasury ATA's transaction history IS the canonical ledger.

The indexer (Postgres-backed, per `docs/observability/`) can be queried for treasury flows via a planned `treasury_flow` view; this is a follow-up not in scope for PR #400 — see [`docs/observability/`](../observability/) future work.

### 2.2 What lives off-chain (this repo)

| Artifact                                       | Purpose                                                                                                              | Cadence                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `docs/operations/disbursement-log.md`          | The authoritative log of every outflow with purpose + category + supporting doc reference + post-execution tx_sig | Per-disbursement (append)        |
| `docs/operations/disbursement-attachments/`    | Invoices, contracts, bounty submissions referenced from the log. Private contents gitignored                       | Per-disbursement (one-shot)      |
| `docs/operations/treasury-reconciliation/`     | Quarterly reconciliations: on-chain ATA history vs disbursement-log + computed expected fee inflows                  | Quarterly (template TBD; first reconciliation drives the template) |

### 2.3 What lives off-chain (external)

| System                               | Purpose                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Legal-entity accounting (TBD)        | Bookkeeping for tax / corporate filings. Out of scope until legal-entity decision is made.    |
| Tax categorization (TBD)             | BR + US tax treatment of protocol fees and disbursements. Gated on legal counsel opinion ([#268](https://github.com/alrimarleskovar/RoundFinancial/issues/268)). |

The entire off-chain accounting layer above the disbursement log is deferred until the legal-entity + jurisdictional decisions are made (per [`mainnet-canary-plan.md`](./mainnet-canary-plan.md) §3.1 / [#268](https://github.com/alrimarleskovar/RoundFinancial/issues/268)). This runbook covers the on-chain + repo-side layer that exists regardless of legal structure.

---

## §3 — Reconciliation

### 3.1 Cadence

- **Per-disbursement** — §1.5 verification step
- **Monthly** — anyone (typically the requester of the most recent disbursement) runs the read-only reconciliation procedure below
- **Quarterly** — formal reconciliation written up under `docs/operations/treasury-reconciliation/YYYY-QN.md`

### 3.2 Read-only monthly check

```bash
# 1. Fetch all txs touching the treasury ATA in the last month
solana transaction-history <TREASURY_ATA> --url mainnet-beta --limit 1000

# 2. Filter for outflows (negative delta to treasury ATA) — compare count vs
#    disbursement-log entries with status=executed in the same window

# 3. Filter for inflows (positive delta) — every one should be from a
#    pool USDC vault (a harvest_yield split). An inflow from any other
#    source is a finding — investigate immediately.

# 4. Compute expected protocol fees over the window:
#    sum(harvested_yield_per_pool) * config.fee_bps / 10_000
#    Should match observed inflow sum within rounding.
```

Discrepancies → open an issue tagged `treasury-reconciliation`. Material discrepancies (> 1% drift) escalate to SEV-2 per [`emergency-response.md`](./emergency-response.md).

### 3.3 Quarterly write-up

Template lands when the first quarterly reconciliation runs (first quarter of mainnet operation). Will live at `docs/operations/treasury-reconciliation/TEMPLATE.md` once the shape stabilizes.

---

## §4 — Operational sanity checks

### 4.1 Pre-disbursement checklist (15 seconds)

Before opening a Squads proposal:

- [ ] Disbursement-log entry exists with §1.1 fields populated
- [ ] If ≥ $5k OR audit/legal/payroll/tax: §1.2 review has at least one non-requester signer ack
- [ ] Recipient ATA confirmed in 2 places (disbursement log + Squads proposal — read them side-by-side)
- [ ] Amount in lamports = `amount_usdc * 10^6` (USDC has 6 decimals; off-by-3 = $1k vs $1m mistake)
- [ ] Treasury ATA has sufficient balance (`getTokenAccountBalance(TREASURY_ATA) >= amount + buffer`)

### 4.2 Post-disbursement checklist (1 minute)

After Squads execution:

- [ ] Solscan tx confirmed and account-changes match expected
- [ ] Disbursement-log entry updated with `tx_sig` + `executed_at` + `status=executed`
- [ ] Squads UI shows proposal as "Executed"
- [ ] Recipient confirmed receipt out-of-band (Signal / email)
- [ ] If recipient is external counterparty (audit firm, vendor): invoice marked paid in their system

### 4.3 Recurring spot-checks

- **Weekly** — eyeball the treasury ATA on Solscan for unexpected inflows or outflows. Any tx without a corresponding `DISB-YYYY-NNN` (for outflows) or `harvest_yield` source (for inflows) is a finding.
- **Pre-disbursement** — confirm `ProtocolConfig.treasury` still equals the expected ATA (`solana account <ProtocolConfig-PDA> --output json | jq .` and decode). An unexpected change here means the treasury was rotated without team knowledge — SEV-0 immediately, treat as authority compromise.

---

## §5 — Future considerations

These are explicit deferrals — not in scope for this runbook today, but tracked so they're not forgotten.

| Item                                        | Trigger to revisit                                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Founder/team compensation framework**     | After external audit clear + BR + US legal counsel opinions ([#268](https://github.com/alrimarleskovar/RoundFinancial/issues/268)). Lands as future ADR; draws against the workflow above. |
| **Hot/cold treasury split**                 | Once treasury balance > $100k AND mainnet operating for ≥ 1 quarter (empirical disbursement rate known)                                                          |
| **Indexer `treasury_flow` view**            | When manual `solana transaction-history` queries become operationally painful (~ when monthly outflow count > 20)                                                |
| **Quarterly reconciliation template**       | First quarter of mainnet operation                                                                                                                              |
| **Streaming payments primitive**            | When team size > 10 OR recurring payment volume > 5/month. Evaluate Streamflow / Bonfida vesting / similar                                                       |
| **Migration to regulated custodian**        | Path-B trigger from [ADR 0008](../adr/0008-treasury-custody-squads-multisig.md) fires (regulatory threshold / audit recommendation / insurance precondition / off-ramp partner / catastrophic compromise / subpoena) |
| **`lock_treasury` decision**                | After external audit clear + at least 1 stable mainnet quarter. Irreversible — see [ADR 0008](../adr/0008-treasury-custody-squads-multisig.md) "Consequences"  |

---

## References

- [ADR 0008](../adr/0008-treasury-custody-squads-multisig.md) — custody decision + Path-B triggers
- [`squads-multisig-procedure.md`](./squads-multisig-procedure.md) — Squads ceremony for upgrade authority + protocol authority + treasury rotation
- [`key-rotation.md`](./key-rotation.md) §(b) — generic treasury rotation runbook
- [`emergency-response.md`](./emergency-response.md) — incident response, signer compromise matrix, on-call SLA
- [`mainnet-canary-plan.md`](./mainnet-canary-plan.md) §3 — preconditions including treasury authority on Squads
- [MAINNET_READINESS.md §3.6 + §3.7](../../MAINNET_READINESS.md) — readiness items
- `programs/roundfi-core/src/instructions/{propose,cancel,commit}_new_treasury.rs`, `lock_treasury.rs` — on-chain rotation primitives ([PR #122](https://github.com/alrimarleskovar/RoundFinancial/pull/122))
- `roundfi-math/waterfall.rs` — fee split math (where treasury inflows originate)
