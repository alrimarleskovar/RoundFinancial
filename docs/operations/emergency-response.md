# Emergency Response Playbook

> **When to open this doc:** something looks wrong. A user reports unexpected behavior. A monitoring alert fires. A researcher emails a vulnerability. A weird tx appears on Solscan. **You're not sure yet whether it's a real incident** — open this doc, run the triage steps, only then decide.
>
> **Pause first, ask questions later** is the official policy for any state-change uncertainty. `pause` is reversible in seconds; an exploited protocol is not.

---

## Severity tiers

| Tier       | Definition                                                                                                                                                                                                                                           | First response                                                                                                      | Authority needed                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **SEV-0**  | Active exploit confirmed (funds being drained, attacker tx visible on-chain)                                                                                                                                                                         | **Immediate pause** + comms within 1h                                                                               | `ProtocolConfig.authority` (pre-Squads single key OR Squads multisig — see [Who can pause](#who-can-pause)) |
| **SEV-1**  | Vulnerability with credible proof-of-concept but not yet exploited live                                                                                                                                                                              | Pause within 24h after assessment + fix-first then announce                                                         | Same as SEV-0                                                                                               |
| **SEV-2**  | Suspicious activity that could be explained by user error OR exploit                                                                                                                                                                                 | Triage 4-8h; pause if doubt persists                                                                                | Same as SEV-0                                                                                               |
| **SEV-2b** | Unexpected protocol-level error firing (Triple Shield: `WaterfallUnderflow` / `EscrowLocked` / `SettleDefaultGracePeriodNotElapsed` / `AssetNotRefrozen` / `PrincipalLoss` / `HarvestSlippageExceeded` outside the canary's expected negative paths) | Triage 2-4h against [`docs/security/self-audit.md`](../security/self-audit.md) §6 then SEV-2 or SEV-1               | Anyone reads; signer needed only if pause decision lands                                                    |
| **SEV-3**  | Operational degradation (RPC errors, indexer drift, monitoring stack quirks) without fund risk                                                                                                                                                       | Investigate per [`docs/observability/pagerduty-runbook.md`](../observability/pagerduty-runbook.md); no pause needed | Anyone on the team                                                                                          |
| **SEV-4**  | User confusion / UX bug / non-fund correctness                                                                                                                                                                                                       | Standard issue triage                                                                                               | Anyone                                                                                                      |

When in doubt, **escalate one tier up** until the responding signer confirms otherwise.

### Who can pause

The `pause` instruction is signed by `ProtocolConfig.authority`. Two phases:

- **Pre-Squads-rotation (devnet today, mainnet day-0 pre-handover):** single keypair. Holder of `~/.config/solana/keypairs/authority.json` (or equivalent) signs directly. Time-to-pause: seconds to minutes once the operator is alerted.

- **Post-Squads-rotation (mainnet post-canary):** 3-of-5 Squads multisig PDA. The pause flow becomes: incident commander → Squads UI → propose `pause` tx → at least 3 of 5 signers approve → execute. Time-to-pause: **5–30 minutes** depending on signer availability and geography. See [`squads-mainnet-ceremony-checklist.md`](./squads-mainnet-ceremony-checklist.md) for the signer roster + on-call rotation. **This shifts SEV-0's "immediate pause" target from "seconds" to "as fast as quorum reaches" — the runbook's "within 1h" comms window stays the same, but the on-call rotation must guarantee 3-signer reachability inside 30 minutes.**

---

## Triage (first 10 minutes)

Regardless of how the report arrived (email, Discord, alert, Solscan watcher):

1. **Capture facts**
   - Reporter handle / email
   - Reported tx Signature (if any) → open on Solscan, screenshot the account-changes block
   - Reported program ID (if any) — cross-reference against `config/program-ids.<cluster>.json` (devnet / mainnet-beta) for the canonical IDs of the 4 deployed programs (`roundfi-core`, `roundfi-reputation`, `roundfi-yield-mock`, `roundfi-yield-kamino`). The latest devnet IDs are also captured in the SEV-046 rehearsal logs (e.g. [`2026-05-19-SEV-046-rehearsal-1g-success.md`](./rehearsal-logs/2026-05-19-SEV-046-rehearsal-1g-success.md)). Mainnet IDs come from the artifact uploaded by `.github/workflows/mainnet-deploy.yml`. **A program ID that doesn't match any of these is itself a finding — escalate to SEV-1 immediately (someone may be impersonating the program).**
   - Affected pool PDA (if any) → resolve member/vault state via `solana account` decode
   - **First-line Triple Shield check** — if the reported tx threw one of the runtime guards (`WaterfallUnderflow`, `EscrowLocked`, `SettleDefaultGracePeriodNotElapsed`, `AssetNotRefrozen`, `PrincipalLoss`, `HarvestSlippageExceeded`), record the error code and which pool/member fired it. These are the defense-in-depth invariants that should never fire outside of deliberate negative-path tests; an unexpected firing is SEV-2b at minimum.
2. **Classify the tier** (see table above). Document the reasoning in the incident log.
3. **Designate one incident commander** (single human point of contact). Everyone else routes through them. **Pre-Squads-rotation:** any team member. **Post-Squads-rotation:** ideally one of the 5 Squads signers — they can both coordinate AND sign without an extra handoff hop.
4. **Open the incident log** — clone [`incident-template.md`](./incident-template.md) to `docs/operations/incidents/YYYY-MM-DD-<short-slug>.md` and start filling in.

---

## SEV-0 — Active exploit

**Time matters. Pause first, then everything else.**

1. **Pause the protocol.** Path depends on the deployment phase (see [Who can pause](#who-can-pause)):

   **Pre-Squads-rotation (single keypair):**

   ```bash
   # Single-signer pause via the SDK orchestrator script.
   # `pnpm devnet:pause` is the canonical wrapper; for mainnet-beta
   # pre-rotation use `pnpm mainnet:pause` (refuses unless
   # SOLANA_CLUSTER=mainnet-beta + MAINNET_DEPLOY_CONFIRM sentinel).
   ANCHOR_WALLET=~/.config/solana/keypairs/authority.json \
   SOLANA_CLUSTER=mainnet-beta \
   pnpm exec tsx scripts/<cluster>/pause.ts
   ```

   **Post-Squads-rotation (3-of-5 multisig):**
   1. Incident commander opens the Squads UI (https://app.squads.so) on the protocol's multisig PDA.
   2. Propose new tx → "Program instruction" → `roundfi-core::pause` (no args).
   3. Ping the 5 signers via the agreed-on emergency channel (Signal group + PagerDuty escalation per [`pagerduty-runbook.md`](../observability/pagerduty-runbook.md)).
   4. At least 3 signers approve in Squads UI.
   5. Execute. Tx hash appears on Solscan within ~30s.

   Once `pause` lands, all fund-movement instructions revert with `ProtocolPaused` except `settle_default` (which remains permissionless for grace-period cleanup — covered by `roundfi-core::pause.rs` allowlist).

2. **Verify the pause took effect** — read `ProtocolConfig.paused` via `solana account` decode. Must be `true`. Also try a `contribute` from a test wallet on devnet — should fail with `ProtocolPaused`.

3. **Snapshot pre-pause state** — for each active pool, decode `Pool` PDA + all `Member` PDAs + the 4 vault balances. Store as JSON in the incident log. Critical for post-mortem reconciliation.

4. **First public comms** (within 1h):
   - Post on the project's official channel: "We've paused the RoundFi protocol while we investigate a security incident. No further action is required from users. Funds in custody remain in their vault PDAs and will be recoverable upon resolution. Updates every 4h until resolved."
   - Pin the post. Do NOT speculate about the vulnerability publicly.

5. **Reach out to the reporter** (if applicable) for collaborative resolution per [`docs/security/bug-bounty.md`](../security/bug-bounty.md).

6. **Investigate** — read the attacker's tx, identify the instruction + accounts used, reproduce locally if possible. If the vulnerability is a real on-chain bug (not a UX confusion):
   - Open a private security branch on the repo (`security/sev-0-<slug>`)
   - Develop + test the fix offline (no public PR until coordinated disclosure)
   - Land the fix following the [deploy runbook](./deploy-runbook.md) Step 3 onward
   - Unpause only after fix is verified live + tested

7. **Coordinated disclosure** (90 days standard, faster if mutually agreed):
   - Public PR with the fix
   - Postmortem published using [`incident-template.md`](./incident-template.md)
   - Bug-bounty reward paid per [`bug-bounty.md`](../security/bug-bounty.md)

---

## SEV-1 — Credible PoC, not yet exploited

Difference from SEV-0: you have time. **Use it.**

1. **Acknowledge the report** within 24h (per SECURITY.md SLA).
2. **Verify the PoC** internally — reproduce on devnet using a fresh test wallet. If reproducible → confirm SEV-1 (real). If not → downgrade to SEV-2 and continue triage.
3. **Develop the fix offline** (private security branch).
4. **Decide on pause timing**:
   - If the bug requires specialized knowledge to exploit → fix-first then announce (Triple Shield holds in the meantime)
   - If the PoC is in a public report (e.g. published before disclosure) → pause immediately
5. **Coordinated disclosure** same as SEV-0.

---

## SEV-2 — Ambiguous, could be exploit or user error

Most reports start here.

1. **Reproduce the reported behavior** in isolation. If it reproduces deterministically AND involves a fund-movement instruction → escalate to SEV-1.
2. **Cross-check against known issues**:
   - [`docs/security/self-audit.md`](../security/self-audit.md) §6 — bugs already found + fixed
   - [`docs/security/self-audit.md`](../security/self-audit.md) §7 — explicit out-of-scope
   - [Open issues with `security` adjacent labels](https://github.com/alrimarleskovar/RoundFinancial/issues?q=is%3Aopen+is%3Aissue+label%3Apre-mainnet+OR+label%3Amainnet-blocker)
3. **If still ambiguous after 4-8h** of investigation → pause as a precaution + escalate to SEV-1. Better a 2h unscheduled pause than a missed exploit.

---

## SEV-2b — Unexpected protocol error

Triple Shield + adapter guards (`WaterfallUnderflow`, `EscrowLocked`, `SettleDefaultGracePeriodNotElapsed`, `AssetNotRefrozen`, `PrincipalLoss`, `HarvestSlippageExceeded`, `YieldVaultDelta`, etc.) are defense-in-depth invariants. They should never fire outside of:

- Deliberate negative-path tests (devnet seed scripts, bankrun fixtures)
- The pre-pause `create_pool` constraint check during a pause-rehearsal
- An adversary's failed exploit attempt (the guard fires, the tx reverts, no funds move — the GOOD outcome of a defense-in-depth)

An unexpected firing on real funds is a signal that one of the protocol invariants was violated. Treat as SEV-2b:

1. **Capture the failing tx** — signature, instruction, all account states pre + post.
2. **Cross-check against the [`self-audit.md`](../security/self-audit.md) §6 "Bugs we found and fixed" register** — if the error matches a previously-closed bug, the regression is itself an exploit vector. Escalate to SEV-1.
3. **Cross-check against the `roundfi-math` invariants** — `WaterfallUnderflow` and `PrincipalLoss` in particular fire when `roundfi-math/waterfall.rs` or the Kamino redeem-vs-deposit accounting goes inconsistent. Run `pnpm test:math:proptest` against the affected pool state.
4. **If the error reproduces on devnet against the same instruction** with a clean test wallet → SEV-1 confirmed; pause + offline-fix; coordinated disclosure.
5. **If the error does NOT reproduce** → user-side data race or RPC stale-read; document in the incident log + downgrade to SEV-3.

The "defense-in-depth fires correctly" outcome (guard caught the bug, tx reverted, no fund movement) is **not an incident on its own** — the protocol behaved as designed. But the OPERATOR is now informed that someone is poking at the protocol. Combine with the indexer's webhook event-stream + RPC quorum logs to characterize the source.

---

## SEV-3 — Operational degradation

Examples: indexer falling behind, Vercel deploy failing, RPC returning stale state, backfill cron stale (`roundfi_indexer_last_backfill_status == 1` for >24h), reconciler unresolved count above the SLO of ≤100 per table.

1. **Identify the affected component** — indexer / app / RPC / monitoring / something else. Cross-reference the firing alert (if any) against [`docs/observability/pagerduty-runbook.md`](../observability/pagerduty-runbook.md) — each of the 8 alerts has a dedicated response procedure.
2. **Apply the standard fix for that component**:
   - **Indexer (reconciler)**: see [`#234 — reconciler hardening`](https://github.com/alrimarleskovar/RoundFinancial/issues/234) for the planned long-term fix; short-term restart the worker. The reconciler emits structured JSON logs (Pass-14) — `event_type: "reconciler_tick"` lines carry `reconciled`/`orphaned`/`pending`/`divergences` counters; check Loki / Datadog for the last 1h trend.
   - **Indexer (backfill cron)**: read the most recent `BackfillRun` row in Postgres (`prisma.backfillRun.findFirst({orderBy: {startedAt: "desc"}})`) — if `status == "error"`, the `errorMessage` field has the failure. Re-run `pnpm --filter @roundfi/indexer backfill` once the root cause is fixed.
   - **App**: check Vercel logs; redeploy if build broke. SEV-045's frontend allowlist tests should have caught any RPC config drift pre-deploy — if the failure mode involves a wrong cluster banner state, that's escalates to SEV-2 (user could mistake mainnet for devnet).
   - **RPC**: failover to backup endpoint. The reconciler's quorum check defends against single-RPC divergence — see `event_type: "rpc_quorum_divergence"` log lines.
3. **Do NOT pause the protocol** — these are off-chain. Protocol is unaffected.
4. **If the SEV-3 sits unfixed for >24h AND a SEV-2/2b/1 fires concurrently**, escalate to SEV-1 globally — observability blindness during an exploit attempt is a serious gap, not a routine degradation.

---

## SEV-4 — UX bug, no fund risk

Standard issue triage. Open a GitHub issue using the bug-report template. No special procedure.

---

## Unpause procedure

Run only after the underlying issue is resolved AND verified:

1. **Re-read state** — confirm `ProtocolConfig.paused == true` (sanity check before unpause).
2. **Run a dry-run test** on a side pool (devnet) — confirm the bug is fixed.
3. **Sign the `unpause`** — same authority surface as `pause`: pre-Squads single keypair; post-Squads 3-of-5 multisig via the Squads UI.
4. **Re-run `pnpm test:mainnet-hardening`** with the live mainnet RPC — every BLOCKER must pass (paused=false, treasury_locked=true, TVL caps, approved_yield_adapter, usdc_mint, metaplex_core pinning per SEV-042/044). Refuse to declare the incident resolved if any BLOCKER fails — that's a regression introduced by the fix itself.
5. **Verify**:
   ```bash
   # ProtocolConfig.paused should now be false
   solana account <protocol-config-pda> --url mainnet-beta --output json | jq ...
   # Test wallet should succeed at contribute again
   ```
6. **Public comms**: "RoundFi protocol resumed. Incident postmortem will be published within 72h." + pin.

---

## Authority key not accessible

The threat model + recovery story depends on the rotation phase.

### Pre-Squads-rotation (single keypair lost / locked / compromised)

- **There is no on-chain recovery without that key.** The protocol cannot be paused by anyone else.
- **In the meantime** — public-channel warning to users to stop interacting with the protocol immediately; mark the program IDs as compromised in `docs/devnet-deployment.md`.
- **Mitigation** — accelerate the Squads rotation (was always planned pre-mainnet anyway, see [`squads-mainnet-ceremony-checklist.md`](./squads-mainnet-ceremony-checklist.md)).

### Post-Squads-rotation (1+ signer keys lost)

| Lost signers | Quorum reachable?               | Posture                                                                                                                                                                                                  |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0            | Yes (3/5)                       | Normal operation                                                                                                                                                                                         |
| 1            | Yes (3/4 of remaining 4)        | Still safe — rotate the lost signer's key out via Squads "add/remove member" tx within the week                                                                                                          |
| 2            | Yes (3/3 of remaining 3)        | **Tight** — every active signer is now critical. Rotate both lost keys out ASAP; no buffer remains                                                                                                       |
| 3            | **No** — only 2 active out of 5 | **CATASTROPHIC** — protocol cannot pause or upgrade. Public-channel warning to users immediately; coordinate with Solana Foundation per [SECURITY.md](../../SECURITY.md) — there is no on-chain recovery |

The 1- and 2-lost cases are why the canary plan §3.1 mandates **signers from at least 3 different geographies** ([#266](https://github.com/alrimarleskovar/RoundFinancial/issues/266)): single-event correlation risk (same office, same earthquake zone, same provider outage) shouldn't cascade past lost-1.

### Compromised signer (different threat from lost)

A compromised key means an attacker can sign as the legitimate signer — they could approve a malicious tx if they reach the 3-signer threshold. Mitigation:

1. **Immediately rotate the compromised signer out via Squads** (the OTHER signers approve the rotation — assumes the compromise hasn't already burned through to quorum).
2. **If the attacker already has 3 signers compromised**, you've lost protocol authority. Time-to-disclosure should be measured in minutes — Squads transactions are timelocked but not infinitely; coordinate with users to withdraw via emergency paths if any (`escape_valve_list` / `escape_valve_buy` is permissionless for member-side exits; `settle_default` is permissionless for grace cleanup).

This is the worst-case scenario and the reason **5-of-5 signers in different geographies, hardware-wallet only, no shared cloud accounts** is in the canary-plan §3.1 hard-gate (see [`key-rotation.md`](./key-rotation.md) pre-mainnet hardening list).

---

## Contact escalation

| Situation                                                  | Contact                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal coordination                                      | Single point of contact: `roundfinance.sol@gmail.com`                                                                                                                                                                                       |
| Post-Squads-rotation pause/upgrade tx                      | Squads UI on the protocol multisig PDA + Signal group with 5 signers (roster pinned in [`squads-mainnet-ceremony-checklist.md`](./squads-mainnet-ceremony-checklist.md))                                                                    |
| Automated alert fired (Prometheus / PagerDuty)             | [`docs/observability/pagerduty-runbook.md`](../observability/pagerduty-runbook.md) — alert-specific response procedures (one per alert: BackfillCronStale, BackfillCronFailed, IndexerLagHigh, ReconcilerUnresolved, etc. — Pass-14 + #271) |
| External reporter (security@)                              | `roundfinance.sol@gmail.com` (per [`SECURITY.md`](../../SECURITY.md))                                                                                                                                                                       |
| Bug-bounty researcher (post-#270 Immunefi live)            | Immunefi platform (project page TBD); response SLA in [`docs/security/bug-bounty.md`](../security/bug-bounty.md)                                                                                                                            |
| Public disclosure ready                                    | Project channel + Mirror / Dev.to post                                                                                                                                                                                                      |
| Audit firm engagement (Adevar, Halborn, OtterSec, Sec3)    | Direct via the audit-firm contact from `AUDIT_SCOPE.md` — post-engagement, the internal pre-audit `docs/security/internal-audit-findings.md` is the cross-reference register                                                                |
| Solana Foundation / ecosystem coordination                 | Solana Discord #security-incidents (mainnet only)                                                                                                                                                                                           |
| Canary-window incident (within the 7-day post-canary soak) | Halt canary per [`mainnet-canary-plan.md`](./mainnet-canary-plan.md) §7; primary + secondary PagerDuty on-call signed up for the soak window must be paged; do NOT advance to retail-pool opening until incident is closed                  |

---

## Post-incident

Within 72 hours of resolution:

- Postmortem published using [`incident-template.md`](./incident-template.md) under `docs/operations/incidents/YYYY-MM-DD-<slug>.md`.
- Affected user comms (if any user funds were at risk).
- Bug-bounty reward paid (if applicable) per [`bug-bounty.md`](../security/bug-bounty.md).
- Add a CHANGELOG entry under `[Unreleased]` for any fix that shipped.
- **Add a SEV row to [`docs/security/internal-audit-findings.md`](../security/internal-audit-findings.md)** — the protocol's pre-audit register. Every incident gets a row regardless of severity: SEV-1+ gets a Critical/High classification; SEV-3 (operational) gets a Low or Info row that documents the systemic-risk lesson without inflating the runtime-bug count. If the incident surfaced a NEW class of bug (not previously known), also write a dedicated post-mortem under `docs/security/post-mortems/SEV-XXX.md` following the SEV-040 template (5-whys, timeline, methodology lesson, action items table).
- If a new attack class was discovered → update `docs/security/self-audit.md` Section 6 + the threat-model table accordingly.
- If operational gap was exposed → open a follow-up issue + update the relevant runbook in this directory. The Pass-N methodology pattern applies: generalize the lesson (every multi-month-old assumption needs a periodic reality-check audit) rather than just patching the specific gap.
- **If the incident involved an unexpected protocol error firing (SEV-2b path)**, update `tests/triple_shield.spec.ts` (or the equivalent integration suite) with a regression test that pins the new known-bad input + asserts the guard fires correctly. Same pattern as the SEV-040 post-mortem "process rule": any commit introducing or modifying a defense-in-depth invariant must include a sibling assertion in the same commit.
