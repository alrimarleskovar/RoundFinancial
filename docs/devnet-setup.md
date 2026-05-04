# RoundFi — Devnet Setup

This guide takes a fresh machine from zero to a deployed RoundFi instance on
Solana Devnet. Follow it in order.

> **Platform note.** Anchor on native Windows is brittle. If you are on
> Windows, run everything below under **WSL2 (Ubuntu 22.04+)**. The repo
> itself can live on the Windows filesystem; only the toolchain needs Linux.

---

## 0 · Prerequisites

| Tool       | Version                                      | Install                                                                                                                |
| ---------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Rust       | **1.79.0** (pinned in `rust-toolchain.toml`) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh`                                                      |
| Solana CLI | **1.18.17**                                  | `sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.17/install)"`                                                      |
| Anchor     | **0.30.1**                                   | `cargo install --git https://github.com/coral-xyz/anchor avm --locked --force && avm install 0.30.1 && avm use 0.30.1` |
| Node.js    | **20.x** (see `.nvmrc`)                      | `nvm install` (inside the repo)                                                                                        |
| pnpm       | **9.x**                                      | `npm i -g pnpm@9`                                                                                                      |

Verify:

```bash
rustc --version        # 1.79.0
solana --version       # 1.18.17
anchor --version       # 0.30.1
node --version         # v20.x
pnpm --version         # 9.x
```

---

## 1 · Clone and configure

```bash
git clone https://github.com/alrimarleskovar/RoundFinancial.git
cd RoundFinancial
pnpm install
cp .env.example .env
```

Point the Solana CLI at Devnet and create a deployer wallet:

```bash
solana config set --url https://api.devnet.solana.com
mkdir -p keypairs
solana-keygen new --no-bip39-passphrase -o keypairs/deployer.json
export ANCHOR_WALLET=$(pwd)/keypairs/deployer.json
```

Edit `.env`:

```env
ANCHOR_WALLET=./keypairs/deployer.json
```

---

## 2 · Fund the deployer

Devnet faucet caps at ~2 SOL per request. You need ~10 SOL to deploy all
four programs comfortably.

```bash
pnpm run devnet:airdrop -- ./keypairs/deployer.json 2
# repeat 4-5 times, or use https://faucet.solana.com
```

Check:

```bash
solana balance
```

---

## 3 · Build, sync keys, build again, deploy

One command does it all:

```bash
pnpm run devnet:deploy
```

Under the hood it runs:

1. `anchor build` — compiles the four programs, generates keypairs in
   `target/deploy/*.json`
2. `anchor keys sync` — rewrites every `declare_id!()` macro and
   `Anchor.toml` with the fresh IDs
3. `anchor build` — rebuild so the embedded IDs match the keypairs
4. `anchor deploy --provider.cluster devnet` — uploads all four programs
5. Writes `config/program-ids.devnet.json` with the deployed IDs

At the end it prints the lines to copy into `.env`:

```env
ROUNDFI_CORE_PROGRAM_ID=<...>
ROUNDFI_REPUTATION_PROGRAM_ID=<...>
ROUNDFI_YIELD_MOCK_PROGRAM_ID=<...>
ROUNDFI_YIELD_KAMINO_PROGRAM_ID=<...>
```

Paste those into `.env` before running anything else.

---

## 4 · Initialize the protocol (Step 4+)

The singleton `ProtocolConfig` account must be created once per cluster:

```bash
pnpm run devnet:init
```

> This script is a stub until Step 4 wires the `initialize_protocol`
> instruction into `roundfi-core`.

---

## 5 · Seed a demo pool (Step 4/8+)

```bash
pnpm run devnet:seed
```

> Stub until the `create_pool` and `join_pool` instructions exist.

---

## 6 · Troubleshooting

**"Transaction simulation failed: Program failed to complete"**
→ You probably skipped `anchor keys sync`. Run `pnpm run devnet:deploy` cleanly.

**"Airdrop request failed"**
→ Devnet faucet is rate-limited. Use https://faucet.solana.com or wait a few minutes.

**"Account does not exist or has no data"**
→ `.env` is missing a program ID. Re-check `config/program-ids.devnet.json`.

**Windows path-separator errors**
→ Run under WSL2. See the platform note at the top.

**"Program authority mismatch"**
→ The deployed program was built under a different keypair. Run:

```bash
anchor clean
pnpm run devnet:deploy
```

---

## 7 · Migrating to Mainnet

When Step 11 arrives:

1. Swap `SOLANA_CLUSTER=mainnet-beta` and `SOLANA_RPC_URL=<paid RPC>`.
2. Fund a **fresh** deployer keypair (never reuse the Devnet one).
3. Run `scripts/mainnet/deploy.ts` — it refuses to run without an explicit
   confirmation prompt.
4. Redeploy `roundfi-yield-kamino` with the real Kamino CPI implementation.
5. Hand program-upgrade authority over to the Squads V4 multisig with
   `scripts/mainnet/handoff-multisig.ts`.

Full checklist lives in [`docs/mainnet-migration.md`](./mainnet-migration.md)
once Step 11 ships.

---

## Reference

- Architecture: [`docs/architecture.md`](./architecture.md)
- Program layout: `programs/roundfi-*/src/lib.rs`
- SDK: [`sdk/src`](../sdk/src) — PDA seeds, fee schedule, generated clients
- Scripts: [`scripts/devnet/`](../scripts/devnet)
- Config loader: [`config/clusters.ts`](../config/clusters.ts)
