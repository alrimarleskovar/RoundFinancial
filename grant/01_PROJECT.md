# 01 · Project — RoundFi

> Cooperative credit, on-chain. An on-chain ROSCA (Rotating Savings & Credit Association) protocol on Solana, bringing behavioral credit to the 1.4B unbanked adults and the $5.7T MSME finance gap that DeFi never served.

Built for the **Colosseum Hackathon 2026** and now extending into a real product.

## The gap

DeFi solved trading, liquidity, and yield farming. It never solved **credit for the unbanked**.

| Protocol | Sub-collateral | Behavior score | Retail user | Emerging markets | NFT position | No prior crypto |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Aave / Marginfi | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Goldfinch | ✓ | ✗ | ✗ | ~ | ✗ | ✗ |
| Maple / TrueFi | ~ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Credix | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| RociFi | ✓ | ~ | ~ | ✗ | ✗ | ✗ |
| **RoundFi** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |

## Core mechanics (the protocol you're funding work on)

- **Pool shape:** 24 members · $416/mo installment · ~$10K credit per cycle
- **Reputation ladder (50-30-10 Rule):** stake drops 50% → 30% → 10% as members graduate Lv1 → Lv2 → Lv3 (Veteran). Veterans unlock 10× leverage.
- **Triple Shield:**
  1. **Seed Draw** — Month-1 retention of 91.6% of capital.
  2. **Adaptive Escrow** — locks reward portions so debt decreases faster than collateral returns.
  3. **Solidarity Vault** — 1% of each installment, redistributed as Good Faith Bonus.
- **Yield Waterfall (Kamino, 5–8% APY):** Protocol → Guarantee Fund → LP Angels → Participants.
- **Escape Valve:** positions are dynamic NFTs. Distressed users sell instead of defaulting.
- **Behavioral oracle:** every payment is an on-chain attestation (SAS-compatible) — a portable credit identity, the *"Serasa of Web3"*.

## What's shipped today

```
RoundFinancial/                       ← github.com/alrimarleskovar/RoundFinancial
├── programs/                         # 4 Anchor programs (Rust)
│   ├── roundfi-core/                       # pool state machine + escrow + solidarity vault
│   ├── roundfi-reputation/                 # SAS-compatible attestation + reputation ladder
│   ├── roundfi-yield-mock/                 # devnet yield adapter (simulated APY)
│   └── roundfi-yield-kamino/               # mainnet yield adapter (real Kamino CPI)
├── sdk/                              # TypeScript SDK skeleton
├── services/orchestrator/            # lifecycle orchestrator (mock + real driver)
├── app/                              # Next.js 14 frontend — feature-complete
│   ├── src/app/                            # 7 routes: / + /home + /carteira + /grupos
│   │                                       #          + /reputacao + /mercado + /insights + /demo
│   ├── src/components/                     # by feature: brand · layout · home · carteira ·
│   │                                       #             grupos · score · mercado · insights ·
│   │                                       #             modals · ui · landing
│   ├── src/lib/                            # theme · i18n · wallet · network · session
│   │                                       #         · motion · groups · useRedirectOnDisconnect
│   └── src/data/                           # typed mock fixtures
├── tests/                            # 14 spec files (Anchor + bankrun harness)
├── scripts/devnet/                   # deploy / airdrop / seed
├── config/                           # cluster + program-ID registry
└── docs/
    ├── architecture.md                     # 45 KB module-by-module spec
    ├── devnet-setup.md
    ├── pitch-alignment.md
    ├── yield-and-guarantee-fund.md
    ├── pitch/                              # EN deck + 3-min pitch
    └── pt/                                 # PT whitepaper + planning PDFs
```

### Front-end (live, runnable today)

| Route | What's there |
|---|---|
| **`/`** | Public landing — Solana-native palette, sticky header, PT/EN toggle, animated gradient title, simulator with live APY math, comparison table with ✓/✗ icons + glow on the RoundFi column, faint scrolling tx-id "data stream" behind the hero, pulsing Connect Phantom CTAs. |
| **`/home`** | Bento dashboard — hero + 4 KPIs + featured round with circular dial + your groups + radial **SAS Passport ring** (gradient stroke, draws in on mount) + Triplo Escudo + live terminal-style **Activity feed**. |
| **`/carteira`** | Wallet — 4 tabs. Connections tab has live **Phantom flow + 1-SOL devnet airdrop** + always-visible hosted-faucet fallback. |
| **`/grupos`** | ROSCA catalog — 5 multi-facet filters + sort + search + 3-column glass grid. |
| **`/reputacao`** | SAS passport — 96pt Syne score + 50/30/10 ladder + bonds list. |
| **`/mercado`** | Secondary market — Buy/Sell tabs + order book + featured-of-the-day card. |
| **`/insights`** | Score evolution SVG curve + behavioral factors + recommendations. |

### Aesthetic + interactive layer (this is the "production-grade UI" depth)

- Neon palette by default + Soft palette via dev tweaks panel.
- Glassmorphism on every card (one helper, both palettes).
- Terminal sidebar (uppercase JetBrains Mono with letter-spacing, glowing active rail).
- Animated CountUp on every hero number — re-formats live when language/currency/palette flips.
- Terminal Activity feed driven by an in-memory **session orchestrator** with an ambient yield ticker that fires every 35s.
- 3 functional modals (Pagar parcela / Entrar no grupo / Vender cota) — all framer-motion, body-scroll-locked, real state mutations.
- Page transitions (off / fade / slide) selectable from the dev Tweaks panel.
- Vectorized brand mark drives header, footer, and `/icon.svg` favicon — no rasters.
- 460+ i18n keys (PT + EN), BRL ↔ USDC live converter.

### Programs / on-chain (drafted — what the grant **validates and ships**)

- 4 Anchor programs with substantial Rust drafts:
  - `roundfi-core` — 14 instructions implemented (`initialize_protocol`, `create_pool`, `join_pool`, `contribute`, `claim_payout`, `release_escrow`, `deposit_idle_to_yield`, `harvest_yield`, `settle_default`, `escape_valve_list`, `escape_valve_buy`, `close_pool`, `update_protocol_config`, `pause`) plus full math modules (`bps`, `cascade`, `dc`, `escrow_vesting`, `seed_draw`, `waterfall`) and state types — ~4,300 LoC.
  - `roundfi-reputation`, `roundfi-yield-kamino`, `roundfi-yield-mock` — also drafted.
- `tests/parity.spec.ts` runs today and asserts **constants/seeds parity** between Rust and the `@roundfi/sdk` TypeScript SDK (zero Solana infra needed).
- Drafted but not yet green: 13 specs covering lifecycle / edge cases / security / yield / reputation under `solana-bankrun`.
- **What the grant validates:** running those drafts green, plus the new economic parity test that ties L2 (`roundfi-core`) to L1 (`runSimulation()` / Stress Lab presets) on FrameMetrics — that's the load-bearing claim of the protocol's correctness.
- Mock orchestrator at `services/orchestrator/` produces lifecycle events the front-end already consumes — this is the bridge that swaps to real CPI calls when programs land on devnet.

## Foundational stack — aligned with `solana.new`

The whole repo runs on the exact toolchain `curl -fsSL https://www.solana.new/setup.sh | bash` installs:

| `solana.new` installs | RoundFi requires |
|---|---|
| Rust toolchain | `rust-toolchain.toml` → 1.79.0 + rustfmt + clippy |
| Solana CLI | `Anchor.toml` → solana_version 1.18.17 |
| Anchor CLI | `Anchor.toml` → anchor_version 0.30.1 |
| Node.js | `.nvmrc` → Node 20 |
| pnpm | `packageManager: pnpm@9.12.0` |

Anyone running `solana.new`, then `git clone`, then `pnpm install` has the exact environment the repo expects. Reproducible end-to-end.

---

Next file: [`02_AGENTIC_PROCESS.md`](./02_AGENTIC_PROCESS.md) — how this got built.
