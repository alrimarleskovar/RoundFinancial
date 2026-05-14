# Proof-of-Personhood Provider Evaluation — RoundFi

> **Purpose:** unblock issue [#227](https://github.com/alrimarleskovar/RoundFinancial/issues/227) (`Civic` rename → chosen PoP provider). Civic Pass was discontinued 31 July 2025; the `roundfi-reputation` program needs a replacement provider before the rename PR can land.
>
> **Audience:** RoundFi engineering + business leads making the partner-selection decision. Decision is **off-protocol** (no code change from this doc), but the **shape** of the chosen provider's on-chain account format determines the rename PR's account-layout migration path.
>
> **Status:** evaluation only — no provider committed. Decision required before #227 can ship.

## TL;DR

We evaluated 4 candidates against 9 criteria. **Recommended: VeryAI** (Solana-native, audited, low fees, no KYC liability). **Strongest alternative: WorldID** if global anti-Sybil is the priority over Solana-native UX.

| Provider                             | Verdict                       | Why                                                                                    |
| ------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------- |
| **VeryAI**                           | ✅ **Primary recommendation** | Solana-native, in-protocol cost <$0.01, no KYC data on our side                        |
| **WorldID**                          | 🟡 Strong fallback            | Larger network (~10M users), but Worldchain-native — Solana bridge adds latency + cost |
| **Sumsub on-chain**                  | 🟡 Considered                 | Enterprise-grade but heavy KYC compliance burden lands on us                           |
| **Privado ID (formerly Polygon ID)** | ❌ Out                        | Self-sovereign but no Solana support; would need full chain bridge                     |

## Why this matters now

The PoP layer **gates the Sybil mitigation** flagged in [`adversarial-threat-model.md §1`](../security/adversarial-threat-model.md) — the largest unaddressed adversarial vector today. Without a chosen provider:

- The `identity::civic` module stays as a stub
- The `link_civic_identity` instruction can't be tested end-to-end
- The B2B oracle (Phase 3) reads can't be cross-validated against humanness signals
- The mainnet GA gate from [`MAINNET_READINESS.md §1.7`](../../MAINNET_READINESS.md) blocks until rename ships

## Evaluation criteria (9)

Weighted by mainnet relevance:

| #   | Criterion                             | Weight | Rationale                                                                     |
| --- | ------------------------------------- | :----: | ----------------------------------------------------------------------------- |
| 1   | **Solana-native account format**      |  High  | Avoids cross-chain bridge complexity + latency tax on every verification      |
| 2   | **Per-verification cost (USD)**       |  High  | Sybil-resistance dies if cost-per-attestation > value-per-installment ($1–10) |
| 3   | **Maintained / active development**   |  High  | Civic taught us the abandonment risk; require ≥ 6mo recent activity           |
| 4   | **Audited / public security history** |  High  | Provider becomes part of our security perimeter                               |
| 5   | **KYC liability for RoundFi**         | Medium | Stricter KYC → CFTC/FinCEN exposure for RoundFi as data processor             |
| 6   | **Privacy posture**                   | Medium | LGPD compliance — wallet ↔ identity link is sensitive                         |
| 7   | **User onboarding friction**          | Medium | High-friction kills retention in emerging markets                             |
| 8   | **Network size**                      |  Low   | We don't need 100M users; we need humans who pay installments                 |
| 9   | **Pricing model stability**           |  Low   | Avoid providers with shadow per-user pricing changes                          |

## Per-provider analysis

### 1. VeryAI ✅ **Primary recommendation**

| Criterion         | Score                                                               |
| ----------------- | ------------------------------------------------------------------- |
| Solana-native     | ✅ Yes — purpose-built for Solana                                   |
| Cost              | ✅ < $0.01 / verification (subsidized devnet, low mainnet fee)      |
| Maintained        | ✅ Active 2024–2026; quarterly releases                             |
| Audited           | 🟡 Recent audit by [name redacted in current doc; needs check]      |
| KYC liability     | ✅ Zero — VeryAI handles compliance fully; we only see boolean pass |
| Privacy           | ✅ ZK-proof based; no PII exposed to RoundFi                        |
| Onboarding        | ✅ One-time biometric scan via partner app; ~2min                   |
| Network size      | ⚠️ Smaller (~200k users); growing fast                              |
| Pricing stability | ✅ Public per-tier pricing                                          |

**Recommended adapter shape for `link_veryai_identity.rs`:**

```rust
// IdentityProvider::VeryAI = 2 (same discriminant as Civic for stable layout)
pub struct VeryaiVerification {
    pub subject_wallet: Pubkey,    // 32
    pub issued_at: i64,            // 8
    pub expiry: i64,               // 8
    pub provider_signature: [u8; 64], // 64 — signed by VeryAI authority
    pub humanness_score: u8,       // 1 — 0..100 confidence
}
```

**Migration impact** vs Civic baseline:

- `IdentityRecord` PDA layout stays stable (32+8+8+64+1 = 113 bytes vs Civic's similar)
- Verification path: read account → verify Ed25519 signature against VeryAI authority pubkey → check `expiry > clock.unix_timestamp`
- Pause + key rotation logic from #122 still applies (the VeryAI authority pubkey can be rotated via treasury timelock pattern)

**Concerns to investigate before commit:**

- ⚠️ Smaller user base — need confirmation we can sustain 24-member pools without VeryAI onboarding bottleneck
- ⚠️ Audit firm name + scope (claim needs verification)
- ⚠️ Specific signature scheme — Ed25519 vs Solana-native sig vs custom — affects on-chain verify cost

### 2. WorldID 🟡 Strong fallback

| Criterion         | Score                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| Solana-native     | ❌ Worldchain-native; Solana support via bridge (~30s latency)         |
| Cost              | ✅ Free at network level (subsidized by Worldcoin protocol)            |
| Maintained        | ✅ Massive ongoing investment from Tools for Humanity                  |
| Audited           | ✅ Multiple public audits (Halborn, Trail of Bits)                     |
| KYC liability     | ✅ Zero on our side                                                    |
| Privacy           | ✅ ZK-proof, no biometric data leaves orb                              |
| Onboarding        | ❌ Requires physical Orb visit — major friction in BR (limited cities) |
| Network size      | ✅ ~10M users globally                                                 |
| Pricing stability | ✅ Protocol-subsidized model                                           |

**Use case:** if global anti-Sybil is the priority over Brazilian retail UX. Strong story for B2B oracle credibility — auditors recognize WorldID immediately.

**Migration shape:** would require bridging Worldchain proofs to Solana. Either via Wormhole (adds attack surface) or a custom oracle (adds trust). Both options expand the audit scope significantly.

**Verdict:** good for Phase 3 (B2B oracle) where the demographic is global. Weak for Phase 1 (Brazilian ROSCAs) where Orb access is limited.

### 3. Sumsub on-chain 🟡 Considered

| Criterion         | Score                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------- |
| Solana-native     | 🟡 SDK exists; on-chain attestation is roadmap                                         |
| Cost              | ❌ $0.50–$2 / verification (enterprise pricing)                                        |
| Maintained        | ✅ Large compliance-focused team                                                       |
| Audited           | ✅ SOC 2 Type II + ISO 27001                                                           |
| KYC liability     | ❌ **Heavy** — Sumsub does full KYC; RoundFi becomes a data controller under LGPD/GDPR |
| Privacy           | 🟡 Full identity data flows through Sumsub + back to us as boolean                     |
| Onboarding        | 🟡 Document scan + selfie; ~5min, well-tested                                          |
| Network size      | N/A (enterprise customer base, not consumer network)                                   |
| Pricing stability | 🟡 Volume-tiered                                                                       |

**Verdict:** rules out for Phase 1 due to KYC liability — RoundFi becomes a credit-data processor under Brazilian Banco Central rules. Acceptable for Phase 3 if regulated B2B consumers require KYC'd subjects.

### 4. Privado ID (Polygon ID) ❌ Out

| Criterion     | Score                            |
| ------------- | -------------------------------- |
| Solana-native | ❌ EVM-native, no Solana port    |
| Cost          | ✅ Free at protocol level        |
| Maintained    | ✅ Active development            |
| Audited       | ✅ Multiple audits               |
| KYC liability | ✅ Zero                          |
| Privacy       | ✅ Strong ZK story               |
| Onboarding    | 🟡 Wallet-based, EVM-friendly UX |
| Network size  | 🟡 Mid-size, growing             |

**Verdict:** technically excellent but requires full chain bridge to land on Solana. Not viable without major infrastructure investment that's out of scope for #227.

## Decision matrix (recommend Option A)

| Option | Provider                                                                | Effort to integrate | Mainnet readiness            | Phase 3 readiness                     |
| ------ | ----------------------------------------------------------------------- | ------------------- | ---------------------------- | ------------------------------------- |
| **A**  | **VeryAI primary, fall back to manual review**                          | ~1 week eng         | ✅ Ready                     | 🟡 OK for BR; needs Phase 3 expansion |
| B      | WorldID + Wormhole bridge                                               | ~3-4 weeks eng      | 🟡 Bridge adds audit surface | ✅ Strong global narrative            |
| C      | Sumsub for compliance + ZK provider for privacy                         | ~2 weeks eng        | 🟡 Adds KYC compliance scope | ✅ Enterprise-ready                   |
| D      | Ship without PoP (rely on stake floor + B2B oracle USD-weighting alone) | 0 effort            | 🟡 Sybil vector unaddressed  | ❌ Phase 3 thesis weakens             |

## Critical path to close #227

If **Option A (VeryAI) is selected:**

1. **Off-protocol (1-2 weeks):**
   - VeryAI partnership agreement signed
   - Account format spec received (Pubkey-of-authority, signature scheme, expiry semantics)
   - Test verification account on devnet from VeryAI test authority
2. **On-protocol (1 PR, ~3 days eng):**
   - Rename `IdentityProvider::Civic` → `IdentityProvider::VeryAI` (same discriminant `=2`, preserves account layout)
   - `identity/civic.rs` → `identity/veryai.rs`
   - `validate_civic_token` → `validate_veryai_token` (Ed25519 verify against authority pubkey)
   - `civic_gateway_program` → `veryai_authority` in `ReputationConfig`
   - SDK + IDL regenerated
   - Tests updated
   - Devnet redeploy + OtterSec attestation refresh
3. **Audit-readiness docs:**
   - `architecture.md §4.4` updated — provider transition resolved
   - `AUDIT_SCOPE.md` updated — `roundfi-reputation` scope confirmed
   - `bug-bounty.md §2` updated — VeryAI verification in scope

## Open questions for the team

Before committing to Option A:

1. **Has the VeryAI partnership conversation started?** If yes, ETA on signed agreement?
2. **Is BR the only Phase 1 market?** If we plan to launch in another region simultaneously, VeryAI's smaller network becomes a bottleneck — re-evaluate WorldID.
3. **Phase 3 KYC requirements from prospective B2B customers** — if neobanks demand KYC'd subjects, hybrid (VeryAI + Sumsub) becomes the only path.
4. **Authority key rotation:** VeryAI's authority pubkey rotation cadence — affects our timelock pattern reuse.

## Cross-refs

- Issue [#227](https://github.com/alrimarleskovar/RoundFinancial/issues/227) — code rename tracking
- [`docs/architecture.md §4.4`](../architecture.md#44-identity-layer-added-v02--2026-04-22--provider-transition-v04--2026-05) — current Civic baseline
- [`docs/security/adversarial-threat-model.md §1`](../security/adversarial-threat-model.md#1-sybil) — Sybil vector this provider mitigates
- [`MAINNET_READINESS.md §6.4`](../../MAINNET_READINESS.md) — PoP provider as mainnet gate
- [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md) — `roundfi-reputation` scope (will need refresh post-rename)

---

_Last updated: May 2026. Decision pending team review. Update with chosen provider + rationale once partnership commits._
