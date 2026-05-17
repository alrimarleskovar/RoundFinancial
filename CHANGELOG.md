# Changelog

All notable changes to RoundFi will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Unreleased changes that ship user-visible behavior add a line under `[Unreleased]` as part of the PR. Releases bump the version + date and move the `[Unreleased]` block down.

---

## [Unreleased]

### Added

- (None yet — next user-visible additions land here.)

---

## [0.5.0] — 2026-05-16 (Pre-audit completion + integration-testing wave + bankrun_compat)

Post-0.4.0 sprint focused on closing the multi-wave internal pre-audit cycle (W3 → W4 → W5 → integration-testing wave), validating the SEV-034 release_escrow fix end-to-end via a new bankrun-compatibility harness, executing the Squads multisig rotation rehearsal on devnet, and producing the documentation surface for the eventual external Adevar Labs engagement (scoping in progress).

**Internal pre-audit framing:** the SEV-### identifiers below come from the team's own pre-audit cycle simulating Adevar Labs' methodology — **NOT** from a formal Adevar engagement. The Adevar engagement is in scoping (cost/timeline negotiation). The internal methodology and SEV naming were deliberately mirrored so the eventual paid auditor can re-validate quickly against a clean baseline. Full tracker: [`docs/security/internal-audit-findings.md`](./docs/security/internal-audit-findings.md).

### Added

#### Internal pre-audit completion

- **W3 batch** — SEV-029 release_escrow partial-pay overpay regression fix with 6 negative tests (#342); 5 W3 findings catalogued (SEV-029..SEV-033).
- **W4 wave** — SEV-034 release_escrow cumulative-paid derivation rewrite + `LifecycleState` simulator that mirrors on-chain state shape AND models `contribute()` between releases (#349); release_escrow derivation extracted to math crate as single source of truth (#351).
- **Fase 5 batch** — constants floor guard CI lane (#343), SEV-030 admin cooldown extension to negative-score schemas + SEV-031 `create_pool` runtime viability guard + SEV-033 webhook fail-closed in production (#344), SEV-026 cascade math refactor delegating both `settle_default` and `release_escrow` to `roundfi-math::cascade` (#345), `fee_bps_yield` 1-day timelock pilot (#347).
- **W5 batch** — SEV-035 SDK enum drift fix (`PoolStatus::Closed = 4`), SEV-036 `Pubkey::default()` zombie state guard on propose handlers, SEV-037 `commit_new_fee_bps_yield` Signer field consistency, SEV-038 `cycles_total == members_target` (was `>=` allowing orphan cycles), SEV-039 `close_pool` PDA/ATA close acknowledged design constraint (#354, #356).
- **Integration-testing wave (this release)** — running the SEV-034 author's prescribed integration spec end-to-end surfaced **SEV-034b** (Critical): `join_pool.rs:272` seeded `member.total_escrow_deposited = stake_amount` (legacy from SEV-029 derivation) while the post-SEV-034 math assumes `ted=0` at join. Effect: `release_escrow` errored `EscrowNothingToRelease` on every call after the first contribute, locking member stake until `close_pool`. **1-line on-chain fix**: `total_escrow_deposited = 0` (#360).

#### bankrun harness extension — `bankrun_compat` shim

- **`tests/_harness/bankrun_compat.ts`** (343 LoC, ADR 0007) — Connection-over-BanksClient shim that wraps bankrun's 3-method `BankrunConnectionProxy` with the full `Connection` surface that `Env`-typed harness helpers expect (`getBalance`, `getLatestBlockhash`, `sendTransaction`, `simulateTransaction`, `confirmTransaction`, `requestAirdrop`, ...). Spec authors swap one import line; `Env`-typed helpers work transparently. Closes the "cooldown-bound / time-warp-bound specs are dead code on localnet" gap that previously hid SEV-034b. (#360 Items J/L/M)
- **3 specs migrated to bankrun via `setupBankrunEnvCompat`** with on-chain validation: `tests/security_sev034_release_escrow_lifecycle.spec.ts` (2/2 passing — the canary that found SEV-034b), `tests/edge_cycle_boundary.spec.ts` (4/4 passing in 1s — was unrunnable on localnet due to 24h+ `waitUntilUnix`), `tests/edge_grace_default.spec.ts` (3/3 passing — `settle_default` with Triple Shield seizure + clock-warp).
- **No remaining `waitUntilUnix(` consumer** in `tests/*.spec.ts` after the migrations.

#### Dev / operations scripts

- **`scripts/dev/patch-anchor-syn-319.sh`** + **`scripts/dev/rebuild-idls.sh`** (#360) — workaround for spike #319 (anchor-syn 0.30.1 IDL builder calls removed `Span::source_file()` API). Patches the cached `anchor-syn-0.30.1` source in `~/.cargo/registry/src` to swap the `#[cfg(procmacro2_semver_exempt)]` gate for `#[cfg(any())]`, then runs `anchor idl build` for the 3 workspace programs the bankrun harness loads. Local-machine-only; CI uses `anchor build --no-idl` and skips bankrun specs (SEV-012 coverage gap).
- **`scripts/test-fresh.sh`** (#361, #362) — fresh local validator + program redeployment for batch localnet runs (kills any running `solana-test-validator`, wipes ledger, fresh `--reset` start, optional `mpl_core.so` clone from mainnet, `anchor build --no-idl` + `anchor deploy`). Detects program-ID drift from Anchor.toml on first-run scenarios (#362). Mirrors the existing `devnet:pause-rehearsal` alias style.
- **5 pnpm aliases for Squads rehearsal** — `devnet:squads-derive-pda`, `devnet:squads-rehearsal-{verify,propose,cancel,commit}` (#367).
- **`docs/operations/squads-rehearsal-quickstart.md`** (#367) — copy-paste runbook condensing the canonical `squads-multisig-procedure.md` into the actual command sequence with expected outputs at each phase. Documents two paths for the Phase C commit timelock: Option 1 (real 7d wait, mainnet-faithful) or Option 2 (temporarily lowered timelock on a throwaway branch).

#### Documentation

- **`docs/adr/0007-bankrun-compat-shim.md`** (#364) — ADR documenting the architectural decision behind `tests/_harness/bankrun_compat.ts`. Captures context (2 distinct spec populations), decision (shim, not rewrite), alternatives rejected (fork upstream, accept 24h localnet, etc.), and empirical consequences (surfaced SEV-034b + SEV-031 latent fixture drift).
- **`docs/319-agave-2x-migration-spike.md`** (#368) — planning spike with empirical failure capture (Cargo unifier deadlock on `zeroize` / `curve25519-dalek` when bumping mpl-core 0.8 → 0.12 piecemeal) + 5-PR roadmap with per-PR risk + time estimates. Concludes: 4-7 working days + OtterSec re-attestation lead time; **not on the mainnet-GA critical path** for Q4 2026.
- **`docs/operations/rehearsal-logs/2026-05-16-squads-rotation-rehearsal.md`** (#369) — Squads rotation rehearsal log: 4 phases validated on-chain (propose `4pfiQLAEzpoz...`, cancel `s1NDWguUm...`, re-propose `2dhWa68945...`, commit `2xeWvuDTa4...`). Final state on parallel test deployment: `live=6Y6BL1mq...`, `pending=default`, `eta=0`. Canonical `8LVrgxKw...` program untouched. Documents pre-flight blockers (devnet ProtocolConfig pre-PR #323 — realloc migration needed for canonical; insufficient SOL on solana config wallet; DeclaredProgramIdMismatch on first deploy attempt).
- **Findings tracker fully reconciled** — section counts now match summary cell-for-cell, internal-audit-findings.md SEV-026/027/030/031/033 status flipped from `🟡 Open/Deferred/Partial` to `🟢 Closed` (#363), SEV-029 + SEV-034 promoted from Low to High section to match their "High — fund-leak" severity notes (#365), stale tracker stats swept across README + MAINNET_READINESS + audit-readiness (#366).

### Changed

- **`programs/roundfi-core/src/instructions/join_pool.rs:272`** — `member.total_escrow_deposited = stake_amount;` → `= 0;` (SEV-034b 1-line on-chain fix in #360). Single on-chain change of the entire 0.5.0 release; all other commits are test / build / harness / doc infrastructure.
- **`programs/roundfi-core/src/instructions/release_escrow.rs`** — derivation extracted to `roundfi-math::escrow_vesting` crate; the on-chain handler now delegates (#351). Same principle as the SEV-026 cascade refactor — single source of truth for replicated financial math.
- **`tests/_harness/index.ts`** — `setupBankrunEnv` exported from barrel.
- **`Anchor.toml`** — `[programs.localnet]` aligned with `declare_id!` + `[programs.devnet]` (was `11111…` placeholders — bankrun was trying to deploy at the System Program address).
- **`tests/edge_grace_default.spec.ts`** — fixture expected values aligned to chain truth (1/3 USDC remainder from D/C ratio — `1500/3000 × 2000 = 1166_666_667 → 333_333_333` stake seizure, was off by exactly 333_333 base units).
- **`tests/edge_cycle_boundary.spec.ts`** — `INSTALLMENT_BASE` bumped 1000 → 2000 USDC to satisfy SEV-031 viability (`members × installment × (1 − sol − esc) ≥ credit`). Pre-existing fixture (installment=1000, credit=2200) violated the post-SEV-031 guard; bankrun migration made the spec actually run and surfaced the latent drift (#360 Item M).
- **`MAINNET_READINESS.md`** + **`README.md`** + **`docs/security/audit-readiness.md`** — tracker stat sweep (W4-era stale numbers updated to current 40/36/10/10) (#366).

### Fixed

- **SEV-034b** (Critical) — `release_escrow` fully broken by `total_escrow_deposited` init in `join_pool` (#360). Feature break of every member's vested stake until `close_pool`; not a fund-drain.
- **`scripts/devnet/squads-rehearsal-{verify,commit-authority}.ts`** offset bug — `OFFSET_PENDING_AUTHORITY: 311 → 313`, `OFFSET_PENDING_AUTHORITY_ETA: 343 → 345` (#369). Root cause: struct's `pub const SIZE` comment listed `pending_authority` before `lp_share_bps`, but Borsh serializes in source declaration order which has `lp_share_bps` (u16) FIRST. Script author trusted the SIZE comment. Bug surfaced during rehearsal execution.

### Infrastructure

- **Reproducible-build attestation refresh deferred** — the 4 deployed devnet programs (`roundfi-core`, `roundfi-reputation`, `roundfi-yield-mock`, `roundfi-yield-kamino`) are pre-#360 bytecode; the SEV-034b fix lives in main but hasn't been redeployed to devnet yet. Next devnet refresh sprint will bundle re-deploy + re-attestation + canonical ProtocolConfig realloc migration (gap surfaced by the Squads rehearsal — canonical config is pre-PR #323, missing `pending_authority` + `pending_authority_eta` fields).
- **Throwaway parallel devnet deploy** at `6WuSo1ut...7Rpn` (Squads rehearsal test instance, not canonical) — see [`docs/operations/rehearsal-logs/2026-05-16-squads-rotation-rehearsal.md`](./docs/operations/rehearsal-logs/2026-05-16-squads-rotation-rehearsal.md) §1.
- **11 PRs merged 2026-05-16** under this release: #359..#369 covering test infra base, SEV-034b fix + Items J/L/M/N/O, test-fresh.sh, findings tracker reconciliation, ADR 0007, SEV-029/034 row promote, tracker stats sweep, Squads quickstart, #319 spike doc, Squads rehearsal execution log + offset fix.

---

## [0.4.0] — 2026-05-14 (Audit-readiness consolidation + app↔chain wiring)

Post-Colosseum sprint focused on external-auditor pre-engagement docs, app↔chain encoder coverage, and security infrastructure (wallet allowlist, RPC quorum, phishing-resistance, indexer reconciler). 4 issues closed (#228, #229, #232, #234); 5 issues with partial progress (#235, #249, #227, #230, #233).

### Added

- **`MAINNET_READINESS.md`** at repo root — single-source devnet→GA checklist; 7 sections × status flags (✅/🟡/🔵/⛔); 9 hard blockers explicitly marked (#250).
- **`docs/security/README.md`** — navigation index for the 7 security docs (reading order, time estimates, cross-refs).
- **`docs/security/adversarial-threat-model.md`** — 6 adversarial scenarios beyond direct default: Sybil cost tables (N=10/100/1000), reputation farming, strategic ordering, malicious Community Pool leader, pool spam, MEV cross-ref (#248).
- **`docs/security/frontend-security-checklist.md`** — 10-threat UX-side checklist (T1-T10); explicit mainnet blockers + 8 already-shipped items with file:line evidence (#251).
- **`docs/security/indexer-threat-model.md`** — 19-threat off-chain consistency analysis (ingestion / reorg / storage / privacy) (#252).
- **`docs/security/mev-front-running.md`** — Solana ordering model + 6-instruction surface enumeration; closes #232 (#254, #255).
- **`docs/architecture/pop-provider-evaluation.md`** — 4-candidate PoP evaluation (VeryAI / WorldID / Sumsub / Privado ID) with 9-criterion matrix (#262, towards #227).
- **`docs/operations/agave-2x-migration-plan.md`** — risk register (R1-R7) + 4-phase sequencing for Solana 1.18 → Agave 2.x toolchain bump (#262, towards #230).
- **`docs/operations/indexer-reorg-recovery.md`** — on-call runbook for indexer reorg events; P1-P3 triage (#258).
- **`crates/math/` workspace member** — pure-Rust math extracted from `programs/roundfi-core/src/math/` (1233 LoC, 6 modules, 66 unit tests + 6 proptest invariants, zero Solana deps); closes #229 (#257).
- **`services/indexer/src/reconciler.ts`** — finality gate (32 slots) + RPC quorum + cross-validation via `getSignaturesForAddress`; closes #234 (#258).
- **`app/src/lib/walletAllowlist.ts`** — Phantom/Solflare/Backpack/Glow/Nightly/Ledger/Trezor allowlist with hardware-wallet detection (#249 W1, #259).
- **`app/src/lib/domainPinning.ts` + `PhishingBanner`** — canonical domains allowlist with red banner for unknown hostnames; SSR-safe (#249 W3, #263).
- **`app/src/components/ui/IntentPanel.tsx`** — human-readable transaction summary before wallet prompt; 8 actions supported (#249 W3, #263).
- **`app/src/lib/rpcAllowlist.ts`** — RPC endpoint allowlist + quorum scaffolding (`readAccountQuorum`) (#249 W2, #264).
- **SDK encoders** (app↔chain wiring towards #235):
  - `app/src/lib/release-escrow.ts` (#260)
  - `app/src/lib/escape-valve-list.ts` (#261)
  - `app/src/lib/deposit-idle-to-yield.ts` (#261)
- **Stress-lab extended presets** — 11 new presets (pool-size, tier-mix, default-position, yield-extreme dimensions); test count 34 → 45; closes #228 (#256).
- **`/reputacao` Devnet/Demo data-source banner** — visual disclosure of on-chain vs session-reducer reflection (#253).
- **README + AUDIT_SCOPE softening** — pitch-vs-shipped honest framing pass (#246).
- **External auditor self-attestation matrix** — `self-audit.md §10` with 10 auditor-first-pass concerns mapped to source + tests (#247).

### Changed

- **`AUDIT_SCOPE.md`** — MEV review row moved from out-of-scope to addressed (closes #232) (#255).
- **`programs/roundfi-core/src/math/mod.rs`** — now a thin adapter layer; re-exports from `roundfi-math` crate; maps `MathError` → `anchor_lang::error::Error` (#257).
- **`programs/roundfi-core/Cargo.toml`** — adds `roundfi-math = { path = "../../crates/math" }`; `proptest` moved to roundfi-math dev-deps.
- **`tests/economic_parity.spec.ts`** — adds 11 new per-preset smoke tests under "L1 stress-lab sanity — extended presets (Issue #228)" describe block.
- **`MAINNET_READINESS.md §5.2`** — indexer reconciler row moved from `🔵 Pending` to `🟡 Partial` after #258 ships.
- **`docs/security/indexer-threat-model.md §2.2`** — R1/R2/R3 moved from `🔵 Pending` to `🟡 Partial` with file:line refs to `reconciler.ts`.

### Fixed

- **D/C invariant exhaustive grid test** — pre-existing test bug surfaced when math crate moved to host execution; gate added to skip pre-violation states the helper can't fix (#257).

### Reference branches (not merged to main)

- **`chore/riptide-spike`** — Riptide v0.9.1 evaluation. Engine boots, loads `roundfi_core.so`, but 864 dispatches fail with `Custom(3002)` because no setup harness. Concluded: 4 architectural walls (no custom semantic class, no [setup] block, no mpl-core support, schema fragility). Issue #228 covers the quantitative-stress goal instead. Reference branch preserved for future revisit if Riptide ships a `generic.v2` class.

---

## [0.3.0] — 2026-05-12 (M3 — Colosseum hackathon submission)

Snapshot of the protocol state at hackathon submission: 4 Anchor programs on Solana devnet, browser-signed user flows for `contribute` + `claim_payout`, full audit-readiness pack, OtterSec verify-build attestation PDAs for every deployed program.

### Added

- **Reproducible-build attestation flow** — all 4 devnet programs (`roundfi-core`, `roundfi-reputation`, `roundfi-yield-mock`, `roundfi-yield-kamino`) carry an on-chain OtterSec verify-build PDA binding bytecode hash → GitHub commit (#206, #207). 30-second CLI verification path documented in [`docs/verified-build.md`](docs/verified-build.md).
- **`AUDIT_SCOPE.md`** at repo root — Statement-of-Work-shape doc with in-scope LoC (8,341 across 3 Anchor programs), out-of-scope rationale, 6 prior internal hardening PRs catalogued, verification path, and an honest mainnet timeline (#224).
- **`docs/security/audit-readiness.md`** — strategic one-pager for external audit firms: TL;DR signals table, fund-flow per vault, 5 ranked high-leverage focus areas, real-bug-already-found section (#215).
- **`docs/security/bug-bounty.md`** — pre-mainnet policy draft: 3-phase activation, 5-tier severity (Critical USD 25-50k → Informational HoF), USD 50k initial pool, USDC-on-Solana payouts, safe-harbor clauses (#225).
- **`docs/stress-lab.md`** — economic-scenario coverage doc: 5 canonical presets, 34 invariant tests, `/lab` UI matrix toggle for custom scenarios (#223).
- **`deny.toml`** at repo root + **`deny · supply-chain (advisory)`** CI lane — licence allow-list (Apache-2.0 / MIT / BSD / ISC / etc.), source restriction to crates.io + Anchor git, RustSec advisory policy with Solana-1.18-transient ignore stubs (#225).
- **`.github/dependabot.yml`** — weekly cargo + npm + actions surveillance with the Solana/Anchor/mpl-core stack explicitly pinned (#215).
- **CONTRIBUTING.md + CODE_OF_CONDUCT.md + issue/PR templates** under `.github/ISSUE_TEMPLATE/` (#211).
- **Triple Shield captured firing on real funds** — 4/4 guards (Seed Draw, GF Solvency, Adaptive Escrow, Solidarity drain) documented in [`docs/security/self-audit.md`](docs/security/self-audit.md) with file:line references and 53 dedicated security tests.
- **YouTube Demo + Pitch videos** linked in README header — `🎬 Demo` ([mQMoh7BMf8E](https://www.youtube.com/watch?v=mQMoh7BMf8E)) + `🎙️ Pitch` ([aWh-0FOuN4o](https://youtu.be/aWh-0FOuN4o)) (#209, #210).

### Changed

- **PoP-provider scaffold framing** — from "Civic Pass active" to "Civic legacy gateway-token validator; VeryAI / WorldID / Sumsub under evaluation" across `docs/architecture.md` §4.4, the identity diagram, the enum comment, and the 3-min pitch decks (#223 reframed in audit-honest direction post-feedback). Civic Pass was discontinued by Civic on 31 July 2025.
- **3-min pitch decks** (EN + PT) aligned with the YouTube video script — slide 4 framing "Credit is the bait" → "The pool is the mechanism" (matches video); slide 11 stack pill `Civic Pass` → `Switchboard` (matches video's "verifiable randomness" claim); slide 11 closing adds "Credit beyond Capital" micro-line (#214).
- **Team slide on 3-min decks** — Diego (Mobile / Flutter, no longer on team) replaced by Gabriel (Security Engineer). Yvina → "Founder & CEO" + lived-insight framing. Caio → "Co-Founder / CPO" + Triple Shield design. Alrimar → "Co-Founder / CTO" + Solana full-stack (Anchor → SAS → Kamino) (#213).
- **README header** — added "Audit-ready" shields badge linking to `docs/security/audit-readiness.md`; added `🛡️ Audit-Readiness` + `📋 Audit Scope` nav entries; status line under nav showing "M3 shipped · 4 programs live on devnet · 162 tests / 53 security-specific · last updated May 2026" (#215, #223, #224).
- **Pitch slide #9 ("Live on devnet")** kept as-is per team decision (boss accepted residual risk on "Solscan verified" framing — confirmed self-attestation PDA is technically equivalent, just not UI-rendered on Solscan for devnet).

### Fixed

- **`Cargo.lock` pinned to v3 + `borsh 1.5.7`** for `solanafoundation/solana-verifiable-build:1.18.26` compatibility — image's bundled Cargo cannot parse v4; image's platform-tools rustc 1.75 cannot compile `borsh 1.6.x` which requires 1.77 (#207).
- **`SECURITY.md` disclosure email** corrected to `roundfinance.sol@gmail.com` (previous placeholder `security@roundfi.dev` was a non-owned domain) (#212).
- **Slide 7 Q&A in 3-min pitch decks** — "Civic Pass + SAS Score" → "PoP gateway + SAS Score" (audit-honest after VeryAI partnership is unsigned).
- **`docs/stress-lab.md`** — dropped the fictional "33 scenarios = 5 + 28 manual matrix runs" reconciliation paragraph (the 28-run set was never persisted and the "33 scenarios" claim isn't in any submitted pitch artifact) (#226).

### Infrastructure

- **GitHub roadmap visible** — 10 issues open in the tracker covering: PoP rename (#227), stress-lab test codification (#228), `roundfi-math` workspace crate extraction (#229), Anza Agave 2.x migration (#230), pause-rehearsal drill (#231), MEV review (#232), `harvest()` redemption path (#233), indexer reconciler hardening (#234), app↔chain wiring completion (#235), this file (#236). Custom labels: `mainnet-blocker`, `pre-mainnet`, `post-mainnet`, `hygiene`.

---

## [0.2.0] — 2026-04-22 (M2 — protocol surface complete)

Reference snapshot pre-hackathon submission. Triple Shield invariants live, identity layer scaffolded (§4.4 of architecture.md), pool lifecycle complete (create / join / contribute / claim_payout / settle_default / close), escape valve secondary market shipped, harvest waterfall with slippage guard. ~140 PRs merged.

Detail-level entries for the M2 surface live in the per-PR descriptions on `main` — historic reconstruction into this CHANGELOG block is a tracked follow-up if external pressure (e.g. partner due-diligence) requires it.

---

## [0.1.0] — 2026-03 (M1 — protocol scaffold)

Initial Anchor workspace, first programs deployed to devnet (placeholder program IDs), pool creation + first browser-signed `contribute` flow. ~50 PRs merged. Same reconstruction caveat as 0.2.0.
