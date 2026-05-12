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

The protocol is currently under **internal audit** (see [`docs/security/self-audit.md`](docs/security/self-audit.md)). External third-party audit is deferred to the mainnet migration phase. This means: please assume no external auditor has rubber-stamped this code yet. We're operating on devnet only.

## Hall of fame

Reporters who find valid vulnerabilities will be credited here (with permission):

_None yet — be the first._
