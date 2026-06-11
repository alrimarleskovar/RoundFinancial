# Feature Freeze — From `v0.4-canary` to Mainnet GA

> **Status:** 🟢 **LIFTED on 2026-06-11** (see [Lift signature block](#lift-signature-block)). The freeze ran from `v0.4-canary` (2026-05-17) to 2026-06-11.
>
> **Why it lifted:** the freeze's external exit criteria (a formal third-party audit engagement; mainnet GA) sit on a longer horizon than the team's near-term development needs. Rather than gate active work on an external milestone whose timing the team does not control, founder and tech lead jointly exercised the self-directed exit criterion. The freeze achieved its purpose — the internal red-team converged (16/16 Critical/High closed, 0 open) — and development resumes under a raised internal-rigor bar (see "Post-lift discipline"), with a formal external audit retained as a hard gate before mainnet GA and real funds.

## What this means

From the moment `v0.4-canary` is tagged onward, the following **does NOT merge to `main`**:

1. **New features** of any size — protocol behavior changes, new instructions, new SDK surface area, new front-end routes/modals.
2. **Refactors** that aren't required for an active SEV remediation.
3. **Architecture changes** — program splits, module reorganization, dependency upgrades that aren't security-critical.
4. **New docs** that don't directly support an active mainnet-prep deliverable (canary plan, audit deliverable, ops runbook).
5. **"One more idea"** PRs — additive scope work without explicit unfreeze approval.

What **CAN** merge during the freeze:

1. **Bug fixes** that close a tracked SEV — must reference the SEV ID in the PR title.
2. **Audit findings remediation** — formal engagement findings (Adevar / Halborn / OtterSec / Sec3 — selection pending) take priority.
3. **CI / tooling fixes** that unblock the canary path (e.g. the deferred `bankrun-no-mpl-core` lane).
4. **Operational docs** filled out post-event (ceremony reports, drill logs, postmortems) — these are evidence captures, not new work.
5. **Security patches** for newly-disclosed CVEs in our dep tree.
6. **Pass-N doc-alignment sweeps** that keep auditor- and judge-facing docs (README, MAINNET_READINESS, AUDIT_SCOPE, SECURITY, security/\*, FREEZE) in sync with the live SEV tracker. These are stale-prevention against `docs/security/internal-audit-findings.md`, not new work. PR title must reference the sweep (e.g. `Pass-N`) and the table below must be updated.
7. **Pre-judge visibility fixes** during hackathon judging weeks — SEO files, README test-count sync, broken-link fixes that affect what a non-aligned reviewer sees first. Bounded scope (no behavior change), tracked here.
8. **Governance ADRs** that document an already-made decision (e.g. ADR 0008 treasury custody — confirms current Squads-multisig path rather than introducing it).

## Why this freeze exists

The session that produced `v0.4-canary` ran 252 commits in 22 days — well above sustainable velocity. The disciplined response is to **stop adding** and start validating against external touchpoints (Adevar engagement, Squads ceremony, canary smoke). Two empirical signals motivated the freeze:

- **SEV-040 + SEV-041** (Critical, both Kamino integration) were caught by the bankrun-clone spike — proves that adding code faster than we can validate creates real bug surface. Both would have failed at canary mainnet, costing $5 + redeploy ceremony.
- **5 doc-refresh waves** (PRs #370-#374) closed real drift but also confirmed Pattern 1 from the session's critical analysis: velocity > documentation discipline. Documentation work is also feature work in disguise.

## Unfreeze criteria

The freeze lifts when **any one** of the following is true:

| Condition                                                                                        | Status                                                                    |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Mainnet GA achieved + first cycle complete                                                       | 🔴 Not yet (Q4 2026 target)                                               |
| Formal external auditor report received (Adevar / Halborn / OtterSec / Sec3 — selection pending) | 🔵 Retained as a pre-mainnet gate (longer horizon than this lift)         |
| Founder + tech lead joint unfreeze in this file                                                  | 🟢 **MET 2026-06-11** — see [Lift signature block](#lift-signature-block) |

## Reviewer requirement during freeze

Every PR opened against `main` during the freeze must:

1. Reference a tracked SEV ID **or** an "exception" line in this doc justifying the work.
2. Be reviewed by at least one of: founder, tech lead, security advisor.
3. Include a `[FREEZE-EXCEPTION]` tag in the PR title for visibility.

The `.github/workflows/freeze-enforcement.yml` workflow automates checks #1 and #3 by asserting the PR title contains either a `SEV-\d+` reference or the literal `[FREEZE-EXCEPTION]` tag. The gate auto-skips for `dependabot[bot]` and `renovate[bot]` authors (the CVE-patch lane explicitly allowed below). Check #2 is human-judged by reviewers.

## Active exceptions

(Approved during freeze, tracked here for audit trail.)

| Date       | Approver | PR / Commit                              | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | -------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-21 | Founder  | `db93a05`                                | Tooling (item 3): `.env.example` stub for Colosseum Copilot API. No protocol behavior change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-05-21 | Founder  | `6f0dd06`                                | Tooling (item 3): `.agents/skills/colosseum-copilot/` install via skills CLI. No protocol behavior change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-21 | Founder  | `485e8dd` (PR #401)                      | Governance ADR (item 8): ADR 0008 `treasury-custody-squads-multisig` + runbook. Documents current path, doesn't introduce new behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-05-21 | Founder  | `3dd0bd9`                                | Pre-judge visibility (item 7): `robots.ts` + `sitemap.ts` + README test count bump 280+→300+. Bounded, no behavior change.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-23 | Founder  | `claude/colosseum-judge-readiness` PR    | Pass-18 doc-alignment sweep (item 6): README + AUDIT_SCOPE + internal-audit-findings + security/README numerics synced with live tracker (33→47 SEVs, 10/10→13/13 C+H). Pitch-deck-EN PT translation. Broken ADR-0007 + ADEVAR_AUDIT_REPORT.md link fixes.                                                                                                                                                                                                                                                                                                                        |
| 2026-05-24 | Founder  | `claude/implement-roundfi-desktop-SRV6l` | Pre-judge visibility (item 7): README fuzz cumulative 503M→9.85B reflecting fresh 600M iter afternoon re-validation + **8.75B overnight sweep 2026-05-24** (6 targets × 1h each, all stable cov 50-66 ft 52-68, 0 crashes across entire history). Pre-Canary critical path Dia 1-2 deliverables: ADR numbering shift (0008→0009 referral, 0009→0010 grace) + label spec + SEV-in-smoke flow + D1 schema 3 alternativas Prisma. Briefing + slides + verificação infra pra reunião do Canary. i18n fix Stress Lab (22 keys for 11 new presets from issue #228). No behavior change. |
| 2026-05-26 | Founder  | PR #412 (`[FREEZE-EXCEPTION]`)           | ECO-002/003 (item 5 — additive economics surface): `StressLabConfig.installmentUsdc` opt-in independent installment (presets byte-identical) + `FrameMetrics.overCollection`; ECO-003 "16.7% breakpoint" re-derived (artifact of retracted premises; gone under on-chain $600). Founder-approved.                                                                                                                                                                                                                                                                                 |
| 2026-05-26 | Founder  | PR #413 (`[FREEZE-EXCEPTION]`)           | Wallet receive QR (item 7 — bounded front-end visibility): `/carteira` Receive modal QR code. No protocol behavior change. Founder-approved.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-05-30 | Founder  | PR #402 (`[FREEZE-EXCEPTION]`)           | Canary grace gate (`pre-ceremony-beta` §6.3 Opção B): opt-in cargo feature `devnet-canary` lowers `GRACE_PERIOD_SECS` 604_800→86_400 (exactly the SEV-002 floor) for the 48h-cycle Canary phase. Feature is NOT default; SEV-002 floor guard runs in both modes (`86_400 >= 86_400`). No mainnet behavior change. Founder-approved.                                                                                                                                                                                                                                               |
| 2026-06-09 | Founder  | (`[FREEZE-EXCEPTION]`)                   | Governance ADR (item 8): amend `architecture.md` §3.3 / §3.4 / §4.2 / §4.5.0 + new §4.7 documenting the team's 2026-06-09 decision on reputation v5.2 (Hybrid path + 4-tier ladder, decisions 3-5 deferred). Forward-pointer notes added to `README.md` and `docs/pitch-alignment.md`. Records an already-made decision; no behavior change, no Rust, no SDK. Decision log: `mobile/docs/reputation-v2/06-team-decisions.md`. Founder-approved.                                                                                                                                   |
| 2026-06-01 | Founder  | PR #441 (`[FREEZE-EXCEPTION]`)           | Audit findings remediation (item 2): new `services/crank/` daemon closes the 6 gaps from the internal canary-readiness audit (settle_default firing, continuous polling, /health 503 contract, RPC liveness probe, typed `pool.all()` decoder, INFRA/LOGIC error classifier). Postgres lease mirrors the indexer's `reconciler_lease` pattern. No on-chain change, no schema change, no consumer wired yet — daemon doesn't run until Railway is pointed at it. Founder-approved.                                                                                                 |

## Self-imposed escape valve

If during the freeze we discover that an additive change is genuinely required (e.g. external audit finds a missing constraint that must ship pre-canary), the procedure is:

1. Open PR with `[FREEZE-EXCEPTION]` tag
2. Tech lead + founder sign off in PR thread (not just code review approval)
3. Add row to "Active exceptions" table above with the PR number
4. Merge

This is friction by design. The friction is the feature.

## Lift signature block

```
FREEZE LIFTED on 2026-06-11 by:
  - Founder:            Yvina
  - Tech lead:          Alrimar S.
  - CPO:                Caio
  - Security engineer:  Gabriel
  - Reason for lift:    Deliberate timing decision. The freeze achieved its
                        purpose — the internal red-team converged (16/16
                        Critical/High closed, 0 open). The external-audit and
                        mainnet-GA exit criteria sit on a longer horizon than
                        the team's near-term roadmap, so founder and tech lead
                        exercised the self-directed exit criterion to resume
                        active development now, under a raised internal-rigor
                        bar. A formal external audit is retained as a hard
                        gate before mainnet and real funds. Reputation v5.2
                        (Hybrid) is the first post-lift workstream.
  - Active SEVs at lift time: 0 open. 51 catalogued, 49 closed in code,
                        2 design-intentional (SEV-018 won't-fix, SEV-032
                        acknowledged). Critical/High 16 of 16 closed
                        (6 Critical + 10 High). Source of truth:
                        docs/security/internal-audit-findings.md.
```

## Post-lift discipline (replaces the freeze gate)

The freeze is gone, but the lessons that motivated it are not. The
empirical trigger was SEV-040/041 (Critical, Kamino) found by validation —
"velocity > validation creates bug surface." With **no external-audit net
on the current timeline**, internal rigor is raised to compensate:

1. **Integration tests are mandatory for any new on-chain instruction or
   behavior change** — bankrun or litesvm, not just host-side unit tests.
   A pure-function unit test is necessary but not sufficient for a
   lifecycle-boundary change.
2. **Negative regression test before merge** for any Critical/High fix
   (the rule that came out of SEV-029) stays in force.
3. **Small, reviewable PRs** — one concern per PR. The freeze enforced this
   indirectly via friction; now it's a norm, not a gate.
4. **`docs/architecture.md` stays the source of truth** — amend it in the
   same PR (or a preceding one) as any protocol/account change. The
   reputation v5.2 work follows this (§4.7).
5. **External audit remains the bar for mainnet GA + real funds.** Lifting
   the freeze unblocks devnet/canary development; it does NOT change the
   pre-mainnet requirement for a formal audit (see `MAINNET_READINESS.md`).

The `.github/workflows/freeze-enforcement.yml` gate is flipped to a no-op
(early-return success) rather than deleted, preserving the audit trail of
how the freeze was enforced while it was active.

## See also

- [`CHANGELOG.md`](./CHANGELOG.md) — `v0.4-canary` release notes
- [`AUDIT_SCOPE.md`](./AUDIT_SCOPE.md) — mainnet timeline
- [`MAINNET_READINESS.md`](./MAINNET_READINESS.md) — pre-mainnet checklist
- [`docs/security/internal-audit-findings.md`](./docs/security/internal-audit-findings.md) — active SEVs

---

_Established: 2026-05-17 under PR #382 (chore/freeze-declaration). Tag marker: `v0.4-canary`._
