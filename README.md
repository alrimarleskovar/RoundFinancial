# RoundFi

> **Behavioral-credit infrastructure for Solana.** RoundFi runs on-chain ROSCAs as a **data-acquisition engine**: every paid installment mints an on-chain attestation that builds a portable credit identity. The ROSCA is the bait; the **behavioral score** is the product. Endgame: a high-margin B2B oracle that neobanks and DeFi protocols subscribe to before lending — _the Serasa of Web3_.

<p>
  <a href="https://github.com/alrimarleskovar/RoundFinancial/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/alrimarleskovar/RoundFinancial/actions/workflows/ci.yml/badge.svg?branch=main"/></a>
  <a href="https://roundfinancial.vercel.app"><img alt="Live demo" src="https://img.shields.io/badge/Live_demo-roundfinancial.vercel.app-14F195?style=for-the-badge&logo=vercel&logoColor=06090F"/></a>
  <a href="https://github.com/alrimarleskovar/RoundFinancial/pulls?q=is%3Apr+is%3Amerged"><img alt="PRs merged" src="https://img.shields.io/badge/PRs_merged-125+-9945FF?style=for-the-badge&logo=github&logoColor=white"/></a>
</p>

<p>
  <a href="https://roundfinancial.vercel.app">🚀 Live demo</a> ·
  <a href="docs/status.md">📋 Status (shipped vs roadmap)</a> ·
  <a href="docs/pitch/pitch-3min-en.html">📊 3-min Pitch (EN)</a> ·
  <a href="docs/pitch/pitch-3min.html">📊 3-min Pitch (PT)</a> ·
  <a href="docs/pitch/pitch-deck-en.html">📊 Long-form Deck (EN)</a> ·
  <a href="docs/architecture.md">🧱 Architecture</a> ·
  <a href="grant/">📦 Grant bundle</a>
</p>

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
- **Score is SAS-compatible from the first attestation.** Every paid installment mints against the Solana Attestation Service schema, so the score reads from any wallet, any protocol — Web3-native portability instead of vendor lock-in. RociFi's score died with RociFi.
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
- **Yield Waterfall (Kamino, 5–8% APY):** Protocol → Guarantee Fund → LP Angels → Participants.
- **Escape Valve:** positions are dynamic NFTs. Distressed users sell instead of defaulting.
- **Behavioral oracle:** every payment is an on-chain attestation (SAS-compatible) — a portable credit identity, the _"Serasa of Web3"_.

## Stress Lab (L1 reference impl)

The protocol's economic spec is encoded in a **pure-TypeScript actuarial simulator** that runs every Triple-Shield rule end-to-end. Lives in [`sdk/src/stressLab.ts`](sdk/src/stressLab.ts) and ships the [`/lab`](app/src/app/lab/page.tsx) interactive route. Used as:

- **Reference implementation** for the on-chain Anchor programs (M2 of the grant roadmap parity-tests against `runSimulation()` outputs).
- **Whitepaper-faithful playground** — pick credit/members/tier/maturity/APY and watch the matrix unfold. 4 canonical presets (Healthy / Pre-default / Post-default / Cascade) load with one click.
- **Audit panel** with full capital-structure breakdown: float + Solidarity Vault + Guarantee Fund (capped at 150% of credit) − outstanding escrow − outstanding stake refund = **Net Solvency**. Plus the 4-tier yield waterfall (admin fee → GF → 65% LPs → 35% participants).

**33 L1 tests green** under `pnpm run test:economic-parity-l1` covering: input refactor (credit-amount as primary), toggleCell click semantics, escrow gating on default month, stake cashback phase, net-solvency identity, capital structure invariants, mature-group acceleration (5/4/3 → 3/2/1), Escape Valve `"E"` cell architecture, and the 4-tier waterfall split.

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
│   ├── economic_parity.spec.ts                 # L1 ↔ L2 economic parity (33 tests passing)
│   └── *.spec.ts                               # 14 lifecycle / edge / security drafts (M1 of grant)
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

A complete Next.js 14 + TypeScript app with **a public landing + 8 dashboard routes** (`/home`, `/carteira`, `/grupos`, `/reputacao`, `/mercado`, `/insights`, `/lab`, `/demo`), real Solana wallet integration (devnet), session-orchestrated state, and a Web3-native aesthetic system (Neon palette, glassmorphism, animated counters, terminal-style activity log).

> **🚀 Try it now:** [roundfinancial.vercel.app](https://roundfinancial.vercel.app) — every push to `main` auto-deploys; PRs get preview URLs.

Run locally:

```bash
pnpm install
pnpm --filter @roundfi/app dev
# -> http://localhost:3000/
```

### Routes

| Route            | What's there                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/`**          | Public landing — animated gradient title + PT/EN toggle + interactive simulator + comparison table + **CoFi paradigm** + **6-card Security grid** + 5-Q **FAQ accordion** + **Waitlist form** + scrolling tx-id "data stream" behind the hero. Connect Phantom CTAs redirect to `/home`.                                                  |
| **`/home`**      | Bento dashboard — clickable KPI cards (Saldo/Yield → `/carteira`, Colateral → `/insights`) + featured round with **CTAs** (Pagar parcela / Ver no catálogo) + clickable group rows (open `PayInstallmentModal`) + radial **SAS Passport ring** + Triplo Escudo + live **Activity feed**.                                                  |
| **`/carteira`**  | 4 tabs · **5 wired modals**: Receber (QR + copy address), Enviar (base58 validation + MAX), Sacar (Kamino yield withdraw), Gerenciar (per-connection inspector). PhantomFaucet (1-SOL airdrop + hosted fallback + Circle USDC). DEMO badges on Civic/Kamino/Solflare/PIX mocks. WalletChip airdrop has inline pill feedback.              |
| **`/grupos`**    | ROSCA catalog with search + 5 multi-facet filters + **level gating in 3 layers** (locked card visual + locked-state modal + defensive `joinGroup()` guard). `+ Novo ciclo` opens `NewCycleModal` (eligible if Lv.3, locked otherwise).                                                                                                    |
| **`/reputacao`** | SAS passport — **click-to-copy wallet** + radial score + 50/30/10 ladder with **level-up bridge** to `/insights` + 4 SAS bonds opening `BondDetailModal` (attestation count, on-chain path, demo callout).                                                                                                                                |
| **`/mercado`**   | Buy + Sell tabs · **Buy modal** (offer summary + savings + demo callout for `escape_valve_buy`) · **Sell modal** (price slider 50–100% of face + 7-day slashing window + Whitepaper protections panel).                                                                                                                                   |
| **`/insights`**  | Score evolution — **range pill (1M/3M/6M/12M)** that actually reshapes the curve + 5-factor breakdown + 3 **clickable recommendation cards** opening detail modals (GANHO ESTIMADO / POR QUE / SINAL ON-CHAIN).                                                                                                                           |
| **`/lab`**       | **Stress Lab** — L1 actuarial simulator. Inputs: tier · maturity · members · credit value · APY · admin fee. 4 one-click preset scenarios. Matrix editor (P/C/X/E cells with position-aware toggle). Pool-balance sparkline. Audit panel: Caixa Bruto + Cofre Solidário + Fundo Garantido − obrigações pendentes = **Solvência Líquida**. |
| `/demo`          | Lifecycle orchestrator demo (developer-facing, not in user nav).                                                                                                                                                                                                                                                                          |

### Aesthetic system

Calibrated against a "Web3 high-end" brief. The whole dashboard reads as a live system, not a banking statement.

- **Neon palette by default** — `#06090F` ground, `#14F195` Solana green, `#9945FF` purple, `#00C8FF` teal accent. Soft (cream + sage) palette stays available via the dev Tweaks panel.
- **Glassmorphism on every primary card** — `backdrop-filter: blur(12px) saturate(140%)` over a translucent base + 1px hairline border. One helper (`glassSurfaceStyle(palette)`) drives every screen.
- **Terminal sidebar** — uppercase JetBrains Mono labels with 0.12em tracking, glowing green active rail.
- **SOLANA_DEVNET pulse** — network status chip in the top bar pulses a green dot when connected; `PHANTOM_OFFLINE` greys out otherwise.
- **Wallet glow** — connected wallet chip runs a subtle `rfi-glow` halo loop; landing CTAs run bigger `rfi-btn-glow-green/purple` halos so every Connect button reads as the primary action immediately.
- **Animated CountUp** — every hero number (saldo, yield, score, KPIs) spring-animates between values when currency / language / palette flips.
- **Terminal Activity feed** — live event stream from the session orchestrator rendered with `>` prompt + `[timestamp]` + op tag + amount + tx id, color-coded per row kind (in / out / attestation / join / yield).
- **Bento `/home`** — asymmetric grid: 3 KPIs + tall radial Score ring + 3-col Featured round + balanced YourGroups / TripleShield + full-width Activity log.
- **Radial SAS Score ring** — 168px SVG arc with green→teal gradient, draws in over 1.6s on first paint.
- **Page transitions** — selectable via Tweaks panel: off / fade (default) / horizontal slide. Driven by framer-motion + `usePathname`.

### Live state & interactions

- **Real wallet flow** — Standard-wallet discovery via `@solana/wallet-adapter-react` picks up Phantom / Solflare / Backpack automatically. Connect from the landing → bounces to `/home`. Disconnect from the wallet chip dropdown → bounces back to `/`.
- **Devnet faucet** — One-click 1-SOL airdrop inside the Phantom card on `/carteira`. Falls back to https://faucet.solana.com when the public RPC rate-limits (always-visible secondary CTA), plus https://faucet.circle.com for devnet USDC.
- **Functional modals (12+)** — every actionable surface across the app routes to an honest demo modal:
  - **`/home`**: PayInstallmentModal (Triple Shield breakdown), JoinGroupModal (locked branch when Lv > user.level)
  - **`/grupos`**: JoinGroupModal, NewCycleModal (eligible vs locked)
  - **`/mercado`**: BuyOfferModal (offer summary + savings), SellPositionModal (slider + Escape Valve panel), SellShareModal (legacy)
  - **`/carteira`**: ReceiveModal, SendModal (address validation + MAX), WithdrawYieldModal, ManageConnectionModal
  - **`/reputacao`**: BondDetailModal (attestation count + on-chain path)
  - **`/insights`**: RecommendationModal (3 detail variants)
  - **`/lab`**: MemberInfoModal (per-member ledger drilldown)
  - All animated via framer-motion, body-scroll locked, Esc + click-outside close. Each one names the M3 Anchor instruction it'll wire to in production via a yellow `MODO DEMO` callout.
- **Session orchestrator** — `lib/session.tsx` drives a typed reducer over `{ user, events[] }`. Submitting a modal really mutates balance / score / yield. An ambient yield ticker fires every 35s so the dashboard reads as alive even while idle.
- **i18n PT/EN** — Every label, button, message, and the entire landing flip on a single toggle. 460+ keys in `lib/i18n.tsx`.
- **BRL ↔ USDC currency toggle** — Source data is BRL; `fmtMoney(brl)` converts at runtime (`USDC_RATE = 5.5`).

### Brand & primitives

- **`RFILogoMark`** — pure SVG vector, gradient `#27D67B → #3BC6D9 → #1E90C9`. Same component drives the landing header, footer, and the `/icon.svg` favicon (both are vectorized — no raster fallbacks).
- **Brand kit** — `RFIPill` × 6 tones, `RFICard` × 4 accents, `MonoLabel`, 23 stroke-based icons in `components/brand/`.
- **Typography** — Syne (display, 400–800), DM Sans (body, 400–700), JetBrains Mono (numbers, 400–600). Loaded via `next/font/google` and exposed as CSS variables.

### Dev affordances

- **Tweaks panel** (bottom-right ✨ button, dev/preview only) — flip palette, page-transition mode, and quick-jump between routes. Hidden in production.
- **Typed mock data** — `data/{carteira,groups,score,market,insights}.ts` with full types so screens are self-contained until the on-chain indexer ships.

## Development Status

**125+ PRs merged on `main` · all squash-merged via `claude/<scope>` branches with structured bodies + Claude session links.**

| Step                       | Status                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Project analysis        | ✅ Done                                                                                                                                                                                                                  |
| 2. Architecture spec       | ✅ Done                                                                                                                                                                                                                  |
| 3. Devnet environment      | ✅ Done                                                                                                                                                                                                                  |
| 4. Smart contracts drafted | ✅ ~4,300 LoC across 14 `roundfi-core` instructions + math modules + state types. Validation pending in M1 of grant.                                                                                                     |
| 5. Contract tests          | 🟢 L1↔L2 economic-parity scaffold + 33 tests passing. 13 lifecycle/edge/security drafts ready to wire under bankrun.                                                                                                     |
| 6. Backend services        | ⏳ Indexer + SDK round-trips (M3)                                                                                                                                                                                        |
| 7. Frontend                | ✅ Landing + 8 dashboard routes (`/home`, `/carteira`, `/grupos`, `/reputacao`, `/mercado`, `/insights`, `/lab`, `/demo`) + Phantom devnet flow + 12 functional modals + Stress Lab L1 reference + Web3 aesthetic system |
| 8. Integration             | ⏳ M3 of grant                                                                                                                                                                                                           |
| 9. Security audit          | ⏳                                                                                                                                                                                                                       |
| 10. Devnet testing         | ⏳ M3 of grant                                                                                                                                                                                                           |
| 11. Mainnet migration      | ⏳                                                                                                                                                                                                                       |

## On-chain Deployments

The post-deploy register lives at [`docs/devnet-deployment.md`](docs/devnet-deployment.md) — that's where program IDs, tx signatures, deployer keypair, and the verification checklist are recorded. The tables below mirror the headline IDs so reviewers can hop straight to Solscan from the README.

> **Status:** `_FILL_ME_` placeholders below are intentional — they get filled in the same commit as the actual deploy, so the register exists pre-deploy and the diff is auditable in one PR.

### Devnet (`?cluster=devnet`)

| Program                | Program ID                                     | Status      | Solscan                                                                                        |
| ---------------------- | ---------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `roundfi-core`         | `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw` | ✅ deployed | [view](https://solscan.io/account/8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw?cluster=devnet) |
| `roundfi-reputation`   | `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2` | ✅ deployed | [view](https://solscan.io/account/Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2?cluster=devnet) |
| `roundfi-yield-kamino` | `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb` | ✅ deployed | [view](https://solscan.io/account/74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb?cluster=devnet) |
| `roundfi-yield-mock`   | `GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ` | ✅ deployed | [view](https://solscan.io/account/GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ?cluster=devnet) |

Initialize txs:

- `initialize_protocol` → [`3gCY7M…fXNUz`](https://solscan.io/tx/3gCY7MpttUhiHejEgxA67FvkzEjrdRYZ99chcFDpbSKBrJAizZqkcuCVCgaC6ZHRCUrcvezGkhe3LN8uWUfrXNUz?cluster=devnet) · ProtocolConfig PDA = [`3c9MmoM…vJoTMV`](https://solscan.io/account/3c9MmoM8ZGQGCrKMFGvJcCtvD78jEPa2JZtLwTvJoTMV?cluster=devnet)
- `initialize_reputation` → [`59Sgz1…ALCn1`](https://solscan.io/tx/59Sgz1G59g2Q3usdk2qVxGVFcQSDU5RhAPSNypY5QJ8oqRRNBqq1VJbgBWh3ymVaBRLm1yJJE2bYYH3wP1PALCn1?cluster=devnet) · ReputationConfig PDA = [`7RDWsSDc…aXo4`](https://solscan.io/account/7RDWsSDcYYjn31E2dL2hbU3YQFFTvh2Wg8nxDsAXaXo4?cluster=devnet)

> **State, not just bytecode.** Devnet has live `ProtocolConfig` + `ReputationConfig` singletons. Pool seeding (`scripts/devnet/seed-pool.ts`) remains a Step 4/8 stub — gated behind the M3 milestone (app ↔ on-chain wiring) per [`docs/status.md`](docs/status.md).

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

| Layer           | Tech                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart contracts | Rust + Anchor 0.30                                                                                                                                                                                                           |
| Tests           | `anchor test` + `solana-bankrun`                                                                                                                                                                                             |
| NFTs            | Metaplex Core                                                                                                                                                                                                                |
| NFT metadata    | Client-supplied URI today (`https://` / `ipfs://` / `ar://` accepted); Arweave-via-Irys upload pipeline planned for M3 — `IRYS_NODE_URL` already wired in [`config/clusters.ts`](config/clusters.ts)                         |
| Attestations    | In-house SAS-compatible module (Devnet) → official SAS (Mainnet)                                                                                                                                                             |
| Yield           | Mock adapter (Devnet) → Kamino CPI (Mainnet). `roundfi-yield-kamino::deposit()` does a real `deposit_reserve_liquidity` CPI on Kamino Lend mainnet program; `harvest()` ships in next milestone (park-only mode until then). |
| Stablecoin      | USDC                                                                                                                                                                                                                         |
| Backend         | Node.js + TypeScript + Fastify + Prisma + PostgreSQL — **indexer (Helius webhooks + websocket fallback) lands in M3**; see [`docs/architecture.md`](docs/architecture.md#indexer)                                            |
| Frontend        | Next.js 14 + React 18 + framer-motion 11 + Tailwind 3 (landing) + @solana/wallet-adapter + @coral-xyz/anchor                                                                                                                 |
| Cluster         | Devnet → Mainnet (env-driven)                                                                                                                                                                                                |

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

Business logic lands in Step 4 — until then, deployed programs only expose a `ping` smoke instruction.

### Deploy the front-end (Vercel)

The repo ships an `app/vercel.json` so the deploy works with one tweak in the dashboard:

1. Sign in at [vercel.com](https://vercel.com) → **Add New** → **Project** → import `alrimarleskovar/RoundFinancial`.
2. **Set Root Directory to `app`** (this is the only manual step — Vercel needs to find `next` in `app/package.json`, not the workspace root).
3. Leave everything else at the default. Vercel reads `app/vercel.json` and:
   - Runs `cd .. && pnpm install --frozen-lockfile` so the **pnpm workspace resolves** (`@roundfi/sdk`, `@roundfi/orchestrator`).
   - Builds the app: `pnpm build` inside `app/`.
   - Auto-detects Next.js inside `app/` and applies all framework optimizations.
4. Click **Deploy**. ~2 minutes.

No env vars required for the public landing — wallet adapter handles its own RPC defaults (devnet). After M3 of the grant ships, the deploy will need:

- `NEXT_PUBLIC_SOLANA_RPC_URL` (Helius / public devnet)
- `NEXT_PUBLIC_ROUNDFI_CORE_PROGRAM_ID`
- `NEXT_PUBLIC_ROUNDFI_REPUTATION_PROGRAM_ID`

The `ignoreCommand` in `app/vercel.json` skips rebuilds when only docs/grant/programs/tests change — saves build minutes on doc-only PRs.

## License

TBD (recommend Apache-2.0 for the core + BUSL-1.1 for the commercial score API).

## Links

- **Repo:** https://github.com/alrimarleskovar/RoundFinancial
- **Hackathon:** Colosseum 2026
