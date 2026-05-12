# Adversarial Threat Model — RoundFi

> **Status: pre-mainnet draft.** Companion to [`self-audit.md`](./self-audit.md) §7 ("Out of scope — future work") which enumerates these scenarios as deferred research items. This doc fills in the details for each: attack vector, attacker pre-conditions, cost in USD/SOL, maximum impact under the current Triple Shield, and the mitigation status (today vs roadmap).
>
> Audience: external audit firms running pre-engagement diligence + the team's own pre-mainnet review. Not a substitute for fuzzing/proptest harnesses (tracked in [#228](https://github.com/alrimarleskovar/RoundFinancial/issues/228)) — this doc is the qualitative companion.
>
> **Scope:** adversarial scenarios beyond simple direct-default (which is already covered by the 5 canonical stress-lab presets in [`docs/stress-lab.md`](../stress-lab.md)). The protocol's solvency floor under those direct-default cases is established; this doc asks "what about coordinated / strategic / multi-wallet adversaries?"

---

## 1. Sybil — same human, N wallets

**Vector**
A single human creates N Solana wallets. Each joins a separate pool (or the same pool with distinct slots if the pool size allows). Over time, each wallet accrues real attestations from real installments paid. The attacker now owns N wallets, each with valid SAS-compatible reputation.

**Pre-conditions**

- N × `STAKE_BPS_LV1 × credit_amount` USDC up-front (Lv1 = 50% × credit; with credit = $30 default → $15 stake/wallet)
- N × `cycles_total × installment_amount` USDC across the pool lifecycle ($30/wallet for the default demo pool over 3 cycles)
- ~0.04 SOL/wallet for ATA + Member PDA rent
- No additional protocol fee — Sybil pays the same as a legitimate member

**Cost to attacker (default demo params)**
| N (wallets) | Up-front USDC | Cycle outlay | SOL rent | Total |
|---|---|---|---|---|
| 10 | $150 | $300 | 0.4 SOL | ~$455 + tx fees |
| 100 | $1,500 | $3,000 | 4 SOL | ~$4,550 |
| 1,000 | $15,000 | $30,000 | 40 SOL | ~$45,500 |

Note: the USDC is **not lost** — it returns via `claim_payout` modulo timing (cycle position). So attacker is locking liquidity, not burning it. Real cost = opportunity cost of locked USDC × duration × yield rate.

**Maximum impact**

- N wallets each holding valid reputation. **No direct protocol theft.**
- If a Phase-3 B2B oracle consumer reads N attestations without weighting by uniqueness-of-human, attacker over-credits N times.
- **Cap:** consumer's lending exposure to the Sybil = N × consumer-determined credit limit. Consumer-side mitigation, not protocol-side.

**Mitigation status**

| Status                  | Today                                                | Roadmap                                                                                             |
| ----------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Stake floor             | ✅ $15 minimum (Lv1) makes Sybil capital-intensive   | —                                                                                                   |
| PoP gating              | ❌ Identity layer optional (§4.4 of architecture.md) | ✅ VeryAI/WorldID/Sumsub integration (#227) makes per-wallet PoP attestation a 1-human-per-cap gate |
| Consumer-side weighting | ❌ Not enforced on-chain                             | ✅ B2B oracle Phase 3 endpoint weights attestation count × USD-value × cycle completion             |

**Honest assessment:** Sybil is **the most expected attack vector** for any reputation system that doesn't gate on identity. Today's mitigation = economic friction ($15 stake floor) is sufficient for hackathon demo + Phase 1 pools where stake size is comparable to consumer credit limits. Mainnet at scale requires PoP integration before B2B oracle ships. Tracked under #227.

---

## 2. Reputation farming — cheap attestations

**Vector**
Attacker creates or joins pools with the smallest viable installment amount. Each contribute mints an attestation. The "cost per attestation" = `installment_amount`. If a Community Pool variant ever allows $1 contributions, attacker mints attestations at $1 each.

**Pre-conditions**

- A pool with low `installment_amount`
- N cycles
- Per cycle: pay 1 installment + 1 attestation minted

**Cost to attacker**

- Today (admin-created pools only): `installment_amount` is set by protocol authority; default = $10/cycle.
- Future (Community Pool, if/when it ships): leader sets installment; could be $1.

**Maximum impact**
Same shape as Sybil from a consumer's perspective — many attestations per dollar of stake. If consumers count attestations without weighting:

- Today (admin pools): $10 per attestation, 3 attestations per Lv1 pool, so $30 for 3 attestations + $15 stake recoverable = $30/3 attestations = $10/attestation effective.
- Future (Community Pool $1): $1/attestation effective.

**Mitigation status**

| Status                  | Today                                                                | Roadmap                                                                                                                |
| ----------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Installment floor       | ⚠️ No on-chain floor; relies on admin discretion                     | ✅ Community Pool variant should hard-cap minimum installment at $5 or similar (TBD pre-mainnet)                       |
| Attestation weighting   | ❌ Schema records `installment` field but no on-chain enforcement    | ✅ B2B oracle weights by USD-value-times-cycles, not count                                                             |
| Cycle-completion factor | ❌ Single attestation per contribute, not weighted by cycle position | ✅ Reputation score formula in `roundfi-reputation` already factors `cycle_index / cycles_total` as a completion ratio |

**Honest assessment:** Farming is **harder than Sybil** because consumer-side weighting by USD-value is well-understood (see Esusu's $1.2B valuation built on similar principle). Pre-mainnet review: confirm installment floor for Community Pool variant.

---

## 3. Strategic ordering & coordinated griefing

**Vector**
Multiple wallets controlled by colluding actors. Possible plays:

- **Cycle rotation gaming** — try to manipulate which slot gets contemplated first
- **Coordinated default timing** — N members default together at cycle K to maximize damage
- **Front-running other members' contributes** — race to claim payout before another member's contribute lands
- **Solidarity drain** — coordinate multiple defaults to drain solidarity vault, then collect Good Faith Bonus shares

**Pre-conditions**

- Multiple Member PDAs in the same pool (must be different wallets per pool)
- Coordination off-chain (Discord, Telegram, etc.)

**Cost to attacker**
Same as legitimate participation. No "strategy fee."

**Maximum impact under Triple Shield**

| Scenario                           | Outcome under current invariants                                                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cycle rotation gaming              | **No impact.** `slot_index = member_index` is set at `join_pool` and immutable. Rotation is deterministic.                                                                                                                                                |
| All-default at cycle K             | **Protocol stays solvent** by construction. Solidarity drained → escrow seized → stake slashed, all capped by D/C invariant. Honest non-defaulting members lose Good Faith Bonus (the 1% solidarity redistribution) but recover their own escrow + stake. |
| Front-running contributes          | **Bounded griefing.** Front-runner can win `claim_payout` for cycle K once, but `member.paid_out` flag prevents re-claim. Wins their own slot only.                                                                                                       |
| Solidarity-then-claim coordination | **Caught by Triple Shield Shield-2 (Guarantee Fund Solvency Guard).** Solidarity drain doesn't change credit_amount; payouts still gated by `vault − GF >= credit`.                                                                                       |

**Mitigation status**

| Status                                           | Today                                                                                                                 | Roadmap                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Deterministic cycle rotation                     | ✅ On-chain, no admin override                                                                                        | —                                                                        |
| Triple Shield solvency under coordinated default | ✅ Stress-tested in `tripleVeteranDefault` preset (3 post-contemplation defaults, 24-member Veteran pool, $10k carta) | ✅ Future: extended preset with N coordinated defaults at various cycles |
| MEV / front-running review                       | ⚠️ Tracked in [#232](https://github.com/alrimarleskovar/RoundFinancial/issues/232)                                    | ✅ Mitigation strategies (commit-reveal, jito bundles) post-mainnet      |

**Honest assessment:** The Triple Shield handles coordinated defaults by construction — that's the whole point. The remaining vector is MEV-style ordering manipulation on `claim_payout` and `escape_valve_buy`, tracked separately.

---

## 4. Malicious pool leader (Community Pool — post-mainnet only)

**Vector**
Community Pool variant (planned for post-mainnet) would allow non-protocol-admin to create pools with custom parameters. A malicious leader could:

- Set predatory cycle_duration (e.g. 1 day — forcing members to maintain unrealistic payment cadence)
- Set inflated stake requirements (e.g. 100% of credit — locking member funds with no benefit)
- Refuse to settle defaults to game payout ordering
- Withhold pool information from members (off-chain — UX problem, not on-chain)

**Pre-conditions**

- Community Pool variant ships (not in current scope; tracked as post-mainnet roadmap)
- Leader can create pools without protocol-admin approval

**Cost to attacker**

- TBD — pool creation fee + leader stake (parameters TBD pre-Community-Pool spec)

**Maximum impact**

- Members onboarding to a malicious pool may lose stakes if they don't escape via the secondary market
- Pool float never gets distributed correctly
- **Bounded by on-chain mechanics:** leader cannot drain pool vaults directly (no admin instruction reaches inside `Pool.vault`); damage is to UX + lost opportunity cost, not direct fund theft

**Mitigation status**

| Status                       | Today                                                                                        | Roadmap                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Pool creation gated to admin | ✅ Only protocol authority calls `create_pool`                                               | ⚠️ Community Pool variant relaxes this                                                        |
| Leader skin-in-game          | ❌ N/A                                                                                       | ✅ Community Pool spec must require leader stake ≥ 2× single-member-stake to align incentives |
| Reputation gate for leaders  | ❌ N/A                                                                                       | ✅ Community Pool spec must require Lv3 (Veterano) to create — leaders have track record      |
| Max-cycle-duration cap       | ❌ N/A                                                                                       | ✅ Community Pool spec must cap `cycle_duration ≥ 7 days`                                     |
| Auto-settle on grace expiry  | ⚠️ `settle_default` is permissionless (anyone can crank after grace), so leader cannot block | — already on-chain                                                                            |

**Honest assessment:** Community Pool is a future variant explicitly NOT in M3 scope. The threat surface listed here is the design constraint for that variant when/if it ships. Tracked as a follow-up.

---

## 5. Pool spam / DoS via creation flood

**Vector**
Attacker spams `create_pool` to bloat the PDA address space + waste solana storage.

**Pre-conditions**

- Permission to call `create_pool` (today: protocol admin only)
- SOL for rent on each Pool PDA + 4 vault ATAs (~0.04 SOL/pool)

**Cost to attacker**

- ~0.04 SOL per pool × N spammed pools

**Maximum impact**

- **Today: zero,** because `create_pool` requires protocol admin authority (`config.authority == signer` constraint at `create_pool.rs`).
- **Future (Community Pool):** if anyone can create, attacker could spam. Solana rent reclaims via account close, so this is a temporary bloat rather than permanent.

**Mitigation status**

| Status                              | Today                                      | Roadmap                                                                              |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Admin-only `create_pool`            | ✅ Constraint on protocol authority signer | —                                                                                    |
| Rate limit (Community Pool variant) | ❌ N/A                                     | ✅ Leader-side rate limit (e.g. 1 pool/Lv3-leader/month) before Community Pool ships |

**Honest assessment:** Non-issue today. Spec consideration for Community Pool variant.

---

## 6. MEV / front-running

**Already documented in [`self-audit.md` §7](./self-audit.md#7-out-of-scope-future-work) + tracked under [Issue #232](https://github.com/alrimarleskovar/RoundFinancial/issues/232).** Surfaces:

- **`claim_payout` ordering** — searcher observing a pending claim could race a stale `contribute` to manipulate current-cycle accounting. Bounded by deterministic slot derivation (see §3 above).
- **`escape_valve_buy` listing-race** — buyer signs over price + listing PDA; searcher can race to buy first if listing PDA is observable + price is favorable. Mitigation TBD (commit-reveal? Jito bundles?).

Pre-mainnet MEV analysis is its own work item; this doc references but doesn't duplicate.

---

## 7. Summary — adversarial surface vs Triple Shield coverage

| Attack class                                      | Stopped by Triple Shield?                                                       | Additional mitigation needed                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| Direct default (single member)                    | ✅ Yes — Shield 1 (Seed Draw), Shield 2 (GF Solvency), Shield 3 (D/C invariant) | None — protocol-solvent by construction             |
| Coordinated default (N members)                   | ✅ Yes — same Shields apply at scale, stress-tested in `tripleVeteranDefault`   | None — extended fuzzing #228 to confirm at larger N |
| Sybil (multi-wallet, same human)                  | ❌ No — Shields are pool-internal, Sybil is cross-pool/cross-protocol           | PoP integration #227 + consumer-side weighting      |
| Reputation farming (low-installment attestations) | ❌ No — attestation count vs USD-value                                          | Installment floor + B2B oracle USD-weighted reads   |
| Strategic ordering / griefing                     | ⚠️ Mostly — front-running on claim_payout / escape_valve_buy unmitigated        | MEV review #232                                     |
| Malicious Community Pool leader                   | N/A today (admin-only pool creation)                                            | Community Pool spec gating (post-mainnet)           |
| Pool spam                                         | N/A today (admin-only)                                                          | Community Pool rate limit (post-mainnet)            |

The Triple Shield protects against the **fund-movement attack classes** (default, coordination at scale). The **reputation-level attack classes** (Sybil, farming) require Phase-3 oracle-side mitigation + PoP integration that's explicitly out of current scope.

---

## 8. Methodology gaps — what this doc doesn't cover

Honest enumeration of what's NOT in this threat model:

- **Quantitative fuzzing** — no proptest / quickcheck harness yet. Tracked in [#228](https://github.com/alrimarleskovar/RoundFinancial/issues/228) for the codifiable subset.
- **Formal verification** — D/C invariant proven in-test only ([`tests/economic_parity.spec.ts`](../../tests/economic_parity.spec.ts) + `tests/security_economic.spec.ts`). Coq/Lean proof is post-audit per self-audit §7.
- **Game-theoretic equilibrium analysis** — no formal mechanism-design analysis of whether honest play is a Nash equilibrium under the current incentive structure. Manual reasoning suggests yes (defaulter loses more than non-defaulter via Triple Shield), but no proof.
- **Cross-pool collusion** — this doc considers single-pool collusion. Multi-pool collusion (e.g. attacker shapes their reputation in pool A to enable a strategic default in pool B) is not analyzed.
- **Off-chain attack surfaces** — wallet phishing, social engineering, RPC trust, indexer reorg consequences. Tracked separately ([#234](https://github.com/alrimarleskovar/RoundFinancial/issues/234) for indexer; self-audit §7 for front-end).

This doc is the **qualitative threat model**. The quantitative complement (fuzzing + formal proofs) is post-mainnet research.

---

## 9. Cross-links

- [`docs/security/self-audit.md`](./self-audit.md) §3 — invariants enforced
- [`docs/security/self-audit.md`](./self-audit.md) §7 — out-of-scope register (this doc is the expansion of bullet 3)
- [`docs/security/self-audit.md`](./self-audit.md) §10 — auditor self-attestation matrix
- [`docs/stress-lab.md`](../stress-lab.md) — 5 canonical presets covering direct-default scenarios
- [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md) — formal audit scope
- Issue [#227](https://github.com/alrimarleskovar/RoundFinancial/issues/227) — PoP provider rename (Sybil mitigation)
- Issue [#228](https://github.com/alrimarleskovar/RoundFinancial/issues/228) — stress-lab fuzzing extension
- Issue [#232](https://github.com/alrimarleskovar/RoundFinancial/issues/232) — MEV review

_Last updated: 2026-05-12 · pre-mainnet draft._
