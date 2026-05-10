# Verified Build (Solscan badge)

This guide takes RoundFi's 4 deployed Anchor programs from "open source on GitHub" to **"Verified Build" badge on Solscan** — Solscan/OtterSec's hash-attestation flow that proves the deployed bytecode was built reproducibly from a specific GitHub commit.

## Why bother

Without this, Solscan shows the program account but no verification badge. Anyone can compare the source manually, but there's no automated proof. The badge:

- Shows green "Verified Build" tile on the program account page
- Lets a juror / partner trust the deployment without reading source themselves
- Lets the slide claim "Solscan verified" defensibly (otherwise misleading — see PR #205 / discussion)

## Prerequisites

- **`solana-verify`** — install via `cargo install solana-verify --locked`
- **Docker** — running daemon (Desktop on Mac/Windows, dockerd on Linux)
- **Solana wallet** at `~/.config/solana/id.json` with **~0.05 SOL on devnet** (free via [faucet.solana.com](https://faucet.solana.com))
- **Upgrade authority keypairs** for the 4 programs — needed only if redeploy is required (Step 4)

## Flow

The whole flow is 3 commands, plus an optional redeploy. Total time ~1-1.5h, mostly Docker compute.

### Step 1 — Reproducible build

```bash
pnpm devnet:verify-build
```

Runs `solana-verify build --library-name <prog>` for each of the 4 programs. Each build runs inside `solanafoundation/solana-verifiable-build:VERSION` Docker image with pinned rust/anchor toolchains, producing hash-stable `.so` files under `target/deploy/`.

Time: ~10-15 min per program (first run pulls the Docker image, ~3 GB).

### Step 2 — Check hashes

```bash
pnpm devnet:verify-check
```

Compares each local build hash (`solana-verify get-executable-hash target/deploy/<prog>.so`) against the on-chain hash (`solana-verify get-program-hash <pid>`).

- **Exit 0** → all hashes match. Skip Step 3, go to Step 4.
- **Exit 1** → at least one mismatch. Programs were originally deployed with non-reproducible `anchor build` — toolchain drift. Step 3 is required.

### Step 3 — Redeploy (only if Step 2 reports mismatches)

For each mismatched program:

```bash
solana program deploy \
  --url https://api.devnet.solana.com \
  --keypair ~/.config/solana/id.json \
  --program-id <upgrade-authority-keypair-of-prog> \
  target/deploy/<prog>.so
```

Notes:
- **Program IDs stay the same** — `--program-id` references your upgrade authority keypair, address is preserved.
- **State is preserved** — pools, members, attestations, all PDAs survive.
- **Cost** — ~0.5-2 SOL per program (free on devnet).
- **You need the upgrade authority keypair** — should be `~/.config/solana/id.json` if you deployed originally.

After redeploying, re-run `pnpm devnet:verify-check` to confirm hashes now match.

### Step 4 — Upload attestations

```bash
pnpm devnet:verify-onchain
```

Runs `solana-verify verify-from-repo` for each program, pointing at:
- `--program-id` — the deployed program address
- `--library-name` — the Cargo crate name (e.g. `roundfi_core`)
- `--commit-hash` — the current `git rev-parse HEAD`
- `https://github.com/alrimarleskovar/RoundFinancial` — the public repo

Each call writes an attestation PDA owned by OtterSec's verify program. Cost: ~0.01 SOL per program × 4.

### Step 5 — Wait for Solscan

After ~10 min, Solscan ingests the PDAs and shows the "Verified Build" badge. Confirm at:

- [`roundfi-core`](https://solscan.io/account/8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw?cluster=devnet)
- [`roundfi-reputation`](https://solscan.io/account/Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2?cluster=devnet)
- [`roundfi-yield-mock`](https://solscan.io/account/GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ?cluster=devnet)
- [`roundfi-yield-kamino`](https://solscan.io/account/74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb?cluster=devnet)

## After verification

Update the README's "Live on devnet" section / pitch slide to reflect verified status. The "Solscan verified" tile becomes legitimate.

## Troubleshooting

**`solana-verify build` fails with Docker permission denied**
→ Linux: add user to `docker` group (`sudo usermod -aG docker $USER`) and re-login. Mac/Windows: ensure Docker Desktop is running.

**Hashes still mismatch after redeploy**
→ Confirm `solana program deploy` used the `target/deploy/<prog>.so` from `solana-verify build`, NOT a fresh `anchor build` (which produces different bytecode). Run `pnpm devnet:verify-build` immediately before deploying.

**`verify-from-repo` rejects with "buffer hash mismatch"**
→ Program account has a different bytecode than the buffer. Same root cause — non-reproducible build leaked in somewhere. Re-run Step 1, then Step 3, then Step 4.

**RPC rate limits during `verify-from-repo`**
→ Pass `-u <custom-rpc>` (Helius, QuickNode, Alchemy free tier) instead of public devnet RPC.
