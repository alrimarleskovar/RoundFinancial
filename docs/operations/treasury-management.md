# Treasury Management Runbook — RoundFi mainnet

> **Scope:** how the protocol owner / multisig members **withdraw** protocol-fee revenue from `ProtocolConfig.treasury` (the USDC ATA pinned in [`initialize_protocol.rs:46-48`](../../programs/roundfi-core/src/instructions/initialize_protocol.rs)) once the Squads ceremony in [`squads-multisig-procedure.md`](./squads-multisig-procedure.md) has rotated treasury custody to the Squads vault PDA.
>
> **Out of scope** — _treasury address rotation_ (covered by [`key-rotation.md` § (b)](./key-rotation.md#b-treasury-address-rotation)), _Cofre Solidário withdrawals_ (separate program-owned PDA, governed differently), _emergency pause_ (covered by [`emergency-response.md`](./emergency-response.md)).
>
> **Design rationale** for "withdrawal is Squads-signed SPL transfer, not a roundfi-core instruction": see [`docs/adr/0008-treasury-custody-squads-multisig.md`](../adr/0008-treasury-custody-squads-multisig.md). This runbook is the operational drill-down of that ADR.

---

## What is the treasury (one paragraph)

The treasury is an SPL `TokenAccount` on the protocol's USDC mint, with `owner = <Squads vault PDA>` after Step 4 of the mainnet ceremony. It is **not** a PDA owned by `roundfi-core` — the program never holds its USDC directly. `roundfi-core` writes _into_ the treasury via SPL `transfer` CPI during `harvest_yield` (and any future fee-flow ix). Withdrawals _out_ of the treasury are standard SPL `transfer` instructions signed by the Squads multisig vault — RoundFi's on-chain code is not involved.

### Treasury balance lifecycle

```
                              ┌─────────────────────────────────────────────┐
   harvest_yield ───── CPI ──▶│  config.treasury  (USDC ATA owned by        │
   (protocol-fee bps          │                    Squads vault PDA)        │
    slice of pool yield)      └─────────────────────────────────────────────┘
                                              │
                                              │ SPL transfer
                                              │ (signed by Squads
                                              │  via threshold approval)
                                              ▼
                              ┌─────────────────────────────────────────────┐
                              │  Recipient ATA (legal entity, ops wallet,   │
                              │  contractor payout, founder distribution,   │
                              │  etc.)                                       │
                              └─────────────────────────────────────────────┘
```

---

## Pre-mainnet checklist (one-time)

Before the **first** treasury withdrawal on mainnet:

- [ ] Step 4 of [`squads-multisig-procedure.md`](./squads-multisig-procedure.md#step-4--rotate-the-treasury-if-applicable) has been completed and verified — `config.treasury` is owned by the Squads vault PDA, confirmed via `solana account <treasury-ata> --output json` + decoded owner field.
- [ ] At least one **devnet rehearsal** of a withdrawal has been executed end-to-end through the same Squads UI (different multisig, throwaway members) — see the rehearsal section at the bottom of this doc.
- [ ] **Recipient allowlist** has been documented (this file's § "Recipient policy") and shared with all multisig members out-of-band.
- [ ] **Squads spending policies** have been configured per § "Squads spending policies" below.
- [ ] **Indexer** is tracking treasury inflows + outflows and surfaces them in the admin dashboard (PR #401 + #402).
- [ ] **Legal entity** that owns the receiving wallet has been incorporated and KYB'd with whatever exchanges / off-ramps will convert USDC → fiat. Treasury withdrawals before legal infrastructure exists are not a programming problem.
- [ ] **Tax counsel** has reviewed the recognition events. USDC inflow to treasury, internal transfers, and final distribution can each be taxable depending on the jurisdiction and entity structure. Out of scope for this doc but required before withdrawing.

---

## Recipient policy

Multisig members agree on the recipient allowlist **out-of-band** (1Password / Signal / written charter) before any withdrawal is proposed. Suggested categories — adjust per the legal entity's actual structure:

| Category              | Example recipient                                                          | Frequency   | Notes                                                                                                  |
| --------------------- | -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| Operating expenses    | Ops wallet (e.g. `OpsXX...XX` ATA on USDC)                                 | Monthly     | Server costs, RPC subscriptions, audit retainers, etc.                                                 |
| Contractor payouts    | Per-contractor ATA, recorded in a shared payouts ledger                    | As invoiced | One ATA per long-term contractor; ad-hoc contractors use the ops wallet as relay                       |
| Founder distributions | Per-founder ATA, distinct from any pool-participating wallet               | Quarterly   | Subject to vesting / cliff per the cap-table; do not commingle with member-signing keys                |
| External audit fees   | Audit-firm-provided ATA (Adevar Labs, OtterSec, etc.)                      | Per audit   | Cross-check with the firm's published payment address — they should publish out-of-band, not via email |
| Bug bounty payouts    | Researcher-provided ATA (per [`bug-bounty.md`](../security/bug-bounty.md)) | Per finding | One-shot; ATA captured in the bounty report                                                            |
| Off-ramp deposits     | Centralised exchange deposit ATA (Coinbase / Kraken / Bitso etc.)          | As needed   | Triple-check the ATA — exchange deposit addresses sometimes rotate                                     |

**Recipient capture rule:** every recipient ATA goes through 3 checks before being proposed:

1. **Out-of-band confirmation** — recipient sends the ATA via at least 2 distinct channels (e.g. encrypted email + Signal). Mismatched ATAs are an automatic abort.
2. **First-tx sanity** — send a $1 test transfer FIRST. Wait for the recipient to confirm receipt out-of-band before proposing the real amount. Squads makes this cheap (one tx).
3. **Mint pin** — confirm the recipient ATA is on `config.usdc_mint` (devnet `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`). Wrong-mint recipients will reject at SPL-transfer time, but catching it pre-propose avoids a wasted Squads round.

---

## Squads spending policies (rate-limit substitute)

Squads v4 supports **spending limits** — per-token, per-window caps that can be approved by a sub-threshold of members. RoundFi uses these as the substitute for the on-chain rate-limit that ADR 0008 deliberately deferred.

Recommended policy (set once, post-Step-4):

| Policy                              | Cap                       | Approval threshold     | Window         | Notes                                                                                                                                                                                             |
| ----------------------------------- | ------------------------- | ---------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routine operating expenses          | 10% of treasury balance   | 2 of 5 (sub-threshold) | 30-day rolling | Lets one duty-officer + one approver release small amounts without convening the full multisig                                                                                                    |
| Large distributions / payouts       | > 10% of treasury balance | Full threshold (3/5)   | n/a            | Default. Anything above the 10% policy escalates to full multisig                                                                                                                                 |
| Recipient not on documented list    | 0 (blocked)               | Full threshold (3/5)   | n/a            | Squads doesn't enforce a recipient allowlist on-chain; the **policy** is "any unknown recipient triggers a full review". Members reject the propose if the recipient isn't on the documented list |
| Emergency drain (incident response) | 100% of balance           | Full threshold (3/5)   | n/a            | For the case where the treasury ATA itself is suspected at-risk; drain to a fresh ATA. See § "Emergency drain" below                                                                              |

These are policy decisions enforced **socially** at the Squads layer + technically at the spending-limit layer. ADR 0008 records that bytecode-level enforcement is a deferred option (Path B) with explicit triggers.

To configure spending limits in Squads: [app.squads.so](https://app.squads.so) → your multisig → Settings → Spending Limits → "Add Spending Limit". Pick the USDC mint + the cap + the window + the sub-threshold. Squads' docs: <https://docs.squads.so/main/spending-limits>.

---

## Procedure — routine withdrawal

### Step 0 — Pre-flight (every withdrawal)

1. **Confirm treasury balance** in the admin dashboard (PR #402) — or via CLI:
   ```bash
   spl-token balance --address <treasury-ata-pubkey> --url mainnet-beta
   ```
2. **Confirm pending state is clean.** If `config.pending_treasury != Pubkey::default()`, a treasury _address rotation_ is in flight and you must complete or cancel it before withdrawing — partial rotations + concurrent withdrawals are a UX trap. Check via:
   ```bash
   pnpm tsx scripts/devnet/squads-rehearsal-verify.ts --target treasury  # works on mainnet too with --url flag
   ```
3. **Confirm protocol is not paused** unless the withdrawal is part of an emergency drain (see § "Emergency drain"). A paused protocol means no `harvest_yield` is running → treasury balance is not growing → confirm withdrawal is still appropriate.
4. **Confirm legal recognition.** The recipient's legal entity, the purpose of the transfer, and the bookkeeping reference (invoice #, payroll period, etc.) are recorded in the team's internal ledger BEFORE the on-chain action.

### Step 1 — Construct the SPL transfer ix

Use the helper script (PR #401):

```bash
pnpm tsx scripts/mainnet/treasury-withdraw.ts \
  --recipient <recipient-ata-pubkey> \
  --amount <usdc-base-units>            # e.g. 1000000 = 1 USDC (6 decimals)
  --memo "Q1-2026 ops payout — invoice #INV-0042" \
  --emit-tx-base64                       # prints the base64-encoded tx for paste-into-Squads
```

The script:

- Verifies the source ATA equals `config.treasury` (reads `ProtocolConfig` on-chain — sanity check that the address hasn't drifted since the last withdrawal)
- Verifies the recipient ATA exists and is on the correct mint
- Verifies `amount > 0` and `amount <= source_balance`
- Optionally adds an SPL `memo` instruction so the on-chain tx carries the bookkeeping reference (auditor-friendly)
- Outputs the unsigned transaction in base64 so it can be pasted into Squads' "Custom transaction" flow

**Why a script** — Squads' UI can build SPL transfers directly, but going through our script enforces the source-ATA sanity check + memo + size validation in one shot. Reduces the chance of an operator typo creating a wrong-source / wrong-mint / off-by-decimal-place withdrawal.

### Step 2 — Propose in Squads

1. Open the multisig in [app.squads.so](https://app.squads.so), connect a member's hardware wallet.
2. "New Transaction" → "Custom transaction" → paste the base64 from Step 1.
3. Squads decodes the tx + shows: source ATA, destination ATA, amount, memo. **Visually verify all 4** against what the script printed.
4. Sign + submit the proposal. Other members see it in the multisig's pending queue.

### Step 3 — Approve

Other members (until threshold is met):

1. Open the proposal in Squads UI.
2. **Verify the same 4 fields** (source / dest / amount / memo) independently — do not just trust the proposer.
3. Cross-check the recipient ATA against the out-of-band documented list (§ "Recipient policy").
4. Sign approval.

For a **routine** withdrawal under the 10% spending-limit policy, 2 of 5 members suffice. For larger withdrawals, all 3 of the full threshold.

### Step 4 — Execute

Any member (or, depending on Squads' "execute by anyone" setting, a permissionless cranker) clicks "Execute" once the threshold is met. Squads' vault PDA signs the SPL `transfer`. The USDC moves from the treasury ATA to the recipient ATA in a single tx.

Squads charges a small SOL fee (~0.000005 SOL for execution); the vault PDA pays it. Ensure the vault PDA has a small SOL balance (~0.1 SOL is plenty for years of executions).

### Step 5 — Post-withdrawal verification

1. **Solscan check** — the tx should show:
   - One SPL Token `Transfer` instruction with source = `config.treasury`, destination = recipient ATA, amount = expected.
   - A Memo instruction with the bookkeeping reference (if `--memo` was used).
   - The Squads vault PDA as the source ATA's authority signer (NOT the deployer key — if you see the deployer key signing post-ceremony, treasury custody has drifted and is a SEV).
2. **Recipient confirms receipt** out-of-band. For exchange deposits, confirm credit shows in the exchange UI.
3. **Update the team's internal ledger** with the tx signature + Squads proposal URL. Auditor-readable trail = tx sig + Squads URL + invoice ID.
4. **Indexer cross-check** — within ~60s, the admin dashboard's "recent withdrawals" panel should show the new entry. If it doesn't, file an indexer incident (the dashboard is read-only — a missing entry means the indexer missed the SPL transfer, not that the withdrawal failed).

---

## Procedure — emergency drain

**Trigger:** the treasury ATA itself is suspected at-risk (e.g. multisig member key suspected compromised, custody-program vulnerability disclosed, etc.). Goal: move 100% of the balance to a fresh ATA under a fresh multisig (or a hardware-wallet single-key escrow as last resort) before the attack can be executed.

> This is **not** the same as a treasury _address rotation_ via `propose_new_treasury` — that has a 7-day timelock, which is too slow for an active incident. The emergency drain moves the funds, then rotates the on-chain `config.treasury` field afterwards via the normal 7-day flow to redirect future inflows.

1. **Pause the protocol** with the protocol authority key (separate from the treasury custody — see [`emergency-response.md`](./emergency-response.md)). Halts further inflows to the treasury, buys time.
2. **Convene the multisig out-of-band** (Signal / Zoom / in-person). All approving members must agree this is an emergency before signing.
3. **Construct the drain tx** — same script as the routine path, but `--amount` = entire current balance, recipient = the pre-prepared **emergency-escrow ATA**:
   ```bash
   pnpm tsx scripts/mainnet/treasury-withdraw.ts \
     --recipient <emergency-escrow-ata> \
     --amount-all \
     --memo "EMERGENCY DRAIN — incident <ID>" \
     --emit-tx-base64
   ```
4. **Propose + full-threshold approve + execute** as fast as practical. Skip any sub-threshold policies — emergency drains require full threshold.
5. **Disclose** per [`emergency-response.md`](./emergency-response.md) procedure — public post-mortem, SECURITY.md update, etc.
6. **Then** start the normal 7-day `propose_new_treasury` flow to redirect future fee inflows to a fresh treasury ATA. During the 7-day window, harvests continue to flow to the old (now-empty) ATA — harmless, since the balance is already safely in escrow.

**Emergency-escrow ATA pre-preparation** — this is the critical readiness step. The team must have, BEFORE any incident, prepared a USDC ATA owned by a separate Squads multisig (or hardware-wallet single-key for ultimate last resort). The ATA pubkey is documented in the same out-of-band channel as the recipient allowlist. Without a pre-prepared escrow, the emergency drain requires creating one mid-incident — feasible but adds minutes to the response time, which matters.

---

## Indexer integration (PR #401)

The indexer (`services/indexer/`) gains two responsibilities for treasury observability:

1. **Inflow tracking** — already partly handled by the `harvest_yield` event decoder ([`services/indexer/src/decoder.ts`](../../services/indexer/src/decoder.ts)). PR #401 adds explicit treasury-balance tracking that doesn't depend on emit-events being present — it indexes raw SPL transfers WHERE destination = `config.treasury`. Robust against any future fee-flow ix that doesn't emit an event.
2. **Outflow tracking** — indexes raw SPL transfers WHERE source = `config.treasury`. The program never witnesses these (Squads is the signer), so this is the only way to surface withdrawals in the admin dashboard.

Schema additions (Prisma — `services/indexer/prisma/schema.prisma`):

```prisma
model TreasuryFlow {
  id           BigInt   @id @default(autoincrement())
  txSignature  String   @unique
  slot         BigInt
  blockTime    DateTime
  direction    String   // "inflow" | "outflow"
  amount       BigInt   // base units (6-dec USDC)
  counterparty String   // source ATA (for inflows) | destination ATA (for outflows)
  memo         String?  // SPL memo instruction text, if present
  @@index([blockTime])
  @@index([direction])
}
```

Backfill: one-shot script reads all SPL transfer history on the treasury ATA from `config.treasury` creation slot onward. Re-runnable (`txSignature` uniqueness handles dedupe).

Metrics emitted to Prometheus:

- `roundfi_treasury_balance_usdc` (gauge, 6-dec USDC base units)
- `roundfi_treasury_inflow_total_usdc{period="24h|7d|30d|all"}` (gauge)
- `roundfi_treasury_outflow_total_usdc{period="24h|7d|30d|all"}` (gauge)
- `roundfi_treasury_withdrawal_count{period="24h|7d|30d|all"}` (gauge)

Alert (in `docs/observability/prometheus-alerts.yaml`):

- **`TreasuryUnexpectedOutflow`** — `increase(roundfi_treasury_outflow_total_usdc[1h]) > 0` and the corresponding withdrawal was not pre-announced in the team's internal channel. (The "pre-announced" signal is a Slack webhook the duty-officer toggles before proposing a withdrawal; absence of toggle + outflow detected = page.)

---

## Admin dashboard (PR #402)

A new page at `app/src/app/admin/treasury/page.tsx` rendered as `TreasuryStats` (`app/src/components/admin/TreasuryStats.tsx`). Read-only — all write actions happen in Squads' UI. Sections:

1. **Header** — current balance (USDC), config.treasury ATA, owner (Squads vault PDA), link to Squads UI for the multisig.
2. **Lifetime stats** — total inflows, total outflows, net retained, inflow rate (per 30d).
3. **Recent inflows** — last 25 entries, with source pool (decoded from `harvest_yield` event when available), tx sig + Solscan link.
4. **Recent withdrawals** — last 25 entries, with destination, memo, tx sig + Solscan link. Each row links to the corresponding Squads proposal (Squads exposes proposal URLs via its API; the indexer captures them when present).
5. **Pending Squads proposals** — calls Squads' indexer/API directly to surface in-flight withdrawal proposals BEFORE they're executed, so other multisig members get a heads-up via the RoundFi admin UI in addition to the Squads UI.
6. **Pending treasury-rotation banner** — if `config.pending_treasury != Pubkey::default()`, surface it prominently with the eta countdown. Withdrawal proposals during a pending rotation are visually flagged.

The dashboard is gated behind the same admin-route guard as the cranker page (`app/src/app/admin/cranker/page.tsx`) — wallet must be on the admin allowlist (`app/src/lib/walletAllowlist.ts`).

---

## Devnet rehearsal

Before the first mainnet withdrawal, run the full procedure end-to-end on devnet:

1. **Use a separate devnet multisig** from the one in the Squads ceremony rehearsal — keeps roles clear. Throwaway members, 2-of-3 threshold for speed.
2. **Have the devnet treasury already pointing at this multisig's vault PDA** (the devnet `harvest_yield` has been running; treasury balance is non-zero from devnet pool activity).
3. **Run the helper script** in `--dry-run` mode first:
   ```bash
   pnpm tsx scripts/mainnet/treasury-withdraw.ts \
     --recipient <devnet-recipient-ata> \
     --amount 1000000 \
     --memo "Devnet rehearsal — 2026-05-XX" \
     --url devnet \
     --dry-run
   ```
   Verify the script's source-ATA / mint / amount checks pass.
4. **Run it for real** with `--emit-tx-base64`, paste into the Squads devnet UI, propose + approve + execute.
5. **Verify on Solscan** that the SPL transfer landed.
6. **Verify the indexer + admin dashboard** picked up the outflow within 60s.
7. **Log the rehearsal** in `docs/operations/rehearsal-logs/YYYY-MM-DD-treasury-withdrawal-rehearsal.md` (template: copy the structure of `TEMPLATE-squads-rotation.md` and adapt sections).

The rehearsal log captures: multisig used, members, recipient, amount, tx sigs (propose / approve / execute), dashboard screenshot, any procedural surprises. Auditors expect to see at least one of these logged before mainnet.

---

## What can go wrong

### Recipient ATA is wrong (typo)

- **Pre-execute** — any approving member rejects the proposal. Re-propose with the correct address.
- **Post-execute** — funds went to the wrong ATA. Recovery depends on who controls the wrong ATA:
  - If the wrong ATA is one we control (e.g. a typo across our own list) → manual return via another SPL transfer from the wrong recipient's owner.
  - If the wrong ATA is uncontrolled → funds may be recoverable only via social engineering of whoever owns the wrong ATA. Effectively lost. **Mitigations:** the pre-execute 4-field visual verification (§ Step 2-3) + the recipient out-of-band confirmation (§ Recipient capture rule) + first-tx sanity ($1 test).

### Amount has a decimal-place error (e.g. extra zero)

- USDC has 6 decimals. `1_000_000` = 1 USDC, `1_000_000_000` = 1000 USDC. **Easy to slip.**
- **Mitigation:** the helper script prints amount in BOTH base units AND human-readable USDC ("Transferring 1_000_000 base units = 1.000000 USDC"). Squads UI also decodes the amount; visually verify in BOTH places.
- **Post-execute recovery** — same as wrong-recipient. Pre-execute is the only reliable backstop.

### Squads proposal sits unapproved past urgency window

- Routine ops: not urgent.
- Emergency drain: convene members out-of-band and approve in minutes. If a member is unreachable, the threshold-1 remaining members + a backup hardware-wallet recovery (per the team's pre-arranged compromised-member protocol) cover it.
- **Mitigation:** the 3-of-5 threshold tolerates up-to-2 unreachable members. If you're at 3-of-3 and one member is unreachable, you have a single point of failure — re-form to 3-of-5 BEFORE relying on this for emergencies.

### Treasury balance unexpectedly low

- Could be: (a) recent withdrawal not yet indexed, (b) `harvest_yield` running below expectations, (c) the treasury ATA itself was drained.
- **Triage:** compare `spl-token balance` direct query against indexer's `roundfi_treasury_balance_usdc`. Match → indexer is fine, real balance is low → root-cause via Solscan tx history. Mismatch → indexer drift, file incident.
- **If the ATA was drained without a Squads-approved proposal** → custody compromise. Trigger the [`emergency-response.md`](./emergency-response.md) incident protocol immediately + emergency drain to a fresh ATA + public disclosure.

### A spending-limit policy didn't trigger as expected

- Squads' spending-limit logic is opaque (members ask "why does this need 3 sigs, I thought 2 was enough"). Reasons usually: (a) per-token spending-limit period reset, (b) the recipient triggered an off-default policy, (c) the limit was misconfigured.
- **Mitigation:** maintain a documented mapping of "scenario → expected threshold" in this runbook, refreshed when Squads' policy config changes. Treat any unexpected threshold escalation as a signal to read the policy config, not as a bug.

---

## Tax & accounting hooks (out of scope, but flagged)

This runbook stops at the on-chain action. The legal / accounting / tax surface that wraps it:

- **Recognition events** — USDC inflow to treasury (from `harvest_yield`) may be a taxable event in the protocol's home jurisdiction depending on entity structure (foundation vs. operating company). Consult counsel pre-mainnet.
- **Internal transfers** — moving USDC between Squads-owned ATAs may or may not be a taxable event. Memo every transfer with the purpose.
- **Founder distributions** — vesting / cliff / withholding obligations apply per the cap-table. Distributions ahead of vesting events are usually a finance-and-legal violation, not just a process slip.
- **Audit trail** — auditors and tax preparers expect: tx sig + Squads proposal URL + invoice/payroll reference + recipient legal entity, all in one ledger. The team's internal bookkeeping system (Quickbooks / Xero / similar) consumes this. Out of scope here; flagged as a precondition for any real withdrawal.

---

## References

- ADR documenting the design choice: [`docs/adr/0008-treasury-custody-squads-multisig.md`](../adr/0008-treasury-custody-squads-multisig.md)
- Treasury field definition: [`programs/roundfi-core/src/state/config.rs:8`](../../programs/roundfi-core/src/state/config.rs)
- Treasury init: [`programs/roundfi-core/src/instructions/initialize_protocol.rs:46-48,76`](../../programs/roundfi-core/src/instructions/initialize_protocol.rs)
- Inflow path: [`programs/roundfi-core/src/instructions/harvest_yield.rs:120-130,294-303`](../../programs/roundfi-core/src/instructions/harvest_yield.rs)
- Rotation ix: [`propose_new_treasury.rs`](../../programs/roundfi-core/src/instructions/propose_new_treasury.rs) / [`commit_new_treasury.rs`](../../programs/roundfi-core/src/instructions/commit_new_treasury.rs) / [`cancel_new_treasury.rs`](../../programs/roundfi-core/src/instructions/cancel_new_treasury.rs)
- One-way lock: [`lock_treasury.rs`](../../programs/roundfi-core/src/instructions/lock_treasury.rs)
- Squads ceremony (establishes Squads custody): [`docs/operations/squads-multisig-procedure.md`](./squads-multisig-procedure.md#step-4--rotate-the-treasury-if-applicable)
- Generic key rotation (covers _address_ rotation, complementary to this doc's _withdrawal_ procedure): [`docs/operations/key-rotation.md`](./key-rotation.md#b-treasury-address-rotation)
- Emergency response: [`docs/operations/emergency-response.md`](./emergency-response.md)
- Bug bounty (one source of recipient ATAs): [`docs/security/bug-bounty.md`](../security/bug-bounty.md)
- Helper script (PR #401): `scripts/mainnet/treasury-withdraw.ts`
- Admin dashboard (PR #402): `app/src/components/admin/TreasuryStats.tsx`
- Squads spending limits docs: <https://docs.squads.so/main/spending-limits>
- Feature freeze constraint: [`FREEZE.md`](../../FREEZE.md)
