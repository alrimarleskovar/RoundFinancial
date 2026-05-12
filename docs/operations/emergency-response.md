# Emergency Response Playbook

> **When to open this doc:** something looks wrong. A user reports unexpected behavior. A monitoring alert fires. A researcher emails a vulnerability. A weird tx appears on Solscan. **You're not sure yet whether it's a real incident** — open this doc, run the triage steps, only then decide.
>
> **Pause first, ask questions later** is the official policy for any state-change uncertainty. `pause` is reversible in seconds; an exploited protocol is not.

---

## Severity tiers

| Tier      | Definition                                                                   | First response                                              | Authority needed   |
| --------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------ |
| **SEV-0** | Active exploit confirmed (funds being drained, attacker tx visible on-chain) | **Immediate pause** + comms within 1h                       | Authority          |
| **SEV-1** | Vulnerability with credible proof-of-concept but not yet exploited live      | Pause within 24h after assessment + fix-first then announce | Authority          |
| **SEV-2** | Suspicious activity that could be explained by user error OR exploit         | Triage 4-8h; pause if doubt persists                        | Authority          |
| **SEV-3** | Operational degradation (RPC errors, indexer drift) without fund risk        | Investigate; no pause needed                                | Anyone on the team |
| **SEV-4** | User confusion / UX bug / non-fund correctness                               | Standard issue triage                                       | Anyone             |

When in doubt, **escalate one tier up** until the responding signer confirms otherwise.

---

## Triage (first 10 minutes)

Regardless of how the report arrived (email, Discord, alert, Solscan watcher):

1. **Capture facts**
   - Reporter handle / email
   - Reported tx Signature (if any) → open on Solscan, screenshot the account-changes block
   - Reported program ID (if any) — should be one of the 4 deployed:
     - `roundfi-core`: `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw`
     - `roundfi-reputation`: `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2`
     - `roundfi-yield-mock`: `GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ`
     - `roundfi-yield-kamino`: `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb`
   - Affected pool PDA (if any) → resolve member/vault state via `solana account` decode
2. **Classify the tier** (see table above). Document the reasoning in the incident log.
3. **Designate one incident commander** (single human point of contact). Everyone else routes through them.
4. **Open the incident log** — clone [`incident-template.md`](./incident-template.md) to `docs/operations/incidents/YYYY-MM-DD-<short-slug>.md` and start filling in.

---

## SEV-0 — Active exploit

**Time matters. Pause first, then everything else.**

1. **Pause the protocol** (assumes the authority keypair is accessible):

   ```bash
   # via Solana CLI + SDK action; today done via the orchestrator script
   # Example shape:
   solana program invoke ... pause ... --keypair ~/.config/solana/keypairs/authority.json
   ```

   Once `pause` lands, all fund-movement instructions revert with `ProtocolPaused` except `settle_default` (which remains permissionless for grace-period cleanup).

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

## SEV-3 — Operational degradation

Examples: indexer falling behind, Vercel deploy failing, devnet RPC returning stale state.

1. **Identify the affected component** — indexer / app / RPC / something else
2. **Apply the standard fix for that component**:
   - Indexer: see [`#234 — reconciler hardening`](https://github.com/alrimarleskovar/RoundFinancial/issues/234) for the planned long-term fix; short-term restart the worker
   - App: check Vercel logs; redeploy if build broke
   - RPC: failover to backup endpoint
3. **Do NOT pause the protocol** — these are off-chain. Protocol is unaffected.

---

## SEV-4 — UX bug, no fund risk

Standard issue triage. Open a GitHub issue using the bug-report template. No special procedure.

---

## Unpause procedure

Run only after the underlying issue is resolved AND verified:

1. **Re-read state** — confirm `ProtocolConfig.paused == true` (sanity check before unpause)
2. **Run a dry-run test** on a side pool (devnet) — confirm the bug is fixed
3. **Sign the `unpause`** with the authority keypair
4. **Verify**:
   ```bash
   # ProtocolConfig.paused should now be false
   # Test wallet should succeed at contribute again
   ```
5. **Public comms**: "RoundFi protocol resumed. Incident postmortem will be published within 72h." + pin

---

## Authority key not accessible

If the authority keypair is **lost, locked, or compromised** and you cannot pause normally:

- **There is no on-chain recovery without that key.** The protocol cannot be paused by anyone else.
- **Mitigation moving forward** — multisig (Squads) before mainnet so 1 lost key isn't fatal.
- **In the meantime** — public-channel warning to users to stop interacting with the protocol immediately; mark the program IDs as compromised in `docs/devnet-deployment.md`.

This is the worst-case scenario and the reason multisig + HSM custody are mainnet pre-requisites (see [`key-rotation.md`](./key-rotation.md) pre-mainnet hardening list).

---

## Contact escalation

| Situation                                     | Contact                                                 |
| --------------------------------------------- | ------------------------------------------------------- |
| Internal coordination                         | Single point of contact: `roundfinance.sol@gmail.com`   |
| External reporter                             | Same email (per [`SECURITY.md`](../../SECURITY.md))     |
| Public disclosure ready                       | Project channel + Mirror / Dev.to post                  |
| Audit firm engagement (Adevar, Halborn, etc.) | Direct via the audit-firm contact from `AUDIT_SCOPE.md` |
| Solana Foundation / ecosystem coordination    | Solana Discord #security-incidents (mainnet only)       |

---

## Post-incident

Within 72 hours of resolution:

- Postmortem published using [`incident-template.md`](./incident-template.md)
- Affected user comms (if any user funds were at risk)
- Bug-bounty reward paid (if applicable) per [`bug-bounty.md`](../security/bug-bounty.md)
- Add a CHANGELOG entry under `[Unreleased]` for any fix that shipped
- If a new attack class was discovered → update `docs/security/self-audit.md` Section 6 + the threat-model table accordingly
- If operational gap was exposed → open a follow-up issue + update the relevant runbook in this directory
