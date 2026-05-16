# Human Passport Bridge — Threat Model

> **🚧 Implementation status (W5 framing correction):** the on-chain
> validator (`programs/roundfi-reputation/src/identity/passport.rs`)
> is implemented and exercised in tests; the **off-chain bridge service
> described below is NOT yet running**. The architecture, trust
> boundary, and threats-vs-mitigations are pre-audited here so the
> protocol can describe its target identity surface honestly — but
> the bridge itself is roadmap, not live. External communications
> should say **"Human Passport-ready"** or **"planned integration"**,
> NOT "Human Passport-integrated." Auditor's W5 #7 explicitly flagged
> the risk of conflating "validator code shipped" with "bridge service
> live" — this badge resolves the framing.
>
> Pre-mainnet checklist for activation is at the bottom of this doc.
>
> **Why this doc exists:** the Adevar Labs W3 re-audit (point #4) flagged
> the off-chain Human Passport bridge as a pending trust boundary that
> needed an explicit threat model before mainnet. The bridge is the only
> non-program trust dependency in the identity layer — every other write
> path is either a user signature or a deterministic CPI from
> `roundfi-core`. This document enumerates the threats, the mitigations
> the on-chain validator already enforces, and the **operational gaps**
> that block the bridge from going live.

## Architecture in one paragraph

Human Passport's score is **off-chain** (HTTPS API; stamps; score
thresholds). To put it on-chain we run a single-purpose bridge service:
it queries the Passport API for a wallet's score, and if the score is
≥ the configured threshold it writes an 83-byte attestation account on
Solana under the bridge service's pubkey. The on-chain validator
(`programs/roundfi-reputation/src/identity/passport.rs`) reads that
account, asserts `owner == config.passport_attestation_authority`, and
parses the inlined fields by byte offset. The 83-byte layout is reused
verbatim from the original Civic Gateway-Token v1 shape so the
byte-offset validator carries unchanged after the Civic → Human Passport
provider migration (#227).

```
┌──────────────┐  HTTPS  ┌──────────────┐  signed tx  ┌─────────────────────────┐
│ Passport API ├────────►│ Bridge svc   ├────────────►│ Solana mainnet           │
│ (web2)       │  score  │ (off-chain)  │  write 83B  │ AttestationAccount (83B) │
└──────────────┘         └──────────────┘             │ owner = bridge pubkey    │
                                                      └──────────┬───────────────┘
                                                                 │ read+validate
                                                                 ▼
                                                      ┌──────────────────────────┐
                                                      │ roundfi-reputation       │
                                                      │ link_passport_identity   │
                                                      │ refresh_identity         │
                                                      └──────────────────────────┘
```

## Trust assumptions

| Component                                     | Trust level                                                                           | Compromise impact                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Passport API (Web2)                           | Trusted for score truth, untrusted for availability                                   | Wrong scores cascade to bridge → can be detected by anomaly monitoring on score deltas                                                        |
| Bridge service authority key                  | Trusted (same operational tier as treasury multisig)                                  | All Passport-linked identities become spoofable; cycle attestations remain unaffected because they are written by `roundfi-core` program PDAs |
| 83-byte attestation account                   | Untrusted — owner-checked + byte-validated                                            | Forged account = rejected by validator (owner check fails)                                                                                    |
| `config.passport_attestation_authority` field | Trusted (mutable via `update_reputation_config`; gated by 7-day timelock per SEV-021) | Wrong authority → no valid attestations parse → degraded UX but no fund loss                                                                  |

## Threats × mitigations

### T1 — Bridge service key compromise

**Scenario:** an attacker who steals the bridge service's signer key can
write attestations for any wallet at any score, bypassing the Passport
API entirely.

**Blast radius:**

- **Identity verification status** for every linked wallet becomes
  untrustworthy. The attest weighting logic (`attest.rs::handler`) gives
  verified wallets a 2× score-delta multiplier for positive schemas;
  with a forged verified status, the attacker (or anyone they coordinate
  with) doubles their score-pump rate.
- **Sybil resistance** is the primary defense the bridge provides; a
  compromised bridge effectively turns the protocol back into a no-
  sybil-check state. The 50/30/10 stake rule and the cycle cooldowns
  remain effective floors.
- **Fund movement** is NOT directly affected — cycle attestations
  (PAYMENT, LATE, DEFAULT, CYCLE_COMPLETE) are written by
  `roundfi-core` pool PDAs, not by the bridge service. The bridge only
  writes the identity attestation read at `link_passport_identity` /
  `refresh_identity` time.

**Mitigations in place:**

- Bridge key is stored in the same operational tier as the treasury
  multisig (3-of-5 Squads on mainnet).
- `passport_attestation_authority` is rotatable via
  `update_reputation_config`. After SEV-021, rotation is gated by the
  7-day reputation authority timelock (`REPUTATION_AUTHORITY_TIMELOCK_SECS`).
- Cycle attestations (the fund-movement-adjacent ones) are program-PDA
  signed, immune to bridge compromise.
- The 50/30/10 stake rule means a level-3 (Veteran) wallet still
  deposits 10% of credit as collateral — score-pumping does not unlock
  unsecured credit.

**Mitigations pending:**

- **Anomaly monitoring** — a script that polls the bridge's attestation
  rate and flags spikes beyond a normal baseline. Not yet wired up.
- **Bridge key HSM** — currently the bridge key is on a hot wallet on
  the bridge host. Moving to an HSM is a mainnet preflight item.
- **Score-delta replay limits per subject** — currently SEV-027 +
  SEV-030 rate-limit admin-direct attestations to 60s/subject. A
  similar rate-limit on the bridge-issued attestation refresh path
  would reduce the rate at which a compromised bridge could backdate
  identity timestamps. Filed as future work.

### T2 — Bridge service writes wrong score

**Scenario:** the bridge service is honest but has a bug or stale cache,
and writes an attestation that overstates the wallet's true Passport
score.

**Blast radius:** identical to T1 for the affected wallets, but
unintentional and lower-volume.

**Mitigations:**

- Bridge service is the only piece of off-chain RoundFi infrastructure
  with write authority to chain state. It's treated with the same
  deployment discipline as treasury operations: signed releases, code
  review, staged rollouts.
- `refresh_identity` re-validates the attestation each time it's called
  (currently called on every `attest` ix via the optional identity
  account path), so a fix to the bridge propagates without manual
  re-link.

### T3 — Replay of an old attestation

**Scenario:** an attacker observes a legitimate attestation account
(83 bytes, embedded in a tx), copies it to a new wallet's
IdentityRecord, and tries to claim the verification status.

**Mitigations in place:**

- The attestation account's `owner` field (byte 1, `Pubkey`) is the
  **user wallet** the attestation was issued for. The validator at
  `passport.rs::validate_passport_attestation` requires
  `view.owner == wallet.key()` — replaying an attestation against a
  different wallet fails the check.
- The attestation account is rent-paid by the bridge service; the
  bridge service is the sole owner; rewriting requires the bridge
  signer.

### T4 — Stale attestation past expiry

**Scenario:** an attestation was issued when the wallet had a high
score, but the wallet's stamps have since expired and the real
Passport score is now below threshold.

**Mitigations in place:**

- `expire_time` field (byte 66, i64) is honored by the validator. If
  the field is non-zero and `now >= expire_time`, the validator
  returns `PassportStatus::Expired`.
- The bridge service writes a default 90-day TTL on issuance.
- `refresh_identity` ix lets users (or any caller, permissionlessly)
  trigger a re-read and re-validate; expired attestations flip
  `IdentityRecord.status` to `Revoked`.

**Gaps:**

- The 90-day TTL is a bridge-service policy, not enforced on-chain.
  A compromised bridge could write a 10-year TTL. Pinning the
  maximum TTL on-chain is filed as future work.

### T5 — Bridge service offline / Passport API offline

**Scenario:** the bridge is down for an extended period. Existing
linked identities continue to work (the on-chain attestation account
doesn't disappear), but new wallet links cannot be created and
expired attestations cannot be refreshed.

**Blast radius:** UX degradation only. No fund loss; protocol continues
running.

**Mitigations in place:**

- The on-chain protocol treats "no identity linked" as Unverified,
  which halves the score-delta weight on positive schemas. The pool
  continues to operate; the affected wallet just builds reputation at
  half-speed until the bridge recovers.
- Bridge service runs in a redundant deployment (mainnet plan: ≥ 2
  hosts behind a load balancer, both pinned to the same Squads-controlled
  signer key).

**Gaps:**

- A multi-provider abstraction (Passport + Sumsub fallback) is not yet
  implemented. The 83-byte attestation envelope is provider-agnostic
  by design, but no second provider is wired up. Filed as Phase 3 work.

## Required pre-mainnet checklist

| Item                                                                   | Status                                          | Owner |
| ---------------------------------------------------------------------- | ----------------------------------------------- | ----- |
| Bridge key moved to HSM                                                | 🔴 Not started                                  | Ops   |
| Bridge anomaly monitoring (attestation rate, score-delta histograms)   | 🔴 Not started                                  | Ops   |
| On-chain max-TTL clamp in validator (cap at 365 days)                  | 🟡 Designed, not implemented                    | Eng   |
| Per-subject rate-limit on `refresh_identity` (60s floor)               | 🟡 Designed, not implemented                    | Eng   |
| Bridge service signed-release process documented                       | 🟢 Done — same as treasury                      |
| Bridge multisig authority (`passport_attestation_authority`) on Squads | 🟢 Done — set at protocol init                  |
| Bridge service runbook for key rotation                                | 🟢 Done — see `docs/operations/key-rotation.md` |
| Bridge-side TTL policy documented                                      | 🟢 Done — 90 days default                       |

## What this doc does NOT cover

- **Phase 3 B2B oracle** — the indexer threat model
  ([`indexer-threat-model.md`](./indexer-threat-model.md)) covers that
  surface separately. The bridge is upstream of B2B; if the bridge
  fails, B2B reads stale scores.
- **Civic-side state** — the original Civic Gateway-Token v1 path is
  no longer supported (#227 retired it). The 83-byte layout is kept
  for byte-compat with pre-#227 IdentityRecord PDAs, but new issuance
  is Passport-only.
- **KYC-grade verification** (Sumsub / Persona) — out of scope for
  current sprint; the attestation envelope is designed to accept it
  later without protocol changes.

## See also

- [`programs/roundfi-reputation/src/identity/passport.rs`](../../programs/roundfi-reputation/src/identity/passport.rs) — validator implementation
- [`programs/roundfi-reputation/src/state/identity.rs`](../../programs/roundfi-reputation/src/state/identity.rs) — IdentityRecord layout
- [`docs/architecture/pop-provider-evaluation.md`](../architecture/pop-provider-evaluation.md) — provider selection rationale (#227)
- [`docs/operations/key-rotation.md`](../operations/key-rotation.md) — bridge key rotation procedure
- [`docs/security/internal-audit-findings.md`](./internal-audit-findings.md) — SEV-021 timelock on `passport_attestation_authority` rotation
