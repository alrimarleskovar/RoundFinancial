# Operations runbooks

> **Status: pre-mainnet drafts.** These runbooks document the operational procedures RoundFi uses (devnet) and will use (mainnet). They are versioned now so the team isn't writing them under incident pressure later. External auditors and partners can read them to understand operational maturity without asking.

| Runbook                                            | When to use                                                   | Who runs it                               |
| -------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| [`deploy-runbook.md`](./deploy-runbook.md)         | Every devnet redeploy + the eventual mainnet GA               | Anyone with deployer keypair access       |
| [`key-rotation.md`](./key-rotation.md)             | Rotating the protocol authority / treasury / deployer keys    | Authority holder (typically the deployer) |
| [`emergency-response.md`](./emergency-response.md) | Incident — exploit suspected, suspicious tx, RPC degradation  | First responder + comms lead              |
| [`incident-template.md`](./incident-template.md)   | Post-incident — write the postmortem within 72h of resolution | Incident commander                        |

## Conventions across all runbooks

- **Single source of truth for ops contacts**: `roundfinance.sol@gmail.com` (see [`SECURITY.md`](../../SECURITY.md))
- **Verification:** every state-change procedure ends with a verification step (re-read on-chain, check Solscan, run the relevant `solana-verify` command). Never "trust the tx Signature" alone.
- **Time discipline:** runbooks reference UTC clock for any "wait N hours / days" step. The 7-day treasury timelock from [PR #122](https://github.com/alrimarleskovar/RoundFinancial/pull/122) is the longest gate; everything else completes within minutes.
- **Devnet vs mainnet:** procedures noted as "(devnet-only)" or "(mainnet-only)" where the difference matters. Most runbooks are cluster-agnostic — flip the `--url` flag.

## What's NOT here (yet)

- Multisig (Squads) procedures — mainnet only; will be added before mainnet smoke
- HSM key custody for the deployer keypair — same
- On-call rotation schedule + comms templates — team-size-dependent; lands when the team is larger than 4

## Cross-links

- [`SECURITY.md`](../../SECURITY.md) — disclosure policy
- [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md) — protocol surface in/out of scope
- [`docs/security/self-audit.md`](../security/self-audit.md) — threat model + invariants
- [`docs/verified-build.md`](../verified-build.md) — reproducible-build attestation flow
