# RoundFi

> **Cooperative credit, on-chain.** An on-chain ROSCA (Rotating Savings & Credit Association) protocol on Solana, bringing behavioral credit to the 1.4B unbanked adults and the $5.7T MSME finance gap that DeFi never served.

<p>
  <a href="docs/pitch/pitch-deck-en.html">📊 Pitch deck</a> ·
  <a href="docs/pt/whitepaper.pdf">📄 Whitepaper (PT)</a> ·
  <a href="docs/architecture.md">🧱 Architecture</a> ·
  <a href="app/public/prototype/index.html">🖥️ Front-end preview</a>
</p>

Built for the **Colosseum Hackathon 2026**.

---

## Why RoundFi

DeFi solved trading. DeFi solved liquidity. DeFi never solved **credit**.

| Protocol | Sub-collateral | Behavior score | Retail user | Emerging markets | NFT position | No prior crypto |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Aave / Marginfi | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Goldfinch | ✓ | ✗ | ✗ | ~ | ✗ | ✗ |
| Maple / TrueFi | ~ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Credix | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| RociFi | ✓ | ~ | ~ | ✗ | ✗ | ✗ |
| **RoundFi** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |

RoundFi is the only protocol that checks every box.

## Core Mechanics

- **Pool shape:** 24 members · $416/mo installment · ~$10K credit per cycle
- **Reputation ladder (50-30-10 Rule):** stake drops 50% → 30% → 10% as members graduate Level 1 → 2 → 3 (Veteran). Veterans unlock 10× leverage.
- **Triple Shield:**
  1. **Seed Draw** — Month-1 retention of 91.6% of capital.
  2. **Adaptive Escrow** — locks reward portions so debt decreases faster than collateral returns.
  3. **Solidarity Vault** — 1% of each installment, redistributed as Good Faith Bonus.
- **Yield Waterfall (Kamino, 5–8% APY):** Protocol → Guarantee Fund → LP Angels → Participants.
- **Escape Valve:** positions are dynamic NFTs. Distressed users sell instead of defaulting.
- **Behavioral oracle:** every payment is an on-chain attestation (SAS-compatible) — a portable credit identity, the *"Serasa of Web3"*.

## Repository Layout

```
RoundFinancial/
├── programs/              # Anchor programs (Rust)
│   ├── roundfi-core/              # Pool state machine + escrow + solidarity vault
│   ├── roundfi-reputation/        # SAS-compatible attestation + reputation ladder
│   ├── roundfi-yield-mock/        # Devnet yield adapter (simulated APY)
│   └── roundfi-yield-kamino/      # Mainnet yield adapter (real Kamino CPI)
├── sdk/                   # TypeScript SDK generated from Anchor IDL
├── services/              # Off-chain services
│   └── orchestrator/              # Lifecycle orchestrator (mock + real driver)
├── app/                   # Next.js 14 front-end (Wallet Adapter, Phantom/Solflare)
│   ├── src/app/                   # / = design prototype  ·  /demo = lifecycle demo
│   └── public/prototype/          # RoundFi Desktop design handoff bundle
├── scripts/               # Devnet deploy, airdrop, seed, stress runners
├── config/                # Cluster configs + program-ID registry
├── tests/                 # Cross-program integration tests (Anchor + bankrun)
└── docs/                  # Architecture, module specs, deploy guides
    ├── pitch/                     # Pitch decks (EN)
    └── pt/                        # Portuguese docs (whitepaper + planning)
```

## Documentation

**Core**
- [**Architecture Spec**](docs/architecture.md) — programs, accounts, instructions, PDAs, CPI graph, error taxonomy
- [Devnet Setup](docs/devnet-setup.md) — full prerequisites + deploy walkthrough
- [Pitch Alignment](docs/pitch-alignment.md) — how the implementation maps to the deck
- [Yield & Guarantee Fund](docs/yield-and-guarantee-fund.md) — waterfall math + adapters

**Pitch**
- [Pitch Deck · EN](docs/pitch/pitch-deck-en.html) — 15-slide Colosseum deck
- [3-min Pitch](docs/pitch/pitch-3min.html) — short-form pitch

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

The product-facing UI is a **desktop dashboard** (see [`app/public/prototype/`](app/public/prototype/)) with a cream/sage *Soft* palette and a dark *Neon* palette, PT/EN i18n, BRL↔USDC switch, and a live Phantom wallet connection flow. It renders at `/` in the Next.js app; the lifecycle demo (orchestrator + wallet adapter) lives at `/demo`.

```bash
pnpm --filter @roundfi/app dev     # http://localhost:3000/
```

## Development Status

| Step | Status |
|---|---|
| 1. Project analysis | ✅ Done |
| 2. Architecture spec | ✅ Done |
| 3. Devnet environment | ✅ Done |
| 4. Smart contracts (core) | ⏳ Next |
| 5. Contract tests | ⏳ |
| 6. Backend services | ⏳ |
| 7. Frontend | 🎨 Design locked · wiring |
| 8. Integration | ⏳ |
| 9. Security audit | ⏳ |
| 10. Devnet testing | ⏳ |
| 11. Mainnet migration | ⏳ |

## Stack

| Layer | Tech |
|---|---|
| Smart contracts | Rust + Anchor 0.30 |
| Tests | `anchor test` + `solana-bankrun` |
| NFTs | Metaplex Core |
| NFT metadata | Arweave via Irys |
| Attestations | In-house SAS-compatible module (Devnet) → official SAS (Mainnet) |
| Yield | Mock adapter (Devnet) → Kamino CPI (Mainnet) |
| Stablecoin | USDC |
| Backend | Node.js + TypeScript + Fastify + Prisma + PostgreSQL + Helius webhooks |
| Frontend | Next.js 14 + React 18 + @solana/wallet-adapter + @coral-xyz/anchor |
| Cluster | Devnet → Mainnet (env-driven) |

## Quick Start

See [`docs/devnet-setup.md`](docs/devnet-setup.md) for the full prerequisites and deploy walkthrough. Short version (WSL2 / Linux / macOS):

```bash
git clone https://github.com/alrimarleskovar/RoundFinancial.git
cd RoundFinancial
pnpm install
cp .env.example .env

solana config set --url https://api.devnet.solana.com
mkdir -p keypairs && solana-keygen new -o keypairs/deployer.json
export ANCHOR_WALLET=$(pwd)/keypairs/deployer.json

pnpm run devnet:airdrop           # 2 SOL (repeat as needed)
pnpm run devnet:deploy            # build → keys sync → build → deploy
# copy the printed IDs into .env
```

Business logic lands in Step 4 — until then, deployed programs only expose a `ping` smoke instruction.

## License

TBD (recommend Apache-2.0 for the core + BUSL-1.1 for the commercial score API).

## Links

- **Repo:** https://github.com/alrimarleskovar/RoundFinancial
- **Hackathon:** Colosseum 2026
