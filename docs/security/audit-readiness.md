# Audit-Readiness — RoundFi

> **One-pager for security firms.** The "why we are audit-ready in 2 weeks, not 6" summary. Companion to:
>
> - [`../../AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md) — formal scope (in/out + LoC + prior hardening PR list + mainnet timeline)
> - [`./internal-audit-findings.md`](./internal-audit-findings.md) — **internal pre-audit tracker (40 findings, 36 closed)** — read this first to see what the team's own red-team already surfaced
> - [`./self-audit.md`](./self-audit.md) — full 228-line self-audit + threat model
> - [`../../SECURITY.md`](../../SECURITY.md) — disclosure channel + SLAs

---

## TL;DR

| Signal                                      | Value                                                                                                 | Where to verify                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Internal pre-audit (Adevar methodology)** | **40 findings catalogued, 36 🟢 closed, 1 🟠 upstream-blocked, 3 🔵 design-intentional**              | [`internal-audit-findings.md`](./internal-audit-findings.md) — public tracker, SEV-001..SEV-039 + SEV-034b     |
| **Critical / High fixes**                   | **10/10 🟢 closed** (3 Critical + 7 High) with negative regression tests per "test-before-merge" gate | PRs [#326..#365](https://github.com/alrimarleskovar/RoundFinancial/pulls?q=is%3Apr+is%3Amerged+SEV)            |
| **Pre-audit methodology**                   | **5 passes** (W1..W5) + 1 integration-testing wave — each pass re-audited the prior round's fixes     | [`internal-audit-findings.md`](./internal-audit-findings.md) §"Methodology"                                    |
| **Single-source-of-truth math**             | Cascade + cumulative-paid derivations centralized in `crates/math/`                                   | Both on-chain handlers AND test simulators delegate to crate helpers (SEV-026, SEV-034 hardening)              |
| Test count                                  | **280+ tests** across 22 spec files                                                                   | `tests/` · `pnpm test:parity` / `pnpm test:events` / `pnpm test:economic-parity-l1` / `pnpm test:app-encoders` |
| Security-specific tests                     | **60+ tests** across 6 bankrun spec files + ~36 audit-regression unit/proptest                        | `tests/security_*.spec.ts` + `tests/reputation_*.spec.ts` + `crates/math/src/**/tests`                         |
| App-encoder structural tests                | **58 tests** (discriminator + account + PDA parity)                                                   | `tests/app_encoders.spec.ts` · 6 IDL-free encoders covered (#283, #287, #291)                                  |
| App-encoder bankrun round-trips             | **7 tests** (4 happy-path + 3 negative-path)                                                          | `tests/app_encoders_bankrun.spec.ts` · #290 W1+W2 + #283 W3                                                    |
| Math fuzz coverage                          | **6 cargo-fuzz targets** on `roundfi-math`                                                            | `crates/math/fuzz/` · 60s PR smoke + 30min weekly long-run (#284)                                              |
| Math test coverage (tarpaulin)              | **>90%** on `roundfi-math`                                                                            | `pnpm coverage` · CI advisory lane (#269)                                                                      |
| Typed protocol errors                       | **40+ named errors** with negative-path tests for each                                                | `programs/roundfi-core/src/error.rs` + `programs/roundfi-reputation/src/error.rs`                              |
| Triple Shield guards captured firing        | **4/4 on real funds** on devnet                                                                       | `docs/devnet-deployment.md`                                                                                    |
| Self-audit + threat model                   | 228 lines, file:line refs                                                                             | [`docs/security/self-audit.md`](./self-audit.md)                                                               |
| CI required gates                           | **4 green pipelines** per PR                                                                          | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)                                                   |
| Open source                                 | Apache-2.0                                                                                            | [`LICENSE`](../../LICENSE)                                                                                     |
| Dependency surveillance                     | Dependabot (cargo + npm + actions)                                                                    | [`.github/dependabot.yml`](../../.github/dependabot.yml)                                                       |
| Reproducible build                          | OtterSec verify-build PDA on-chain                                                                    | [`docs/verified-build.md`](../verified-build.md)                                                               |
| Disclosure channel                          | `roundfinance.sol@gmail.com`                                                                          | [`SECURITY.md`](../../SECURITY.md)                                                                             |

## Internal pre-audit — what we surfaced ourselves

> **Framing:** this is the team's own 5-pass red-team exercise + 1 integration-testing wave modeled on Adevar Labs' methodology, run _before_ commissioning Adevar's formal engagement (scoping in progress). The paid audit's clock should go to harder questions, not findings a competent in-house red-team can surface. **Not an Adevar attestation** — full framing in [`internal-audit-findings.md`](./internal-audit-findings.md).

**Severity distribution (40 findings):**

| Severity      | Total  | 🟢 Closed | 🟠 Blocked | 🔵 Design-intentional |
| ------------- | ------ | --------- | ---------- | --------------------- |
| Critical      | 3      | 3         | 0          | 0                     |
| High          | 7      | 7         | 0          | 0                     |
| Medium        | 9      | 8         | 1          | 0                     |
| Low           | 12     | 12        | 0          | 0                     |
| Informational | 9      | 6         | 0          | 3                     |
| **Total**     | **40** | **36**    | **1**      | **3**                 |

**Highlights worth the auditor's attention:**

- **SEV-001 (Critical):** unvalidated `c_token_account` in `roundfi-yield-kamino::Deposit` could redirect Kamino c-tokens to an attacker ATA. Closed by [#326](https://github.com/alrimarleskovar/RoundFinancial/pull/326) with `associated_token::mint + authority` constraint. Re-validation path documented in [`docs/operations/kamino-devnet-exercise.md`](../operations/kamino-devnet-exercise.md).
- **SEV-002 (Critical) + SEV-023 (Medium):** two instances of "devnet shortcut leaked to production" pattern (`GRACE_PERIOD_SECS = 60`, `MIN_CYCLE_DURATION = 60`). Both reverted; **pattern audit ([#340](https://github.com/alrimarleskovar/RoundFinancial/pull/340)) swept every other constant; floor-guard CI lane added ([#343](https://github.com/alrimarleskovar/RoundFinancial/pull/343))** so any future regression of this shape fails loudly even if the pinning test is updated to the wrong value.
- **SEV-021 / SEV-022 (High):** reputation authority rotation gained a 7-day timelock; core/reputation pause flags decoupled so reputation pause no longer drags core CPI flows through the back door.
- **SEV-029 → SEV-034 chain (High, fund-leak, regression-of-regression):** the SEV-016 partial-pay fix (#334) introduced an overpay in `release_escrow` (SEV-029, #342). The SEV-029 fix itself was wrong — derivation `stake - escrow_balance` ignored that `contribute()` mutates `escrow_balance`. **Caught by W4 pre-audit; closed by [#349](https://github.com/alrimarleskovar/RoundFinancial/pull/349) with correct derivation, [#350](https://github.com/alrimarleskovar/RoundFinancial/pull/350) ships bankrun integration test, [#351](https://github.com/alrimarleskovar/RoundFinancial/pull/351) extracts the derivation to the math crate as single source of truth.** Methodological insight from this chain: pure-math simulators prove function properties, not on-chain behavior — Critical / High fixes now require integration-level tests.
- **SEV-026 (Low):** `settle_default` cascade math refactored to delegate to `roundfi_math::seize_for_default` — same single-source-of-truth pattern. The SEV-034 chain re-validated why this matters.

**Remaining surface:** SEV-012 (bankrun-in-CI coverage gap) is **upstream-blocked** on mpl-core 0.8 → Anchor 0.31 borsh compat ([mpl-core#282](https://github.com/metaplex-foundation/mpl-core/issues/282)) — tests run locally, just not in CI. SEV-018 (`settle_default` deliberately bypasses pause) and SEV-032 (`ReputationConfig` padding exhausted by SEV-021 additions) are documented **design constraints**, not vulnerabilities.

**Why this is signal, not noise:** every Critical / High fix ships with a **negative regression test before merge**. The two-layer constants defense (pinning + floor-guard) + the single-source-of-truth math crate pattern (SEV-026, SEV-034) close the structural classes the chain exposed.

## What's the protocol doing with funds

Four USDC vault PDAs per pool. **No instruction can drain a pool to an authority** — fund movement is gated by signed user actions (`contribute`, `claim_payout`, `release_escrow`, `escape_valve_buy`) or permissionless cranks with hard math invariants (`settle_default`, `harvest_yield`).

| Vault                   | Funded by                                               | Drained by                                                      | Invariant                                                                                                                      |
| ----------------------- | ------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `escrow_usdc_vault`     | Stakes at `join_pool` (50/30/10% of credit per Lv1/2/3) | `release_escrow` (vesting tranches) · `settle_default` Shield 3 | Cannot drop below committed stake until vesting tranche unlocks                                                                |
| `pool_usdc_vault`       | Installments at `contribute` (74% of each payment)      | `claim_payout` to slot winner                                   | Subject to Seed Draw + Solvency Guard invariants — see [Self-Audit §3.1](./self-audit.md#31-economic-invariants-triple-shield) |
| `solidarity_usdc_vault` | 1% of every contribution                                | `settle_default` Shield 2 (first line)                          | Strictly increasing until a default consumes it                                                                                |
| `yield_usdc_vault`      | Idle pool float routed via `deposit_idle_to_yield`      | Harvested via `harvest_yield` waterfall                         | Waterfall is conservation-of-funds tested                                                                                      |

## Why we say "auditable in 2 weeks"

**Invariants are pre-documented, not discovered during audit.** The self-audit doc enumerates each protocol guarantee, maps it to the source line that enforces it, and points to the test that proves it. **The internal pre-audit (W1-W4) re-validated every guarantee against a critical/high adversarial lens before any external dollar is spent.** Audit hours go to **adversarial creativity**, not "what does this code do" or "what does the team already know is wrong."

Specifically, the Triple Shield is the highest-stakes surface:

- **Shield 1 — Seed Draw Invariant** · `claim_payout.rs` · captured firing on Pool 3 default cycle. SEV-031 added a runtime viability guard at `create_pool` so custom pools that would fail this guard are rejected pre-state-allocation.
- **Shield 2 — Guarantee Fund Solvency Guard** · `claim_payout.rs` · captured firing with `WaterfallUnderflow ×2`. SEV-003 fix tightened the LP-share policy (was caller-controlled, now read from `ProtocolConfig.lp_share_bps`).
- **Shield 3 — Adaptive Escrow Seizure** · `settle_default.rs` (now delegating to `roundfi_math::seize_for_default` per SEV-026) · captured on Pool 3 ($0.20 solidarity vault drained, escrow + stake left intact at shield 1 because D/C invariant held).

The 40+ typed errors cover: PDA seeds binding, mint constraints, ATA ownership (SEV-001 hardening), CPI program-id checks, cycle ordering, listing/buyer mismatches, attestation schema validation, treasury timelock, authority rotation timelock (SEV-021), fee*bps_yield timelock (SEV-024 follow-up), pool viability (SEV-031), pause gating (selective per SEV-022). \*\*Each one has a negative-path test in `tests/security*\*.spec.ts`OR`crates/math/src/**/tests`.**

## Real production bug already surfaced internally

**`mpl-core TransferV1` resets owner-managed plugin authorities.** Discovered during devnet exercise of `escape_valve_buy` — bankrun didn't catch it (mpl-core mock != live program). Fix shipped in the same PR: re-approve `FreezeDelegate` + `TransferDelegate` to the position PDA post-transfer. See [Self-Audit §6.1](./self-audit.md#61-mpl-core-transferv1-plugin-authority-reset).

This is the kind of issue that proves the codebase has been _exercised_, not just compiled. Live devnet under load surfaces real bugs that mocks miss — same lesson the SEV-034 chain re-taught at the test-methodology layer.

## Pitch vs shipped — honest framing for the audit firm

External reviewers comparing pitch material against the codebase will see a few framing nuances. Calling them out proactively so audit hours aren't spent on resolving claims that already have honest answers:

| Claim in pitch / README                                                | What's actually shipped                                                                                                                                                                                                                                                                                                                                                                                                                                          | How to read it                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Score is SAS-compatible from the first attestation"                   | `roundfi-reputation` mints SAS-compatible attestations on every `contribute` (real, on-chain, devnet-verified). User-facing `/reputacao` surface mixes on-chain reads with session-reducer reflection in Demo Studio mode.                                                                                                                                                                                                                                       | **On-chain infrastructure: shipped.** B2B subscription consumers + indexer-backed reads on the live `/reputacao` page: roadmap (Phase 3, post-mainnet).                                           |
| "Yield Waterfall (Kamino, 5–8% APY)"                                   | `roundfi-yield-kamino` adapter ships real Kamino Lend CPIs for **both** the deposit path (`deposit_reserve_liquidity`) and the harvest path (`redeem_reserve_collateral`, redeem-all + redeposit-principal round-trip). Closed [#233](https://github.com/alrimarleskovar/RoundFinancial/issues/233). Devnet runs the mock adapter (`roundfi-yield-mock`) for deterministic test cycles; mainnet flips to the kamino adapter via `config.approved_yield_adapter`. | **Deposit + harvest paths: shipped, in scope.** Adapter pubkey on `Pool.yield_adapter` is the swap mechanism — no core redeploy needed to flip from mock to kamino in production.                 |
| "All four primitives exist on Solana for the first time" (pitch video) | Solana, SAS, Kamino, Switchboard are all available in the Solana ecosystem. RoundFi integrates with SAS (real attestations) + Kamino (real deposit CPI). Switchboard is roadmap (random seed-draw on a future Pool variant).                                                                                                                                                                                                                                     | **Ecosystem availability: yes for all four. RoundFi-integrated: 2 of 4 today.** Pitch framing is "ecosystem readiness enables this protocol," not "RoundFi integrates all four end-to-end today." |
| "Users build reputation. Protocols pay to read it." (pitch slide 11)   | Phase 1 (data acquisition via ROSCAs): shipped. Phase 3 (B2B oracle subscriptions): roadmap. Both 3-min decks already title this section as "B2B Endgame" to convey future-state.                                                                                                                                                                                                                                                                                | **Long-term revenue model, explicitly Phase 3.** No B2B revenue yet; ROSCA float + protocol fees on harvest are the only Phase-1 economics.                                                       |

These nuances do not affect the on-chain protocol's correctness — they're product-narrative caveats. The auditor should focus hours on the in-scope code surface (next sections), not on resolving these framing-vs-shipped gaps.

## What's out of scope for the audit (don't waste budget)

Explicitly deferred to mainnet migration, listed here so audit hours don't go to known-deferred items:

- Formal verification of the D/C invariant (Coq/Lean) — currently proven in-test only, including a ~13,500-input exhaustive sweep in `crates/math/src/cascade.rs::exhaustive_post_seizure_invariant_always_holds`
- Indexer reconciler under hostile RPC reorg (off-chain only, not fund-movement path; threat model at [`indexer-threat-model.md`](./indexer-threat-model.md))
- MEV review (already documented in [`mev-front-running.md`](./mev-front-running.md) — 9 user-facing ix analysed; mitigation cross-referenced with negative-path tests)
- Front-end attack surface (wallet adapter, RPC trust, phishing-resistant flows; see [`frontend-security-checklist.md`](./frontend-security-checklist.md))
- Phase 3 B2B oracle subscriptions — not yet shipped, no contract surface

**Items pre-audit already closed (auditor should skim, not deep-dive):**

- Constants devnet-shortcut family (SEV-002 / SEV-023) — closed + floor-guard CI lane added ([#343](https://github.com/alrimarleskovar/RoundFinancial/pull/343))
- Treasury rotation (SEV-006) — 7-day timelock, ATA validation, lockable
- Reputation authority rotation (SEV-021) — same shape, 7-day timelock
- fee_bps_yield direct mutation (SEV-024 + follow-up) — capped at 30%, 1-day timelock pilot
- Pool viability runtime guard (SEV-031) — handled by `roundfi_math::seed_draw::pool_is_viable`
- release_escrow cumulative-paid derivation (SEV-029 → SEV-034) — single source of truth in `roundfi_math::escrow_vesting::compute_release_delta_target`, used by handler AND simulator AND bankrun integration test
- settle_default cascade math (SEV-026) — delegated to `roundfi_math::seize_for_default`, no inline duplicate

See [`internal-audit-findings.md`](./internal-audit-findings.md) for the per-finding status. **The auditor's W4 evaluation explicitly cleared all fund-loss-shaped findings as 🟢 closed.**

## High-leverage areas to spend audit hours on

Sorted by where adversarial creativity gets the most value given the pre-audit closed surface:

1. **Cross-program CPI surface** — `roundfi-core ↔ roundfi-reputation ↔ roundfi-yield-{mock,kamino}`. Pool PDA signing semantics, identity attestation freshness reads, mpl-core asset state mutations under settle_default. The pre-audit covered the obvious paths; adversarial timing / interleaving across the three programs is the highest-leverage exploration.
2. **Yield waterfall math under extreme inputs** — `harvest_yield` distributes realized yield across protocol fee → GF top-up → LPs → participants. Closed-form expectations live in `tests/economic_parity.spec.ts` + 6 cargo-fuzz targets. Audit any rounding/precision drift under near-overflow inputs; verify the fuzz corpus reaches the edges.
3. **`escape_valve_buy` atomic re-anchor** — post-mpl-core bug fix, but the re-approval timing is delicate. Any path where the position NFT moves but plugins don't re-anchor is a freeze-evasion risk. The bankrun spec covers happy + 3 negative cases (#290); audit for the 4th — partial-failure reorder.
4. **PDA derivation surface** — 8 seed schemas (`config`, `pool`, `member`, `escrow`, `solidarity`, `yield`, `position`, `listing`). The Rust ↔ TS parity tests prove the encoder matches but don't prove the seed schema itself resists collision under future schema additions.
5. **Timelock composition** — treasury (7d), authority (7d), reputation authority (7d), fee_bps_yield (1d) all use the propose/cancel/commit pattern. What if multiple are pending simultaneously? `lock_treasury` / `lock_approved_yield_adapter` are one-way kill switches mid-window — verify no path where a half-committed proposal leaks authority.
6. **Off-chain trust boundaries** — Human Passport bridge ([`passport-bridge-threat-model.md`](./passport-bridge-threat-model.md)) and indexer webhook auth (SEV-033 fail-closed in prod). These are NOT on the fund-movement trust path but are the next-most-likely-exploited surfaces if mainnet attracts attention.

## Engagement format

The internal pre-audit (W1..W5 + 1 integration-testing wave, 40 findings, 36 closed) ran _before_ commissioning the formal Adevar engagement. Recommended formal scope:

**1-2 week re-validation engagement** against `main` HEAD, focused on:

- Adversarial validation of the closed surface (auditor should attempt to re-open at least 3 random Critical / High SEVs from the public tracker)
- Deep-dive on the 5 high-leverage areas above
- Final attestation against `programs/roundfi-core` + `programs/roundfi-reputation` + `programs/roundfi-yield-kamino`

Out: `services/indexer/`, `app/`, `packages/sdk/` — those don't custody funds.

**Deliverables on our side, ready before kickoff:**

- Internal pre-audit tracker — [`internal-audit-findings.md`](./internal-audit-findings.md) (40 SEVs, 36 closed, 1 upstream-blocked, 3 design-intentional)
- Self-audit doc (this folder) + threat models (adversarial, MEV, indexer, passport bridge)
- Constants audit methodology — [`constants-audit-2026-05.md`](./constants-audit-2026-05.md)
- Test suite passing — CI green on `main` (anchor build / js lint+parity / cargo audit / cargo deny); bankrun lane runs locally pending SEV-012 upstream unblock
- Reproducible build attestation (OtterSec PDA on devnet — see [`docs/verified-build.md`](../verified-build.md))
- Single point of contact: `roundfinance.sol@gmail.com`

Welcome.
