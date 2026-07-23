# ADR 0013 — Behind-member catch-up (regularização) during the grace window

**Status:** 🟡 Proposed — **security-gated, no on-chain code until reviewed**
**Date:** 2026-07-23
**Decision-makers:** RoundFi team (Alrimar, Caio — security owner)
**Related:** LEAD-001 (payable-XOR-settleable, `docs/security/audit-leads-triage.md`); `tests/edge_settle_default_boundary.spec.ts`; ADR 0012 (prepayment — the AHEAD direction); the `contribute` cycle gate; `settle_default` grace gate; SEV-053 (window anchoring).

## Context

A member who **misses** an installment and whose pool then advances the cycle (`claim_payout.rs:201` / `crank_payout.rs:232` set `pool.current_cycle = next_cycle`) lands in `contributions_paid < current_cycle` — **behind**. From there, **no instruction lets them pay**:

- `contribute` requires `args.cycle >= pool.current_cycle` (ADR 0012) **and** `args.cycle == member.contributions_paid`. A behind member's next unpaid installment is `contributions_paid < current_cycle`, which fails `>= current_cycle`. Reverts, always.
- `settle_default` requires `contributions_paid < current_cycle` **and** `clock >= next_cycle_at + GRACE`. Before grace elapses it can't fire either.

So during the grace window the member is **behind but not yet defaultable — and has no way to act.** This is not a UI limitation; it is arithmetic (raised by Yvina on devnet).

Two things make this a genuine defect rather than a clean design:

1. **The product promises catch-up.** `docs/spec/derived/10-user-guide.md:227` — _"If you fall behind, catch up inside the grace window."_ The pay modal said the same (`modal.pay.gate.behind` — "fale com o grupo pra regularizar"). Both promise a path the protocol doesn't implement. (The modal copy is corrected to be honest in the same PR as this ADR; the guide + the real path are this ADR's job.)
2. **The "no catch-up" property is real but EMERGENT, not designed.** LEAD-001 records _payable-XOR-settleable_ — `contribute` needs `>= current_cycle`, `settle_default` needs `< current_cycle`, so a late payment can never race settlement. Valuable. But `tests/edge_settle_default_boundary.spec.ts` itself calls it _"emergent from two `require!`s in two files … with no single test pinning it"_ — it was **observed and pinned**, not chosen. So closing the catch-up gap is not overturning a deliberate mechanism; it is **re-deriving the same race-safety by a different means while honouring the product promise.**

ADR 0012 (#643) already relaxed the same gate in the **opposite** direction (AHEAD / prepayment). This ADR is the BEHIND direction and is deliberately split out because — unlike prepayment — it touches the settlement race, so it is **security-gated**.

## Decision (proposed — pending Caio's review)

Allow a behind member to **catch up during the grace window**, and preserve race-safety by swapping **state exclusion** for **time exclusion**.

1. **`contribute` accepts arrears during grace.** In addition to the current `>= current_cycle` path, accept `args.cycle == member.contributions_paid` when `contributions_paid < current_cycle` **and** `clock.unix_timestamp < grace_deadline` (`= next_cycle_at + GRACE_PERIOD_SECS`). The `== contributions_paid` check still forbids skipping — a behind member pays their oldest unpaid installment first and walks forward.
2. **`settle_default` is unchanged** — it still requires `clock >= grace_deadline`. So the catch-up window (`clock < grace_deadline`) and the settle window (`clock >= grace_deadline`) are **temporally disjoint**: at no instant are both a catch-up `contribute` and a `settle_default` valid for the same member. The race LEAD-001 rules out stays ruled out — by time instead of by state.
3. **Arrears are classified `LATE`.** The current `on_time = clock <= next_cycle_at` is not enough (it reasons about the _current_ cycle's deadline, not the missed one). Make it cycle-aware: `on_time = args.cycle >= pool.current_cycle && clock <= pool.next_cycle_at`. A behind catch-up (`args.cycle < current_cycle`) is therefore always `LATE` (−100), which is correct — the installment missed its deadline — and matches the reputation intent the `skip_defaulted_payout` / SEV-053 comments already reach for.
4. **Catch-up removes the behind status.** Once `contributions_paid` climbs back to `current_cycle`, the member is payable-current again and `settle_default` no longer applies (`contributions_paid < current_cycle` is false). Regularização, delivered.

Open questions for the review (not yet decided): whether arrears carry a **penalty** beyond the LATE score hit (v1 proposal: no on-chain fee — the LATE reputation mark is the cost); and whether catch-up is capped to the single missed cycle or may span multiple missed cycles inside one grace window (proposal: as many as `== contributions_paid` walks, all `LATE`, all before `grace_deadline`).

**Validation before any merge:** litesvm/bankrun tests pinning — (a) a behind member catches up during grace → succeeds, minted `LATE`; (b) the same `contribute` **after** `grace_deadline` → still reverts (no catch-up post-grace, settle territory); (c) `settle_default` after grace on a member who did NOT catch up → still succeeds; (d) no ordering of (a)/(c) double-processes. Plus extending `edge_settle_default_boundary` so the XOR is pinned as _time-exclusive_ rather than _state-exclusive_.

## Consequences

- ✅ Closes the trap Yvina found; the grace window becomes actionable instead of a countdown to seizure; the code finally matches `10-user-guide.md`.
- ✅ Race-safety preserved by construction (disjoint time windows) — the LEAD-001 property is re-expressed, not dropped.
- ✅ Correct reputation: arrears score as `LATE`, so catching up is not free of consequence, just not fatal.
- ⚠️ Turns an _emergent_ invariant into a _designed_ one — which is an improvement, but it MUST be reviewed as a security change (Caio), with the property test rewritten to assert the new (time-exclusive) shape.
- ⚠️ `grace_deadline` moves with `next_cycle_at` (SEV-053 `max(schedule, now)`); the catch-up gate must read the same freshly-anchored deadline, or a stale read could misjudge the window edge.
- ❌ Not a one-liner like ADR 0012: it adds a second accepted branch to `contribute`, a cycle-aware `on_time`, and its own test matrix. Worth it, but gated.

## Alternatives considered

### Make the docs match the code (drop the catch-up promise) instead of adding catch-up

Cheapest: edit `10-user-guide.md` + the modal copy to say "once you fall behind, the cota is on the default track." Honest, zero on-chain risk. Rejected as the _end state_ (a ROSCA with no path back from a single miss is harsh and off-brand for a consórcio), but adopted as the **interim** — the modal copy is corrected now while this ADR is reviewed, so we never ship a false promise.

### Let catch-up run at any time (no grace bound)

Simplest gate (`contribute` accepts any `args.cycle == contributions_paid`). Rejected: it reintroduces exactly the late-pay-vs-settle race LEAD-001 rules out — after `grace_deadline` both a catch-up and a `settle_default` would be valid. The grace bound is what keeps the windows disjoint.

### Off-chain "regularização" (indexer/operator brokers it)

Matches the old "fale com o grupo" copy literally, but a fund-movement path gated on a trusted broker is against the protocol's trustless posture. Rejected.

### Penalty-bearing catch-up (late fee on top of LATE)

Defensible economically, but adds fee math + a treasury sink to a first cut. Deferred to the review — v1 proposes the `LATE` score hit as the only cost.

## References

- The trap: `contribute.rs` cycle gate + `settle_default.rs` `MemberNotBehind` / grace gate
- Cycle advance that opens the gap: `claim_payout.rs:201`, `crank_payout.rs:232`
- Emergent-invariant note + pin: `tests/edge_settle_default_boundary.spec.ts` (Cases C/D)
- Security property: LEAD-001, `docs/security/audit-leads-triage.md`
- Product promise: `docs/spec/derived/10-user-guide.md:227`
- Opposite direction (already shipped): ADR 0012 (prepayment)
- Window anchoring caveat: SEV-053 (`claim_payout.rs:202-213`)
- Follow-up (required before code): Caio security review of this ADR + the test matrix above
