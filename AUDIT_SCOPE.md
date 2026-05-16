# RoundFi — Audit Scope

> **Statement of Work for external security review.** Companion to:
>
> - [`SECURITY.md`](./SECURITY.md) — disclosure channel + SLAs
> - [`docs/security/self-audit.md`](./docs/security/self-audit.md) — full 228-line self-audit + threat model
> - [`docs/security/internal-audit-findings.md`](./docs/security/internal-audit-findings.md) — **internal pre-audit tracker (40 findings, 36 closed; Critical/High 10/10)** — read this first to see what the team's own red-team already surfaced
> - [`docs/security/audit-readiness.md`](./docs/security/audit-readiness.md) — strategic one-pager (TL;DR, fund-flow, ranked focus areas)
> - [`MAINNET_READINESS.md`](./MAINNET_READINESS.md) — single-source checklist for the path from M3 (devnet) → mainnet GA
> - [`docs/verified-build.md`](./docs/verified-build.md) — reproducible-build flow and on-chain attestation
>
> **Pre-audit state (May 2026):** the team ran an internal 5-pass
> red-team exercise + 1 integration-testing wave, modeled on Adevar
> Labs' methodology, _before_ commissioning the formal engagement —
> 40 findings catalogued, 36 closed (Critical/High 10/10 including
> SEV-034b surfaced by the integration-testing wave), 1 upstream-blocked
> (SEV-012 bankrun-in-CI), 3 acknowledged design constraints. **This
> is NOT an Adevar attestation** — the SEV-### identifiers come from
> the team's own pre-audit cycle simulating Adevar's methodology; the
> formal Adevar engagement is in scoping. The taxonomy was deliberately
> mirrored so the eventual paid auditor can re-validate quickly against
> a clean baseline.

---

## In scope — 3 Anchor programs · ~8,655 lines of Rust

| Program                         | LoC (`*.rs`)  | Surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `programs/roundfi-core`         | **6,157**     | Pool lifecycle (create / join / contribute / claim_payout / settle_default / close), escrow + solidarity + yield vault PDAs, escape valve secondary market (list/buy), treasury timelock + lock, harvest waterfall, Triple Shield invariants                                                                                                                                                                                                                                                                  |
| `programs/roundfi-reputation`   | **1,744**     | SAS-compatible attestations, level promotion (1→2→3), CPI surface from roundfi-core, identity scaffold (Civic gateway-token validator — provider TBD post-mainnet, see [§4.4 of architecture.md](./docs/architecture.md#44-identity-layer-added-v02--2026-04-22--provider-transition-v04--2026-05))                                                                                                                                                                                                           |
| `programs/roundfi-yield-kamino` | **754**       | Real Kamino Lend CPI — `deposit_reserve_liquidity` (deposit path) + `redeem_reserve_collateral` (harvest path, **redeem-all + redeposit-principal** round-trip; see module comment) — production target                                                                                                                                                                                                                                                                                                       |
| **Total in scope**              | **8,655 LoC** | 40+ typed errors, **280+ tests** (53 security-specific bankrun + 58 app-encoder structural + 7 bankrun round-trips + 10 canary-control negative + 36 audit-regression unit/proptest + 109 lifecycle/edge/parity) + **6 cargo-fuzz targets** on `roundfi-math` (~503M inputs, 0 crashes over a 5min/target sweep + a 30s/target post-fix smoke), Triple Shield economic invariants + `bankrun_compat` shim (ADR 0007) enabling cooldown-bound + time-warp specs to run in seconds rather than 7-day real waits |

---

## Out of scope

| Component                               | Reason                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `programs/roundfi-yield-mock` (348 LoC) | Devnet-only test adapter; never deployed to mainnet                                                                                                           |
| `app/` (Next.js frontend)               | Wallet adapter trust, RPC connection, UI flows — different threat model (UI/UX security review, not on-chain)                                                 |
| `services/indexer/`                     | Off-chain Helius webhook + Postgres backfiller; never on the fund-movement trust path                                                                         |
| `packages/sdk/`                         | TypeScript encoders / decoders; correctness already gated by Rust↔TS parity tests (see [`tests/parity.spec.ts`](./tests/parity.spec.ts), 7 tests, runs in CI) |
| `tests/`                                | Test code itself (the assertions are the audit artifact, not auditable code)                                                                                  |

Documented out-of-scope items (do **not** spend audit hours here, tracked for follow-up):

- **Formal verification of D/C invariant** — currently proven in-test only ([`tests/economic_parity.spec.ts`](./tests/economic_parity.spec.ts) + [`tests/security_economic.spec.ts`](./tests/security_economic.spec.ts)); Coq/Lean proof is post-audit
- **Indexer reconciler under hostile RPC reorg** — off-chain consistency only, not fund-movement; threat model at [`docs/security/indexer-threat-model.md`](./docs/security/indexer-threat-model.md), reconciler implementation tracked in [#234](https://github.com/alrimarleskovar/RoundFinancial/issues/234)
- **Front-end attack surface** — phishing-resistant wallet flows; separate UX-security pass; checklist at [`docs/security/frontend-security-checklist.md`](./docs/security/frontend-security-checklist.md)

Items moved from out-of-scope to **addressed** (pre-engagement deliverables):

- **MEV / front-running review** — done. Pre-audit MEV analysis covering all 6 ordering-sensitive instructions (`claim_payout`, `escape_valve_buy`, `settle_default`, `harvest_yield`, `deposit_idle_to_yield`, `join_pool`) at [`docs/security/mev-front-running.md`](./docs/security/mev-front-running.md). Big-picture finding: Triple Shield constrains extraction to bounded griefing on all instructions except `escape_valve_buy` listing-race (recommended pre-mainnet mitigation: commit-reveal listings + Jito bundles for cancel/relist). Closes [#232](https://github.com/alrimarleskovar/RoundFinancial/issues/232).
- **`harvest()` path in `roundfi-yield-kamino`** — promoted in-scope. Real Kamino `redeem_reserve_collateral` CPI implemented as a **redeem-all + redeposit-principal** round-trip in [`programs/roundfi-yield-kamino/src/lib.rs`](./programs/roundfi-yield-kamino/src/lib.rs). Slippage guard (`min_realized_usdc`) and adapter-balance-delta over-withdraw guard from PR #124 apply unchanged (they live in `roundfi-core::harvest_yield` and are adapter-agnostic). Pinned `PrincipalLoss` error guards against an exchange-rate regression. Closes [#233](https://github.com/alrimarleskovar/RoundFinancial/issues/233).

See [`docs/security/self-audit.md` §7](./docs/security/self-audit.md#7-out-of-scope-future-work) for the full out-of-scope register.

---

## Prior internal hardening — 6 findings closed in early internal review

Six audit findings were surfaced and fixed during the team's early internal review **before** the multi-pass pre-audit cycle (W1-W5 + integration-testing wave) that produced the SEV-### tracker. Each PR below carries: source-line reference, threat model, error variant, test coverage. Linked so the eventual external Adevar engagement doesn't re-flag what's already closed.

**Honest framing:** the team's early internal review **did not catch** the Critical `c_token_account` ATA constraint miss on `roundfi-yield-kamino::Deposit` (closed in W1 of the internal pre-audit as SEV-001 — same constraint that was already in place on `Harvest::c_token_account`, copy-paste-miss). The W1 pass of the internal pre-audit caught it. The full remediation track across all 5 internal passes + 1 integration-testing wave is documented in [`docs/security/internal-audit-findings.md`](./docs/security/internal-audit-findings.md) — 40 findings total, 36 closed (3 Critical + 7 High + 9 Medium + 12 Low + 9 Informational), 1 upstream-blocked, 3 design-intentional. [`ADEVAR_AUDIT_REPORT.md`](./ADEVAR_AUDIT_REPORT.md) preserves the original W1 transcript in Adevar's issue-template format — the **filename uses "ADEVAR" because the templates mirror Adevar's published format, NOT because Adevar wrote it**. Adevar engagement is in scoping; the formal audit's surface area starts from main HEAD post-remediation, not from the original W1 baseline.

| #   | PR                                                                     | Title                                                                                  | Surface                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [**#122**](https://github.com/alrimarleskovar/RoundFinancial/pull/122) | `fix(roundfi-core): treasury rotation hardening — timelock + one-way lock (Option C)`  | Treasury redirect via mutable `config.treasury`. 7-day timelock + permissionless `commit_new_treasury` + one-way `lock_treasury` kill switch                                                          |
| 2   | [**#123**](https://github.com/alrimarleskovar/RoundFinancial/pull/123) | `fix(roundfi-core): post-CPI invariant verification on escape_valve_buy`               | mpl-core `TransferV1` returning Ok without state mutation. Post-CPI assertion of `asset.owner == buyer` + `FreezeDelegate.frozen == true` (new errors: `AssetTransferIncomplete`, `AssetNotRefrozen`) |
| 3   | [**#124**](https://github.com/alrimarleskovar/RoundFinancial/pull/124) | `fix(roundfi-core): slippage guard on harvest_yield against under-reporting adapter`   | Adapter returns dust instead of expected yield. Caller-provided `min_realized_usdc` slippage threshold (new error: `HarvestSlippageExceeded`)                                                         |
| 4   | [**#125**](https://github.com/alrimarleskovar/RoundFinancial/pull/125) | `fix(roundfi-core): batched defensive audit hardening (4 findings)`                    | `metadata_uri` scheme allow-list, `guarantee_fund_room` overrun warning, `harvest_yield` doc clarity, reinit-defense on `escape_valve_buy` (new error: `MetadataUriInvalidScheme`)                    |
| 5   | [**#127**](https://github.com/alrimarleskovar/RoundFinancial/pull/127) | `feat(roundfi-core): audit close-out — trusted reputation_level from on-chain profile` | Client-trusted `args.reputation_level` could bypass stake-tier rules. Derive trusted level from `ReputationProfile` PDA on-chain (new error: `ReputationLevelMismatch`)                               |
| 6   | [**#155**](https://github.com/alrimarleskovar/RoundFinancial/pull/155) | `test(security): cover audit error paths from #122-#127`                               | `tests/security_audit_paths.spec.ts` — one minimal failing-path test per new error code from the prior 5 fixes (4 implementable, 2 documented-skipped requiring malicious mpl-core mock)              |

The full per-PR threat-model table + post-patch trade-offs is in each PR description; click through to read.

---

## Verification — reproducible build attestation

All 4 deployed devnet programs carry an **on-chain verify-build attestation PDA** signed by the deployer, binding the deployed bytecode hash to a specific commit of this repo. 30-second CLI check that anyone can run independently:

```bash
# Install solana-verify (one-time)
cargo install solana-verify --locked

# Audit any of the 4 programs (example: roundfi-core)
solana-verify -u https://api.devnet.solana.com get-program-pda \
  --program-id 8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw \
  --signer 64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm
```

Returns `git_url` + `commit` + `executable_hash`. Cross-check via the bytecode three-way match:

```bash
solana-verify -u devnet get-program-hash <program-id>          # deployed bytecode
solana-verify get-executable-hash target/deploy/<prog>.so      # local rebuild
```

All three hashes match across all 4 programs. See [`docs/verified-build.md`](./docs/verified-build.md) for the full reproducible-build flow including Docker image, Cargo.lock pinning, and redeploy procedure.

| Program                | Program ID                                     | Attestation PDA (devnet)                                                                                                                 |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `roundfi-core`         | `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw` | [`HmfD81yvAmGV9cP2GF3PbdfocwHi9CcCvkYv2PveqE5K`](https://solscan.io/account/HmfD81yvAmGV9cP2GF3PbdfocwHi9CcCvkYv2PveqE5K?cluster=devnet) |
| `roundfi-reputation`   | `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2` | Resolve via `get-program-pda`                                                                                                            |
| `roundfi-yield-kamino` | `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb` | Resolve via `get-program-pda`                                                                                                            |
| `roundfi-yield-mock`   | `GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ` | Resolve via `get-program-pda`                                                                                                            |

> Note: The green "Verified Build" tile on Solscan is gated on OtterSec's remote build queue, which is mainnet-only by design. On-chain attestation here gives the same hash-binding guarantee, CLI-checked instead of UI-rendered.

---

## Mainnet timeline

Current date: **May 2026**. Hackathon submission complete (Colosseum 2026). Internal pre-audit complete (5 passes + integration-testing wave, 36/40 findings closed including 10/10 Critical/High). Adevar Labs formal engagement in scoping (cost/timeline negotiation).

| Phase                                                    | Window     | Status                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal self-audit + threat model                       | Q1–Q2 2026 | ✅ Done — [`docs/security/self-audit.md`](./docs/security/self-audit.md) (228 lines)                                                                                                                                                      |
| Internal pre-audit (5 passes + integration-testing wave) | May 2026   | ✅ Done — 40 findings catalogued, 36 closed (10/10 Critical/High). [`docs/security/internal-audit-findings.md`](./docs/security/internal-audit-findings.md)                                                                               |
| Squads multisig rotation rehearsal (devnet)              | May 2026   | ✅ Done 2026-05-16 — 4 phases validated on-chain (propose/cancel/re-propose/commit). [`docs/operations/rehearsal-logs/2026-05-16-squads-rotation-rehearsal.md`](./docs/operations/rehearsal-logs/2026-05-16-squads-rotation-rehearsal.md) |
| Pause-state rehearsal (devnet)                           | May 2026   | ✅ Done 2026-05-12 — [`docs/operations/rehearsal-logs/2026-05-12-pause-rehearsal.md`](./docs/operations/rehearsal-logs/2026-05-12-pause-rehearsal.md)                                                                                     |
| External audit (Adevar Labs — formal)                    | Q2–Q3 2026 | 🟡 Scoping in progress (cost/timeline negotiation)                                                                                                                                                                                        |
| Legal counsel review                                     | Q3 2026    | 🔵 Planned                                                                                                                                                                                                                                |
| Mainnet smoke (canary pool, capped TVL)                  | Q3–Q4 2026 | 🔵 Planned — see [`docs/operations/mainnet-canary-plan.md`](./docs/operations/mainnet-canary-plan.md)                                                                                                                                     |
| Mainnet GA + bug-bounty program (Immunefi, $50k initial) | Q4 2026    | 🔵 Planned                                                                                                                                                                                                                                |

The bug-bounty program is **planned for mainnet launch**, not now. Full policy drafted at [`docs/security/bug-bounty.md`](./docs/security/bug-bounty.md) — USD 50k initial pool, 5-tier severity, USDC-on-Solana payouts, 90-day coordinated disclosure. See [`SECURITY.md`](./SECURITY.md) for interim devnet/smoke-phase rewards.

---

## Engagement format requested

- **Duration:** 2-week scoped engagement (8,655 LoC is comfortably auditable in 2 weeks given the pre-documented invariants + 5-pass internal pre-audit that closed 36/40 findings)
- **Channels:** Single point of contact `roundfinance.sol@gmail.com` · private GitHub repo access available on request · responsible-disclosure SLAs in [`SECURITY.md`](./SECURITY.md)
- **Deliverables we ship pre-kickoff:** self-audit doc + threat model + reproducible-build attestation + CI green on `main` + this scope doc + [operations runbooks](./docs/operations/) (deploy, key-rotation, emergency-response, incident postmortem template)
- **Deliverables we need from auditor:** standard severity-classified findings report + remediation review pass after fixes land
- **Findings disclosure:** coordinated 90-day standard, or sooner if mutually agreed

---

## High-leverage focus areas

The [`docs/security/audit-readiness.md`](./docs/security/audit-readiness.md#high-leverage-areas-to-spend-audit-hours-on) document ranks 5 adversarial-creativity targets. Summary:

1. **`settle_default` invariant chain** — Shield ordering, GF/escrow/solidarity drain sequence, cranker race with late `contribute`
2. **Yield waterfall math** — rounding / precision drift under extreme inputs
3. **`escape_valve_buy` atomic re-anchor** — post-mpl-core bug fix; freeze-evasion risk if re-approval timing slips
4. **PDA derivation surface** — 8 seed schemas, collision resistance under future additions
5. **Treasury timelock + pause** — half-committed proposal under `lock_treasury` mid-window

---

_Last updated: May 2026._
