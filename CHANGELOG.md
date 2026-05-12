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
