# RoundFi — Pitch ↔ Implementation Alignment

**Version:** 1.1 (2026-04-30 — re-aligned to canonical PDFs)
**Status:** Reflects the canonical Triple Shield narrative as defined in [whitepaper](pt/whitepaper.pdf), [B2B plan](pt/plano-b2b.pdf), and [Expansion plan](pt/plano-expansao.pdf).

> **v1.1 changelog.** v1.0 reordered the Triple Shield to match the on-chain *seizure order* in `settle_default.rs` (solidarity → escrow → stake). v1.1 reverts that reordering — the PDFs are the canonical narrative source, and the Triple Shield is a **structural protection narrative** (prevention layers, ordered by build sequence), not a recovery sequence. The seizure-order observation is preserved in §3.2 as an implementation detail.

---

## 1. Core thesis (unchanged)

> **"Behavior is the new collateral."**
> On-chain payment discipline becomes a member's primary credit signal. The better the on-chain history, the less principal a member must lock as collateral to receive credit.

This thesis is directly backed by the `stake_bps_for_level()` function in [constants.rs:56](../programs/roundfi-core/src/constants.rs:56): Level 1 = 50% stake, Level 2 = 30%, Level 3 = 10%.

---

## 2. The Reputation Ladder

| Level | Label (canonical) | Stake required | Leverage over stake |
|-------|-------------------|----------------|----------------------|
| 1 | Iniciante (Beginner) | 50% of `credit_amount` | **2×** (100/50) |
| 2 | Comprovado (Proven) | 30% of `credit_amount` | **3.3×** (100/30) |
| 3 | **Veterano (Veteran)** | 10% of `credit_amount` | **10×** (100/10) |

**Canonical leverage framing (v1.1 — PDF-aligned).** The whitepaper math is direct:

> "Veteran deposits 10% of the credit and accesses 100% of it — **10× leverage over the stake**."

i.e. `MAX_BPS / STAKE_BPS_LEVEL_3 = 10_000 / 1_000 = 10`. Guarded as a unit test in [constants.rs::veteran_leverage_is_ten_times_per_whitepaper](../programs/roundfi-core/src/constants.rs).

This is **not** leveraged lending in the DeFi margin/liquidation sense — the member also commits to paying N-1 future installments. But the comparison the pitch invokes is intentional: where DeFi typically demands 150% collateral to extend $1,000 of credit, RoundFi extends $10,000 of credit against $1,000 of stake at the Veteran tier. That ratio is the headline product claim.

---

## 3. Triple Shield — canonical (PDF-aligned)

The Triple Shield is a **structural protection narrative**: three independent capital primitives that the protocol builds during normal operation to keep itself solvent under stress. Ordered by their build sequence in the protocol's lifecycle (cycle 1 first, then per-payout escrow, then ongoing 1%/yield accrual).

| # | Canonical name | What it does | Funding source | On-chain primitive |
|---|----------------|--------------|----------------|---------------------|
| **Shield 1** | **Sorteio Semente** *(Seed Draw / Bootstrap Mês 1)* | Cycle 1 caps the contemplated member's payout at `2 × installment` (≈ $832 for a $5,000-installment scenario). The remaining ~91.6% of cycle-1 capital stays in the vault as a structural cushion. The protocol is overcapitalized from Day 0. | The asymmetric upfront formula in `claim_payout.rs` (cycle 1 special case) | Payout cap at cycle = 1 |
| **Shield 2** | **Escrow Adaptativo + Stake** | Reputation-tier-driven payout/escrow split + stake floor. The contemplated member receives only `payoutPct%` upfront; the remaining `escrowPct%` drips out over `releaseMonths` cycles, gated by paid installments. Stake is the fallback collateral. | Member's posted stake + the protocol's locked escrow per cycle | `LEVEL_PARAMS` table (50/30/10 stake; 50/45/35% payout; 50/55/65% escrow; 5/4/3-month release) |
| **Shield 3** | **Cofre Solidário + Cascata de Yield** | 1% of every paid installment routes to a segregated **Solidarity Vault** (independent of the float). The Kamino yield on the float runs a **waterfall**: protocol fee → Guarantee Fund (capped at 150% × credit) → 65% LPs → 35% participants. | 1% of installments (Solidarity Vault) + Kamino yield (Cascade) | `solidarity_vault` PDA + yield waterfall in `harvest_yield.rs` |

### 3.1 What to say in the pitch (script)

> "Our protection architecture has three shields, built in order during the pool's lifetime.
> **Shield 1 is the Seed Draw** — at cycle 1, the contemplated member receives only twice their installment, not the full credit. The other 91.6% of the capital stays in the vault as a structural cushion. The protocol is overcapitalized from Day 0.
> **Shield 2 is the Adaptive Escrow + Stake** — reputation drives the upfront/escrow split. A Veteran gets only 35% of the credit upfront; the remaining 65% drips back to them only as they pay their installments. The escrow is the gating mechanic; the stake is the fallback collateral. Default becomes mathematically illogical.
> **Shield 3 is the Solidarity Vault + Yield Cascade** — 1% of every installment goes to an independent fund that is never the protocol's working capital. Plus the Kamino yield runs a waterfall — admin fee, then a 150%-of-credit Guarantee Fund, then LPs and participants. Even with 0% yield, the protocol stays solvent."

### 3.2 Implementation note — on-chain seizure order

When a default occurs and `settle_default.rs` executes, the Rust code seizes capital in a different order than the Triple Shield's *build* order: **solidarity vault first → escrow second → stake third**, capped by the D/C invariant (`D_rem × C_init ≤ C_after × D_init`). This is a **recovery sequence** — orthogonal to the Shield narrative above. Pitch-narrative usage should always use the Shield 1 → 2 → 3 build order; only technical / due-diligence audiences need the seizure-order detail.

The Guarantee Fund (a sub-component of Shield 3, alongside the Solidarity Vault) is **topped up by the yield waterfall but not drawn during v1 defaults**. It earmarks pool funds against payout drain (`claim_payout.rs` will refuse to pay out below the guarantee-fund balance). v2 will introduce a catastrophic-loss draw path.

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

## 8. Summary of pitch revisions (v1.1 PDF-aligned)

| Original phrasing | Canonical phrasing (v1.1) | Reason |
|-------------------|----------------------------|--------|
| "Shield 1 = Solidarity Vault" *(v1.0 reorder)* | **"Shield 1 = Sorteio Semente / Bootstrap Mês 1"** | PDFs canonical; cycle-1 retention is the structural Day-0 protection |
| "Shield 2 = Member Stake + Escrow" *(v1.0 reorder)* | **"Shield 2 = Escrow Adaptativo + Stake"** *(unchanged in name; restored to position 2)* | PDFs canonical |
| "Shield 3 = Guarantee Fund" *(v1.0 reorder)* | **"Shield 3 = Cofre Solidário + Cascata de Yield"** | PDFs canonical; Guarantee Fund is a sub-component of Shield 3, not the whole shield |
| "O protocolo ainda sai no lucro" | "O protocolo permanece solvente por construção" | Removes unsupported profit claim |
| "10× de adiantamento sobre o depósito" *(v1.0 rephrase)* | **"10× de alavancagem sobre o stake"** *(v1.1 — PDF canonical)* | PDFs use "10× leverage / 10× sobre o stake" directly. v1.0 invented "advancement" to distinguish from DeFi margin; v1.1 trusts the reader to understand the difference and uses the PDF wording. |
| "Serasa da Web3 (visão futura)" | "Serasa da Web3 (tese central, com SAS attestations + `get_profile` já no foundation layer)" | PDFs frame Phase 3 B2B oracle as the central thesis, not a side roadmap item |

**Why v1.1 reverses v1.0's Shield order.** v1.0 reordered the Triple Shield to match the on-chain seizure sequence in `settle_default.rs` (solidarity → escrow → stake). The PDFs ([whitepaper](pt/whitepaper.pdf) + [B2B plan](pt/plano-b2b.pdf)) use a different framing — the structural build order of protection layers — and the PDFs are the canonical source. The on-chain seizure order is preserved as an implementation note in §3.2.

---

*End of pitch-alignment v1.0.*
