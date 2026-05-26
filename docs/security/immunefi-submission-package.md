# Immunefi Submission Package — RoundFi

> **Purpose:** ready-to-submit package for activating the RoundFi bug bounty on Immunefi (or HackenProof — same format works) at mainnet GA. Everything below is pre-filled from [`bug-bounty.md`](./bug-bounty.md) (policy source of truth) and [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md) (scope). The operator just needs to:
>
> 1. Open https://immunefi.com/launch-bounty/
> 2. Copy/paste each section below into the corresponding form field
> 3. Upload the JSON asset list (§3) via Immunefi's import flow
> 4. Confirm the team-controlled treasury address holding the USD 50k initial pool (§9 funding section)
> 5. Wait for Immunefi review (~5 business days)
> 6. Update `bug-bounty.md` status banner from "draft" to "live" + add Immunefi URL
>
> **Pre-mainnet:** this file sits ready. Submission is gated on mainnet deploy + treasury USDC pool funded.

## 1. Project Overview (Immunefi "About" field)

```
RoundFi is an open-source ROSCA (Rotating Savings & Credit Association) primitive on Solana. Members pool monthly USDC installments, take turns receiving the credit lump per cycle, and build an on-chain SAS-compatible behavioral credit score over time. The protocol implements a "Triple Shield" solvency invariant (seed-draw retention, adaptive escrow, solidarity vault + yield cascade) enforced by 20 instructions across 3 Anchor programs:

  - roundfi-core (~6500 LoC): pool lifecycle, custody, treasury rotation timelock, harvest waterfall, escape valve NFT marketplace
  - roundfi-reputation (~1200 LoC): SAS-compatible attestation issuance, level promotion, identity scaffold
  - roundfi-yield-kamino (~770 LoC): adapter to Kamino Lend for yield-bearing idle USDC

Pre-engagement internal audit completed (49 findings, 46 closed, Critical/High 14/14) — see https://github.com/alrimarleskovar/RoundFinancial/blob/main/docs/security/internal-audit-findings.md.

The protocol is live on devnet today; mainnet GA is gated on formal external audit (Adevar Labs engagement in scoping) + Squads multisig ceremony + this bug bounty going live.
```

## 2. Severity Classification (Immunefi v2.3 rubric mapping)

| Severity      | Definition                                                                                                                   | Reward (USDC)                | Notes                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| Critical      | Direct theft / freeze of user funds, governance takeover, protocol-wide insolvency vector                                    | $25,000–$50,000              | Reward scales with TVL impacted at time of report |
| High          | Theft / freeze of LP-share yields, denial of service blocking primary user actions (>1h), partial governance compromise      | $10,000–$25,000              |                                                   |
| Medium        | Denial of secondary functionality (e.g. NFT marketplace, indexer), incorrect score attribution, recoverable accounting drift | $2,500–$10,000               |                                                   |
| Low           | Information disclosure (off-chain), griefing without economic damage, missing input validation w/o exploit path              | $500–$2,500                  |                                                   |
| Informational | Code quality, missing tests, gas optimization, doc errata                                                                    | Hall of Fame + swag, no cash |                                                   |

**Initial pool: USD 50,000 USDC on Solana.** Replenished after each payout. Capped at USD 100,000 total annual spend until TVL > $5M (then re-scope upward).

**Severity escalation:** the Immunefi v2.3 rubric (https://immunefi.com/severity-system/) is the canonical reference. We apply the standard impact + likelihood matrix; ambiguous cases default to RoundFi's published interim policy in `bug-bounty.md §4.1` (MEV sub-tiering) and `bug-bounty.md §4.2` (Phase 1 vs Phase 3 weighting).

## 3. In-Scope Assets (JSON for Immunefi import)

```json
{
  "assets": [
    {
      "type": "smart_contract",
      "chain": "solana",
      "url": "https://github.com/alrimarleskovar/RoundFinancial/tree/main/programs/roundfi-core",
      "addresses": ["<MAINNET_ROUNDFI_CORE_PROGRAM_ID>"],
      "description": "Pool state machine, custody, escape valve, harvest waterfall, treasury controls (20 instructions)",
      "severity_caps": {
        "critical": 50000,
        "high": 25000,
        "medium": 10000
      }
    },
    {
      "type": "smart_contract",
      "chain": "solana",
      "url": "https://github.com/alrimarleskovar/RoundFinancial/tree/main/programs/roundfi-reputation",
      "addresses": ["<MAINNET_ROUNDFI_REPUTATION_PROGRAM_ID>"],
      "description": "SAS-compatible attestation issuance + reputation ladder + Human Passport bridge validator",
      "severity_caps": {
        "critical": 25000,
        "high": 15000,
        "medium": 5000
      }
    },
    {
      "type": "smart_contract",
      "chain": "solana",
      "url": "https://github.com/alrimarleskovar/RoundFinancial/tree/main/programs/roundfi-yield-kamino",
      "addresses": ["<MAINNET_ROUNDFI_YIELD_KAMINO_PROGRAM_ID>"],
      "description": "Adapter to Kamino Lend (deposit_reserve_liquidity + redeem_reserve_collateral CPIs)",
      "severity_caps": {
        "critical": 25000,
        "high": 10000,
        "medium": 2500
      }
    },
    {
      "type": "web",
      "url": "https://app.roundfi.finance",
      "description": "Front-end. In scope ONLY for vulnerabilities that compromise the on-chain trust path (e.g. wallet adapter sign-payload swap, RPC pinning bypass, phishing-resistant onboarding bypass)",
      "severity_caps": {
        "critical": 10000,
        "high": 5000
      }
    }
  ]
}
```

**Address placeholders to fill at submission time:**

- `MAINNET_ROUNDFI_CORE_PROGRAM_ID`
- `MAINNET_ROUNDFI_REPUTATION_PROGRAM_ID`
- `MAINNET_ROUNDFI_YIELD_KAMINO_PROGRAM_ID`

Devnet addresses (for testnet bounty mirror, if Immunefi supports):

- `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw` (core)
- `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2` (reputation)
- `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb` (yield-kamino)

## 4. Out of Scope (Immunefi "Out of Scope" field)

```
- Vulnerabilities in upstream dependencies (Solana runtime, BPF execution, SPL Token, mpl-core, Anchor, Kamino, SAS) — report to upstream maintainers; RoundFi credits pass-through but does not pay
- The off-chain mock yield adapter (programs/roundfi-yield-mock) — replaced by Kamino in production
- Indexer (services/indexer/) - except where it compromises on-chain trust path
- UX bugs / UI inconsistencies / styling — not bounty-eligible
- Best-practice recommendations without concrete exploit (e.g. "consider adding constraint X") — open a regular issue
- Findings already documented in internal-audit-findings.md (48 public SEVs (SEV-001..048) as of submission) — only NET-NEW vulnerabilities qualify
- Out-of-scope items per AUDIT_SCOPE.md: harvest yield-mock path, frontend, tests, mainnet operational keys, indexer cron schedulers
```

## 5. Proof of Concept Requirements

```
Every Critical/High report MUST include:

1. Step-by-step reproduction against the deployed mainnet (or devnet, then we'll port-verify on mainnet) program ID
2. A failing transaction signature OR a Rust/TypeScript test demonstrating the exploit
3. Estimated funds at risk (TVL impact, in USDC)
4. Suggested remediation (one-line minimum; bonus reward tier if the fix is mergeable)

Medium/Low: written description sufficient if exploit path is clear from the prose.

Informational: title + description; no PoC required.

DO NOT attempt the exploit on production with real user funds without coordinating with the team first — see Safe Harbor §6.
```

## 6. Safe Harbor

```
RoundFi adopts the EF Foundation Safe Harbor template (https://github.com/security-alliance/safe-harbor) with the following project-specific clauses:

WHITELISTED ACTIVITIES:
  - Testing exploits against devnet (no restrictions)
  - Testing exploits against mainnet IF AND ONLY IF:
    (a) Attack uses ≤ USD 100 of the researcher's own funds
    (b) Researcher notifies roundfinance.sol@gmail.com BEFORE attempting on mainnet
    (c) Researcher RETURNS all stolen funds (minus their bounty) within 72h
    (d) No user funds beyond the researcher's own wallets are touched

PROHIBITED:
  - Phishing actual users
  - DoS attacks against mainnet (RPC flood, transaction spam)
  - Public disclosure before fix is merged + 90-day window expires
  - Theft, retention, or use of customer data from indexer

We will NOT pursue legal action against researchers acting in good faith within the Safe Harbor boundaries above. We retain the right to pursue action against malicious actors.
```

## 7. KYC Requirements

```
Up to USD 10,000 in rewards: NO KYC required. Payment to any Solana wallet address.

USD 10,000 - USD 25,000: Light KYC (full legal name + country, via Immunefi's standard flow).

USD 25,000 - USD 50,000 (Critical): Full KYC (legal name + government ID + proof of address + sanctions screening). This is mandatory for compliance with our treasury operating policies.

KYC data is held by Immunefi (or HackenProof), NOT by RoundFi. RoundFi only receives the wallet address + payout authorization.
```

## 8. Disclosure Timeline

```
- T+0:    Report submitted via Immunefi platform
- T+72h:  RoundFi acknowledges receipt + initial severity triage
- T+7d:   Detailed reproduction confirmed or feedback requested
- T+14d:  Fix design finalized + reward tier confirmed
- T+30d:  Fix merged to main + deployed (Critical/High may be faster)
- T+30d:  Reward paid out
- T+120d: Public disclosure (90 days post-fix), unless mutually agreed earlier

Embargo periods may extend for findings that affect upstream dependencies (we coordinate with the upstream maintainer's disclosure timeline) or that require coordinated multi-protocol patching.
```

## 9. Contact + Funding

```
Primary contact:    roundfinance.sol@gmail.com
PGP key:            On request via the above address (key fingerprint published in SECURITY.md)
Backup channel:     [@RoundFinance on X — DM open for security researchers, NOT for reports]
Response time:      72h SLA on initial acknowledgment

Treasury funding for initial pool (USD 50k USDC):
  Wallet:             <MULTISIG_TREASURY_ADDRESS>  (= Squads-controlled USDC ATA, post-ceremony)
  Verification tx:    <USDC_50K_DEPOSIT_TX_SIGNATURE>
  Solscan link:       https://solscan.io/tx/<sig>

Replenishment: top up after every payout; auto-monitored via observability stack (see docs/operations/observability-spec.md).
```

## 10. Tags (Immunefi taxonomy)

```
solana, anchor, lending, defi, rosca, behavioral-credit, brazil, emerging-markets, kamino-integration, sas-attestation
```

## 11. Additional artifacts to upload alongside submission

| File                                                         | Purpose                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md)                     | Formal scope doc (Statement of Work shape)                        |
| [`internal-audit-findings.md`](./internal-audit-findings.md) | Pre-existing 49 findings — researchers should NOT re-report these |
| [`self-audit.md`](./self-audit.md)                           | Trust model + invariants + per-ix privilege table                 |
| [`mev-front-running.md`](./mev-front-running.md)             | Solana ordering threat model                                      |
| [`bug-bounty.md`](./bug-bounty.md) (source policy)           | Master policy this package derives from                           |
| `programs/roundfi-{core,reputation,yield-kamino}/Cargo.toml` | Build manifests for SBF compilation                               |

## 12. Submission checklist

- [ ] All `<MAINNET_*>` placeholders replaced with actual mainnet program IDs (post-deploy)
- [ ] Treasury USDC ATA address confirmed + funded with USD 50,000
- [ ] PGP key fingerprint added to `SECURITY.md` and shareable on request
- [ ] Immunefi account created + verified
- [ ] `bug-bounty.md` status banner updated from "draft" to "live"
- [ ] Internal team notified that the program is going live + on-call SLA cover assigned
- [ ] First-72h incident drill rehearsed (someone receives a fake-Critical report, responds within SLA)

## See also

- [`bug-bounty.md`](./bug-bounty.md) — master policy
- [`SECURITY.md`](../../SECURITY.md) — interim disclosure channel + SLAs (active until Immunefi go-live)
- [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md) — formal scope
- [`internal-audit-findings.md`](./internal-audit-findings.md) — pre-existing findings catalog
- [Immunefi v2.3 severity rubric](https://immunefi.com/severity-system/) — canonical reference
- [EF Safe Harbor template](https://github.com/security-alliance/safe-harbor) — legal basis

---

_Last updated: 2026-05-17_
_Authored under PR #381 as part of the mainnet-prep deliverables sprint._
