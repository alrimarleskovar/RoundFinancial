# L4 Elite Default-Asymmetry — Bounded-Risk Analysis (ECO-V52)

> **Status:** analysis / decision-support closing the ECO-V52 "L4 default
> asymmetry (draw 100% / lose 3%)" residual. Not a leverage change.
> **Scope:** quantify whether the Elite tier's 3%-stake default tail is a
> fund-drain (it is not) and pin the on-chain mitigations against regression.
> **Method:** grounded in the on-chain constants + `settle_default` shields;
> every figure cites its source. Companion to
> [`reputation-farming-roi.md`](./reputation-farming-roi.md), which covers
> the L2/L3 (pre-four-tier) case.

---

## 1. The asymmetry, stated exactly

The v5.2 ladder discounts the **stake** a member must lock at `join_pool`,
not the **credit** they receive:

| Level | `stake_bps` | Stake on a 10 000 USDC pool | Leverage (`MAX_BPS / stake_bps`) |
| ----: | ----------: | --------------------------: | -------------------------------: |
|    L1 | 5 000 (50%) |                  5 000 USDC |                               2× |
|    L2 | 2 500 (25%) |                  2 500 USDC |                               4× |
|    L3 | 1 000 (10%) |                  1 000 USDC |                              10× |
|    L4 |    300 (3%) |                    300 USDC |                           ~33.3× |

Source: `programs/roundfi-core/src/constants.rs` (`STAKE_BPS_LEVEL_*`),
pinned by `economic_parity.spec.ts` ("stake floors mirror the on-chain
50/25/10/3 schedule") and `constants.rs::tests::stake_tier_values_match_whitepaper`.

A member who draws their carta early (the seed-draw front-loads cycle-1
claimants — `SEED_DRAW_BPS = 9_160`) and then stops contributing leaves an
**unbacked tail** that the pool's shields must absorb:

```
unbacked_tail ≈ credit_received − seized(solidarity + escrow + stake)
```

Because L4 posts only **3%** stake, the stake leg of that seizure is the
thinnest of any tier — so the Elite default tail is, by construction, the
**widest**. That is the asymmetry the auditor flagged ("draw 100% / lose
3%"). The rest of this note shows it is **bounded and irrational to
exploit**, not a fund-drain.

---

## 2. Why it is loss-BOUNDED, not fund-drain

The Elite tail is wider than other tiers but it is **not unbounded**, for
three independent on-chain reasons:

1. **Triple Shield + D/C invariant (the hard bound).**
   `settle_default` seizes `solidarity → escrow → stake` into
   `pool_usdc_vault` ("remaining members never foot the bill"), and then
   enforces the debt/credit invariant
   `D_remaining * C_initial <= C_remaining * D_initial`
   (`settle_default.rs:11-23`). If a seizure would break it, the program
   **seizes less** — collateral stays locked rather than the pool going
   unbalanced. The pool can never be driven cash-negative by a settle.

2. **Seed-Draw retention (caps the early extraction).** The cycle-0
   `claim_payout` guard requires the pool to retain **91.6%** of credit at
   first payout (`SEED_DRAW_BPS = 9_160`, the SEV-025 viability constraint).
   An Elite member cannot draw the carta _and_ leave the pool hollow — the
   retention buffer is what the next settle seizes against.

3. **Guarantee Fund (absorbs the residual).** `DEFAULT_GUARANTEE_FUND_BPS =
15_000` (150% of protocol yield) is earmarked to cover exactly this
   redistributive shortfall.

**Validation in the model:** `economic_parity.spec.ts` →
"Elite triple-default is still loss-BOUNDED (no fund-drain at 3% stake)"
asserts `0 < totalLoss < 3 × creditAmount` for three consecutive Elite
defaults — i.e. loss is real but can never exceed the cartas actually drawn.
A sibling test pins that the Elite tail is _strictly worse_ than Veterano's,
so the asymmetry is **visible, not silently absent**.

> The residual loss is **redistributive** (borne by co-members + the GF up
> to the bound), not a drain of protocol-controlled funds. This is the
> nature of any ROSCA: a member who defaults after drawing hurts the round.
> The shields cap how much.

---

## 3. Why farming-to-Elite-then-default is economically irrational

To reach L4 an attacker must clear **both** on-chain pillars:

| Pillar       | Constant                                                                                                      | Cost imposed                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Time**     | `LEVEL_4_MIN_CYCLES = 8` pools completed end-to-end, each ≥ 30 days apart (`MIN_POOL_COMPLETE_COOLDOWN_SECS`) | ≥ ~4 years of honest history (8 × ~6-month pools) — the strongest wall-clock floor in the protocol                                               |
| **Identity** | `IDENTITY_HARD_FLOOR_LEVEL = LEVEL_MAX`                                                                       | L4 is **never** granted to an unverified wallet, even on devnet where the configurable gate is off — a real Human-Passport sybil cost per wallet |

So the Elite default is **single-use and pre-paid**: the attacker spends
~4 years of genuine ROSCA participation **and** a verified identity, then
burns both on one default whose marginal prize over simply defaulting at a
lower tier is only the **stake discount** (a few hundred USDC on a 10k
pool). A `SCHEMA_DEFAULT` attestation applies **−500 score + immediate
demotion**, so the wallet cannot repeat. Per the farming-ROI model this is
already negative-EV at L2/L3; at L4 the acquisition cost is **multiples
higher** while the marginal prize is **smaller** (3% vs 10% stake is a
narrower discount delta than 50%→10%). The economics are strictly worse for
the attacker than every cheaper tier.

---

## 4. Why the 33× is design-intentional (not a bug to "fix")

The leverage ladder is a **product decision the maintainers took
deliberately**, recorded in `docs/architecture.md`:

> "The '10× leverage' headline survives — L3 stays at 10%. But L4 Elite at
> 3% implies **~33×**; whether that becomes a new headline or stays
> understated is a **whitepaper/pitch decision, not an engineering one**.
> Flagging so it's chosen deliberately." — `architecture.md:677`

High leverage for high-reputation members **is the product**: behaviour is
the collateral, and ~4 years of kept obligations + a verified identity is
what "buys" the 3% stake. Narrowing the Elite stake discount (the
farming-ROI doc's **R1** — a graduated / absolute exposure cap) would change
that headline claim, so it is correctly **out of engineering scope** and
left to the whitepaper owners (see §6).

---

## 5. Regression guards (what pins the mitigation)

The bounded-risk argument above only holds while the two pillars hold, so
both are now pinned against silent drift (`programs/roundfi-reputation/src/constants.rs`,
`mod floor_guards`):

- `identity_hard_floor_covers_elite_tier` — asserts
  `IDENTITY_HARD_FLOOR_LEVEL <= LEVEL_MAX`, so the Elite tier can never
  escape the mandatory identity floor (a value above `LEVEL_MAX` would
  silently disable it).
- `level_4_min_cycles_above_floor` — asserts `LEVEL_4_MIN_CYCLES >= 8`, so
  the ~4-year wall-clock cost can't be quietly lowered "for a demo" (the
  SEV-002 regression family).

Plus the pre-existing `economic_parity.spec.ts` loss-bounded assertion (§2)
and the on-chain D/C invariant in `settle_default`. Together: the asymmetry
is **modelled, bounded, and its on-chain mitigations are CI-pinned**.

---

## 6. The residual that remains a PRODUCT decision

This analysis closes the **security** residual: the L4 asymmetry is not a
fund-drain, is irrational to exploit, and its mitigations are pinned. What
remains is **not a security item** — it is the standing product question
the architecture already flagged: _should the 3% Elite stake (33× leverage)
ship as-is, or should the absolute stake discount be capped (farming-ROI
R1) on very large-`credit_amount` pools?_ That changes the headline leverage
claim and belongs to the whitepaper owners, not to engineering. It is
tracked there, **not** as an open audit finding.

---

## 7. Verdict

**Low / design-intentional.** The Elite default tail is the widest by
construction but is **loss-bounded** (Triple Shield + D/C invariant +
Seed-Draw retention + GF, validated by the `eliteTripleDefault` test),
**economically irrational** to exploit (≥ ~4 years + a verified identity,
burned single-use for a smaller marginal prize than any cheaper tier), and
**deliberately chosen** (the 33× is a documented whitepaper decision). The
two on-chain pillars are now CI-pinned. No fund-drain path; the only open
question is a product one (§6).
