# Feature Freeze — From `v0.4-canary` to Mainnet GA

> **Status:** ACTIVE as of `v0.4-canary` (2026-05-17).
>
> **Lifts on:** mainnet GA (Q4 2026 target) OR explicit `<unfreeze>` declaration in this file with reviewer sign-off.

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

| Condition                                                                                        | Status                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Mainnet GA achieved + first cycle complete                                                       | 🔴 Pending (Q4 2026 target)                       |
| Formal external auditor report received (Adevar / Halborn / OtterSec / Sec3 — selection pending) | 🔴 Pending (engagement in scoping)                |
| Founder + tech lead joint unfreeze in this file                                                  | 🔴 Pending (intentional friction — requires both) |

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

## Self-imposed escape valve

If during the freeze we discover that an additive change is genuinely required (e.g. external audit finds a missing constraint that must ship pre-canary), the procedure is:

1. Open PR with `[FREEZE-EXCEPTION]` tag
2. Tech lead + founder sign off in PR thread (not just code review approval)
3. Add row to "Active exceptions" table above with the PR number
4. Merge

This is friction by design. The friction is the feature.

## Lift signature block

When the freeze lifts, replace this section with:

```
FREEZE LIFTED on YYYY-MM-DD by:
  - Founder:        <signature>
  - Tech lead:      <signature>
  - Reason for lift: <one line>
  - Active SEVs at lift time: <list>
```

Until then, the freeze stands.

## See also

- [`CHANGELOG.md`](./CHANGELOG.md) — `v0.4-canary` release notes
- [`AUDIT_SCOPE.md`](./AUDIT_SCOPE.md) — mainnet timeline
- [`MAINNET_READINESS.md`](./MAINNET_READINESS.md) — pre-mainnet checklist
- [`docs/security/internal-audit-findings.md`](./docs/security/internal-audit-findings.md) — active SEVs

---

_Established: 2026-05-17 under PR #382 (chore/freeze-declaration). Tag marker: `v0.4-canary`._
