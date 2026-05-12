# Incident Postmortem — `<short slug>`

> **Template.** Copy this file to `docs/operations/incidents/YYYY-MM-DD-<short-slug>.md` at the start of an incident; fill in as the response unfolds. Published version (post-resolution) lives in the same path on `main`.

---

## Summary

- **Incident ID:** `YYYY-MM-DD-<short-slug>`
- **Severity:** `SEV-0` / `SEV-1` / `SEV-2` / `SEV-3` / `SEV-4`
- **Status:** `active` / `mitigated` / `resolved` / `closed`
- **Discovered at:** YYYY-MM-DD HH:MM UTC
- **Resolved at:** YYYY-MM-DD HH:MM UTC
- **Duration:** Xh Ym
- **Incident commander:** `<name>`
- **One-sentence description:** ...

## Impact

- **Funds affected:** USD `<amount>` / 0 (specify pool PDAs)
- **Users affected:** count, or "all members of pool X", or "none"
- **Surface affected:** `roundfi-core` / `roundfi-reputation` / yield adapter / off-chain indexer / app frontend
- **Was the protocol paused?** Yes (`pause` tx `<sig>` at `<time>`) / No
- **Cluster:** devnet / mainnet smoke / mainnet GA

## Timeline (UTC)

| Time  | Event                                       | Notes                                   |
| ----- | ------------------------------------------- | --------------------------------------- |
| HH:MM | First signal (alert / report / observation) | reporter handle + tx sig if applicable  |
| HH:MM | Incident declared, severity assigned        | who decided + reasoning                 |
| HH:MM | First responder action                      | what was done                           |
| HH:MM | Pause issued (if applicable)                | tx Signature                            |
| HH:MM | Root cause identified                       | summary                                 |
| HH:MM | Fix developed                               | private branch link or just description |
| HH:MM | Fix deployed                                | redeploy tx Signature(s)                |
| HH:MM | Unpause issued (if applicable)              | tx Signature                            |
| HH:MM | Public comms posted                         | channel + permalink                     |
| HH:MM | Incident resolved                           | criteria met                            |

## Root cause

(Write this AFTER the incident is mitigated, not during.)

What actually happened, in chronological causal order. Avoid blame; focus on the mechanism. If the cause is a bug in our code, link the exact source line that's wrong + the fix commit.

Common root-cause categories (pick one as the primary classification):

- **Logic bug** — invariant assumption that didn't hold (Triple Shield bypass, integer overflow, etc.)
- **Account validation gap** — PDA seed, owner, or mint check missing/wrong
- **Authority misconfiguration** — wrong signer accepted, missing auth check
- **CPI assumption** — downstream program behavior changed or returned Ok without state change (cf. mpl-core TransferV1 in [self-audit §6.1](../security/self-audit.md#61-mpl-core-transferv1-plugin-authority-reset))
- **Operational error** — manual mistake during deploy / key handling / config update
- **Off-chain bug** — indexer / app / RPC layer issue with no on-chain consequence
- **External dependency** — upstream program (mpl-core, Kamino, SAS) behavior changed or had a bug
- **User error** — actually not a protocol bug; user's wallet config / tx construction was wrong

## How it was found

- **Internal alert?** Which monitor / log signature triggered.
- **External reporter?** Through SECURITY.md / bug-bounty / Discord / Twitter; their handle if they consented to public credit (per [bug-bounty.md §6](../security/bug-bounty.md)).
- **Self-noticed?** During what activity (manual review, devnet exercising, etc.).

## What worked (response)

What part of the response went smoothly. Examples:

- `pause` instruction was reachable in < 30 seconds from incident-commander declaration
- Solscan tx forensics let us reconstruct the affected accounts in 5 min
- Reporter responded to triage emails within 1h

## What didn't (response)

What should have been faster / clearer / less manual. Examples:

- The pause comms template wasn't drafted — we spent 15 min writing it instead of pushing
- Three team members had to log in to the SECURITY.md inbox separately because we didn't have shared access
- The deployer keypair was on one machine; if that machine was offline we couldn't have acted

## Mitigation

What was done to stop the active impact (pause, hotfix, ATA freeze, communication). Keep separate from "fix" — mitigation is the short-term stopgap; fix is the durable correction.

## Fix

Link to the PR(s) that landed the durable fix. Include:

- Diff scope
- New tests added (negative-path + regression specs)
- New runbook entries (if applicable)
- Migration plan if account layouts changed

## Disclosure

- **Public timeline:** when the incident was first acknowledged publicly + when full details were published
- **Coordinated with reporter?** (if applicable)
- **Bug-bounty payment:** amount + tx Signature (if applicable)

## Action items (post-incident)

Concrete follow-ups, each with a tracking issue:

- [ ] `#XXX` — Fix the root cause permanently (already done if "Fix" section is filled)
- [ ] `#XXX` — Add a monitor that would have caught this earlier
- [ ] `#XXX` — Update the runbook in `docs/operations/` for this scenario
- [ ] `#XXX` — Add a regression test to prevent recurrence
- [ ] `#XXX` — Hardening item that emerged from the response process (e.g. shared access to security inbox)

## Lessons learned

The single most important paragraph in the doc. What does this incident teach us about:

- The protocol's threat model (is there a class of bug we weren't watching for?)
- Our response process (what would we do faster next time?)
- Our tooling (what monitor / runbook / template was missing?)

Keep this honest. The postmortem culture is "blameless and brutal" — describe what went wrong without naming-and-shaming, but don't soften the gaps.

---

_Last updated: `<author> at YYYY-MM-DD HH:MM UTC`_
