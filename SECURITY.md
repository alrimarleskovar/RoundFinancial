# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue.** If you believe you've found a security vulnerability in RoundFi, please report it privately so we can fix it before public disclosure.

### Preferred channel

Email: **roundfinance.sol@gmail.com** (PGP key on request).

### What to include

- A clear description of the vulnerability and its potential impact
- Steps to reproduce (devnet preferred; testnet/mainnet only if non-destructive)
- Affected component (`programs/roundfi-core`, `programs/roundfi-reputation`, `services/indexer`, `app/`, `sdk/`)
- Affected version / commit SHA
- Your suggested mitigation (optional but appreciated)
- Whether you wish to be credited in the fix announcement

### What to expect

- **Acknowledgement** within 72 hours
- **Triage** within 7 days (severity assessment + initial response with our reproduction status)
- **Fix or mitigation** scoped to severity:
  - Critical (funds at risk, privilege escalation): hours-to-days
  - High (degraded guarantees, recoverable losses): days-to-weeks
  - Medium / Low: scheduled into normal release cadence
- **Public disclosure** coordinated with reporter — typically 90 days after fix lands on `main`, or sooner if mutually agreed

### Scope

In scope:

- All code under `programs/`, `services/indexer/`, `sdk/`, `app/`, `tests/`
- Devnet deployment integrity (program ID + PDA derivation)
- Front-end → SDK → on-chain trust path (Phantom signing, transaction encoding)

Out of scope (please report to upstream maintainers instead):

- Solana runtime / BPF execution
- mpl-core program (NFT standard) — but **do** report any RoundFi misuse of mpl-core
- SPL Token program
- Phantom wallet
- Helius RPC infrastructure

### Bug bounty

A full bounty policy is drafted and versioned at [`docs/security/bug-bounty.md`](docs/security/bug-bounty.md): scope, 5-tier severity classification with the Immunefi v2.3 rubric, USD 25k–50k reward bands at the top, USD 50k initial pool, USDC-on-Solana payouts, 90-day coordinated disclosure, explicit safe-harbor clauses. The program **activates at mainnet GA** (Q4 2026 — see [`AUDIT_SCOPE.md`](AUDIT_SCOPE.md#mainnet-timeline)) via Immunefi (or HackenProof) syndication.

In the interim (devnet through mainnet smoke), valid reports go through the channel at the top of this file and qualify for:

- Public credit in `docs/security/self-audit.md` and the fix-PR description (with permission)
- A handwritten thank-you + RoundFi swag (T-shirt / sticker pack) for valid reports
- Up to USD 1,000 per Critical finding at team discretion during the mainnet-smoke phase

### Audit status

The protocol has completed an **internal pre-audit** (May 2026): 5-pass red-team exercise + 1 integration-testing wave + 7 follow-up waves (Kamino-spike discovery / Kamino-spike execution / Pass-8 constants / Pass-9 PDA seeds / Pass-10 canary-plan vs hardening / Pass-11 frontend mainnet / Pass-12 CD pipeline / Pass-13 canary-plan vs reality / Pass-14 indexer observability / Pass-15 emergency-response runbook) run by the RoundFi team **simulating an external auditor's methodology** + 1 external-audit pass (2026-05-24) — **49 findings catalogued, 45+ 🟢 closed** (Critical/High 14/14 including SEV-034b surfaced by the integration-testing wave, SEV-040/041/042 surfaced by Kamino-spike pre-audit, and SEV-047 reputation-farming — two-layer `promote_level` gate (cycles-gate Part 1 + identity-gate Part 2); live counts canonical in the tracker's [Summary table](docs/security/internal-audit-findings.md#summary)), 1 🟠 upstream-blocked (SEV-012 ← mpl-core borsh compatibility), 3 🔵 design-intentional. Mainnet operational scaffolding shipped: CD pipeline (SEV-046, devnet rehearsal 1g green on 2026-05-19), mainnet hardening pre-flight script (SEV-042 + SEV-044), structured indexer observability (Pass-14), Squads-aware emergency-response runbook (Pass-15). Public tracker at [`docs/security/internal-audit-findings.md`](docs/security/internal-audit-findings.md). See also the canonical internal audit at [`docs/security/self-audit.md`](docs/security/self-audit.md) and the post-mortem registry at [`docs/security/post-mortems/`](docs/security/post-mortems/).

**This is NOT an external auditor attestation.** The formal external audit engagement (Adevar Labs / Halborn / OtterSec / Sec3 — selection pending) is in **scoping** (cost/timeline negotiation) — the internal pre-audit was run _before_ commissioning the paid auditor so the formal audit's clock can go to harder questions rather than findings the team could surface independently. Please assume no external auditor has rubber-stamped this code yet. We're operating on devnet only — the CD pipeline (SEV-046) can deploy to mainnet on a signed git tag with a 3-of-5 Squads-approval gate, but no mainnet deploy has been authorized and no canary has run.

## Hall of fame

Reporters who find valid vulnerabilities will be credited here (with permission):

_None yet — be the first._
