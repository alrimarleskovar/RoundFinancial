# RoundFi — Yield Waterfall & Guarantee Fund

**Version:** 1.1 (2026-04-30 — re-aligned to canonical PDFs)
**Scope:** Explains the role of the yield adapter, the harvest waterfall, and the Guarantee Fund. Intended as reading material for judges, partners, and auditors.

> **v1.1 changelog.** v1.0 documented the on-chain Rust order (GF top-up first, then protocol fee). The canonical PDFs ([whitepaper](pt/whitepaper.pdf) + [Viabilidade Técnica](pt/viabilidade-tecnica.pdf)) define a different waterfall: **protocol fee first, then GF, then LPs, then participants**. The Stress Lab L1 simulator ([sdk/src/stressLab.ts](../sdk/src/stressLab.ts)) implements the PDF order. v1.1 of this doc re-aligns to the PDFs and flags the on-chain `harvest_yield.rs` as M1/M2 contract-validation work — the L1↔L2 parity test ([tests/economic_parity.spec.ts](../tests/economic_parity.spec.ts)) is what will catch the divergence and force the Rust side to match.

---

## 1. Why RoundFi has a yield adapter

A ROSCA pool sits on idle float between contribution and payout. In a 24-member, 24-cycle, 10k-USDC-credit pool, the `pool_usdc_vault` holds an average of ~5k USDC of member funds that are _waiting_ to be paid out. Letting that float earn yield is a no-brainer — **the question is how that yield is distributed and how conservatively the protocol is positioned against adapter risk.**

RoundFi's answer has two parts:

1. **Adapter-is-untrusted.** The yield adapter (Kamino on mainnet, a mock on devnet) is treated as external code: core validates the program ID against `pool.yield_adapter` on every CPI, snapshots balances before-and-after, and _uses the observed delta_ rather than the adapter's declared return. See [Step 4c memory](../memory/feedback_step4c_economic_security.md).
2. **Deterministic waterfall.** Every harvest routes yield through the exact same four buckets, in the exact same order, with no bucket skippable.

---

## 2. The yield waterfall — four buckets, strict order

From [math/waterfall.rs](../programs/roundfi-core/src/math/waterfall.rs) and [harvest_yield.rs](../programs/roundfi-core/src/instructions/harvest_yield.rs):

```
┌──────────────────────────────────────────────────────────────┐
│                      harvested yield (ΔYield)                │
└──────────────────────────────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ (1) Protocol   │  │ (2) Guarantee  │  │ (3) LPs /      │
│     fee (20%)  │  │     Fund top-  │  │     Liquidity  │
│                │  │     up         │  │     Angels     │
│                │  │   (cap 150%)   │  │     (~65% of   │
│                │  │                │  │      residual) │
└────────────────┘  └────────────────┘  └────────────────┘
         │                                       │
         ▼                                       │
 ┌────────────────┐                              │
 │ treasury ATA   │                              │
 └────────────────┘                              │
                                                 ▼
                                        ┌────────────────┐
                                        │ (4) Participants│
                                        │     — residual  │
                                        │     "patience   │
                                        │     prize"      │
                                        │     (~35%)      │
                                        └────────────────┘
```

### 2.1 Step 1 — Protocol fee (20% performance fee)

The protocol's **20% performance fee** is taken first, on the gross harvested yield. Transferred to `treasury` (on devnet `treasury` is the authority's USDC ATA; on mainnet it is a Squads V4 multisig). This is the primary revenue stream from Phase 1 in the [B2B plan](pt/plano-b2b.pdf) — it covers operational costs while Phase 3 (the B2B oracle API) ramps up to become the high-margin endgame.

### 2.2 Step 2 — Guarantee Fund top-up (cap 150%)

After the protocol fee, the Guarantee Fund is topped up from the _remaining_ yield. Sizing follows `config.guarantee_fund_bps` (default 15000 bps = **150% of credit**) — the cap that keeps the GF a defensive reserve, not a yield magnet. Once the cap is hit, this step is skipped on subsequent harvests and 100% of the residual flows to step 3.

### 2.3 Step 3 — LPs (Anjos de Liquidez · ~65% of residual)

Of whatever remains after the GF cap is filled, **~65%** is paid to **LPs / Liquidity Angels** — external capital providers who fund the pool's float beyond what members deposit. This is the upside slice that makes RoundFi competitive against single-asset DeFi vaults: LPs get behavioral-credit-backed yield instead of just lending into a generic pool. Configurable via `LP_RESIDUAL_SHARE` in [stressLab.ts](../sdk/src/stressLab.ts) — would be a governance parameter on-chain.

### 2.4 Step 4 — Participants ("prêmio de paciência" · ~35% of residual)

The final ~35% of the residual flows back to pool members who completed their cycle on time — the **patience prize**. Credited to `pool_usdc_vault` on-chain (effectively reducing future installment burden) or distributed pro-rata at pool close.

**Handler-enforced invariant.** The handler asserts:

```
protocol_fee + gf_topup + lp_share + participants_share == harvested_delta
```

Any reordering or skipping is rejected with `WaterfallNotConserved`. Computations use bps math with floor, and residuals accumulate in `solidarity_balance` so **no rounding lamports are lost**.

> **On-chain alignment note (M1/M2 work).** As of v0.5 of the on-chain code, [harvest_yield.rs](../programs/roundfi-core/src/instructions/harvest_yield.rs) implements a _different_ order — GF top-up first, fee second, "good-faith bonus" third, residual fourth. The PDFs and the [Stress Lab L1 simulator](../sdk/src/stressLab.ts) define the canonical order shown above. The L1↔L2 economic-parity test in [tests/economic_parity.spec.ts](../tests/economic_parity.spec.ts) will fail on this divergence in M1/M2 contract validation, forcing the Rust side to match. The doc is now the canonical spec; Rust will catch up.

---

## 3. The Guarantee Fund — what it does today, what it will do tomorrow

### 3.1 Role today (v1 — shipped)

1. **Payout-drain protection.** Before transferring `credit_amount` to a member, [claim_payout.rs:119](../programs/roundfi-core/src/instructions/claim_payout.rs:119) computes `spendable = pool_usdc_vault.amount - pool.guarantee_fund_balance` and requires `spendable >= credit_amount`. The Guarantee Fund is **earmarked**: the pool can never pay out if doing so would eat into the reserve.
2. **Growth path.** Topped up every harvest (Step 2 of the waterfall, after the protocol fee). Caps at 150% of credit and then stops accruing.

### 3.2 What the v1 Guarantee Fund does NOT do

- **It does not cover defaults.** `settle_default` never draws from `guarantee_fund_balance`. The default-cascade is per-member-local: Solidarity → Member escrow → Member stake. The Guarantee Fund sits untouched during settlement.
- **It does not pay yields to members.** Members (and LPs) receive yield via the LP / participants slices of the waterfall (steps 3 + 4 above), not via the Guarantee Fund.

This is an intentional simplification for v1. The Guarantee Fund acts as a **future crash reserve** — accumulated across the lifetime of the pool so that v2 can introduce a catastrophic-loss draw path (e.g., a pool-wide black-swan event) with rate-limiting and governance oversight.

### 3.3 Role tomorrow (v2 — roadmap)

- **Catastrophic draw path.** If cumulative seized collateral in a cycle is insufficient to cover the payout float, a bounded draw from the GF kicks in. Rate-limited to prevent crank griefing.
- **GF redemption on pool close.** Unused GF at `close_pool` is returned pro-rata to members who completed all cycles on-time. Turns the reserve into a _loyalty dividend_.

These are called out as roadmap in all narrative material; the v1 demo does **not** claim them.

---

## 4. Where the Guarantee Fund sits inside Shield 3

In the canonical pitch mapping (see [pitch-alignment.md](./pitch-alignment.md) §3, v1.1+):

- **Shield 1 = Sorteio Semente** _(Seed Draw / Bootstrap Mês 1)_ — cycle-1 retention of 91.6% before any payout-drain risk exists
- **Shield 2 = Escrow Adaptativo + Stake** — reputation-tier-driven payout/escrow split, gated by paid installments
- **Shield 3 = Cofre Solidário + Cascata de Yield** — 1% of every installment routes to a segregated **Solidarity Vault**, plus the Kamino yield runs a 4-tier waterfall (admin fee → **Guarantee Fund** capped at 150% × credit → 65% LPs → 35% participants)

The **Guarantee Fund is one of two sub-components of Shield 3** (the other is the Solidarity Vault). It's funded by the yield waterfall — _not_ by an initial deposit and _not_ by stress seizure. v1 uses it as a payout-drain guard; v2 will add a catastrophic-loss draw path.

---

## 5. Reading this live — how to verify the waterfall on-chain

For a reviewer or auditor:

1. Find the pool's `harvest_yield` transaction on Devnet.
2. Parse the `msg!` logs — the handler emits per-bucket amounts (`gf`, `fee`, `bonus`, `participants`) and the pre/post `pool_usdc_vault` balance.
3. Cross-check: `sum(buckets) == post_vault - pre_vault + outflows`.

For the Guarantee Fund specifically:

1. Read `pool.guarantee_fund_balance` before harvest, after harvest, and after any `claim_payout`.
2. After harvest: balance must have _grown_ by `gf_topup`.
3. After payout: balance must be _unchanged_ (the earmark is enforced pre-transfer).

The off-chain [stress-test script](../scripts/stress/multi_default.ts) (Step 4f addition) exercises a 3-veteran-default scenario against a localnet pool and asserts these relationships.

---

_End of yield-and-guarantee-fund v1.0._
