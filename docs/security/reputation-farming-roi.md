# Reputation-Farming ROI Model (Audit Wave 4)

> **Status:** analysis / decision-support, not a code change.
> **Scope:** the "self-pool reputation farming" lead left open by the
> internal audit — quantify whether `cost_to_farm_L3 < value_of_L3` so
> the team can decide if mitigation is warranted.
> **Method:** grounded in the on-chain constants (no invented numbers);
> every figure cites its source file.

---

> ### Update — 2026-06 (Pass-3 + ECO-V52)
>
> This model is the **Audit Wave 4** snapshot and predates two hardenings;
> read it with these deltas:
>
> - **Cooldown 6d → 30d, cycles = full pools.** Pass-3 re-semanticised
>   `cycles_completed` to count **pools completed end-to-end** (the member's
>   last contribution landing), gated by `MIN_POOL_COMPLETE_COOLDOWN_SECS` =
>   **30 days** (was the 6-day `MIN_CYCLE_COOLDOWN_SECS`). Every wall-clock
>   floor quoted below is now ~5× larger.
> - **Four-tier ladder.** L4 "Elite" (3% stake) was added with a hard
>   Proof-of-Personhood floor (`IDENTITY_HARD_FLOOR_LEVEL`) that no config
>   value can disable. The §1–§2 L3-centric framing carries to L4 a fortiori.
> - **R2 applied at L2 (ECO-V52).** `LEVEL_2_MIN_CYCLES` raised **1 → 2**:
>   the 4× tier now requires two completed pools, closing the residual where
>   a single self-dealt pool reached L2 on the gate-off devnet path with no
>   identity. Floor-guarded (`level_2_min_cycles_above_floor`).
> - **§1 L2 stake corrected.** §1's table showed `3 000 (30%)` from the
>   pre-ECO-V52 draft; the real value is **2 500 bps (25%, exactly 4×)** —
>   `constants.rs:150`, parity-pinned in `economic_parity.spec.ts:931`
>   ("ECO-V52: was 30"). The headline L1→L3 prize (4 000) is unaffected (it
>   never depended on L2).
> - **R1 still open — owner decision.** The structural fix for the only
>   regime where the farm clears (large-`credit_amount` pools, §5.1) is the
>   graduated / absolute **stake-discount cap (R1, §7)**. It changes
>   `roundfi-core::join_pool`'s stake economics — i.e. the headline leverage
>   claim — so it is deliberately **left to the whitepaper owners** and is
>   NOT part of ECO-V52. Recommended as the next step if monitoring (R4)
>   surfaces farm attempts against high-credit pools.

---

## 1. What an attacker actually buys by reaching L3

Reputation level affects **exactly one** economic lever: the **stake
requirement** at `join_pool`. It does **not** gate credit access — any
member can join any pool regardless of level; only the collateral they
must lock changes (`join_pool.rs:177` → `stake_bps_for_level`).

| Level | `stake_bps` | Stake on the default 10 000 USDC pool |
| ----: | ----------: | ------------------------------------: |
|    L1 | 5 000 (50%) |                            5 000 USDC |
|    L2 | 2 500 (25%) |                            2 500 USDC |
|    L3 | 1 000 (10%) |                            1 000 USDC |

Source: `sdk/src/constants.ts STAKE_BPS_BY_LEVEL`; pool defaults
`roundfi-core/src/constants.rs` (`DEFAULT_CREDIT_AMOUNT = 10 000 USDC`,
`DEFAULT_MEMBERS_TARGET = 24`, `DEFAULT_INSTALLMENT = 600 USDC`,
`DEFAULT_CYCLE_DURATION = 30 days`).

**Marginal value of L3 over L1** on a 10 000 USDC pool = the stake
discount = **5 000 − 1 000 = 4 000 USDC of collateral that is no longer
at risk** on a default. That 4 000 USDC is the _entire_ prize. It does
**not** unlock more credit, more pools, or any other capability.

This framing is the crux of the whole model: **farming to L3 is worth
at most the stake discount on a subsequent default.** Everything below
compares that prize to the cost of obtaining it.

---

## 2. The exploit the prize enables

The only way to convert the stake discount into profit is a
**deliberate default**: join a real pool at L3, receive an early payout
(the seed-draw front-loads cycle-1 claimants — `SEED_DRAW_BPS = 9 160`,
91.6% retention), then stop contributing and let the pool settle the
default.

On default, the **Triple Shield** seizes `solidarity + escrow + stake`
(`settle_default.rs`). Immediately after an early claim, accrued
escrow/solidarity are small, so the pool's unbacked loss approaches:

```
unbacked_loss ≈ credit_received − seized_stake − seized_escrow_solidarity
```

| Level | seized stake | max unbacked loss (early-claim, ~0 escrow) |
| ----: | -----------: | -----------------------------------------: |
|    L1 |        5 000 |               ≈ 10 000 − 5 000 = **5 000** |
|    L3 |        1 000 |               ≈ 10 000 − 1 000 = **9 000** |

**Key observation:** a profitable default exists _at every level_ — the
Triple Shield + seed-draw retention are what bound it, **not** the
reputation level. Reaching L3 only widens the unbacked loss by the
**4 000 USDC stake discount**. An attacker who simply defaults at L1
already captures the larger-absolute 5 000 exposure **with zero farming
cost**. So the marginal product of farming is strictly the 4 000.

---

## 3. On-chain anti-farming controls (exact)

| Control                     | Value                                           | Source                              | Effect on the farm                                                                                   |
| --------------------------- | ----------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Score: PAYMENT              | +10                                             | `reputation/constants.rs:53`        | per on-time contribution                                                                             |
| Score: CYCLE_COMPLETE       | +50                                             | `:54`                               | per completed cycle                                                                                  |
| Score: LATE                 | −100                                            | `:55`                               | one late wipes 10 payments                                                                           |
| Score: DEFAULT              | −500                                            | `:56`                               | the exploit itself costs 500                                                                         |
| L2 gate                     | score ≥ 500 **and** cycles ≥ 2 (ECO-V52; was 1) | `:60,72`                            | two full rounds                                                                                      |
| L3 gate                     | score ≥ 2 000 **and** cycles ≥ 3                | `:61,73`                            | the prize tier                                                                                       |
| **Cycle-complete cooldown** | **518 400 s = 6 days / subject**                | `:38`, enforced `attest.rs:191-195` | `cycles_completed` rises **≤ 1 per 6 days per wallet**, regardless of how many pools run in parallel |
| Sybil halving               | positive deltas ×½ if unverified                | `attest.rs:225-237`                 | unverified PAYMENT +5, CYCLE_COMPLETE +25                                                            |
| Default demotion            | re-derive level from post-delta score, clamp L1 | `attest.rs:269-289`                 | a default instantly drops the farmed level                                                           |
| Issuer auth                 | pool-PDA or admin only                          | `attest.rs:122`                     | a farm pool must run **real** cycles to emit attests                                                 |

The load-bearing control is the **6-day per-subject cooldown on
`cycles_completed`** (SEV-047). Because L3 requires `cycles_completed ≥
3`, there is a **hard wall-clock floor of ≥ 18 days** to reach L3 that
**no amount of capital or parallel pools can shortcut** — the cooldown
keys on the _subject wallet_, not the pool.

---

## 4. Cost to farm one wallet to L3

Two binding constraints must BOTH be satisfied: `score ≥ 2 000` and
`cycles_completed ≥ 3`.

### 4.1 Time floor (hard)

`cycles_completed ≥ 3` at one increment / 6 days ⇒ **≥ 18 days minimum**,
independent of everything else. In practice the score constraint pushes
this higher unless the attacker also spams PAYMENT across parallel pools.

### 4.2 Score paths

**Path A — single pool, honest cadence (verified identity):**
per completed cycle = +50 (cycle) + ~1×+10 (payment) = **+60**.
`2 000 / 60 ≈ 34 cycles`. Gated by the 6-day cooldown → `34 × 6 ≈ **204
days**`. Unverified halves it → +30/cycle → `67 cycles ≈ **402 days**`.

**Path B — parallel-pool PAYMENT spam (fastest score):**
pool-PDA `SCHEMA_PAYMENT` has **no** 6-day cooldown (only the 60-s
admin-direct cooldown, `:50`, which doesn't apply to the pool path), and
a farm pool's `cycle_duration` is attacker-chosen, so PAYMENTs can be
emitted quickly across `P` controlled pools. Score 2 000 at +10
(verified) = **200 payments**; at +5 (unverified) = **400 payments**.
_But_ `cycles_completed ≥ 3` still forces ≥ 18 days, and each
`CYCLE_COMPLETE` the attacker does collect is capped at 1/6-days. So
Path B reaches the _score_ fast but is still **floored at ≥ 18 days** by
the cycles gate.

⇒ **Effective floor to L3 ≈ 18 days** (Path B, capital-heavy) to
**~200 days** (Path A, capital-light, verified).

### 4.3 Capital cost

Every attestation must come from a **real** pool cycle (issuer = pool
PDA). The attacker must therefore fund, for each controlled seat in each
farm pool, across ≥ 3 cycles:

- **Stake** locked for the pool's life (even at self-dealing L1 = 50% of
  that farm pool's credit), plus
- **Installments** each cycle (`DEFAULT_INSTALLMENT = 600 USDC/cycle`),
  plus
- **Protocol-fee leakage** on harvested yield / fees skimmed by the
  waterfall — a real, non-recoverable cost on every cycle.

If the attacker self-deals (controls all seats), the contribution
capital _circulates_ back to them, but it is **locked + fee-taxed +
time-valued** for the whole farm. The irreducible costs are: time-value
of locked capital over ≥ 18 days, protocol fees on ≥ 3 cycles, the
transaction/compute fees of running the pools, and — for the fast
verified path — **the cost of acquiring a verified identity** (Human
Passport), which is itself the anti-sybil chokepoint.

### 4.4 The burn on exit

Executing the default applies **−500 score and an immediate demotion**
(`attest.rs:269-289`). The farmed wallet is **single-use**: one exploit
burns the L3 status it spent ≥ 18 days building. The escape-valve mints a
_new_ identity, but it starts at **L1** and must be re-farmed from
scratch. So the farm cost is paid **per exploit**, not amortized.

---

## 5. Break-even

```
farm_cost(per exploit)  ≷  4 000 USDC   (the L3 stake discount on a 10k pool)

farm_cost ≈  time_value(locked_capital, ≥18d)
           + protocol_fees(≥3 cycles, all controlled seats)
           + tx/compute fees
           + identity_acquisition (fast path)
           + opportunity_cost(burned wallet, re-farm next time)
```

The prize (4 000) is **fixed** and **small relative to the capital that
must be locked to farm**. To run even a minimal self-pool through 3
cycles, the attacker locks low-tens-of-thousands of USDC (stake +
3×installments across enough seats to emit the needed PAYMENTs) for
≥ 18 days, pays protocol fees on every cycle, and burns the wallet on
exit. Against a **4 000** marginal gain, the farm is **economically
marginal-to-negative** in the default configuration — and the attacker's
strictly-simpler alternative (default at L1, no farming) already
captures a _larger absolute_ unbacked loss.

### 5.1 Where it could flip positive

The break-even is sensitive to two pool parameters a creator controls:

1. **Large `credit_amount`.** The prize scales linearly: on a 100 000
   USDC pool the discount is **40 000**, which can dominate the
   (sub-linear) farm cost. Farming is only rational against **large-
   credit pools**.
2. **Short `cycle_duration` on the _target_ pool.** Doesn't change the
   18-day farm floor, but shortens the window between L3-join and the
   early-claim-then-default, reducing accrued escrow/solidarity the
   Shield can seize → larger unbacked loss.

So the residual risk is concentrated in: **high-credit pools** reached by
a **verified** identity (fast path) where the **4 000-scaled-up discount
exceeds the farm cost**.

---

## 6. Findings

1. **The audit's "cheap + 6-day cooldown" framing is directionally
   right but under-quantified.** The binding control is the SEV-047
   `cycles_completed ≥ 3` floor (≥ 18 days, capital + cooldown
   immovable), reinforced by sybil-halving and default-demotion. In the
   **default 10 000 USDC** configuration the farm is **economically
   marginal** — the prize is just the 4 000 stake discount, the simpler
   L1-default alternative captures more, and the wallet burns on exit.

2. **The real residual is parameter-dependent, not structural.** Farming
   only turns rational against **large-credit pools** (the prize scales
   linearly with `credit_amount` while the farm cost does not) reached
   via a **verified identity** on the fast PAYMENT-spam path.

3. **Level discounts _stake_ but not _exposure_.** Because level changes
   only collateral and not credit access, an L3 member on a big pool
   carries the _same_ credit exposure as an L1 member but posts ⅕ the
   collateral — the discount is unmatched by any graduated exposure cap.

---

## 7. Recommendations (for the team to weigh — no code here)

Ordered by leverage ÷ disruption:

- **R1 (cheapest, recommended): cap per-pool `credit_amount` as a
  function of the joiner's level**, or cap the L3 stake _discount_ in
  absolute USDC. Today level→stake is a flat ratio; a graduated
  exposure cap (e.g. L3's 10% stake only applies up to a credit ceiling,
  above which the ratio steps back up) removes the linear-prize scaling
  that is the only regime where farming pays. Smallest change, kills the
  §5.1 failure mode directly.

- **R2: raise the L3 floor.** `LEVEL_3_MIN_CYCLES = 3` (≥ 18 days). A
  bump to e.g. 6 (≥ 36 days) doubles the time floor at negligible cost
  to legitimate veterans (who hit it naturally over months) while
  further taxing the farm. One-line constant change + the existing floor
  guard test.

- **R3: require verified identity for L3** (`required_min_level` is
  already wired — `set_identity_gate`). Setting the L3 identity gate
  forces every farmed wallet through the Human Passport chokepoint,
  pricing in a real per-wallet sybil cost and collapsing the cheap
  unverified path. Operational toggle, no code change.

- **R4 (monitoring, not prevention): alert on the farm signature.** A
  wallet reaching L3 with `cycles_completed` clustered near the 6-day
  cooldown across many short-cycle pools, then joining a high-credit
  pool and claiming early, is a detectable pattern. The indexer already
  has the events; an Insights panel (post-threshold) or an ops alert
  closes the loop without a protocol change.

**Bottom line:** in the shipped default configuration the lead is
**low-severity** — the economics don't clear. It becomes **medium** only
for **large-`credit_amount` pools**, and **R1** (graduated exposure cap)
is the single change that removes that regime. Recommend R1 + R3 (gate),
hold R2 unless monitoring shows farm attempts.
