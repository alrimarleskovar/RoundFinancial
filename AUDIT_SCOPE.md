# RoundFi — Audit Scope

> **Statement of Work for external security review.** Companion to:
>
> - [`SECURITY.md`](./SECURITY.md) — disclosure channel + SLAs
> - [`docs/security/self-audit.md`](./docs/security/self-audit.md) — full 228-line self-audit + threat model
> - [`docs/security/internal-audit-findings.md`](./docs/security/internal-audit-findings.md) — **internal pre-audit tracker (canonical count — see its [Summary table](./docs/security/internal-audit-findings.md#summary); 51 findings / 49 closed / 0 open / Critical/High 16 of 16 as of 2026-05-27)** — read this first to see what the team's own red-team already surfaced. Includes the 5-pass methodology + 9 follow-up waves through 2026-05-26 (Kamino-spike discovery / execution / Pass-8 constants / Pass-9 PDA seeds / Pass-10 canary-plan vs hardening / Pass-11 frontend mainnet / Pass-12 CD pipeline / Pass-13 canary-plan vs reality / Pass-14 indexer observability / Pass-15 emergency-response runbook / Pass-16 sibling-docs alignment), incl. PRs #405–#413.
> - [`docs/security/audit-readiness.md`](./docs/security/audit-readiness.md) — strategic one-pager (TL;DR, fund-flow, ranked focus areas)
> - [`docs/security/post-mortems/`](./docs/security/post-mortems/) — dedicated post-mortems for Critical-class SEVs (currently SEV-040; more retroactive entries planned)
> - [`MAINNET_READINESS.md`](./MAINNET_READINESS.md) — single-source checklist for the path from M3 (devnet) → mainnet GA
> - [`docs/verified-build.md`](./docs/verified-build.md) — reproducible-build flow and on-chain attestation
> - [`docs/operations/cd-pipeline.md`](./docs/operations/cd-pipeline.md) — SEV-046 CD pipeline architecture (`.github/workflows/{devnet,mainnet}-deploy.yml`), rehearsal protocol, Squads-approval-gated mainnet deploy
>
> **Pre-audit state (2026-05-26):** the team ran an internal 5-pass
> red-team exercise + 1 integration-testing wave + 9 follow-up waves
> (through 2026-05-26, incl. PRs #405–#413), modeled on an external
> auditor's methodology, _before_ commissioning
> the formal engagement — **51 findings catalogued, 49 closed,
> 0 open** (Critical/High **16 of 16** including SEV-034b
> surfaced by the integration-testing wave, SEV-040 / SEV-041 /
> SEV-042 surfaced by the Kamino-spike pre-audit, SEV-047 / SEV-048
> from the 2026-05-24 external-audit pass, and SEV-049 + SEV-050,
> the two High liveness locks from the litesvm L1↔L2 parity slice
> (SEV-049 = `skip_defaulted_payout`; SEV-050 = removed close_pool's
> unsatisfiable defaulted-pool guard) — live counts
> canonical in the
> [tracker Summary table](./docs/security/internal-audit-findings.md#summary)), SEV-012
> closed via a litesvm REQUIRED CI lane (mpl_core join_pool /
> escape_valve_buy path now runs in CI — `tests/_harness/litesvm.ts` +
> `tests/litesvm_join_pool.spec.ts`, Node-24-pinned to dodge a V8-GC
> `std::bad_alloc`; the #230 SDK-transitive `solana-program 1.18.x`
> dep bump since closed by the Agave 3.x / anchor 1.0 migration in #487), 3 acknowledged design
> constraints. **This is NOT an external auditor attestation** — the
> SEV-### identifiers come from the team's own pre-audit cycle
> simulating the published methodology shape; the formal engagement
> (Adevar / Halborn / OtterSec / Sec3 — selection pending) is in
> scoping. The taxonomy was deliberately mirrored so the eventual
> paid auditor can re-validate quickly against a clean baseline.

---

## In scope — 3 Anchor programs · ~8,655 lines of Rust

| Program                         | LoC (`*.rs`)  | Surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `programs/roundfi-core`         | **6,157**     | Pool lifecycle (create / join / contribute / claim_payout / settle_default / close), escrow + solidarity + yield vault PDAs, escape valve secondary market (list/buy), treasury timelock + lock, harvest waterfall, Triple Shield invariants                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `programs/roundfi-reputation`   | **1,744**     | SAS-compatible attestations, level promotion (1→2→3), CPI surface from roundfi-core, identity scaffold (Civic gateway-token validator — provider TBD post-mainnet, see [§4.4 of architecture.md](./docs/architecture.md#44-identity-layer-added-v02--2026-04-22--provider-transition-v04--2026-05))                                                                                                                                                                                                                                                                                                                                                                                                           |
| `programs/roundfi-yield-kamino` | **754**       | Real Kamino Lend CPI — `deposit_reserve_liquidity` (deposit path) + `redeem_reserve_collateral` (harvest path, **redeem-all + redeposit-principal** round-trip; see module comment) — production target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Total in scope**              | **8,655 LoC** | 40+ typed errors, **280+ tests** (53 security-specific bankrun + 58 app-encoder structural + 7 bankrun round-trips + 10 canary-control negative + 36 audit-regression unit/proptest + 109 lifecycle/edge/parity) + **6 cargo-fuzz targets** on `roundfi-math` (~9.85B inputs cumulative — 503M historical CI smoke + 600M afternoon re-validation 2026-05-24 + 8.75B overnight sweep 2026-05-24 (6 targets × 1h each), 0 crashes across entire history, coverage stable (saturation reached) in the input space covered by the current corpus), Triple Shield economic invariants + `bankrun_compat` shim (ADR 0007) enabling cooldown-bound + time-warp specs to run in seconds rather than 7-day real waits |

---

## Out of scope

| Component                               | Reason                                                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `programs/roundfi-yield-mock` (348 LoC) | Devnet-only test adapter; never deployed to mainnet                                                                                                            |
| `app/` (Next.js frontend)               | Wallet adapter trust, RPC connection, UI flows — different threat model (UI/UX security review, not on-chain)                                                  |
| `services/indexer/`                     | Off-chain Helius webhook + Postgres backfiller; never on the fund-movement trust path                                                                          |
| `packages/sdk/`                         | TypeScript encoders / decoders; correctness already gated by Rust↔TS parity tests (see [`tests/parity.spec.ts`](./tests/parity.spec.ts), 13 tests, runs in CI) |
| `tests/`                                | Test code itself (the assertions are the audit artifact, not auditable code)                                                                                   |

Documented out-of-scope items (do **not** spend audit hours here, tracked for follow-up):

- **Formal verification of D/C invariant** — currently proven in-test only ([`tests/economic_parity.spec.ts`](./tests/economic_parity.spec.ts) + [`tests/security_economic.spec.ts`](./tests/security_economic.spec.ts)); Coq/Lean proof is post-audit
- **Indexer reconciler under hostile RPC reorg** — off-chain consistency only, not fund-movement; threat model at [`docs/security/indexer-threat-model.md`](./docs/security/indexer-threat-model.md), reconciler implementation tracked in [#234](https://github.com/alrimarleskovar/RoundFinancial/issues/234)
- **Front-end attack surface** — phishing-resistant wallet flows; separate UX-security pass; checklist at [`docs/security/frontend-security-checklist.md`](./docs/security/frontend-security-checklist.md)

Items moved from out-of-scope to **addressed** (pre-engagement deliverables):

- **MEV / front-running review** — done. Pre-audit MEV analysis covering all 6 ordering-sensitive instructions (`claim_payout`, `escape_valve_buy`, `settle_default`, `harvest_yield`, `deposit_idle_to_yield`, `join_pool`) at [`docs/security/mev-front-running.md`](./docs/security/mev-front-running.md). Big-picture finding: Triple Shield constrains extraction to bounded griefing on all instructions except `escape_valve_buy` listing-race (recommended pre-mainnet mitigation: commit-reveal listings + Jito bundles for cancel/relist). Closes [#232](https://github.com/alrimarleskovar/RoundFinancial/issues/232).
- **`harvest()` path in `roundfi-yield-kamino`** — promoted in-scope. Real Kamino `redeem_reserve_collateral` CPI implemented as a **redeem-all + redeposit-principal** round-trip in [`programs/roundfi-yield-kamino/src/lib.rs`](./programs/roundfi-yield-kamino/src/lib.rs). Slippage guard (`min_realized_usdc`) and adapter-balance-delta over-withdraw guard from PR #124 apply unchanged (they live in `roundfi-core::harvest_yield` and are adapter-agnostic). Pinned `PrincipalLoss` error guards against an exchange-rate regression. SEV-041 fix landed canonical 12-account ordering (was 9-account jumbled) pinned by `kamino_redeem_metas_match_canonical_layout` + `kamino_deposit_metas_match_canonical_layout` cargo tests. **#233 part A closed** (on-chain CPI code shipped); **part B pending** (canonical mainnet Kamino USDC reserve pubkey pin in `scripts/mainnet/canary-flow.ts` PREFLIGHT_CHECKS + canary smoke-test against cloned mainnet reserve — operator decision, see [`docs/operations/mainnet-canary-plan.md §3.2`](./docs/operations/mainnet-canary-plan.md)).

See [`docs/security/self-audit.md` §7](./docs/security/self-audit.md#7-out-of-scope-future-work) for the full out-of-scope register.

---

## Prior internal hardening — 6 findings closed in early internal review

Six audit findings were surfaced and fixed during the team's early internal review **before** the multi-pass pre-audit cycle (W1-W5 + integration-testing wave) that produced the SEV-### tracker. Each PR below carries: source-line reference, threat model, error variant, test coverage. Linked so the eventual external Adevar engagement doesn't re-flag what's already closed.

**Honest framing:** the team's early internal review **did not catch** the Critical `c_token_account` ATA constraint miss on `roundfi-yield-kamino::Deposit` (closed in W1 of the internal pre-audit as SEV-001 — same constraint that was already in place on `Harvest::c_token_account`, copy-paste-miss). The W1 pass of the internal pre-audit caught it. The full remediation track across all 5 internal passes + 1 integration-testing wave + 9 follow-up waves through 2026-05-26 (incl. PRs #405–#413) is documented in [`docs/security/internal-audit-findings.md`](./docs/security/internal-audit-findings.md) — **51 findings total, 49 closed, 0 open** (6 Critical + 10 High + 14 Medium + 12 Low + 9 Informational; live counts canonical in the tracker's [Summary table](./docs/security/internal-audit-findings.md#summary)), SEV-012 closed via a litesvm REQUIRED CI lane (the #230 SDK-transitive `solana-program 1.18.x` bump since closed by the anchor-1.0 migration #487), SEV-039 closed via the `close_member` + `close_pool_vaults` rent-reclaim ceremony, 2 design-intentional. The 3 net-new Critical findings beyond the original 5-pass came from the Kamino-spike pre-audit (SEV-040 KAMINO_LEND_PROGRAM_ID typo, SEV-041 CPI account list 9→12, SEV-042 mainnet-hardening byte offsets — all fixed via PR [#383](https://github.com/alrimarleskovar/roundfinancial/pull/383)). [`ADEVAR_AUDIT_REPORT.md` @ commit `03f8030`](https://github.com/alrimarleskovar/RoundFinancial/blob/03f8030/ADEVAR_AUDIT_REPORT.md) preserves the original W1 transcript in the published issue-template format (file was retired from `main` once findings were absorbed into the live tracker; git history preserves the transcript at the linked commit) — the **filename uses "ADEVAR" because the templates mirror that firm's published format, NOT because they wrote it**. External-auditor engagement (Adevar / Halborn / OtterSec / Sec3 — selection pending) is in scoping; the formal audit's surface area starts from main HEAD post-remediation, not from the original W1 baseline.

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

Current date: **2026-05-26**. Hackathon submission complete (Colosseum 2026). Internal pre-audit complete (5 passes + integration-testing wave + 9 follow-up waves + 2026-05-24 external-audit pass, **48/51 findings closed; Critical/High 16 of 16 — 0 open** (SEV-050, the defaulted-pool `close_pool` liveness lock, closed by removing the unsatisfiable defaulted-pool guard); SEV-012 closed via a litesvm REQUIRED CI lane). Mainnet operational scaffolding shipped: SEV-046 CD pipeline (rehearsal 1g green 2026-05-19), Pass-14 indexer observability, Pass-15 Squads-aware emergency-response runbook. External-auditor formal engagement (Adevar / Halborn / OtterSec / Sec3 — selection pending) in scoping (cost/timeline negotiation).

| Phase                                                                                              | Window     | Status                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal self-audit + threat model                                                                 | Q1–Q2 2026 | ✅ Done — [`docs/security/self-audit.md`](./docs/security/self-audit.md) (228 lines)                                                                                                                                                                 |
| Internal pre-audit (5 passes + integration-testing wave + 9 follow-up waves + external-audit pass) | May 2026   | ✅ Done — 51 findings catalogued, 49 closed, 0 open; Critical/High 16 of 16; [canonical Summary table](./docs/security/internal-audit-findings.md#summary). [`docs/security/internal-audit-findings.md`](./docs/security/internal-audit-findings.md) |
| Squads multisig rotation rehearsal (devnet)                                                        | May 2026   | ✅ Done 2026-05-16 — 4 phases validated on-chain (propose/cancel/re-propose/commit). [`docs/operations/rehearsal-logs/2026-05-16-squads-rotation-rehearsal.md`](./docs/operations/rehearsal-logs/2026-05-16-squads-rotation-rehearsal.md)            |
| Pause-state rehearsal (devnet)                                                                     | May 2026   | ✅ Done 2026-05-12 — [`docs/operations/rehearsal-logs/2026-05-12-pause-rehearsal.md`](./docs/operations/rehearsal-logs/2026-05-12-pause-rehearsal.md)                                                                                                |
| External audit (Adevar / Halborn / OtterSec / Sec3 — formal, selection pending)                    | Q2–Q3 2026 | 🟡 Scoping in progress (cost/timeline negotiation)                                                                                                                                                                                                   |
| Legal counsel review                                                                               | Q3 2026    | 🔵 Planned                                                                                                                                                                                                                                           |
| Mainnet smoke (canary pool, capped TVL)                                                            | Q3–Q4 2026 | 🔵 Planned — see [`docs/operations/mainnet-canary-plan.md`](./docs/operations/mainnet-canary-plan.md)                                                                                                                                                |
| Mainnet GA + bug-bounty program (Immunefi, $50k initial)                                           | Q4 2026    | 🔵 Planned                                                                                                                                                                                                                                           |

The bug-bounty program is **planned for mainnet launch**, not now. Full policy drafted at [`docs/security/bug-bounty.md`](./docs/security/bug-bounty.md) — USD 50k initial pool, 5-tier severity, USDC-on-Solana payouts, 90-day coordinated disclosure. See [`SECURITY.md`](./SECURITY.md) for interim devnet/smoke-phase rewards.

---

## Engagement format requested

- **Duration:** 2-week scoped engagement (8,655 LoC is comfortably auditable in 2 weeks given the pre-documented invariants + 5-pass internal pre-audit + 9 follow-up waves + external-audit pass that closed 48/51 findings)
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

_Last updated: 2026-05-26 (toolchain note refreshed 2026-06-14 — the #230 `solana-program` bump landed via the #487 Agave 3.x / anchor 1.0 migration)._
