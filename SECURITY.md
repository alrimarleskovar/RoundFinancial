# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue.** If you believe you've found a security vulnerability in RoundFi, please report it privately so we can fix it before public disclosure.

### Preferred channel

Email: **security@roundfi.dev** (PGP key on request).

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

A formal bounty program is **planned for mainnet migration** (post-hackathon). Suggested platforms: Immunefi or HackenProof. Initial pool sizing TBD.

In the interim, we offer:

- Public credit in `docs/security/self-audit.md` and the fix-PR description (with permission)
- A handwritten thank-you + RoundFi swag (T-shirt / sticker pack) for valid reports

### Audit status

The protocol is currently under **internal audit** (see [`docs/security/self-audit.md`](docs/security/self-audit.md)). External third-party audit is deferred to the mainnet migration phase. This means: please assume no external auditor has rubber-stamped this code yet. We're operating on devnet only.

## Hall of fame

Reporters who find valid vulnerabilities will be credited here (with permission):

_None yet — be the first._
