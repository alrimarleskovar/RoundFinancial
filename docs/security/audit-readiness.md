# Audit-Readiness — RoundFi

> **One-pager for security firms.** This is the "why we are audit-ready in 2 weeks, not 6" summary. Companion to the full [Self-Audit & Threat Model](./self-audit.md) (228 lines, asset inventory, invariants mapped to file:line, 53 security-specific tests catalogued).

---

## TL;DR

| Signal                               | Value                                                  | Where to verify                                                                     |
| ------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Test count                           | **162 tests** across 18 spec files                     | `tests/` · `pnpm test:parity` / `pnpm test:events` / `pnpm test:economic-parity-l1` |
| Security-specific tests              | **53 tests** across 5 spec files                       | `tests/security_*.spec.ts` + `reputation_*.spec.ts`                                 |
| Typed protocol errors                | **28+ named errors** with negative-path tests for each | `programs/roundfi-core/src/error.rs`                                                |
| Triple Shield guards captured firing | **4/4 on real funds** on devnet                        | `docs/devnet-deployment.md`                                                         |
| Self-audit + threat model            | 228 lines, file:line refs                              | [`docs/security/self-audit.md`](./self-audit.md)                                    |
| CI required gates                    | **4 green pipelines** per PR                           | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)                        |
| Open source                          | Apache-2.0                                             | [`LICENSE`](../../LICENSE)                                                          |
| Dependency surveillance              | Dependabot (cargo + npm + actions)                     | [`.github/dependabot.yml`](../../.github/dependabot.yml)                            |
| Reproducible build                   | OtterSec verify-build PDA on-chain                     | [`docs/verified-build.md`](../verified-build.md)                                    |
| Disclosure channel                   | `roundfinance.sol@gmail.com`                           | [`SECURITY.md`](../../SECURITY.md)                                                  |

## What's the protocol doing with funds

Four USDC vault PDAs per pool. **No instruction can drain a pool to an authority** — fund movement is gated by signed user actions (`contribute`, `claim_payout`, `release_escrow`, `escape_valve_buy`) or permissionless cranks with hard math invariants (`settle_default`, `harvest_yield`).

| Vault                   | Funded by                                               | Drained by                                                      | Invariant                                                                                                                      |
| ----------------------- | ------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `escrow_usdc_vault`     | Stakes at `join_pool` (50/30/10% of credit per Lv1/2/3) | `release_escrow` (vesting tranches) · `settle_default` Shield 3 | Cannot drop below committed stake until vesting tranche unlocks                                                                |
| `pool_usdc_vault`       | Installments at `contribute` (74% of each payment)      | `claim_payout` to slot winner                                   | Subject to Seed Draw + Solvency Guard invariants — see [Self-Audit §3.1](./self-audit.md#31-economic-invariants-triple-shield) |
| `solidarity_usdc_vault` | 1% of every contribution                                | `settle_default` Shield 2 (first line)                          | Strictly increasing until a default consumes it                                                                                |
| `yield_usdc_vault`      | Idle pool float routed via `deposit_idle_to_yield`      | Harvested via `harvest_yield` waterfall                         | Waterfall is conservation-of-funds tested                                                                                      |

## Why we say "auditable in 2 weeks"

**Invariants are pre-documented, not discovered during audit.** The self-audit doc enumerates each protocol guarantee, maps it to the source line that enforces it, and points to the test that proves it. Audit hours go to **adversarial creativity**, not "what does this code do."

Specifically, the Triple Shield is the highest-stakes surface:

- **Shield 1 — Seed Draw Invariant** · `claim_payout.rs:109-117` · captured firing on Pool 3 default cycle
- **Shield 2 — Guarantee Fund Solvency Guard** · `claim_payout.rs:123-131` · captured firing with `WaterfallUnderflow ×2`
- **Shield 3 — Adaptive Escrow Seizure** · `settle_default.rs` · captured on Pool 3 ($0.20 solidarity vault drained, escrow + stake left intact at shield 1 because D/C invariant held)

The remaining 28+ typed errors cover: PDA seeds binding, mint constraints, ATA ownership, CPI program-id checks, cycle ordering, listing/buyer mismatches, attestation schema validation, treasury timelock, pause gating. **Each one has a negative-path test in `tests/security_*.spec.ts`.**

## Real production bug already surfaced internally

**`mpl-core TransferV1` resets owner-managed plugin authorities.** Discovered during devnet exercise of `escape_valve_buy` — bankrun didn't catch it (mpl-core mock != live program). Fix shipped in the same PR: re-approve `FreezeDelegate` + `TransferDelegate` to the position PDA post-transfer. See [Self-Audit §6.1](./self-audit.md#61-mpl-core-transferv1-plugin-authority-reset).

This is the kind of issue that proves the codebase has been _exercised_, not just compiled. Live devnet under load surfaces real bugs that mocks miss.

## What's out of scope for the audit (don't waste budget)

Explicitly deferred to mainnet migration, listed here so audit hours don't go to known-deferred items:

- External third-party audit recommendation (this engagement is the start of that)
- Formal verification of the D/C invariant (Coq/Lean) — currently proven in-test only
- Indexer reconciler under hostile RPC reorg (off-chain only, not fund-movement path)
- MEV review (claim_payout, escape_valve_buy ordering analysis)
- Front-end attack surface (wallet adapter, RPC trust, phishing-resistant flows)

See [Self-Audit §7](./self-audit.md#7-out-of-scope-future-work) for the full list.

## High-leverage areas to spend audit hours on

Sorted by where adversarial creativity gets the most value:

1. **`settle_default` invariant chain** — Shield ordering, GF/escrow/solidarity drain sequence, can the cranker race a member's late `contribute`?
2. **Yield waterfall math** — `harvest_yield` distributes realized yield across protocol fee → GF top-up → LPs → participants. Closed-form expectations live in `tests/economic_parity.spec.ts`; audit any rounding/precision drift under extreme inputs.
3. **`escape_valve_buy` atomic re-anchor** — post-mpl-core bug fix, but the re-approval timing is delicate. Any path where the position NFT moves but plugins don't re-anchor is a freeze-evasion risk.
4. **PDA derivation surface** — 8 seed schemas (`config`, `pool`, `member`, `escrow`, `solidarity`, `yield`, `position`, `listing`). The Rust ↔ TS parity tests prove the encoder matches but don't prove the seed schema itself resists collision under future schema additions.
5. **Treasury timelock + pause** — `propose_new_treasury` → 7-day timelock → `commit_new_treasury` (anyone can crank). What if `lock_treasury` is called mid-window? Currently idempotent kill switch; verify no path where a half-committed proposal leaks authority.

## Engagement format

Recommended: **2-week scoped engagement** on `programs/roundfi-core` + `programs/roundfi-reputation` (the CPI surface). Out: `services/indexer/`, `app/`, `packages/sdk/` — those don't custody funds.

Deliverables on our side, ready before kickoff:

- Self-audit doc (this folder)
- Threat model (Section 1–2 of self-audit)
- Test suite passing (CI green on `main`)
- Reproducible build attestation (OtterSec PDA on devnet — see [`docs/verified-build.md`](../verified-build.md))
- Single point of contact: `roundfinance.sol@gmail.com`

Welcome.
