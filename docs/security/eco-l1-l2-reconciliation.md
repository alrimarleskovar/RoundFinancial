# ECO L1↔L2 Reconciliation — Stress Lab model vs on-chain truth

> **Status: reconciliation decision (2026-05-26).** Resolves the three
> open cryptoeconomic parity findings ECO-002, ECO-003, ECO-007 from the
> 2026-05-24 external-audit pass (see
> [`internal-audit-findings.md`](./internal-audit-findings.md) §"Cryptoeconomic findings").
>
> Audience: external auditors + the team's pre-mainnet review. The point of
> this doc is to state, for each finding, **the decision** (reconcile-by-doc
> vs deferred-model-change) and the rationale — so the divergences between
> the Stress Lab (L1) and the on-chain protocol (L2) are explicit and
> intentional, not silent.

## Background — what L1 and L2 are

- **L1 — the Stress Lab** (`sdk/src/stressLab.ts`): a TypeScript economic
  simulator that powers the public `/lab` UI. It is an **exploration /
  teaching tool**: given a credit, member count, level, yield, and a
  payment matrix, it projects per-cycle cash flows and a solvency read.
  It is NOT the protocol's source of truth.
- **L2 — the on-chain protocol** (`programs/roundfi-core`): the actual
  instructions (`contribute`, `claim_payout`, `settle_default`,
  `deposit_idle_to_yield`, …) and their invariants (D/C, Triple Shield).
  This is the source of truth, covered by 314 tests + ~9.85B fuzz
  iterations.

When L1 and L2 disagree, **L2 wins** — L1 is the model, L2 is reality. The
findings below are cases where L1 is known to differ; the question each
resolves is "fix L1 to match, or document the difference as an intentional
simplification?"

A standing guard exists for the most dangerous class of L1↔L2 drift:
`tests/parity.spec.ts` "ECO-001 reachability" asserts that the display-only
`netSolvency` metric has **zero** call-sites in `programs/**/*.rs`, so no L1
modelling choice can ever gate an on-chain fund movement. That guard is the
backstop behind every decision here.

---

## ECO-007 — `lpDistribution` treatment

**Divergence.** L1 treats `lpDistribution` as "already paid out" and excludes
it from `netSolvency` (`stressLab.ts:408-414`, `:629-632`). On-chain,
post-SEV-048, `claim_payout` / `deposit_idle_to_yield` reserve
`lp_distribution_balance` as a **non-spendable earmark inside the pool USDC
vault** until M3 LP-withdrawal ships.

**Decision: reconcile-by-doc — intentional L1 simplification (sound for the
solvency verdict).**

Rationale: the only metric L1 produces that matters for the audit claim is
the solvency verdict. For that verdict, **both models treat `lpDistribution`
as unavailable to cover obligations**:

- L1 excludes it from `netSolvency` (it's "out of the books").
- L2 keeps it in the vault but earmarked non-spendable, so it is likewise
  excluded from funds available to back `credit_amount` (the Shield-2
  Guarantee-Fund solvency guard gates on `vault − GF − LP ≥ credit`).

So the economic substance for solvency is identical; the divergence is purely
**bookkeeping location** (conceptually-paid-out vs earmarked-in-vault), which
does not change any L1 verdict.

**Guard for the future.** This simplification is sound for the solvency
verdict, but it is NOT sound for a parity test that asserts **raw vault
balances** between L1 and L2 — there, the on-chain vault carries the LP
earmark and L1 does not. The L2 economic-parity blocks that would exercise
this are currently `describe.skip` / `this.skip()` and LP-withdrawal (M3) has
not shipped, so the gap is **inert today**. Whoever un-skips those blocks (or
ships LP-withdrawal) MUST first make L1 reserve `lpDistribution` in the float
the same way on-chain does, or the raw-balance assertion will diverge. The
inline notes at `stressLab.ts:408-414` and `:629-632` carry this warning.

---

## ECO-002 — L1 recovery model ≠ on-chain `settle_default`

**Divergence.** Two coupled differences:

1. **Recovery generosity.** L1 credits a generous seizure on default
   (retains roughly the defaulter's full paid-in position to `retained`),
   while on-chain `settle_default` seizes `missed = installment.min(d_rem)`
   **once** and leaves the remaining collateral **locked** (not credited as
   protocol surplus). L1 is therefore **optimistic** relative to the
   contract.
2. **Installment derivation.** L1 derives `installment = creditAmountUsdc /
members` (`stressLab.ts:368-369`) — the pure zero-sum ROSCA installment
   (e.g. $416.67 for a $10k / 24-member pool). On-chain uses an
   **independent** installment (SEV-025 set the demo pool to $600/cycle, a
   viable amount that is not forced to equal `credit/members`). L1 has no
   way to express an installment that differs from `credit/members`.

**Decision: reconcile-by-doc now (L1 is the optimistic model; L2 is truth) +
deferred model change for the installment-independence enhancement.**

Rationale:

- The recovery-generosity gap is **safe in the direction that matters**: L1
  is more optimistic than the contract, and the contract's conservative
  behaviour (`settle_default`) is the one covered by 314 tests + fuzz and is
  what actually moves funds. An optimistic teaching model that overstates
  recovery cannot cause an on-chain loss — it can only mislead a reader, so
  the honest fix is to **label** L1 as an optimistic upper-bound recovery
  model, which this doc + the inline caveat now do.
- The installment-independence change (add an optional independent
  `installment` to `StressLabConfig`, then **rebalance the surplus
  accounting** that arises when `members × installment ≠ credit`) is a real
  model enhancement. It is **deliberately deferred**, not done blind: the
  Stress Lab is a public, judge-facing tool, and changing the surplus
  accounting without re-validating every preset's displayed numbers against
  the UI is exactly the failure mode of ECO-005 (a public number that didn't
  reconcile). The enabling change is contained; the accounting rebalance must
  be validated in the lab UI, which is a follow-up with a human in the loop.

Net: L1's optimism is documented (not a security issue — it is the
non-authoritative model and errs optimistic); the installment-independence
modelling is a tracked follow-up.

---

## ECO-003 — "non-monotonic thin margin, breakpoint 16.7%"

**Divergence.** The audit flagged a suspected non-monotonic solvency margin
with a breakpoint around 16.7%.

**Decision: retract the claim as unsound; re-derivation deferred.**

Rationale: the 16.7% breakpoint was derived on top of **two premises that are
now known invalid**:

1. The `netSolvency` metric (ECO-001), which is an immediate-liquidation /
   end-of-life measure that is structurally negative on intermediate ROSCA
   frames and can even "improve" on a default — i.e. not a sound
   intermediate-frame solvency signal. (`netSolvency` is display-only;
   zero on-chain call-sites, guarded in CI.)
2. The infeasible `$416.67` zero-sum installment (ECO-002), rather than the
   on-chain `$600`.

With both premises invalid, "non-monotonic margin at 16.7%" is **not a
sound claim** and should not be cited. A re-derivation under on-chain
parameters (the independent `$600` installment + a final-frame,
yield-aware read) depends on the ECO-002 installment-independence work and a
lab run, so it is deferred. Until then, the breakpoint is **retracted**, not
confirmed.

---

## Summary

| Finding | Decision                                          | What changed                                                                                                                            | Deferred                                                                                |
| ------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| ECO-002 | Reconcile-by-doc (L1 = optimistic model; L2 wins) | Inline caveat at the installment derivation + this doc label L1 as an optimistic upper-bound recovery model with a zero-sum installment | Independent-installment config + surplus-accounting rebalance (needs lab-UI validation) |
| ECO-003 | Retract the unsound breakpoint claim              | This doc retracts "non-monotonic margin @ 16.7%" (built on ECO-001 metric + $416 installment)                                           | Re-derivation under on-chain `$600` + final-frame yield-aware read                      |
| ECO-007 | Reconcile-by-doc (intentional L1 simplification)  | Firmed-up inline notes + this doc: sound for the solvency verdict, with a guard for raw-balance L2 parity                               | Reserve `lpDistribution` in L1 before un-skipping L2 parity / shipping LP-withdrawal    |

**Bottom line.** None of ECO-002/003/007 is a fund-drain or an on-chain
correctness issue — they are L1-model accuracy / parity items. L2 (the
on-chain protocol) is the source of truth and is independently validated; L1
is a non-authoritative exploration tool whose remaining divergences are now
explicit and, where they err, err on the optimistic (non-dangerous) side.

## See also

- [`internal-audit-findings.md`](./internal-audit-findings.md) — ECO series + the `netSolvency` ECO-001 reachability guard
- [`../stress-lab.md`](../stress-lab.md) — the L1 presets and how to read them
- `sdk/src/stressLab.ts` — the L1 model (inline ECO-001/002/007 caveats)
- `tests/parity.spec.ts` — "ECO-001 reachability" CI guard
