# RoundFi — Devnet Deployment Record

**Cluster:** Solana **Devnet** · **Status:** ✅ All 4 programs deployed + protocol singletons initialized + first ROSCA pool live (2026-05-07). `ProtocolConfig` + `ReputationConfig` + `Pool` PDAs hold real state on-chain with the four USDC vault ATAs (pool/escrow/solidarity/yield) all initialized. Member onboarding (`join_pool` + Metaplex Core NFT mint) remains an M3 step — see `seed-members.ts` placeholder.

> This file is the **post-deploy register**: program IDs, transaction
> signatures, deployer keypair, dates. It complements
> [`devnet-setup.md`](./devnet-setup.md) (the how-to) and
> [`status.md`](./status.md) (the project-level shipped/pending register).
>
> Workflow when (re)deploying:
>
> 1. Run the deploy pipeline per `devnet-setup.md` §3-§5.
> 2. Copy the program IDs from `config/program-ids.devnet.json` (the deploy
>    script writes this automatically).
> 3. Copy the deployment transaction signatures from the Solana CLI output.
> 4. Fill in the tables below + commit.
> 5. Anyone reading the repo can now jump straight from a public Solscan
>    link to the live program — auditable evidence that the protocol is on
>    chain, not just claimed in a doc.

---

## 1 · Latest deployment

| Field                          | Value                                          |
| ------------------------------ | ---------------------------------------------- |
| **Date** (UTC)                 | 2026-05-07                                     |
| **Anchor**                     | `0.30.1`                                       |
| **Solana CLI**                 | `3.1.14` (Anza Agave)                          |
| **Rust**                       | `1.95.0` (host channel = `stable`)             |
| **Workstation**                | WSL2 Ubuntu 22.04 (`LAPTOP-N7DHUF3R`)          |
| **Deployer pubkey**            | `64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm` |
| **Deployer SOL balance after** | `0.53341092` SOL (faucet exhausted; see §7)    |
| **Build commit**               | `d57bb43` (main @ time of deploy)              |

---

## 2 · Program IDs

After `pnpm run devnet:deploy` writes `config/program-ids.devnet.json`,
copy the four IDs below and link each to its Solscan page so reviewers
can verify on chain. Devnet Solscan URL pattern:
`https://solscan.io/account/<PROGRAM_ID>?cluster=devnet`

| Program                | Program ID                                     | Status      | Solscan                                                                                        |
| ---------------------- | ---------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `roundfi-core`         | `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw` | ✅ deployed | [view](https://solscan.io/account/8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw?cluster=devnet) |
| `roundfi-reputation`   | `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2` | ✅ deployed | [view](https://solscan.io/account/Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2?cluster=devnet) |
| `roundfi-yield-kamino` | `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb` | ✅ deployed | [view](https://solscan.io/account/74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb?cluster=devnet) |
| `roundfi-yield-mock`   | `GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ` | ✅ deployed | [view](https://solscan.io/account/GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ?cluster=devnet) |

> **Sanity check after filling:** `solana program show <PROGRAM_ID> --url devnet`
> should print `Program Id: <PROGRAM_ID>` and a non-zero `Data Length`.
> If it returns `Account does not exist`, the upload failed silently —
> rerun `anchor deploy --provider.cluster devnet` and capture the error
> output.

---

## 3 · Deployment transactions

Solana CLI's `--verbose` flag prints the `Signature:` line for each
program upload. Capture the four signatures + the protocol initialization
tx so reviewers can see the on-chain history without poking around.

| Step                               | Tx Signature                                                                               | Solscan                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy `reputation`                | `TkT3pk6W7pED5BWGKYDMQGjwkg6M9xf8USpUkS5w4yweoyamdY1a4LzCAyWkbVi39KYCFs6evsMa6RZ9ctFScpM`  | [view](https://solscan.io/tx/TkT3pk6W7pED5BWGKYDMQGjwkg6M9xf8USpUkS5w4yweoyamdY1a4LzCAyWkbVi39KYCFs6evsMa6RZ9ctFScpM?cluster=devnet)  |
| Deploy `core`                      | `3jbdE3u2bdmdzHKiWPa9j3wdo7QP1hJdeEUDzdX4ENWkXPkAYk5gcpBHuvn668XAY8WbwNxhPfhV6tkaKKN8ehRV` | [view](https://solscan.io/tx/3jbdE3u2bdmdzHKiWPa9j3wdo7QP1hJdeEUDzdX4ENWkXPkAYk5gcpBHuvn668XAY8WbwNxhPfhV6tkaKKN8ehRV?cluster=devnet) |
| Deploy `yield-kamino`              | `21RmNi2PgZqs9TVaL8uxiqcZBQGkHCKUGS9EQDauEhWu6JWLmiHeR8JaW6KFnSCAKSqUpQagrGYW6iyy5TjWzyS3` | [view](https://solscan.io/tx/21RmNi2PgZqs9TVaL8uxiqcZBQGkHCKUGS9EQDauEhWu6JWLmiHeR8JaW6KFnSCAKSqUpQagrGYW6iyy5TjWzyS3?cluster=devnet) |
| Deploy `yield-mock`                | `3U4C4JVqxhrd2d343DQqgRGgqb1a8VdQXMBkFtqy148UnEBwrH8ia76PdG776qvxGNnMVqX62FVQGG6QVZ61RTGY` | [view](https://solscan.io/tx/3U4C4JVqxhrd2d343DQqgRGgqb1a8VdQXMBkFtqy148UnEBwrH8ia76PdG776qvxGNnMVqX62FVQGG6QVZ61RTGY?cluster=devnet) |
| Create treasury ATA                | `4s5ESCkvapynecLDGpd9iSvBWEirtVuND9rxLsMa8kHNxowHZQAXwCQssb4SDdSH12eYtuGTQLvRUBabrTm8Hbfq` | [view](https://solscan.io/tx/4s5ESCkvapynecLDGpd9iSvBWEirtVuND9rxLsMa8kHNxowHZQAXwCQssb4SDdSH12eYtuGTQLvRUBabrTm8Hbfq?cluster=devnet) |
| `initialize_protocol`              | `3gCY7MpttUhiHejEgxA67FvkzEjrdRYZ99chcFDpbSKBrJAizZqkcuCVCgaC6ZHRCUrcvezGkhe3LN8uWUfrXNUz` | [view](https://solscan.io/tx/3gCY7MpttUhiHejEgxA67FvkzEjrdRYZ99chcFDpbSKBrJAizZqkcuCVCgaC6ZHRCUrcvezGkhe3LN8uWUfrXNUz?cluster=devnet) |
| `initialize_reputation`            | `59Sgz1G59g2Q3usdk2qVxGVFcQSDU5RhAPSNypY5QJ8oqRRNBqq1VJbgBWh3ymVaBRLm1yJJE2bYYH3wP1PALCn1` | [view](https://solscan.io/tx/59Sgz1G59g2Q3usdk2qVxGVFcQSDU5RhAPSNypY5QJ8oqRRNBqq1VJbgBWh3ymVaBRLm1yJJE2bYYH3wP1PALCn1?cluster=devnet) |
| `roundfi_core` upgrade (split fix) | `56Fia9v3nYzhRTmYjwuwvdvcFmZYsCdXr8Nh4QicTE6pYyhCPMerYabuAtbrFYk9RVfv8moXkANFYYTE15KWSiwH` | [view](https://solscan.io/tx/56Fia9v3nYzhRTmYjwuwvdvcFmZYsCdXr8Nh4QicTE6pYyhCPMerYabuAtbrFYk9RVfv8moXkANFYYTE15KWSiwH?cluster=devnet) |
| `create_pool`                      | `2Emh1snRJgSRsypcwSgZUe21Duw6pKrQk4e16NJQh3CLi9ehaQGQPnj1RJvEAyPu3icjmThM4ehnk55sn8GE8urS` | [view](https://solscan.io/tx/2Emh1snRJgSRsypcwSgZUe21Duw6pKrQk4e16NJQh3CLi9ehaQGQPnj1RJvEAyPu3icjmThM4ehnk55sn8GE8urS?cluster=devnet) |
| `init_pool_vaults` (4 vault ATAs)  | `zmnoexdEA8VVwLDNQJPVh8eVPdiLK5EThEAh7rbWiVJNrjQCzyCExXpmDtQL73DdUKm1vpmNd5pNWqeVo3iumnx`  | [view](https://solscan.io/tx/zmnoexdEA8VVwLDNQJPVh8eVPdiLK5EThEAh7rbWiVJNrjQCzyCExXpmDtQL73DdUKm1vpmNd5pNWqeVo3iumnx?cluster=devnet)  |
| Seed members (`seed-members.ts`)   | _M3 scope — Circle USDC faucet hits + 3× join_pool with Metaplex Core NFT mint_            | _N/A until M3_                                                                                                                        |

---

## 4 · Configuration files updated post-deploy

The deploy script writes `config/program-ids.devnet.json`. Two more files
must land in the same commit so the rest of the repo sees the new IDs:

| File                              | Update                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Anchor.toml` `[programs.devnet]` | Replace the four `1111…1111` placeholders with the real IDs                                        |
| `.env` (root)                     | Set `ROUNDFI_CORE_PROGRAM_ID`, `..._REPUTATION_..._ID`, etc. — see `clusters.ts` for the full list |
| `config/program-ids.devnet.json`  | Auto-written by `scripts/devnet/deploy.ts` — review and commit it                                  |

After committing, anyone running `pnpm test:bankrun` against devnet (or
the M3 wiring in the app) gets the right IDs without env hand-rolling.

---

## 4b · State accounts created post-init / post-seed

After `pnpm devnet:init` and `pnpm devnet:seed`, the following accounts exist on-chain. Reviewers can fetch each one via Solscan or `solana account show` to verify the protocol holds real, structured state:

| Account                                    | Address                                        | Type                        | Solscan                                                                                        |
| ------------------------------------------ | ---------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| `ProtocolConfig` PDA                       | `3c9MmoM8ZGQGCrKMFGvJcCtvD78jEPa2JZtLwTvJoTMV` | Anchor account (core)       | [view](https://solscan.io/account/3c9MmoM8ZGQGCrKMFGvJcCtvD78jEPa2JZtLwTvJoTMV?cluster=devnet) |
| `ReputationConfig` PDA                     | `7RDWsSDcYYjn31E2dL2hbU3YQFFTvh2Wg8nxDsAXaXo4` | Anchor account (reputation) | [view](https://solscan.io/account/7RDWsSDcYYjn31E2dL2hbU3YQFFTvh2Wg8nxDsAXaXo4?cluster=devnet) |
| Treasury USDC ATA                          | `5ggMVBCqCfjwzKegvwMs3dpJqYDYNxmgnpubb55CVQX5` | SPL token account           | [view](https://solscan.io/account/5ggMVBCqCfjwzKegvwMs3dpJqYDYNxmgnpubb55CVQX5?cluster=devnet) |
| **`Pool` PDA** (demo, 3-member, $30 carta) | `5APoECXzJwr6j6xXGsqkT6GRSWNVDm4NSQB3KLhc8ooa` | Anchor account (core)       | [view](https://solscan.io/account/5APoECXzJwr6j6xXGsqkT6GRSWNVDm4NSQB3KLhc8ooa?cluster=devnet) |

The pool's four USDC vault ATAs land in the same `init_pool_vaults` tx — they're derivable as `getAssociatedTokenAddress(USDC_MINT, <authority_pda>)` where the four authorities are PDAs from `[SEED_X, pool.key()]`:

| Vault              | Authority seed prefix | Purpose                                                               |
| ------------------ | --------------------- | --------------------------------------------------------------------- |
| `pool_usdc_vault`  | `b"pool"` (Pool PDA)  | Active settlement pot — installments land here                        |
| `escrow_vault`     | `b"escrow"`           | Member stake escrow — locked Lv2 stake (~$9 each at 30% × $30 credit) |
| `solidarity_vault` | `b"solidarity"`       | Cofre Solidário — 1% of every installment (Triple Shield 1st cushion) |
| `yield_vault`      | `b"yield"`            | Parked-USDC source for the Kamino-bound yield adapter                 |

PDAs are deterministic — re-running `pnpm devnet:init` and `pnpm devnet:seed` against the same cluster + program IDs is idempotent (both scripts detect existing PDAs/ATAs and print "skipping").

---

## 5 · Verification checklist

Run these from the deployer machine after the steps above and tick
each box. If any line fails, the deployment is **not** ready —
investigate before announcing.

- [ ] `solana program show <core_id> --url devnet` returns non-zero `Data Length`.
- [ ] `solana program show <reputation_id> --url devnet` returns non-zero `Data Length`.
- [ ] `solana program show <yield_mock_id> --url devnet` returns non-zero `Data Length`.
- [ ] `solana program show <yield_kamino_id> --url devnet` returns non-zero `Data Length`.
- [ ] `pnpm devnet:init` exits zero (protocol singleton initialized).
- [ ] `pnpm devnet:seed` exits zero (demo pool created + USDC minted to fixture wallets).
- [ ] Solscan loads each Program ID page without 404 (cluster=devnet pinned in URL).
- [ ] At least one read from `program.account.protocolConfig.fetch(configPda)` succeeds against the devnet RPC (smoke test).

---

## 6 · Redeployment notes

A second deploy with the **same** keypairs replaces the on-chain bytes
in place (Solana program upgrade) and keeps the IDs stable — no
downstream config change needed. To redeploy:

```bash
anchor build --no-idl   # builds against the pinned Cargo.lock
anchor upgrade target/deploy/<program>.so --program-id <PROGRAM_ID> --provider.cluster devnet
```

If you ever need to **rotate** a program ID (lost keypair, suspected
compromise), generate a fresh keypair under `target/deploy/`, run
`anchor keys sync`, and follow §1-§4 again. Update this doc with the
new IDs and the rotation reason in §7.

---

## 7 · Deployment history

Keep the most recent deploy at the top. Older entries get a `[ROTATED]`
or `[DEPRECATED]` tag with a one-line explanation so the audit trail
survives.

| Date       | Build commit | Deployer                                       | Reason                                                                                                                                                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-07 | `67748ac`    | `64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm` | Initial v1.1 deploy + protocol init + first pool seeded (TransferDelegate plugin + PDF-canonical waterfall + 3 PDA singletons + 1 demo Pool with 4 vault ATAs) | Four sessions on the same day. (1) `roundfi-reputation`, `roundfi-core`, `roundfi-yield-kamino` deploy. (2) `roundfi-yield-mock` deploy after 8h faucet cooldown. (3) `initialize_protocol` + `initialize_reputation` via rewritten `init-protocol.ts` (#162). (4) `create_pool` + `init_pool_vaults` for the demo 3-member pool (#164) — required splitting the original combined `create_pool` into two ixs to dodge a Solana 3.x stack frame overflow. Member onboarding (`seed-members.ts` with USDC stakes + Metaplex Core NFT mints) is the next M3 step. |

---

## 8 · Mainnet smoke deploy

> **Goal:** prove the same `target/deploy/*.so` artifacts that pass devnet
> also land on Mainnet — validates the CD pipeline against real-cluster
> conditions (priority fees, account size limits, recent-blockhash
> behavior) and gives reviewers a clickable Mainnet Solscan link as
> evidence of execution. **Presence, not a pool** — the protocol is NOT
> initialized for live users; production launch is gated behind the
> Phase 3 milestone in `status.md`.

### What "smoke deploy" means here

- Deploy the same four programs to Mainnet using **fresh keypairs** (so
  the eventual production deploy can rotate to the real authority
  without conflicting). The smoke deploy IDs can be kept (cheaper —
  preserves the audit trail for reviewers) or closed (recovers the rent).
- Do **NOT** call `initialize_protocol` against Mainnet from a smoke
  run. A live `ProtocolConfig` would imply user funds at risk under a
  pre-audit binary.
- After the smoke deploy + sanity reads, the smoke programs can be
  closed (`solana program close <ID> --bypass-warning`) to recover the
  rent locked by each upload.

### Pre-flight

| Requirement                            | Notes                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mainnet wallet                         | Real SOL — typical Anchor program upload locks ≈ 1 SOL per program in rent. **Budget ~3-5 SOL total ($300-500 at ~$100/SOL)** to cover the four programs + priority fees during a busy block. There is no `airdrop` on Mainnet. |
| `Anchor.toml` patch                    | Add `[programs.mainnet]` block alongside `[programs.devnet]`, pointing at the Mainnet keypairs under `target/deploy/`                                                                                                           |
| RPC                                    | Mainnet's public RPC (`https://api.mainnet-beta.solana.com`) is rate-limited; consider Helius / Triton / QuickNode endpoints set in `SOLANA_RPC_URL`                                                                            |
| `solana config set --url mainnet-beta` | Switch CLI before deploying so `anchor deploy --provider.cluster mainnet` works                                                                                                                                                 |

### Procedure (mirrors §1-§4 but mainnet-flavored)

```bash
# 1. Generate fresh keypairs for the smoke deploy (do NOT reuse the
#    devnet ones — Mainnet IDs are forever, throwaway is cleaner).
mkdir -p keypairs/mainnet-smoke
for p in roundfi_core roundfi_reputation roundfi_yield_mock roundfi_yield_kamino; do
  solana-keygen new --no-bip39-passphrase -o "keypairs/mainnet-smoke/${p}.json"
done

# 2. Update `target/deploy/${program}-keypair.json` to point at the
#    smoke keypairs (anchor deploy reads from there).
cp keypairs/mainnet-smoke/*.json target/deploy/

# 3. Sync the new IDs into Anchor.toml + the declare_id! macros.
anchor keys sync

# 4. Rebuild so the binaries embed the right declare_id.
anchor build --no-idl

# 5. Deploy.
anchor deploy --provider.cluster mainnet
```

### Verification (Mainnet)

| Check                                                  | Expected                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solana program show <ID> --url mainnet-beta`          | Non-zero `Data Length` for each                                                                                                                       |
| Solscan (no `cluster=` query — Mainnet is the default) | `https://solscan.io/account/<ID>` 200s                                                                                                                |
| Smoke read                                             | `(env.programs.core.account as any).protocolConfig.fetch(pda)` rejects with "Account does not exist" — confirms the program is up but not initialized |

### Cleanup after smoke

```bash
# Recover the rent (~2 SOL × 4 programs).
for ID in <core_id> <reputation_id> <yield_mock_id> <yield_kamino_id>; do
  solana program close "$ID" --bypass-warning --url mainnet-beta
done
```

> The closed program IDs cannot be reused. The eventual production deploy
> uses a separate set of keypairs (preferably authored under a Squads V4
> multisig per `architecture.md` §10) so the smoke run leaves no residue
> in the on-chain namespace beyond what's documented in §7.

### Smoke deployment record (fill after running)

| Field                             | Value                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Date (UTC)                        | _yyyy-mm-dd_                                                                   |
| Smoke `core`                      | `_FILL_ME_`                                                                    |
| Smoke `reputation`                | `_FILL_ME_`                                                                    |
| Smoke `yield_mock`                | `_FILL_ME_`                                                                    |
| Smoke `yield_kamino`              | `_FILL_ME_`                                                                    |
| SOL spent on uploads              | _≈ X SOL_                                                                      |
| SOL recovered via `program close` | _≈ Y SOL_                                                                      |
| Outcome                           | _e.g. "All four programs deployed and closed cleanly. CD pipeline validated."_ |
