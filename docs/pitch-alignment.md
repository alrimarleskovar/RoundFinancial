# RoundFi — Pitch ↔ Implementation Alignment

**Version:** 1.0 (2026-04-22 — Step 4f: narrative alignment)
**Status:** Authoritative mapping between the product narrative and the on-chain behavior.

This document is the single source of truth for how the pitch narrative maps onto the shipping protocol. If the pitch and this document disagree, this document wins until a new version is cut.

---

## 1. Core thesis (unchanged)

> **"Behavior is the new collateral."**
> On-chain payment discipline becomes a member's primary credit signal. The better the on-chain history, the less principal a member must lock as collateral to receive credit.

This thesis is directly backed by the `stake_bps_for_level()` function in [constants.rs:56](../programs/roundfi-core/src/constants.rs:56): Level 1 = 50% stake, Level 2 = 30%, Level 3 = 10%.

---

## 2. The Reputation Ladder

| Level | Label (pitch) | Stake required | Capital advancement vs. stake |
|-------|---------------|----------------|-------------------------------|
| 1 | Newcomer | 50% of `credit_amount` | Up to 2× |
| 2 | Trusted | 30% of `credit_amount` | Up to ~3.3× |
| 3 | **Veteran** | 10% of `credit_amount` | **Up to 10×** |

**Framing rule (v1.0 revision).** The pitch uses "10× leverage" as a conversational shorthand. The canonical framing in docs and demos is:

> "Up to **10× capital advancement** based on reputation tier — a Veteran locks 10% of the credit amount as stake, and the pool advances the full credit upfront."

This is **not** leveraged lending in the DeFi margin/liquidation sense: the member also commits to paying N-1 future installments. The "advancement" is the ROSCA rotation mechanic, priced by reputation.

---

## 3. Triple Shield — canonical mapping (v1.0 revision)

**Important:** The previous pitch ordering (*"Shield 2 fundo de segurança first, then 10%, then Shield 1 reserva inicial, then Shield 3 solidarity"*) did not match the shipping code. The canonical mapping below matches [settle_default.rs:152-271](../programs/roundfi-core/src/instructions/settle_default.rs) and is the version to use in all future narrative.

| # | Canonical name | Code primitive | Role on default | Source of funds |
|---|----------------|-----------------|-----------------|------------------|
| **Shield 1** | **Solidarity Vault** (first line of defense) | `solidarity_vault` PDA | **Seized first** to cover the missed installment of a defaulting member | 1% of every contribution (`solidarity_bps = 100`) |
| **Shield 2** | **Member Stake + Escrow** (collateral layer) | `member.escrow_balance` + `member.stake_deposited` | Seized second and third, in that order. Bounded by the **D/C invariant**: the seizure is capped so `D_rem × C_init ≤ C_after × D_init` | The defaulting member's own collateral |
| **Shield 3** | **Guarantee Fund** (yield-funded reserve) | `pool.guarantee_fund_balance` (earmark inside `pool_usdc_vault`) | **Not used in v1 defaults.** Earmarked to block payout drain (see `claim_payout.rs:119`); intended as a v2 catastrophic-loss reserve | Top-up from yield harvest (step 1 of the yield waterfall) |

**Why Shield 3 is inert on defaults in v1.** The Guarantee Fund is topped up by the yield waterfall but never drawn during `settle_default`. It acts as a payout-float guarantee (the pool is prevented from paying out if doing so would drop `pool_usdc_vault.amount` below `guarantee_fund_balance`). v2 will introduce a catastrophic draw path with rate limits.

### 3.1 What to say in the pitch (script)

> "Our security architecture has three shields.
> **Shield 1, the Solidarity Vault**, is funded by 1% of every contribution and is the first line of defense — it covers the missed installment of anyone who falls behind.
> **Shield 2 is the member's own collateral** — stake plus escrow, seized under a debt-versus-collateral invariant that guarantees no member is ever over-seized.
> **Shield 3 is the Guarantee Fund**, a yield-funded reserve that is topped up on every harvest and earmarked inside the pool's vault. It protects payouts from being drained by future stress events."

---

## 4. Solvency framing (v1.0 revision)

**Removed.** "Even in the worst case, the protocol still profits."

**Replacement framing.** Use one of these two, depending on audience:

| Audience | Framing |
|----------|---------|
| General / pitch | "Losses are bounded, and the protocol remains **solvent by construction**." |
| Technical / investor-due-diligence | "Member-level losses are bounded by the D/C invariant in [settle_default.rs:278-283](../programs/roundfi-core/src/instructions/settle_default.rs:278); pool-level solvency is maintained by the Seed-Draw invariant (91.6% retention at cycle 0) in [claim_payout.rs:101](../programs/roundfi-core/src/instructions/claim_payout.rs:101); no single defaulter can drain more than their own posted collateral." |

The **stress-test claim** ("3 Veterans default → $30 K hole absorbed") is now supported by an off-chain simulation script (see §7), not an on-chain guarantee. Narrative should reference the simulation, not claim on-chain profit.

---

## 5. Escape Valve (Maria's story) — narrative + code check

The pitch story: Maria has an emergency, sells her position, recovers funds, **and protects her reputation.**

- **Aligned.** [escape_valve_list.rs](../programs/roundfi-core/src/instructions/escape_valve_list.rs) and [escape_valve_buy.rs](../programs/roundfi-core/src/instructions/escape_valve_buy.rs) implement the close-old / create-new Member re-anchor pattern. Maria's wallet never enters `settle_default`, so no `SCHEMA_DEFAULT` attestation is issued.
- **Nuance to keep honest in demo.** Maria does not continue accruing `SCHEMA_CYCLE_COMPLETE` attestations for the remaining cycles — the buyer does. Reputation is *protected* from a negative hit, but does not keep growing from that pool.
- **Buyer upside claim** ("entering a mature pool improves odds"): this is accurate because buyers skip the early cycles that have the highest default risk (the Seed Draw window). The chart in the deck is a fair representation.

---

## 6. Identity — Civic + SAS (optional, modular)

The pitch does not mention identity explicitly, which is **correct** — identity is opt-in and never a gate. Current state:

- [link_civic_identity.rs](../programs/roundfi-reputation/src/instructions/link_civic_identity.rs) is shipped; Civic gateway tokens are validated byte-by-byte with no trust in the external program's Anchor traits.
- `IdentityRecord` is read by `attest` as a sybil-weight hint; it is never read by `join_pool`.
- **Narrative to use:** "Identity is additive — Civic Pass boosts your signal, but the protocol works for every wallet from day one."

---

## 7. Roadmap vision (v1.0 clarification)

**"Serasa da Web3" / "on-chain behavior oracle" is roadmap vision, not shipped product.**

- **Shipped today:** SAS-compatible `Attestation` PDAs are externally readable by any wallet. The new `get_profile` instruction (Step 4f) adds a canonical read path that a consumer program can CPI into via `simulateTransaction` + return-data parsing.
- **Roadmap:** A public HTTP `GET /reputation/:wallet` endpoint (indexer-backed), a B2B score API with API-key gating (`POST /b2b/score`), and first partner integrations with under-collateralized lending protocols.
- **Narrative to use:** "Our end-state vision is a Web3 credit bureau — a neutral, on-chain oracle for wallet behavior. Today we ship the foundation: SAS-compatible attestations, a public read instruction, and the anti-gaming rules that make the score trustworthy."

---

## 8. Summary of pitch revisions

| Original phrasing | Revised phrasing | Reason |
|-------------------|-------------------|--------|
| "Shield 1 = reserva inicial" | "Shield 3 = Guarantee Fund (yield-funded reserve)" | GF is topped up by yield, not an initial deposit |
| "Shield 2 = fundo de segurança, entra primeiro" | "Shield 1 = Solidarity Vault, entra primeiro" | Code's first seizure is solidarity, not GF |
| "Shield 3 = cofre solidário (último)" | "Shield 1 = Solidarity Vault (primeiro)" | Same reorder as above |
| "O protocolo ainda sai no lucro" | "O protocolo permanece solvente por construção" | Removes unsupported profit claim |
| "10× de alavancagem" | "10× de adiantamento sobre o depósito" | Distinguishes from DeFi margin-leverage |
| "Serasa da Web3 (hoje)" | "Serasa da Web3 (visão — hoje: atestações SAS-compatíveis + `get_profile`)" | Honest roadmap framing |

---

*End of pitch-alignment v1.0.*
