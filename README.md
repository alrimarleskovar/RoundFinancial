# RoundFi

> **Behavioral-credit infrastructure for Solana.** RoundFi runs on-chain ROSCAs as a **data-acquisition engine**: every paid installment mints an on-chain attestation that builds a portable credit identity. The ROSCA is the bait; the **behavioral score** is the product. Endgame: a high-margin B2B oracle that neobanks and DeFi protocols subscribe to before lending — _the Serasa of Web3_.

<p>
  <a href="https://github.com/alrimarleskovar/RoundFinancial/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/alrimarleskovar/RoundFinancial/actions/workflows/ci.yml/badge.svg?branch=main"/></a>
  <a href="https://roundfinancial.vercel.app"><img alt="Live demo" src="https://img.shields.io/badge/Live_demo-roundfinancial.vercel.app-14F195?style=for-the-badge&logo=vercel&logoColor=06090F"/></a>
  <a href="https://www.youtube.com/watch?v=mQMoh7BMf8E"><img alt="Demo video" src="https://img.shields.io/badge/Demo-video-FF0000?style=for-the-badge&logo=youtube&logoColor=white"/></a>
  <a href="https://youtu.be/aWh-0FOuN4o"><img alt="Pitch video" src="https://img.shields.io/badge/Pitch-video-FF0000?style=for-the-badge&logo=youtube&logoColor=white"/></a>
  <a href="https://github.com/alrimarleskovar/RoundFinancial/pulls?q=is%3Apr+is%3Amerged"><img alt="PRs merged" src="https://img.shields.io/badge/PRs_merged-186+-9945FF?style=for-the-badge&logo=github&logoColor=white"/></a>
  <a href="docs/security/audit-readiness.md"><img alt="Audit-ready · self-audit + threat model" src="https://img.shields.io/badge/Audit_ready-self_audit_%2B_threat_model-FF7A45?style=for-the-badge&logo=rust&logoColor=white"/></a>
  <a href="docs/devnet-deployment.md"><img alt="Devnet · 3 pools + browser writes" src="https://img.shields.io/badge/Devnet-3_pools_%2B_browser_writes-00C8FF?style=for-the-badge&logo=solana&logoColor=06090F"/></a>
</p>

<p>
  <a href="https://roundfinancial.vercel.app">🚀 Live demo</a> ·
  <a href="https://www.youtube.com/watch?v=mQMoh7BMf8E">🎬 Demo (video)</a> ·
  <a href="https://youtu.be/aWh-0FOuN4o">🎙️ Pitch (video)</a> ·
  <a href="docs/status.md">📋 Status (shipped vs roadmap)</a> ·
  <a href="docs/pitch/pitch-3min-en.html">📊 3-min Pitch (EN)</a> ·
  <a href="docs/pitch/pitch-3min.html">📊 3-min Pitch (PT)</a> ·
  <a href="docs/pitch/pitch-deck-en.html">📊 Long-form Deck (EN)</a> ·
  <a href="docs/architecture.md">🧱 Architecture</a> ·
  <a href="docs/security/audit-readiness.md">🛡️ Audit-Readiness</a> ·
  <a href="AUDIT_SCOPE.md">📋 Audit Scope</a> ·
  <a href="MAINNET_READINESS.md">🚦 Mainnet Readiness</a> ·
  <a href="grant/">📦 Grant bundle</a>
</p>

<sub>**Status:** M3 shipped · 4 programs live on devnet · reproducible-build attestation on-chain · **227 tests across 20 spec files** (53 security-specific bankrun + 58 app-encoder structural + 7 bankrun round-trips + 109 lifecycle/edge/parity) · 6 cargo-fuzz targets on `roundfi-math` · seeking external audit (Adevar Labs track). _Last updated: May 2026._</sub>

Built for the **Colosseum Hackathon 2026**.

---

## Why RoundFi

DeFi solved trading. DeFi solved liquidity. DeFi never solved **credit**. The two clearest attempts at on-chain ROSCAs / under-collateralized retail credit both shipped — and both went quiet:

- **WeTrust** (Ethereum, 2017–2018) — first on-chain ROSCA, _Trusted Lending Circles_. Gas costs ate margins, retention collapsed when ETH stalled, and the protocol _was_ the product — no data layer to monetize. Wound down quietly.
- **RociFi** (Solana, 2021–2023) — under-collateralized lending with NFT credit scores. The score was program-internal (not portable, not SAS-compatible), B2B distribution never materialized, and liquidator economics broke under volatility. Project sunset.

| Protocol        |   Status   | Sub-collateral | Behavior score | Retail user | Emerging markets | Position NFT | No prior crypto |
| --------------- | :--------: | :------------: | :------------: | :---------: | :--------------: | :----------: | :-------------: |
| Aave / Marginfi |    live    |       ✗        |       ✗        |      ✗      |        ✗         |      ✗       |        ✗        |
| Goldfinch       |    live    |       ✓        |       ✗        |      ✗      |        ~         |      ✗       |        ✗        |
| Maple / TrueFi  |    live    |       ~        |       ✗        |      ✗      |        ✗         |      ✗       |        ✗        |
| Credix          |    live    |       ✓        |       ✗        |      ✗      |        ✓         |      ✗       |        ✗        |
| WeTrust         | **sunset** |       ✓        |       ✗        |      ✓      |        ~         |      ✗       |        ✗        |
| RociFi          | **sunset** |       ✓        |       ~        |      ~      |        ✗         |      ~       |        ✗        |
| **RoundFi**     | **devnet** |     **✓**      |     **✓**      |    **✓**    |      **✓**       |    **✓**     |      **✓**      |

The boxes alone don't make us right — Aave, Goldfinch, and Credix are real businesses with billions of TVL between them. **What separates RoundFi from the projects that sunset is structural, not feature-list:**

- **Phase 3 is the revenue model from day 1, not an afterthought.** WeTrust's protocol _was_ the product, so when retention slipped there was nothing left to sell. RociFi's NFT score didn't read outside their pools, so there was no B2B moat. RoundFi treats Phase 1 (ROSCAs) explicitly as the data-acquisition engine for Phase 3 (per-call B2B oracle subscriptions to neobanks + DeFi protocols). The Triple Shield + Yield Cascade exist to keep Phase 1 solvent **while** the on-chain dataset compounds.
- **Score is SAS-compatible from the first attestation.** Every paid installment mints against the Solana Attestation Service schema — the protocol shipped this end-to-end (see `roundfi-reputation` program + `tests/reputation_cpi.spec.ts`). On the user-facing side, the `/reputacao` surface today mixes on-chain reads (real devnet attestations from member-3's contribute and others) with a session-reducer reflection used in Demo Studio mock mode. The portability infrastructure is on-chain; B2B subscription consumers are roadmap (Phase 3). RociFi's score died with RociFi — SAS-compatible attestations exist independent of any front-end going forward.
- **Solvency is mathematical, not aspirational.** WeTrust's retention model was "members keep paying because trust." RoundFi's Triple Shield gives a **91.6% Month-1 retention floor** as a deterministic property of the contract — encoded in [`programs/roundfi-core/src/math/waterfall.rs`](programs/roundfi-core/src/math/waterfall.rs) and parity-tested against the [Stress Lab L1 simulator](sdk/src/stressLab.ts). Stake decays 50% → 30% → 10% but only after on-chain attestations confirm cycle completion — no honor system.

## Thesis (per the whitepaper)

RoundFi is a **behavioral-credit primitive disguised as a savings protocol**. The product evolves through three explicit phases — codified in the [B2B plan](docs/pt/plano-b2b.pdf) and [Expansion plan](docs/pt/plano-expansao.pdf):

| Phase              | Surface                             | What it does                                                                                                                                  |
| ------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 · Liquidity**  | ROSCA pools on Solana               | Bootstrap users with sub-collateralized credit. Stake ladder 50% → 30% → 10% as reputation graduates.                                         |
| **2 · Reputation** | SAS attestations + behavioral score | Every paid installment mints an immutable attestation; the score becomes a portable credit identity.                                          |
| **3 · B2B data**   | Behavioral oracle API               | Neobanks, DeFi protocols, and emerging-market lenders subscribe per-call to query the score before extending credit. **High-margin endgame.** |

**Phase 1 is the acquisition engine. Phase 3 is the business model.** The Triple Shield + Yield Cascade exist to keep Phase 1 solvent while the on-chain dataset compounds. Esusu hit a $1.2B valuation building Phase 2 in Web2; RoundFi does it on-chain with deterministic logic, then sells the data layer.

## Core Mechanics

- **Pool shape:** 24 members · $416/mo installment · ~$10K credit per cycle
- **Reputation ladder (50-30-10 Rule):** stake drops 50% → 30% → 10% as members graduate Level 1 → 2 → 3 (Veteran). Veterans unlock 10× leverage.
- **Triple Shield:**
  1. **Seed Draw** — Month-1 retention of 91.6% of capital.
  2. **Adaptive Escrow** — locks reward portions so debt decreases faster than collateral returns.
  3. **Solidarity Vault** — 1% of each installment, redistributed as Good Faith Bonus.
- **Yield Waterfall (Kamino adapter, 5–8% APY mainnet target):** Protocol → Guarantee Fund → LP Angels → Participants. The Kamino adapter ships with a real `deposit_reserve_liquidity` CPI for the deposit path ([`programs/roundfi-yield-kamino`](programs/roundfi-yield-kamino)); the `harvest` path is staged behind audit clearance (tracked in [#233](https://github.com/alrimarleskovar/RoundFinancial/issues/233)). Devnet uses the **mock adapter** (`programs/roundfi-yield-mock`) for deterministic test cycles. Adapter is swap-via-`Pool.yield_adapter` Pubkey — no core redeploy needed.
- **Escape Valve:** positions are dynamic NFTs. Distressed users sell instead of defaulting.
- **Behavioral oracle:** every payment is an on-chain attestation (SAS-compatible) — a portable credit identity, the _"Serasa of Web3"_.

## Stress Lab (L1 reference impl)

The protocol's economic spec is encoded in a **pure-TypeScript actuarial simulator** that runs every Triple-Shield rule end-to-end. Lives in [`sdk/src/stressLab.ts`](sdk/src/stressLab.ts) and ships the [`/lab`](app/src/app/lab/page.tsx) interactive route. Used as:

- **Reference implementation** for the on-chain Anchor programs (M2 of the grant roadmap parity-tests against `runSimulation()` outputs).
- **Whitepaper-faithful playground** — pick credit/members/tier/maturity/APY and watch the matrix unfold. 4 canonical presets (Healthy / Pre-default / Post-default / Cascade) load with one click.
- **Audit panel** with full capital-structure breakdown: float + Solidarity Vault + Guarantee Fund (capped at 150% of credit) − outstanding escrow − outstanding stake refund = **Net Solvency**. Plus the 4-tier yield waterfall (admin fee → GF → 65% LPs → 35% participants).

**40 L1 tests green** under `pnpm run test:economic-parity-l1` covering: input refactor (credit-amount as primary), toggleCell click semantics, escrow gating on default month, stake cashback phase, net-solvency identity, capital structure invariants, mature-group acceleration (5/4/3 → 3/2/1), Escape Valve `"E"` cell architecture, and the 4-tier waterfall split.

**L1 ↔ L2 parity validated on-chain (Healthy preset).** The `Healthy` matrix from `runSimulation()` is now driven end-to-end against `roundfi-core` and asserts per-member USDC delta on-chain ≡ L1 net within ε = 1 USDC base unit. Pre-default / Post-default / Cascade unlock mechanically once the canary turns green organically; the matrix-driver harness already supports all four preset shapes.

## Repository Layout

```
RoundFinancial/
├── programs/                           # Anchor programs (Rust)
│   ├── roundfi-core/                           # Pool state machine + escrow + solidarity vault
│   ├── roundfi-reputation/                     # SAS-compatible attestation + reputation ladder
│   ├── roundfi-yield-mock/                     # Devnet yield adapter (simulated APY)
│   └── roundfi-yield-kamino/                   # Mainnet yield adapter (real Kamino CPI)
├── sdk/                                # TypeScript SDK generated from Anchor IDL
├── services/orchestrator/              # Lifecycle orchestrator (mock + real driver)
├── app/                                # Next.js 14 front-end (Wallet Adapter, Phantom/Solflare/Backpack)
│   ├── src/app/                                # Routes
│   │   ├── page.tsx                            # / public landing (CoFi paradigm + Security grid + FAQ + Waitlist)
│   │   ├── home/                               # /home Bento dashboard (gated by wallet connect)
│   │   ├── carteira/                           # /carteira (4 tabs · Receive/Send/Withdraw modals · DEMO badges)
│   │   ├── grupos/                             # /grupos catalog (level gating · Novo ciclo modal)
│   │   ├── reputacao/                          # /reputacao SAS passport (copyable · Bond detail modal · level-up bridge)
│   │   ├── mercado/                            # /mercado Buy + Sell tabs (Escape Valve flow)
│   │   ├── insights/                           # /insights score curve (zooming range · Recommendation modals)
│   │   ├── lab/                                # /lab Stress Lab (L1 actuarial simulator · 5 preset scenarios)
│   │   └── demo/                               # /demo lifecycle demo (orchestrator + wallet adapter)
│   ├── src/components/                         # By feature: brand · layout · home · carteira · grupos · score · mercado · lab · insights · modals
│   ├── src/lib/                                # Theme · i18n (510+ keys PT/EN) · wallet · network · session · groups helpers
│   ├── src/data/                               # Typed mock fixtures (USER, NFT_POSITIONS, ACTIVE_GROUPS, …)
│   └── public/prototype/                       # Original design handoff bundle (legacy preview)
├── scripts/                            # Devnet deploy, airdrop, seed, stress runners
├── config/                             # Cluster configs + program-ID registry
├── tests/                              # Cross-program integration tests (Anchor + bankrun)
│   ├── parity.spec.ts                          # Rust ↔ TS constants/seeds parity (zero infra)
│   ├── economic_parity.spec.ts                 # L1 ↔ L2 economic parity (40 tests passing)
│   └── *.spec.ts                               # 17 additional specs · 162 cases total (lifecycle, edge, security, reputation, yield, events)
├── grant/                              # Superteam Agentic Engineering grant bundle (7 docs)
└── docs/                               # Architecture, module specs, deploy guides
    ├── pitch/                                  # 3-min decks (PT + EN) + long-form deck
    └── pt/                                     # Portuguese strategy docs (whitepaper + planning)
```

## Documentation

**Core**

- [**Architecture Spec**](docs/architecture.md) — programs, accounts, instructions, PDAs, CPI graph, error taxonomy
- [Devnet Setup](docs/devnet-setup.md) — full prerequisites + deploy walkthrough
- [Pitch Alignment](docs/pitch-alignment.md) — how the implementation maps to the deck
- [Yield & Guarantee Fund](docs/yield-and-guarantee-fund.md) — waterfall math + adapters

**Pitch**

- [3-min Pitch · EN](docs/pitch/pitch-3min-en.html) — 12-slide short-form deck (English)
- [3-min Pitch · PT](docs/pitch/pitch-3min.html) — 12-slide short-form deck (Portuguese)
- [Long-form Deck · EN](docs/pitch/pitch-deck-en.html) — 15-slide Colosseum deck

**English (strategy + technical)** — full index in [`docs/en/`](docs/en/README.md)

- [00 · Documentation Index](docs/en/00-documentation-index.pdf) — formal strategic index of the package
- [01 · Overview](docs/en/01-roundfi-overview.pdf) — entry point, 60-second pitch in document form
- [02 · Technical Whitepaper](docs/en/02-technical-whitepaper.pdf) — protocol whitepaper, source of truth for mechanics
- [03 · Architecture Spec](docs/en/03-architecture-spec.pdf) — program topology, account model, instruction surface
- [04 · Behavioral Reputation Score](docs/en/04-behavioral-reputation-score.pdf) — 50/30/10 ladder + attestation schemas
- [05 · Stress Lab & Economic Model](docs/en/05-stress-lab-economic-model.pdf) — L1 actuarial simulator + Triple Shield invariants
- [06 · Market & GTM](docs/en/06-market-and-gtm.pdf) — market sizing + ICP + go-to-market motion
- [07 · Business Model & B2B Oracle](docs/en/07-business-model-b2b-oracle.pdf) — 3-phase revenue + Phase 3 endgame
- [08 · Competitive Analysis](docs/en/08-competitive-analysis.pdf) — honest positioning vs Aave, Kamino, Maple, TrueFi, Goldfinch, Credix, RociFi, ARCx, WeTrust
- [09 · Risk & Compliance](docs/en/09-risk-and-compliance.pdf) — risk taxonomy + regulatory framing + compliance posture
- [10 · User Guide](docs/en/10-user-guide.pdf) — end-user onboarding, step by step
- [11 · Devnet Status & Proof](docs/en/11-devnet-status-and-proof.pdf) — Solscan receipts + Triple Shield enforcement evidence

**Grant bundle (Superteam · Agentic Engineering)**

- [Grant index](grant/00_README.md) — 7-file response bundle
- [Project overview](grant/01_PROJECT.md) · [Agentic process](grant/02_AGENTIC_PROCESS.md) · [PR log](grant/03_PR_LOG.md)
- [Grant use](grant/04_GRANT_USE.md) · [Builder note](grant/05_BUILDER_NOTE.md) · [Milestones](grant/06_MILESTONES.md)

**Portuguese (strategy + research)**

- [Whitepaper Técnico](docs/pt/whitepaper.pdf)
- [Guia do Usuário](docs/pt/guia-usuario.pdf)
- [Viabilidade Técnica](docs/pt/viabilidade-tecnica.pdf)
- [Escada de Reputação](docs/pt/escada-reputacao.pdf)
- [Válvula de Escape](docs/pt/valvula-escape.pdf)
- [Plano Estratégico B2B](docs/pt/plano-b2b.pdf)
- [Plano de Expansão](docs/pt/plano-expansao.pdf)

Per-module READMEs land alongside each module as it ships.

## Front-end

A complete Next.js 14 + TypeScript app with **a public landing + 9 routes** (`/home`, `/carteira`, `/grupos`, `/reputacao`, `/mercado`, `/insights`, `/lab`, `/admin` Demo Studio, `/demo`), real Solana wallet integration (devnet), session-orchestrated state, and a Web3-native aesthetic system (Neon palette, glassmorphism, animated counters, terminal-style activity log).

> **🚀 Try it now:** [roundfinancial.vercel.app](https://roundfinancial.vercel.app) — every push to `main` auto-deploys; PRs get preview URLs.

Run locally:

```bash
pnpm install
pnpm --filter @roundfi/app dev
# -> http://localhost:3000/
```

### Routes

| Route            | What's there                                                                                                                                                                                                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/`**          | Public landing — animated gradient title + PT/EN toggle + interactive simulator + comparison table + **CoFi paradigm** + **6-card Security grid** + 5-Q **FAQ accordion** + **Waitlist form** + scrolling tx-id "data stream" behind the hero. Connect Phantom CTAs redirect to `/home`.                                               |
| **`/home`**      | Bento dashboard — clickable KPI cards (Balance/Yield → `/carteira`, Collateral → `/insights`) + featured round with **CTAs** (Pay installment / View catalog) + clickable group rows (open `PayInstallmentModal`) + radial **SAS Passport ring** + Triple Shield + live **Activity feed**.                                             |
| **`/carteira`**  | 4 tabs · **5 wired modals**: Receive (QR + copy address), Send (base58 validation + MAX), Withdraw (Kamino yield withdraw), Manage (per-connection inspector). PhantomFaucet (1-SOL airdrop + hosted fallback + Circle USDC). DEMO badges on Civic/Kamino/Solflare/PIX mocks. WalletChip airdrop has inline pill feedback.             |
| **`/grupos`**    | ROSCA catalog with search + 5 multi-facet filters + **level gating in 3 layers** (locked card visual + locked-state modal + defensive `joinGroup()` guard). `+ New cycle` opens `NewCycleModal` (eligible if Lv.3, locked otherwise).                                                                                                  |
| **`/reputacao`** | SAS passport — **click-to-copy wallet** + radial score + 50/30/10 ladder with **level-up bridge** to `/insights` + 4 SAS bonds opening `BondDetailModal` (attestation count, on-chain path, demo callout).                                                                                                                             |
| **`/mercado`**   | Buy + Sell tabs · **Buy modal** (offer summary + savings + demo callout for `escape_valve_buy`) · **Sell modal** (price slider 50–100% of face + 7-day slashing window + Whitepaper protections panel).                                                                                                                                |
| **`/insights`**  | Score evolution — **range pill (1M/3M/6M/12M)** that actually reshapes the curve + 5-factor breakdown + 3 **clickable recommendation cards** opening detail modals (Estimated Gain / Why / On-chain Signal).                                                                                                                           |
| **`/lab`**       | **Stress Lab** — L1 actuarial simulator. Inputs: tier · maturity · members · credit value · APY · admin fee. 4 one-click preset scenarios. Matrix editor (P/C/X/E cells with position-aware toggle). Pool-balance sparkline. Audit panel: Gross Cash + Solidarity Vault + Guarantee Fund − outstanding obligations = **Net Solvency**. |
| `/demo`          | Lifecycle orchestrator demo (developer-facing, not in user nav).                                                                                                                                                                                                                                                                       |

### Aesthetic system

Calibrated against a "Web3 high-end" brief. The whole dashboard reads as a live system, not a banking statement.

- **Neon palette by default** — `#06090F` ground, `#14F195` Solana green, `#9945FF` purple, `#00C8FF` teal accent. Soft (cream + sage) palette stays available via the dev Tweaks panel.
- **Glassmorphism on every primary card** — `backdrop-filter: blur(12px) saturate(140%)` over a translucent base + 1px hairline border. One helper (`glassSurfaceStyle(palette)`) drives every screen.
- **Terminal sidebar** — uppercase JetBrains Mono labels with 0.12em tracking, glowing green active rail.
- **SOLANA_DEVNET pulse** — network status chip in the top bar pulses a green dot when connected; `PHANTOM_OFFLINE` greys out otherwise.
- **Wallet glow** — connected wallet chip runs a subtle `rfi-glow` halo loop; landing CTAs run bigger `rfi-btn-glow-green/purple` halos so every Connect button reads as the primary action immediately.
- **Animated CountUp** — every hero number (balance, yield, score, KPIs) spring-animates between values when currency / language / palette flips.
- **Terminal Activity feed** — live event stream from the session orchestrator rendered with `>` prompt + `[timestamp]` + op tag + amount + tx id, color-coded per row kind (in / out / attestation / join / yield).
- **Bento `/home`** — asymmetric grid: 3 KPIs + tall radial Score ring + 3-col Featured round + balanced YourGroups / TripleShield + full-width Activity log.
- **Radial SAS Score ring** — 168px SVG arc with green→teal gradient, draws in over 1.6s on first paint.
- **Page transitions** — selectable via Tweaks panel: off / fade (default) / horizontal slide. Driven by framer-motion + `usePathname`.

### Live state & interactions

- **Real wallet flow** — Standard-wallet discovery via `@solana/wallet-adapter-react` picks up Phantom / Solflare / Backpack automatically. Connect from the landing → bounces to `/home`. Disconnect from the wallet chip dropdown → bounces back to `/`.
- **Devnet faucet** — One-click 1-SOL airdrop inside the Phantom card on `/carteira`. Falls back to https://faucet.solana.com when the public RPC rate-limits (always-visible secondary CTA), plus https://faucet.circle.com for devnet USDC.
- **Functional modals (17)** — every actionable surface across the app routes to an honest demo modal:
  - **`/home`**: PayInstallmentModal (Triple Shield breakdown), JoinGroupModal (locked branch when Lv > user.level)
  - **`/grupos`**: JoinGroupModal, NewCycleModal (eligible vs locked)
  - **`/mercado`**: BuyOfferModal (offer summary + savings), SellPositionModal (slider + Escape Valve panel), SellShareModal (legacy)
  - **`/carteira`**: ReceiveModal, SendModal (address validation + MAX), WithdrawYieldModal, ManageConnectionModal
  - **`/reputacao`**: BondDetailModal (attestation count + on-chain path)
  - **`/insights`**: RecommendationModal (3 detail variants)
  - **`/lab`**: MemberInfoModal (per-member ledger drilldown)
  - All animated via framer-motion, body-scroll locked, Esc + click-outside close. Each one names the M3 Anchor instruction it'll wire to in production via a yellow `MODO DEMO` callout.
- **Session orchestrator** — `lib/session.tsx` drives a typed reducer over `{ user, events[] }`. Submitting a modal really mutates balance / score / yield. An ambient yield ticker fires every 35s so the dashboard reads as alive even while idle.
- **i18n PT/EN** — Every label, button, message, and the entire landing flip on a single toggle. 650+ keys per locale (~1,300 total) in `lib/i18n.tsx`.
- **BRL ↔ USDC currency toggle** — Source data is BRL; `fmtMoney(brl)` converts at runtime (`USDC_RATE = 5.5`).

### Brand & primitives

- **`RFILogoMark`** — pure SVG vector, gradient `#27D67B → #3BC6D9 → #1E90C9`. Same component drives the landing header, footer, and the `/icon.svg` favicon (both are vectorized — no raster fallbacks).
- **Brand kit** — `RFIPill` × 6 tones, `RFICard` × 4 accents, `MonoLabel`, 26 stroke-based icons in `components/brand/`.
- **Typography** — Syne (display, 400–800), DM Sans (body, 400–700), JetBrains Mono (numbers, 400–600). Loaded via `next/font/google` and exposed as CSS variables.

### Dev affordances

- **Tweaks panel** (bottom-right ✨ button, dev/preview only) — flip palette, page-transition mode, and quick-jump between routes. Hidden in production.
- **Typed mock data** — `data/{carteira,groups,score,market,insights}.ts` with full types so screens are self-contained until the on-chain indexer ships.

## Development Status

**186 PRs merged on `main` · all squash-merged via `claude/<scope>` branches with structured bodies + Claude session links.**

| Step                       | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Project analysis        | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2. Architecture spec       | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 3. Devnet environment      | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4. Smart contracts drafted | ✅ **~6,150 LoC across 20 `roundfi-core` instructions** (lifecycle: `create_pool`, `init_pool_vaults`, `join_pool`, `contribute`, `claim_payout`, `release_escrow`, `settle_default`, `escape_valve_list/buy`, `close_pool`; yield: `deposit_idle_to_yield`, `harvest_yield`; governance: `initialize_protocol`, `update_protocol_config`, `propose/cancel/commit/lock_treasury`, `pause`; dev: `ping`) + math modules + state types. **Validated end-to-end on devnet across M1, M2, M3** (see row 10). 1 protocol fix shipped during M3 (mpl-core owner-managed plugin re-approval after `TransferV1`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 5. Contract tests          | 🟢 **L1↔L2 economic-parity scaffold + 227 test cases across 20 spec files** covering lifecycle, edge cases (cycle boundaries, degenerate shapes, grace-period defaults, shield-1-only seizure), security (CPI, inputs, audit paths, economic invariants, lifecycle), reputation (guards, CPI, lifecycle), yield integration, parity, event encoding, **app-encoder structural parity (58 tests)** + **app-encoder bankrun round-trips (7 tests, 4 happy-path + 3 negative-path)**. Plus **6 cargo-fuzz targets** on `roundfi-math` (60s PR smoke + 30min weekly long-run). All passing under bankrun + the same IDL-free SDK encoders the front-end and indexer use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 6. Backend services        | 🟢 **SDK + indexer scaffold shipped, browser round-trip closed.** `@roundfi/sdk` ships **7 IDL-free TS action helpers** (`initializeProtocol`, `createPool`, `joinPool`, `contribute`, `claimPayout`, `settleDefault`, `closePool` in `actions.ts`) + **3 raw account decoders** (Pool, Member, Listing in `onchain-raw.ts`) + event encoders (`events.ts`) + PDA derivation helpers (`pda.ts`), consumed by both the front-end and the indexer. `services/indexer/` ships Fastify + Helius webhook + Prisma/Postgres schema (pools/members/attestations) + getProgramAccounts backfill. Round-trip proven end-to-end: PayInstallmentModal → SDK encoder → Phantom signs → devnet → Solscan tx [`37FZUtg7…wg6f`](https://solscan.io/tx/37FZUtg7SrNuf2AfkiXAJsLTDambYfGowqdtgcAk1tWrjFKJ4X5NDEkRGwKAgkBzBXR9gn7vLBXqwCP7WvA8wg6f?cluster=devnet); ClaimPayoutModal → tx [`LKickMQ1…SEv7Ym`](https://solscan.io/tx/LKickMQ1fUJ38zawrYUT9UdtsQpy8kVyUF3Q4onPtBqZFmm1EL4EEF5BNrGsfNRkM9vf6doRTG8W2rNmaSEv7Ym?cluster=devnet). Pending: reconciler that joins event rows → canonical pool/member rows + B2B score oracle endpoint + indexer running on a hosted cluster (post-hackathon).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7. Frontend                | ✅ Landing + 9 routes (`/home`, `/carteira`, `/grupos`, `/reputacao`, `/mercado`, `/insights`, `/lab`, `/admin` Demo Studio, `/demo`) + Phantom devnet flow + **17 functional modals** + Stress Lab L1 reference + Web3 aesthetic system + **6 Demo Studio presets** with deterministic clean-stage iteration (synthesizes implied payment history so /insights factors and Activity feed reflect persona, no residual state between preset loads)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 8. Integration             | 🟢 **End-to-end browser → SDK → devnet round-trip closed.** Phantom-signed `contribute()` + `claim_payout()` from PayInstallmentModal/ClaimPayoutModal route through `@roundfi/sdk` (IDL-free encoders) to devnet RPC and surface receipts in Solscan. The Receive (claim-payout) CTA covers all three group surfaces: FeaturedGroup, GroupRow, and `/grupos` GroupCard, plus the Demo Studio mock-mode path. /insights factors reactive to live session state (events + joinedGroups). Pending: indexer-backed reads (front-end reads on-chain directly today; B2B oracle endpoint and reconciler are post-hackathon).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9. Security audit          | 🟡 **Internal audit shipped** ([`docs/security/self-audit.md`](docs/security/self-audit.md)) covering threat model, asset/trust model, the **Triple Shield** invariants (seed-draw, GF solvency, D/C invariant) with file:line references, all 10 PDA seed conventions, per-instruction privilege table for all 20 ix, **53 security-specific bankrun test cases** mapped to each invariant (plus 58 app-encoder structural + 7 bankrun round-trips + 6 cargo-fuzz targets in layered coverage — see [audit-readiness.md](docs/security/audit-readiness.md) TL;DR), and the mpl-core `TransferV1` plugin-authority bug surfaced + fixed during M3 devnet exercising. Automated tooling (`cargo audit`, anchor build, parity tests) runs in CI. [`SECURITY.md`](SECURITY.md) published for responsible disclosure. **External third-party audit (Halborn/Ottersec/Sec3) + bug bounty deferred to mainnet migration phase** — out of hackathon scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 10. Devnet testing         | 🟢 **Full M3 protocol surface exercised on devnet** across **three pools** + Escape Valve + Pool 1 finalized via `close_pool` (balanced summary: total_contributed=$90 = total_paid_out=$90) + **Pool 3 settle_default with Triple Shield seizure on real funds**. Pool 1: 3-cycle ROSCA closed + EscrowLocked negative test + close_pool. Pool 2 (cycle_duration=3600s): ON-TIME contribs + Yield Cascade + positive release_escrow + escape_valve_list + escape_valve_buy. Pool 3 (cycle_duration=60s, GRACE_PERIOD=60s devnet patch): fresh wallet set joined, slot 2 fell behind ($5 < $10 installment), `claim_payout(0)` advanced the cycle, `settle_default(1)` drained the solidarity vault ($0.20) and **stopped at shield 1 because the D/C invariant already held** — `member.defaulted=true`, SCHEMA_DEFAULT attestation written, escrow + stake left intact. **Real mpl-core bug surfaced and fixed end-to-end**: TransferV1 resets owner-managed plugin authorities; fix re-approves them post-transfer. **4 Triple Shield guards captured firing on real funds** (`WaterfallUnderflow` ×2, `EscrowLocked`, **shield-1-only seizure**). **Browser-signed write loop closed end-to-end**: member-3 contributes via PayInstallmentModal → tx [`37FZUtg7…wg6f`](https://solscan.io/tx/37FZUtg7SrNuf2AfkiXAJsLTDambYfGowqdtgcAk1tWrjFKJ4X5NDEkRGwKAgkBzBXR9gn7vLBXqwCP7WvA8wg6f?cluster=devnet); member-4 receives via the new ClaimPayoutModal → tx [`LKickMQ1…SEv7Ym`](https://solscan.io/tx/LKickMQ1fUJ38zawrYUT9UdtsQpy8kVyUF3Q4onPtBqZFmm1EL4EEF5BNrGsfNRkM9vf6doRTG8W2rNmaSEv7Ym?cluster=devnet). The Receive (claim-payout) CTA also extends to **Demo Studio mock mode** + **`/grupos` GroupCard** so scenarios without a real wallet (Maria-as-recipient, etc.) drive the same modal through the session reducer — same protocol economics surfaced live (`PROGRESSO DE PAGAMENTO` + `TRIPLE SHIELD GARANTIA` UI panels). **Phase 3 indexer scaffold** also landed (Fastify + Helius webhook + Postgres event store via Prisma + getProgramAccounts backfill — wired against the same IDL-free SDK decoders the front-end uses). 10 Solana 3.x Box workarounds + 1 protocol fix shipped. See [`docs/devnet-deployment.md`](docs/devnet-deployment.md). |
| 11. Mainnet migration      | ⏳                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## On-chain Deployments

The post-deploy register lives at [`docs/devnet-deployment.md`](docs/devnet-deployment.md) — that's where program IDs, tx signatures, deployer keypair, and the verification checklist are recorded. The tables below mirror the headline IDs so reviewers can hop straight to Solscan from the README.

> **Status:** `_FILL_ME_` placeholders below are intentional — they get filled in the same commit as the actual deploy, so the register exists pre-deploy and the diff is auditable in one PR.

### Devnet (`?cluster=devnet`)

| Program                | Program ID                                     | Status                    | Solscan                                                                                        |
| ---------------------- | ---------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `roundfi-core`         | `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw` | ✅ deployed · 🔐 attested | [view](https://solscan.io/account/8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw?cluster=devnet) |
| `roundfi-reputation`   | `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2` | ✅ deployed · 🔐 attested | [view](https://solscan.io/account/Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2?cluster=devnet) |
| `roundfi-yield-kamino` | `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb` | ✅ deployed · 🔐 attested | [view](https://solscan.io/account/74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb?cluster=devnet) |
| `roundfi-yield-mock`   | `GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ` | ✅ deployed · 🔐 attested | [view](https://solscan.io/account/GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ?cluster=devnet) |

> **🔐 Reproducible build, attested on-chain.** Every byte at the program addresses above is bound to commit [`5f1673b`](https://github.com/alrimarleskovar/RoundFinancial/commit/5f1673bb65a300d2188a737e20f03c59c6f8b10e) of this repo via an OtterSec verify-build attestation PDA on devnet. Bytecode is reproducible from source: rebuilding inside the official `solanafoundation/solana-verifiable-build:1.18.26` Docker image produces a `.so` whose hash matches the deployed program account. Audit yourself in 30 seconds:
>
> ```bash
> solana-verify -u https://api.devnet.solana.com get-program-pda \
>   --program-id 8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw \
>   --signer 64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm
> ```
>
> Returns the bound `git_url` + `commit` + `executable_hash`. Compare against `solana-verify -u devnet get-program-hash <pid>` (deployed bytecode) and `solana-verify get-executable-hash target/deploy/<prog>.so` (your local rebuild) — all three match. Full flow including the Docker build + redeploy step: [`docs/verified-build.md`](docs/verified-build.md).
>
> The green "Verified Build" tile on Solscan is gated on OtterSec's remote build queue, which is mainnet-only by design — out of scope while RoundFi runs on devnet. The on-chain attestation here gives the same hash-binding guarantee, just CLI-checked instead of UI-rendered.

Initialize + seed txs:

- `initialize_protocol` → [`3gCY7M…fXNUz`](https://solscan.io/tx/3gCY7MpttUhiHejEgxA67FvkzEjrdRYZ99chcFDpbSKBrJAizZqkcuCVCgaC6ZHRCUrcvezGkhe3LN8uWUfrXNUz?cluster=devnet) · ProtocolConfig PDA = [`3c9MmoM…vJoTMV`](https://solscan.io/account/3c9MmoM8ZGQGCrKMFGvJcCtvD78jEPa2JZtLwTvJoTMV?cluster=devnet)
- `initialize_reputation` → [`59Sgz1…ALCn1`](https://solscan.io/tx/59Sgz1G59g2Q3usdk2qVxGVFcQSDU5RhAPSNypY5QJ8oqRRNBqq1VJbgBWh3ymVaBRLm1yJJE2bYYH3wP1PALCn1?cluster=devnet) · ReputationConfig PDA = [`7RDWsSDc…aXo4`](https://solscan.io/account/7RDWsSDcYYjn31E2dL2hbU3YQFFTvh2Wg8nxDsAXaXo4?cluster=devnet)
- `create_pool` → [`2Emh1s…E8urS`](https://solscan.io/tx/2Emh1snRJgSRsypcwSgZUe21Duw6pKrQk4e16NJQh3CLi9ehaQGQPnj1RJvEAyPu3icjmThM4ehnk55sn8GE8urS?cluster=devnet) · Pool PDA = [`5APoECXz…c8ooa`](https://solscan.io/account/5APoECXzJwr6j6xXGsqkT6GRSWNVDm4NSQB3KLhc8ooa?cluster=devnet) (demo, 3 members, $30 credit slot, 3 cycles)
- `init_pool_vaults` → [`zmnoex…umnx`](https://solscan.io/tx/zmnoexdEA8VVwLDNQJPVh8eVPdiLK5EThEAh7rbWiVJNrjQCzyCExXpmDtQL73DdUKm1vpmNd5pNWqeVo3iumnx?cluster=devnet) (4 USDC vault ATAs: pool/escrow/solidarity/yield)
- `join_pool` × 3 — Lv1 stakes ($15 each, 50% of credit) deposited to the escrow vault, Metaplex Core position NFTs minted with FreezeDelegate + TransferDelegate plugins:
  - Member 0 → [`4r2Pd9qv…ADc5`](https://solscan.io/account/4r2Pd9qvL5iDyh7689rTsXVrAYoocoSsoR4bLZJhADc5?cluster=devnet) · join tx [`2UrRDG…dnLD`](https://solscan.io/tx/2UrRDG9f6Dq8rZE3h1t5decBPrSV5gLacHBNhbKUvEBCyjQDuC5htJNbkVxuHwD5srPu7xT6F7AGB3bJpAoddnLD?cluster=devnet)
  - Member 1 → [`3Sr4M88H…eEnm`](https://solscan.io/account/3Sr4M88HDY3f1hnWJR7dznSvjCoRB4bTwGMDvAVNeEnm?cluster=devnet) · join tx [`3GJUTi…wU8k`](https://solscan.io/tx/3GJUTibE3LEn9zaJT7BdqpHKnKy8ZnPzysbYUEo6b3uxV8bbypmvAgcKtTNsGbhjfhfPzWejiaTGhkoAEvPSwU8k?cluster=devnet)
  - Member 2 → [`6ymEiWiA…cYiaa`](https://solscan.io/account/6ymEiWiAU6oJT4i5MisJDCZTSqtuvbfBKccVfdocYiaa?cluster=devnet) · join tx [`3L7dtn…ceYSJ`](https://solscan.io/tx/3L7dtnuaR4arvAjMuAFSofJpuSLunxz8ajWWRDbUw3d9wdgzgBPEA5x1a1yvZh6cikPVHieUkbvkNaooDqhceYSJ?cluster=devnet)
- `contribute` × 3 — cycle 0 fully paid; each $10 installment split across solidarity (1%) / escrow (25%) / pool float (74%); each call also init's a reputation `Attestation` PDA (`SCHEMA_LATE = 2`):
  - Member 0 cycle 0 → [`ysSSQJh…6HHW`](https://solscan.io/tx/ysSSQJhk8Frn87ng4dPGvePaNeLGeU45GHkNY75XPw7ACMymmFDUvHLEeyaRFkkWbogHHqXqAYasNVhp22o6HHW?cluster=devnet)
  - Member 1 cycle 0 → [`3MwScoes…cMYJ`](https://solscan.io/tx/3MwScoes8KrzqWy3QUUeEhqmejKfN44kTXzkY41rYZqfoLFiEKK9yT2m3cQjh27FjJrCbDeHd8AoTSy4JAGicMYJ?cluster=devnet)
  - Member 2 cycle 0 → [`yTVakGw…iDT`](https://solscan.io/tx/yTVakGwDwvWUEXYpzCBuvW2t9D2XWsyLwr1eJN8weWgPGqcuhqHRyN7Vx871f3xHXVgVc6z41EW899bYT9x1iDT?cluster=devnet)
- `claim_payout` cycle 0 / slot 0 — Pool PDA signs $30 USDC transfer to member 0, `pool.current_cycle` advances 0 → 1, `Member.paid_out=true`, `SCHEMA_CYCLE_COMPLETE` attestation minted:
  - Pool float top-up [`4dEaTvFr…pKpe8`](https://solscan.io/tx/4dEaTvFrHnztJoK9GwM2E7rqnDFtxUSEgtc8iq4xoU1LGCNEGc97kUkAJQSuxJzXWFkwoye7Bq93YrjC2H7pKpe8?cluster=devnet) — deployer adds $7.80 USDC to `pool_usdc_vault` (proxy for the Yield Cascade LP-distribution flow that bridges this gap in production)
  - Claim tx [`5fx4VLEt…qpab`](https://solscan.io/tx/5fx4VLEtgbVuXDrXs9rCcAmJarJx6UWWYoeVonQXLQ7JqC5HnMYTNqKNSzjKiroL8s6ZH1UpxpQBmETFKZxpqpab?cluster=devnet) — member 0 USDC ATA: 15 → 45 (+$30 received)
- `contribute` cycle 1 × 3 — same split, member balances rolled forward; new SCHEMA_LATE attestations:
  - Member 0 cycle 1 → [`3hqMZGB…JGBdB`](https://solscan.io/tx/3hqMZGBH4eosuuJ38PewMs1WMu8maUTuW6PP1a1qP1pE6aJzxHHJgPPtMorJtsYnzJ7WA83LsWoQjTHu7gBJGBdB?cluster=devnet)
  - Member 1 cycle 1 → [`CFt7rHW…BeY9G`](https://solscan.io/tx/CFt7rHWnHY5AqMWCLPs9Rg3dgyjs8BYwUM4dRKm5yaUyPZARcygucnsa2f2EmdRvbgQ9xF49v5b52tfRgJBeY9G?cluster=devnet)
  - Member 2 cycle 1 → [`P3iaunv…sGRmM`](https://solscan.io/tx/P3iaunviiq5QXMiuochuorRApukMsk1TK3RUaCeftQ2TVkDN452phWxVkR4wmhtwuXWZXQEKqSsnkKu8WpsGRmM?cluster=devnet)
- `claim_payout` cycle 1 / slot 1 — member 1 receives $30, `pool.current_cycle` advances 1 → 2:
  - Top-up [`HwC3ZGd…gWgD`](https://solscan.io/tx/HwC3ZGd18Ss2HehP5STSaXZD8GDtS86tK4DyYiYQUUVAom8kWpYXNKHNfMFWhoJVignuEXHFeVeSf2goYC7gWgD?cluster=devnet) · Claim tx [`4KEmjib…ye1o`](https://solscan.io/tx/4KEmjibkqrTRxkcPQzP36qALiaRZqJXsr7EHMZqxnWyWQBWKTsBauivRxAUswBqboXyQc1v1kcorQeVZfBCyye1o?cluster=devnet) — member 1 USDC ATA: 5 → 35
- `contribute` cycle 2 × 3 — final cycle's contributions:
  - Member 0 cycle 2 → [`4T1W7cB…61mJ8`](https://solscan.io/tx/4T1W7cBwJ8xV77dUK99qhgqB4fuadkaJa8yLcFUcavKchgHpwexvpseRgmygn6PtEFxd1tJfDPT1ERni5uz61mJ8?cluster=devnet)
  - Member 1 cycle 2 → [`5PHr9Qn…sfsQ`](https://solscan.io/tx/5PHr9Qn8daHWHXqW97YnrfP3J7Z123TdcxL8nGQU9g2V1dDN2t79FJnJHwp5n95mDUkTTz4F6gDy7kbhG2sxsfsQ?cluster=devnet)
  - Member 2 cycle 2 → [`3AQ3jxv…6VvQj`](https://solscan.io/tx/3AQ3jxvUA8Mf6JGDdU71NuMqQuZdsAyikpoGzwjfdHwcJANhzo2Au3oxtgdSRDCBNDuhahWi8hg7WQXXKPq6VvQj?cluster=devnet)
- `claim_payout` cycle 2 / slot 2 — member 2 receives $30, **`pool.status = Completed`**:
  - Top-up [`4MgZk1C…kZJHH`](https://solscan.io/tx/4MgZk1C1ToenQ9pgDtURnh8iefGvzr2bZ6ACXayPCdjZjZbEzzzQqAbpJkE13xNDtPxNu9fupEJgQdjkUwjkZJHH?cluster=devnet) · Claim tx [`4bjda3t…Kfwc`](https://solscan.io/tx/4bjda3tX5p1tqQkRFKDnX2NbEGKqUqAadRiEE8LdTGStNmJCsnwHbxDop1Z5cJzpyT1XuhAtjV6ytXZm9gmMKfwc?cluster=devnet) — member 2 USDC ATA: 15 → 45

- `release_escrow` negative test (member 0, checkpoint 1) — **failed on-chain with `EscrowLocked` code 6011** because `member.on_time_count (0) < args.checkpoint (1)`. The protocol refused to release the legitimate $22.50 escrow balance because all contributions had been LATE. Durable on-chain enforcement evidence:
  - Failed tx [`4wB8RqiP…f5Mn`](https://solscan.io/tx/4wB8RqiP57qQMNi6Vs6yLckkurm1pzqv2zoGev4duyaPWvCJoMdZEynfHTCjfitrGXenbUbsPRjdZG1xTZY8f5Mn?cluster=devnet) — log: `AnchorError ... release_escrow.rs:91. Error Code: EscrowLocked. Error Number: 6011`

> **Full ROSCA closed end-to-end on devnet, plus Triple Shield enforcement verified.** Protocol init → pool create → vault inits → 3 members joined with USDC stakes + position NFTs → 9 contributions across 3 cycles → 3 payouts (slots 0 → 1 → 2) → **`Pool.status = Completed`** → 12 reputation attestations on-chain → **2 deterministic guards captured firing** (`WaterfallUnderflow` if pool float can't cover credit; `EscrowLocked` if member paid late). See [`docs/status.md`](docs/status.md) and [`docs/devnet-deployment.md`](docs/devnet-deployment.md).

### Pool 2 — yield + positive release (`?cluster=devnet`)

Pool 2 (`8XZxRSqU…twbujm`, `cycle_duration = 3600s`) was driven specifically to exercise the M3 instructions that pool 1's late-paying lifecycle skipped: **`deposit_idle_to_yield` + `harvest_yield`** (the full PDF-canonical Yield Cascade) and the **positive-path `release_escrow`** (vesting math returns stake to a member who paid on-time).

- `deposit_idle_to_yield` × 2 + pre-fund — 10 USDC moved from pool float to yield_mock vault, plus a 0.5 USDC pre-fund to simulate accrued APY:
  - Last deposit [`3gAbmM48…U3kp`](https://solscan.io/tx/3gAbmM48vEQRRwk39oTeRET4mGD2jFrx8xRiDnAfQNxr7zn5TZbExgCM1BFPnEmEr78p7xCZy74brWRstKnyU3kp?cluster=devnet) · pre-fund [`26DN91xo…3gf2`](https://solscan.io/tx/26DN91xosAcKJKWafQY91rSEqCCjvKRc4zF1sP3iGCnRmPCZGbGTSHaNkq7AhvwesGuQqHxYmb5QZoKfoHvy3gf2?cluster=devnet)
- `harvest_yield` — realized 0.5 USDC, full waterfall (protocol fee 20% → treasury, GF/LP/participants logical earmarks accrued):
  - [`U1vK5GXM…sdmq`](https://solscan.io/tx/U1vK5GXMMWRhiuSEQ3ByfKDeHuBNrk6EVciC3CYRZaX4YPWTYFzBipsjBZbV4CVARjyPte47V1AcpgE33u1sdmq?cluster=devnet) · pool float +0.4, treasury +0.1
- `release_escrow` POSITIVE — member 0 received 5 USDC of vested stake (`stake_deposited / cycles_total = $15 / 3`):
  - [`5BvLSatc…HVQm`](https://solscan.io/tx/5BvLSatc9gbmaRJLjJnP9YLhHEHcCFN2thfZ5wZAL9kGjL4mkUSAL89jcszbwKLgd7rFFg5dZnpycTZVWxFcHVQm?cluster=devnet) · `escrow_balance: 17.50 → 12.50`, `last_released_checkpoint: 0 → 1`, `member ATA: 0 → 5 USDC`

### Pool 2 — Escape Valve secondary market

The protocol's differentiator vs WeTrust / RociFi: distressed members can sell their position to a buyer who picks up the obligations, instead of defaulting and triggering Triple Shield seizure.

- **List**: member 1 (slot 1) listed at $14 USDC (slight discount vs $15 stake) [`4aFv9zbC…tzDu`](https://solscan.io/tx/4aFv9zbCB6ut82TaMEsXL9pt1ASkRTywGgfgiNGvSQUo4RJ9d1qtAJsPBmnV4upNqWfWM3Sr5sbmNT2mJG3jtzDu?cluster=devnet) · listing PDA [`5sQBMvMY…oMB5A`](https://solscan.io/account/5sQBMvMYU1iqHMz7rvNSjEdvtqohLZqmTmDxyEHoMB5A?cluster=devnet)
- **Bug surfaced + fixed in flight**: first buy attempt reverted with mpl-core `0x1a` because `TransferV1` resets owner-managed plugin authorities (FreezeDelegate / TransferDelegate). Bankrun harness only had defense-in-depth `AssetNotRefrozen` guards; the positive flow had never run on real mpl-core. **Fix shipped**: re-approve both plugins back to `position_authority` post-transfer. Core upgrade [`2RSZQLtq…36tQ`](https://solscan.io/tx/2RSZQLtqd8eepfz4kHGcDcupWCv7fbVvxKH4PTQWPST7B2QXN6zhCbQoSWrtSnZwVuAML8BEhZgVaE6uMeTX36tQ?cluster=devnet)
- **Buy POSITIVE**: a fresh buyer wallet picked up the listing. $14 USDC buyer→seller, atomic re-anchor closed the old Member PDA + minted a new one at the buyer's key (all bookkeeping carried over), NFT thawed/transferred/re-delegated/re-frozen under `position_authority`, listing closed. Buy tx [`3cdG3bWR…cgCpr`](https://solscan.io/tx/3cdG3bWRmgMShw5vCQREY6tJ9HQh3VzW42GN55vdR7ZLPuBgrZhow3wGkPv97A9CTmP2VkVifVgnPTeHebGcgCpr?cluster=devnet) · new Member PDA [`Am3iA2sd…oxQF`](https://solscan.io/account/Am3iA2sddUE7sWyYuzuTkV8Da9ZjZj9NhxR5w3PKoxQF?cluster=devnet)

### Pool 3 — `settle_default` + Triple Shield seizure (`?cluster=devnet`)

Pool 3 (`D9PS7Q…pDE5`, `cycle_duration=60s`) was provisioned with a **fresh wallet set** (`MEMBER_INDEX_OFFSET=3` → `member-3/4/5`) so neither Pool 1 nor Pool 2's existing `SCHEMA_CYCLE_COMPLETE` attestations interfered with the default flow's `SCHEMA_DEFAULT` (id=3) write. Combined with the devnet-only `GRACE_PERIOD_SECS=60` patch (was 7d in production), the grace-elapsed precondition was reachable in a single test run.

- `contribute` cycle 0 — slots 0+1 paid LATE (`now > pool.next_cycle_at + 60s`), slot 2 was **SKIPPED** by `seed-cycle.ts` pre-flight ATA balance check ($5 < $10 installment) so member-5 became the deliberate defaulter:
  - Member-3 cycle 0 → [`HWeuu9J8…61WEy`](https://solscan.io/tx/HWeuu9J8uK2HgVeMCD4bEBiYCGdGfUTvapuFEXEDp8iGbqhVDeLDDdeF6hXDYRnZej14guUg8Hqv3Nw6gj61WEy?cluster=devnet)
  - Member-4 cycle 0 → [`5YhGNfHY…g3auz`](https://solscan.io/tx/5YhGNfHY4FDsjq9tbSLe2pLtSvSysQV78XZALPbNXuY9xZSurdHviWnjs3MBRau4SKpsX1cjafD4UyHKFFeg3auz?cluster=devnet)
- `claim_payout` cycle 0 / slot 0 — deployer floated $15.20 to cover slot-2's missing contribution; member-3 received $30; `pool.current_cycle` advances 0 → 1:
  - Top-up [`532qSPCE…xAMsD`](https://solscan.io/tx/532qSPCEBwgYLgjbmraZ4PotYM2H9N3qo6w9KW8yG6d2WBfZZjH6Vudpj4x7oRaVSH88qevSffWG2VxMrnBxAMsD?cluster=devnet) · Claim tx [`4DEb5AQo…re7GD`](https://solscan.io/tx/4DEb5AQob2h7t2VjKS8bzdqTT5aQjbr7EoAePs9arDW66yfwKyth4JEiWwDUTiTvrjYs38D21bwuQSyHQnere7GD?cluster=devnet)
- **`settle_default(1)` slot 2 — Triple Shield waterfall fired**: drained $0.20 from solidarity vault, **stopped at shield 1** because the D/C invariant already held (`c_after $30 ≥ d_rem $30`), `member.defaulted=true`, SCHEMA_DEFAULT attestation written, escrow + stake left intact.
  - Settle tx [`34UyAtEP…NeJeG`](https://solscan.io/tx/34UyAtEPH5iWXrzhMGLRJVYzt2Z314f4S9DbwmfXA8bfS3SKahgEYkTgFz6KGuX441ktPVVnEvLk19fuVAkNeJeG?cluster=devnet) · Member-2 PDA (now `defaulted=true`) [`GqzmPkW7…SqfHQ`](https://solscan.io/account/GqzmPkW73QaoSZAmg481btfPkgY7jgncPekf2aUSqfHQ?cluster=devnet)

On-chain `msg!` summary captured verbatim:

```
roundfi-core: settle_default cycle=1 member=4sLSCzCJnZFMtaLD6vQsgZ4ywAwYa6joExK9dcM2HvKq
  seized_total = 200_000   (= $0.20)
  solidarity   = 200_000   (= $0.20)   ← drained
  escrow       = 0                       ← intact
  stake        = 0                       ← intact
  d_rem = c_init = c_after = 30_000_000  (= $30 = pool.credit_amount)
```

This is the first capture of the **shield-1-only quadrant** on real funds. The opposite extreme — installment > stake_initial + escrow_so_far — would force shields 2+3 to fire and is covered by bankrun's `tests/security_default.spec.ts`.

> **Full M3 protocol surface exercised on-chain across three pools, plus the first browser-signed write loop end-to-end.** Across pool 1 (negative paths + claims + close_pool), pool 2 (yield + positive release + Escape Valve), and pool 3 (settle_default + Triple Shield seizure + browser contribute + browser claim_payout), every active M3 instruction now has a real on-chain receipt: `create_pool`, `init_pool_vaults`, `join_pool`, `contribute`, `claim_payout`, `release_escrow`, `deposit_idle_to_yield`, `harvest_yield`, `escape_valve_list`, `escape_valve_buy`, `close_pool`, **`settle_default`**, plus `roundfi_yield_mock.init_vault`. **4 Triple Shield guards captured firing on real funds** (`WaterfallUnderflow` ×2, `EscrowLocked`, **shield-1-only seizure**). **Browser-signed `contribute()` + `claim_payout()`** (Phantom → IDL-free encoders → devnet) close the wiring loop — txs [`37FZUtg7…wg6f`](https://solscan.io/tx/37FZUtg7SrNuf2AfkiXAJsLTDambYfGowqdtgcAk1tWrjFKJ4X5NDEkRGwKAgkBzBXR9gn7vLBXqwCP7WvA8wg6f?cluster=devnet) (pay) + [`LKickMQ1…SEv7Ym`](https://solscan.io/tx/LKickMQ1fUJ38zawrYUT9UdtsQpy8kVyUF3Q4onPtBqZFmm1EL4EEF5BNrGsfNRkM9vf6doRTG8W2rNmaSEv7Ym?cluster=devnet) (receive). **An mpl-core owner-managed plugin gotcha** (a real production-relevant issue bankrun missed) was surfaced and fixed end-to-end on devnet. **Pool 1's close_pool emitted a balanced summary log** (total_contributed=$90, total_paid_out=$90) — the lifecycle invariant for a completed ROSCA holds. 16 reputation `Attestation` PDAs on-chain (13 cycle + 1 SCHEMA_DEFAULT + 1 SCHEMA_LATE from browser contribute + 1 SCHEMA_CYCLE_COMPLETE from browser claim). 10 Solana 3.x Box workarounds + 1 protocol fix shipped this milestone.

### App ↔ chain wiring foundation

The front-end's read path is now wired against the deployed pools (foundation on branch [`claude/m3-app-wiring-foundation`](https://github.com/alrimarleskovar/RoundFinancial/tree/claude/m3-app-wiring-foundation)):

- **IDL-free pool + member decoders** in [`sdk/src/onchain-raw.ts`](sdk/src/onchain-raw.ts) (Anchor's IDL gen is broken on Rust 1.95+; we replicate the offsets from `pool.rs` / `member.rs` byte-for-byte). React hooks `usePool(seedKey)` and `usePoolMembers(seedKey)` poll every 30s.
- **`/home` lights up live** — the **FeaturedGroup** card overrides its mock counters with real Pool 2 state (members joined / cycle / installment / credit) when devnet RPC responds, plus a "ROSTER" chip row beneath the avatars showing the three real wallets with slot tags + on-time / contributions tooltips + red border on `defaulted=true`. A new **`<DevnetPoolStatus />`** row shows all 3 deployed pools side-by-side with status badge + live counters + Solscan links per card.
- **`/grupos`** — the catalog now opts cards into an "on-chain · devnet" pill (linked to Solscan) via an optional `devnetPool` field on the fixture. `g1` is tagged → pool 3. When a fixture is also flagged `contemplated: true` (Demo Studio scenarios), the GroupCard's primary CTA flips to a purple-teal **"Receber R$ X"** button (literal PT UI label rendered by the app's i18n layer when PT locale is active).
- **Three IDL-free write encoders** all under `app/src/lib/`:
  - [`contribute.ts`](app/src/lib/contribute.ts) — discriminator `522144832000cd5f`, 18 accounts (validated end-to-end on devnet)
  - [`claim-payout.ts`](app/src/lib/claim-payout.ts) — discriminator `7ff0843ee3c69285`, 14 accounts (validated end-to-end on devnet)
  - [`escape-valve-buy.ts`](app/src/lib/escape-valve-buy.ts) — discriminator `c48acf6a712d9c54`, 15 accounts + 5 mpl-core CPIs at 600k CU (encoder shipped, UI wire deferred)
- **PayInstallmentModal + ClaimPayoutModal** auto-detect on-chain mode when the connected wallet is a materialized member of the target pool, swap the mock 1500ms timeout for a real `wallet.sendTransaction`, render tx hash + Solscan link on success. Both modals surface the **protocol economics inline**: a **Payment Progress** grid (installments paid / remaining / outstanding debt — labeled `PROGRESSO DE PAGAMENTO` in the PT UI) + a **Triple Shield Collateral** grid (stake locked + escrow accumulated + total collateral — labeled `TRIPLE SHIELD GARANTIA` in the PT UI) so the demo answers the natural "is the user really receiving 100% of credit_amount upfront, regardless of level / installments paid?" question on screen.
- **Demo Studio + `/grupos` mock-mode CTA** — the same `ClaimPayoutModal` is now dual-mode. Chain mode fires the real `claim_payout` tx; mock mode (when memberRecord/pool/seedKey props are omitted) drives the `session.claimPayoutMock` reducer for Demo Studio scenarios where the contemplated user has no on-chain wallet match. Same UX, same protocol disclosure, different ingress.

Read paths degrade gracefully (`status="fallback"` → muted "rpc unavailable" line) and the write path falls back to the mock confirm when pre-conditions don't hold, so the localhost demo / unconnected-wallet flow stays unchanged.

> **Write loop validated end-to-end on devnet (2026-05-07).** TWO browser-signed txs, opposite sides of the ROSCA cycle:
>
> - **Pay** — Member-3 imported into Phantom, connected on `/home`, FeaturedGroup flipped to ON-CHAIN · DEVNET reading Pool 3 live, `PayInstallmentModal` showed the green ON-CHAIN banner, user signed in Phantom, the IDL-free encoder dispatched `contribute(cycle=1, schemaId=SCHEMA_LATE)` and the program landed it cleanly. Tx [`37FZUtg7…wg6f`](https://solscan.io/tx/37FZUtg7SrNuf2AfkiXAJsLTDambYfGowqdtgcAk1tWrjFKJ4X5NDEkRGwKAgkBzBXR9gn7vLBXqwCP7WvA8wg6f?cluster=devnet) — first browser-signed `contribute()` in RoundFi history. Member-3's USDC ATA dropped 45 → 35.
> - **Receive** — Member-4 imported via the new `pnpm devnet:export-pk` helper, connected on `/home`. FeaturedGroup detected `member.slot_index == pool.current_cycle == 1` and surfaced the new purple-teal claim-payout CTA (rendered as `"Receber R$ 165"` under PT locale) next to the pay-installment CTA (`"Pagar parcela"`). Click → `ClaimPayoutModal` showed the ON-CHAIN banner with `claim_payout(cycle=1)` + four-bullet state transition preview. First attempt reverted with `WaterfallUnderflow` (pool float $7.60 < credit_amount $30) — **the protocol's solvency guard working as designed, captured live**. The new `pnpm devnet:seed-topup` companion script computed the gap (`credit − spendable + cushion`) and bridged it from the deployer (tx [`3iFuuEwP…s9VQ`](https://solscan.io/tx/3iFuuEwPnBzYpkqdEzGCvRMu1FTyhfS7bcajmrTsyS2bysX3drP8dLGeV7ZLPwUt6MpyqssA6CuribfdB84as9VQ?cluster=devnet)). Retry landed claim_payout tx [`LKickMQ1…SEv7Ym`](https://solscan.io/tx/LKickMQ1fUJ38zawrYUT9UdtsQpy8kVyUF3Q4onPtBqZFmm1EL4EEF5BNrGsfNRkM9vf6doRTG8W2rNmaSEv7Ym?cluster=devnet). Member-4's USDC ATA: 35 → 65, `pool.current_cycle` 1 → 2, `member.paid_out=true`, `SCHEMA_CYCLE_COMPLETE` attestation written.
>
> Both write paths use the same byte-for-byte IDL-free encoder methodology (precomputed Anchor discriminator + manual account list mirroring the program's `<Accounts>` declaration). The remaining `escape_valve_buy` encoder (also shipped in this PR) inherits the same confidence even before its own end-to-end run.

### Mainnet (smoke deploy — presence only, **not** initialized for live users)

The Mainnet IDs below validate the CD pipeline against real-cluster conditions and give reviewers a clickable Mainnet Solscan link as evidence of execution. The protocol is **not** initialized; production launch is gated behind the Phase 3 milestone in [`docs/status.md`](docs/status.md). Procedure: [`docs/devnet-deployment.md` §8](docs/devnet-deployment.md#8--mainnet-smoke-deploy).

| Program                | Program ID  | Solscan                                      |
| ---------------------- | ----------- | -------------------------------------------- |
| `roundfi-core`         | `_FILL_ME_` | [view](https://solscan.io/account/_FILL_ME_) |
| `roundfi-reputation`   | `_FILL_ME_` | [view](https://solscan.io/account/_FILL_ME_) |
| `roundfi-yield-mock`   | `_FILL_ME_` | [view](https://solscan.io/account/_FILL_ME_) |
| `roundfi-yield-kamino` | `_FILL_ME_` | [view](https://solscan.io/account/_FILL_ME_) |

Deploy tx (any of the four uploads): `_FILL_ME_` ([view](https://solscan.io/tx/_FILL_ME_))

## Stack

| Layer           | Tech                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Smart contracts | Rust + Anchor 0.30                                                                                                                                                                                                                                                                                                                                                                                     |
| Tests           | `anchor test` + `solana-bankrun`                                                                                                                                                                                                                                                                                                                                                                       |
| NFTs            | Metaplex Core                                                                                                                                                                                                                                                                                                                                                                                          |
| NFT metadata    | Client-supplied URI today (`https://` / `ipfs://` / `ar://` accepted); Arweave-via-Irys upload pipeline planned post-mainnet — `IRYS_NODE_URL` already wired in [`config/clusters.ts`](config/clusters.ts)                                                                                                                                                                                             |
| Attestations    | In-house SAS-compatible module (Devnet) → official SAS (Mainnet)                                                                                                                                                                                                                                                                                                                                       |
| Yield           | Mock adapter (Devnet) → Kamino CPI (Mainnet). `roundfi-yield-kamino::deposit()` does a real `deposit_reserve_liquidity` CPI on Kamino Lend mainnet program; `harvest()` ships in next milestone (park-only mode until then).                                                                                                                                                                           |
| Stablecoin      | USDC                                                                                                                                                                                                                                                                                                                                                                                                   |
| Backend         | Node.js + TypeScript + Fastify + Prisma + PostgreSQL — **indexer scaffold landed in M3** (`services/indexer/`: webhook handler + IDL-free Anchor log decoder + getProgramAccounts backfill against the same SDK helpers the front-end uses); see [`services/indexer/README.md`](services/indexer/README.md) for run instructions and [`docs/architecture.md`](docs/architecture.md#indexer) for design |
| Frontend        | Next.js 14 + React 18 + framer-motion 11 + Tailwind 3 (landing) + @solana/wallet-adapter + @coral-xyz/anchor                                                                                                                                                                                                                                                                                           |
| Cluster         | Devnet → Mainnet (env-driven)                                                                                                                                                                                                                                                                                                                                                                          |

## Quick Start

### Run the front-end (no on-chain deploy needed)

```bash
git clone https://github.com/alrimarleskovar/RoundFinancial.git
cd RoundFinancial
pnpm install
pnpm --filter @roundfi/app dev
# -> http://localhost:3000/
```

To use the live wallet flow on devnet, install Phantom and switch its network to Devnet before clicking "Connect Wallet".

### Deploy programs to devnet

See [`docs/devnet-setup.md`](docs/devnet-setup.md) for the full walkthrough. Short version (WSL2 / Linux / macOS):

```bash
cp .env.example .env
solana config set --url https://api.devnet.solana.com
mkdir -p keypairs && solana-keygen new -o keypairs/deployer.json
export ANCHOR_WALLET=$(pwd)/keypairs/deployer.json

pnpm run devnet:airdrop           # 2 SOL (repeat as needed)
pnpm run devnet:deploy            # build → keys sync → build → deploy
# copy the printed IDs into .env
```

All 20 `roundfi-core` instructions are deployed and exercised on devnet (see [On-chain Deployments](#on-chain-deployments)). The `ping` dev-only smoke instruction stays in the program as a quick connectivity check.

### Deploy the front-end (Vercel)

The repo ships an `app/vercel.json` so the deploy works with one tweak in the dashboard:

1. Sign in at [vercel.com](https://vercel.com) → **Add New** → **Project** → import `alrimarleskovar/RoundFinancial`.
2. **Set Root Directory to `app`** (this is the only manual step — Vercel needs to find `next` in `app/package.json`, not the workspace root).
3. Leave everything else at the default. Vercel reads `app/vercel.json` and:
   - Runs `cd .. && pnpm install --frozen-lockfile` so the **pnpm workspace resolves** (`@roundfi/sdk`, `@roundfi/orchestrator`).
   - Builds the app: `pnpm build` inside `app/`.
   - Auto-detects Next.js inside `app/` and applies all framework optimizations.
4. Click **Deploy**. ~2 minutes.

No env vars required for the public landing — wallet adapter handles its own RPC defaults (devnet). For browser-signed write paths against devnet (now live), the deploy uses:

- `NEXT_PUBLIC_SOLANA_RPC_URL` (Helius / public devnet)
- `NEXT_PUBLIC_ROUNDFI_CORE_PROGRAM_ID`
- `NEXT_PUBLIC_ROUNDFI_REPUTATION_PROGRAM_ID`

The `ignoreCommand` in `app/vercel.json` skips rebuilds when only docs/grant/programs/tests change — saves build minutes on doc-only PRs.

## License

**Apache-2.0** — full text in [`LICENSE`](./LICENSE). Covers the four Anchor programs (`programs/roundfi-core`, `roundfi-reputation`, `roundfi-yield-mock`, `roundfi-yield-kamino`), the IDL-free SDK (`sdk/`), and the Next.js app (`app/`). Reputation scoring methodology is documented openly in [`docs/en/04-behavioral-reputation-score.pdf`](./docs/en/04-behavioral-reputation-score.pdf) so any third party can audit how the score is generated. A future hosted B2B scoring service (Phase 3) may ship under a separate license; not yet released.

## Links

- **Repo:** https://github.com/alrimarleskovar/RoundFinancial
- **Hackathon:** Colosseum 2026
