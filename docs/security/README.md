# RoundFi Security Documentation — Reading Order

> **Purpose:** navigation index for the security docs in this directory. External reviewers (audit firms, partners) should follow this order on first read.

## TL;DR

| What you have | Time to read                     | When to read                                |
| ------------- | -------------------------------- | ------------------------------------------- |
| 5 min         | `../../AUDIT_SCOPE.md` (1-pager) | Before everything else                      |
| 10 min        | `audit-readiness.md`             | Strategic context                           |
| 5 min         | `internal-audit-findings.md`     | Adevar Labs audit — public findings tracker (28 SEVs, status, PRs) |
| 5 min         | `constants-audit-2026-05.md`     | Post-audit pattern sweep (SEV-002 / SEV-023 family) |
| 30 min        | `self-audit.md`                  | Deep dive on protocol guarantees            |
| 15 min        | `adversarial-threat-model.md`    | Sybil / ordering / griefing surface         |
| 15 min        | `mev-front-running.md`           | Solana-specific ordering attacks (9 ix)     |
| 10 min        | `frontend-security-checklist.md` | UX trust path (out of on-chain audit scope) |
| 10 min        | `indexer-threat-model.md`        | Off-chain consistency (Phase 3 B2B oracle)  |
| 5 min         | `bug-bounty.md`                  | Disclosure policy + reward tiers            |

**Total first-pass: ~2 hours.**

## Recommended reading sequence

### 1. Start here — `../../AUDIT_SCOPE.md` (repo root)

Statement-of-Work-shape doc:

- In-scope: 3 Anchor programs (8,341 LoC of Rust)
- Out-of-scope: yield-mock, harvest() path, frontend, indexer, SDK, tests
- 6 prior internal hardening PRs catalogued
- Mainnet timeline + engagement format

**Why first:** answers "what am I auditing" before any deep dive.

### 2. Strategy — `audit-readiness.md`

One-pager for security firms:

- TL;DR signals table (test count, security tests, devnet attestations, etc.)
- What the protocol does with funds (4 vault PDAs per pool)
- 5 ranked high-leverage focus areas for audit hours
- Pitch-vs-shipped honest framing table
- Real production bug already surfaced internally

**Why second:** strategic context before deep dive.

### 3. Audit findings tracker — `internal-audit-findings.md`

Public accountability record for the Adevar Labs audit (May 2026):

- 28 findings total (20 initial + 8 re-audit)
- One row per SEV — severity, status (🟢 Closed / 🟡 Deferred / 🟠 Blocked / 🔵 Won't fix), PR, technical note
- Disclosure timeline + summary table
- Methodology notes — pattern fingerprinting after SEV-002 / SEV-023

**Why third:** before reading the deep dive, see what the external review surfaced and how each finding was triaged.

### 3a. Pattern sweep — `constants-audit-2026-05.md`

Post-audit, deliberate sweep for the **SEV-002 / SEV-023 pattern** (devnet shortcut value pinned with a "MUST revert before mainnet" TODO that never closed):

- Full methodology + reproducible grep commands
- Findings table — hardcoded literals: 0; doc drift: 1 (fixed); default-permissive flags: 6 (documented)
- Verdict: the SEV-002 / SEV-023 family is closed

**Why now:** linked from the tracker as the most recent audit-driven sweep; demonstrates the "if it happened twice, sweep for instance #3" methodology.

### 4. Deep dive — `self-audit.md` (228 lines)

The canonical internal audit:

- §1 Assets at risk — 7 fund-bearing accounts
- §2 Trust assumptions — protocol authority, member, runtime, mpl-core, indexer
- §3 Invariants & enforcement — Triple Shield (Seed Draw, Solvency Guard, D/C) + PDA seeds + per-instruction privilege model
- §4 Test coverage — 53 security-specific tests mapped to invariants
- §5 Known limitations + caveats
- §6 Production bug surfaced + fixed (mpl-core `TransferV1` plugin reset)
- §7 Out of scope — future work register
- §8 Recommendations before mainnet
- §9 Disclosure channel
- §10 External auditor self-attestation matrix (10 auditor-first-pass concerns mapped to source + tests)

**Why fourth:** the rest of the docs cite this one. Read it once, refer back as needed.

### 5. Adversarial threat model — `adversarial-threat-model.md`

Qualitative threat model beyond direct default:

- §1 Sybil — N wallets, same human (cost table for N = 10/100/1000)
- §2 Reputation farming — low-installment attestations
- §3 Strategic ordering & coordinated griefing
- §4 Malicious Community Pool leader (post-mainnet variant)
- §5 Pool spam / DoS
- §6 MEV / front-running (cross-ref to dedicated doc below)
- §7 Summary table — attack class × Triple Shield coverage
- §8 Methodology gaps

**Why fifth:** complements self-audit §7 with the explicit Sybil framing.

### 6. MEV — `mev-front-running.md`

Solana-specific ordering analysis:

- §1 Solana ordering model (Jito searchers, leader rotation, parallel scheduling — differs from Ethereum mempool)
- §2 Per-instruction surface enumeration (**9 user-facing ix** × attack model × mitigations) — covers `contribute`, `claim_payout`, `release_escrow`, `escape_valve_list`, `escape_valve_buy`, `settle_default`, `harvest_yield`, `deposit_idle_to_yield`, `join_pool`
- §3 Summary — bounded griefing vs latent extraction
- §3.1 **Consolidated mitigations × tests table** — every code-level mitigation cross-referenced with the negative-path test that exercises it
- §4 Recommended audit focus
- §5 Methodology gaps
- Big-picture finding: Triple Shield constrains extraction to bounded griefing on all instructions except `escape_valve_buy` listing-race
- Companion: [`bug-bounty.md §4.1`](./bug-bounty.md) MEV severity sub-tiering (Critical → Informational)

**Why sixth:** deep on ordering-dependent attacks the on-chain audit will look at.

### 7. Front-end attack surface — `frontend-security-checklist.md`

UX-side checklist (explicitly out-of-scope of on-chain audit):

- §1 Threat model — 10 threats (T1-T10) on the user trust path
- §2 Hard mainnet blockers — visual identification, RPC trust, domain integrity, tx confirmation, wallet adapter
- §3 Recommended hardening — hardware wallet, phishing-resistant onboarding, defensive read patterns
- §4 Already shipped (8 items with file:line evidence)
- §5 What this does not cover
- §6 Verification checklist for canary smoke

**Why seventh:** separates client-side from on-chain trust path; auditor needs to know what they don't cover.

### 8. Indexer — `indexer-threat-model.md`

Off-chain consistency (Phase 3 B2B oracle dependency):

- §1 Trust boundary — 6 layers (ledger → Helius → RPC → indexer → DB → oracle)
- §2 Threat model — 19 threats in 4 categories (ingestion, reorg, storage, privacy)
- §3 Already-shipped mitigations
- §4 Hard mainnet blockers
- §5 Recommended hardening
- §6 Out of scope (boundary against on-chain audit)
- §7 Methodology gaps

**Why eighth:** Phase 3 product correctness. Not on the fund-movement trust path.

### 9. Disclosure & rewards — `bug-bounty.md`

Pre-mainnet policy draft:

- 3-phase activation (devnet smoke / mainnet canary / mainnet GA)
- 5-tier severity (Critical USD 25-50k → Informational HoF)
- USD 50k initial pool, Immunefi or HackenProof
- Safe-harbor clauses
- Scope mirror (in/out matches AUDIT_SCOPE.md)

**Why ninth:** for would-be reporters once mainnet ships. Pre-mainnet uses SECURITY.md's interim policy.

## Companion docs in other directories

These cross-reference the security docs and matter to the audit pre-engagement reading:

| File                                                                                       | What it adds                                             |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| [`../../AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md)                                             | Formal scope, LoC tally, prior PR hardening list         |
| [`../../MAINNET_READINESS.md`](../../MAINNET_READINESS.md)                                 | Path from devnet (M3) → mainnet GA; hard blockers marked |
| [`../../SECURITY.md`](../../SECURITY.md)                                                   | Vulnerability disclosure channel + SLAs                  |
| [`../verified-build.md`](../verified-build.md)                                             | OtterSec verify-build PDA flow + verification commands   |
| [`../operations/agave-2x-migration-plan.md`](../operations/agave-2x-migration-plan.md)     | Toolchain migration risk register (#230)                 |
| [`../operations/indexer-reorg-recovery.md`](../operations/indexer-reorg-recovery.md)       | On-call runbook for indexer reorg events                 |
| [`../architecture/pop-provider-evaluation.md`](../architecture/pop-provider-evaluation.md) | PoP provider evaluation matrix (#227)                    |

## What's deliberately NOT in this directory

- **Smart-contract source code** — lives in `programs/`
- **Test code** — lives in `tests/`
- **Operational runbooks** — live in `docs/operations/`
- **Architecture decisions** — live in `docs/architecture/`

## Maintenance

Update this README whenever a security doc is added, removed, or substantively reorganized. The reading-time estimates are rough — adjust if a doc grows past ~500 LoC.

---

_Last updated: May 2026. 7 security docs indexed (plus this README)._
