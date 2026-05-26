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

**Decision: reconcile-by-doc (L1 is the optimistic model; L2 is truth) +
installment-independence shipped as an additive, opt-in model change.**

Rationale:

- The recovery-generosity gap is **safe in the direction that matters**: L1
  is more optimistic than the contract, and the contract's conservative
  behaviour (`settle_default`) is the one covered by 314 tests + fuzz and is
  what actually moves funds. An optimistic teaching model that overstates
  recovery cannot cause an on-chain loss — it can only mislead a reader, so
  the honest fix is to **label** L1 as an optimistic upper-bound recovery
  model, which this doc + the inline caveat now do.
- The installment-independence change is now **shipped** (`stressLab.ts`): an
  optional `StressLabConfig.installmentUsdc` decouples the installment from
  `credit / members`, exactly like the on-chain pool (`installment_amount`
  and `credit_amount` are independent fields). It is **additive and opt-in** —
  when omitted, the installment is the zero-sum `credit / members` default, so
  **every preset's displayed numbers are byte-identical** (guarded by a CI test
  asserting `overCollection === 0` across all presets). This sidesteps the
  ECO-005 failure mode (no public number changes silently).
- **Surplus accounting (decision: residual-in-float + explicit metric).** When
  the independent installment over- or under-collects vs the zero-sum baseline
  (`members × installment ≠ credit`), the difference flows through the float
  and is surfaced as `FrameMetrics.overCollection` (= `(installment −
credit/members) × installments paid`). It is **not refunded** — this matches
  on-chain, where the surplus sits in the vault and safety comes from the D/C
  invariant, not from zero-sum. ⚠️ **Pending lab-UI validation:** the
  _disposition_ of that surplus (protocol-held equity vs eventually
  member-refundable) and the displayed solvency magnitudes for any new
  independent-installment preset still need a human-in-the-loop lab run before
  being published as judge-facing claims. The mechanics + metric are landed;
  introducing a public over-collecting preset is the gated follow-up.

Net: L1's optimism is documented; the installment-independence mechanics are
shipped (opt-in, no preset drift), with the surplus surfaced explicitly and the
public-preset/number step gated on lab-UI validation.

---

## ECO-003 — "non-monotonic thin margin, breakpoint 16.7%"

**Divergence.** The audit flagged a suspected non-monotonic solvency margin
with a breakpoint around 16.7%.

**Decision: retract the original claim as unsound; re-derived under on-chain
parameters (provisional, pending lab-UI validation).**

Rationale: the 16.7% breakpoint was derived on top of **two premises that are
now known invalid**:

1. The `netSolvency` metric (ECO-001), which is an immediate-liquidation /
   end-of-life measure that is structurally negative on intermediate ROSCA
   frames and can even "improve" on a default — i.e. not a sound
   intermediate-frame solvency signal. (`netSolvency` is display-only;
   zero on-chain call-sites, guarded in CI.)
2. The infeasible `$416.67` zero-sum installment (ECO-002), rather than the
   on-chain `$600`.

**Re-derivation (now that ECO-002's independent installment exists).** Sweeping
post-contemplation defaults `k` on the canonical 24-member / $10k-credit /
Veterano pool and reading the **final-frame** `netSolvency`
(`tests/economic_parity.spec.ts` → "runSimulation — ECO-003 breakpoint
re-derivation"):

- **Under the retracted premises** ($416.67 zero-sum installment, 6.5% APY) the
  claim **reproduces exactly**: final-frame `netSolvency` runs
  `+28 (k=3) → −184 (k=4) → +24 (k=5)` — i.e. it dips below zero at **k=4 = 4/24
  = 16.7%** and then **recovers**. The non-monotonic U-shape is the ECO-001
  end-of-life artifact (the defaulter's un-disbursed escrow lingers in
  `poolBalance` while their outstanding obligation drops), not a real
  cliff. So the audit's number was a faithful read of an unsound metric on an
  infeasible installment.
- **Under the on-chain independent $600 installment** the breakpoint **does not
  reproduce**: final-frame `netSolvency` stays positive and **monotonically
  decreasing** through at least k=8 (33% defaults). The buffer is the
  over-collection of $600 vs the $416.67 zero-sum baseline
  (`overCollection ≈ 24 × 24 × $183.33 ≈ $105.6k` at 0% APY), surfaced by ECO-002.

⚠️ **Provisional.** The _qualitative_ finding is solid and CI-pinned: the
"non-monotonic margin @ 16.7%" is an artifact of the retracted premises and
**does not survive** the move to on-chain parameters. The _quantitative_
solvency magnitudes under $600 are dominated by over-collection sitting in the
float (see ECO-002), whose disposition still needs a human-in-the-loop lab run
before any figure is published as a judge-facing claim. Until then: the original
breakpoint is **retracted**, and the re-derivation says **no breakpoint under
on-chain params** (provisional).

---

## Summary

| Finding | Decision                                                  | What changed                                                                                                                                                                                    | Deferred                                                                             |
| ------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ECO-002 | Reconcile-by-doc + ship additive installment-independence | Optional `installmentUsdc` decouples installment from `credit/members` (opt-in; presets byte-identical, `overCollection===0` guarded); surplus = residual-in-float surfaced as `overCollection` | Surplus _disposition_ + any public over-collecting preset (needs lab-UI validation)  |
| ECO-003 | Retract original claim; re-derive (provisional)           | 16.7% dip reproduces only under the retracted premises ($416.67 + netSolvency); under on-chain `$600` there is **no breakpoint** (monotonic, solvent through 33%) — CI-pinned                   | Quantitative magnitudes under `$600` (over-collection dominated) pending lab-UI run  |
| ECO-007 | Reconcile-by-doc (intentional L1 simplification)          | Firmed-up inline notes + this doc: sound for the solvency verdict, with a guard for raw-balance L2 parity                                                                                       | Reserve `lpDistribution` in L1 before un-skipping L2 parity / shipping LP-withdrawal |

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
