# RoundFi — Yield Waterfall & Guarantee Fund

**Version:** 1.0 (2026-04-22 — Step 4f)
**Scope:** Explains the role of the yield adapter, the harvest waterfall, and the Guarantee Fund. Intended as reading material for judges, partners, and auditors.

---

## 1. Why RoundFi has a yield adapter

A ROSCA pool sits on idle float between contribution and payout. In a 24-member, 24-cycle, 10k-USDC-credit pool, the `pool_usdc_vault` holds an average of ~5k USDC of member funds that are *waiting* to be paid out. Letting that float earn yield is a no-brainer — **the question is how that yield is distributed and how conservatively the protocol is positioned against adapter risk.**

RoundFi's answer has two parts:

1. **Adapter-is-untrusted.** The yield adapter (Kamino on mainnet, a mock on devnet) is treated as external code: core validates the program ID against `pool.yield_adapter` on every CPI, snapshots balances before-and-after, and *uses the observed delta* rather than the adapter's declared return. See [Step 4c memory](../memory/feedback_step4c_economic_security.md).
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
│ (1) Guarantee  │  │ (2) Protocol   │  │ (3) Good-faith │
│     Fund top-  │  │     fee (20%)  │  │     bonus      │
│     up         │  │                │  │                │
└────────────────┘  └────────────────┘  └────────────────┘
         │                   │                   │
         │                   ▼                   │
         │           ┌────────────────┐          │
         │           │ treasury ATA   │          │
         │           └────────────────┘          │
         │                                       ▼
         │                              ┌────────────────┐
         │                              │ solidarity_    │
         │                              │ vault (future  │
         │                              │ on-time bonus) │
         │                              └────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│ (4) Participants — residual credited to         │
│     pool_usdc_vault (reduces future installment │
│     burden or tops up payouts)                  │
└─────────────────────────────────────────────────┘
```

### 2.1 Step 1 — Guarantee Fund top-up (FIRST)

The Guarantee Fund is topped up **before any fee is skimmed**. This is the core economic-security decision of Step 4c: the shock absorber is funded before the protocol takes revenue. Sizing follows `config.guarantee_fund_bps` (default 15000 bps = 150% of cumulative protocol fees).

### 2.2 Step 2 — Protocol fee (20% of remaining)

After GF top-up, 20% of the *remaining* yield is transferred to `treasury`. On devnet `treasury` is the authority's USDC ATA; on mainnet it is a Squads V4 multisig.

### 2.3 Step 3 — Good-faith bonus

A configurable share of the remaining yield flows back to the `solidarity_vault` where it is distributed to on-time members via `distribute_good_faith_bonus`. This is the positive-signal side of the reputation system: good behavior is *paid*, not only unpunished.

### 2.4 Step 4 — Participants (residual)

Everything left goes to `pool_usdc_vault`. Because payouts are fixed at `pool.credit_amount`, this residual effectively reduces the member-installment burden in later cycles, or tops up the float so the Seed-Draw invariant holds with a comfortable margin.

**Handler-enforced invariant.** The handler asserts:

```
gf_topup + protocol_fee + good_faith_bonus + participants_residual == harvested_delta
```

Any reordering or skipping is rejected with `WaterfallNotConserved`. Computations use bps math with floor, and residuals accumulate in `solidarity_balance` so **no rounding lamports are lost**.

---

## 3. The Guarantee Fund — what it does today, what it will do tomorrow

### 3.1 Role today (v1 — shipped)

1. **Payout-drain protection.** Before transferring `credit_amount` to a member, [claim_payout.rs:119](../programs/roundfi-core/src/instructions/claim_payout.rs:119) computes `spendable = pool_usdc_vault.amount - pool.guarantee_fund_balance` and requires `spendable >= credit_amount`. The Guarantee Fund is **earmarked**: the pool can never pay out if doing so would eat into the reserve.
2. **Growth path.** Topped up every harvest (Step 1 of the waterfall).

### 3.2 What the v1 Guarantee Fund does NOT do

- **It does not cover defaults.** `settle_default` never draws from `guarantee_fund_balance`. The default-cascade is per-member-local: Solidarity → Member escrow → Member stake. The Guarantee Fund sits untouched during settlement.
- **It does not pay yields to members.** Members receive yield via the good-faith bonus and the participants residual, not via the Guarantee Fund.

This is an intentional simplification for v1. The Guarantee Fund acts as a **future crash reserve** — accumulated across the lifetime of the pool so that v2 can introduce a catastrophic-loss draw path (e.g., a pool-wide black-swan event) with rate-limiting and governance oversight.

### 3.3 Role tomorrow (v2 — roadmap)

- **Catastrophic draw path.** If cumulative seized collateral in a cycle is insufficient to cover the payout float, a bounded draw from the GF kicks in. Rate-limited to prevent crank griefing.
- **GF redemption on pool close.** Unused GF at `close_pool` is returned pro-rata to members who completed all cycles on-time. Turns the reserve into a *loyalty dividend*.

These are called out as roadmap in all narrative material; the v1 demo does **not** claim them.

---

## 4. Why the pitch calls it "Shield 3"

In the canonical pitch mapping (see [pitch-alignment.md](./pitch-alignment.md)):

- **Shield 1 = Solidarity Vault** (first line of defense; always-on, first-seized on default)
- **Shield 2 = Member stake + escrow** (collateral layer; D/C-invariant-bounded)
- **Shield 3 = Guarantee Fund** (yield-funded; payout-drain-protected in v1; catastrophic-draw-capable in v2)

Shield 3 is **last** because it is:
- The most conservative (built from yield over time, never from stress seizure)
- The only shield protecting against events the first two cannot absorb
- The shield whose v2 upgrades unlock the "solvent by construction" claim under increasingly adversarial scenarios

---

## 5. Reading this live — how to verify the waterfall on-chain

For a reviewer or auditor:

1. Find the pool's `harvest_yield` transaction on Devnet.
2. Parse the `msg!` logs — the handler emits per-bucket amounts (`gf`, `fee`, `bonus`, `participants`) and the pre/post `pool_usdc_vault` balance.
3. Cross-check: `sum(buckets) == post_vault - pre_vault + outflows`.

For the Guarantee Fund specifically:

1. Read `pool.guarantee_fund_balance` before harvest, after harvest, and after any `claim_payout`.
2. After harvest: balance must have *grown* by `gf_topup`.
3. After payout: balance must be *unchanged* (the earmark is enforced pre-transfer).

The off-chain [stress-test script](../scripts/stress/multi_default.ts) (Step 4f addition) exercises a 3-veteran-default scenario against a localnet pool and asserts these relationships.

---

*End of yield-and-guarantee-fund v1.0.*
