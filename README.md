# RoundFi

> **Cooperative credit, on-chain.** An on-chain ROSCA (Rotating Savings & Credit Association) protocol on Solana, bringing behavioral credit to the 1.4B unbanked adults and the $5.7T MSME finance gap that DeFi never served.

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
├── programs/          # Anchor programs (Rust)
│   ├── roundfi-core/          # Pool state machine + escrow + solidarity vault
│   ├── roundfi-reputation/    # SAS-compatible attestation + reputation ladder
│   ├── roundfi-yield-mock/    # Devnet yield adapter (simulated APY)
│   └── roundfi-yield-kamino/  # Mainnet yield adapter (real Kamino CPI)
├── sdk/               # TypeScript SDK generated from Anchor IDL
├── backend/           # Indexer, B2B score API, crank service (Fastify + Prisma)
├── app/               # Next.js 15 frontend (Wallet Adapter, Phantom/Solflare)
├── scripts/           # Devnet deploy, airdrop, seed, mainnet migration
├── config/            # Env, cluster configs, program-ID registry
├── docs/              # Architecture, module specs, run/deploy/migrate guides
└── tests/             # Cross-program integration tests (Anchor + bankrun)
```

## Documentation

- [**Architecture Spec**](docs/architecture.md) — programs, accounts, instructions, PDAs, CPI graph, error taxonomy
- [Pitch Deck](roundfi-pitch-en%20%284%29.html) (EN) — the 15-slide Colosseum deck
- [Whitepaper](WHITEPAPER%20T%C3%89CNICO%20.pdf) (PT) — technical whitepaper
- Per-module READMEs land alongside each module as it ships.

## Development Status

| Step | Status |
|---|---|
| 1. Project analysis | ✅ Done |
| 2. Architecture spec | ✅ Done |
| 3. Devnet environment | ⏳ Next |
| 4. Smart contracts (core) | ⏳ |
| 5. Contract tests | ⏳ |
| 6. Backend services | ⏳ |
| 7. Frontend | ⏳ |
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
| Frontend | Next.js 15 + React 19 + @solana/wallet-adapter + @coral-xyz/anchor |
| Cluster | Devnet → Mainnet (env-driven) |

## Quick Start

Not yet runnable — scaffolding lands in Step 3.

## License

TBD (recommend Apache-2.0 for the core + BUSL-1.1 for the commercial score API).

## Links

- **Repo:** https://github.com/alrimarleskovar/RoundFinancial
- **Hackathon:** Colosseum 2026
