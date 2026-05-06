# RoundFi — Devnet Deployment Record

**Cluster:** Solana **Devnet** · **Status:** _Pending first deploy — fill this in after running the steps in `devnet-setup.md`._

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

| Field                          | Value                                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| **Date** (UTC)                 | _yyyy-mm-dd_                                                       |
| **Anchor**                     | `0.30.1`                                                           |
| **Solana CLI**                 | `1.18.17` (Anza Agave)                                             |
| **Rust**                       | `1.79.0` (pinned by `rust-toolchain.toml`)                         |
| **Workstation**                | _e.g. WSL2 Ubuntu 22.04 / macOS 14.5 / Linux native_               |
| **Deployer pubkey**            | `_FILL_ME_` (from `solana-keygen pubkey ./keypairs/deployer.json`) |
| **Deployer SOL balance after** | `_FILL_ME_` SOL (from `solana balance --keypair …`)                |
| **Build commit**               | `_FILL_ME_` (`git rev-parse --short HEAD` at deploy time)          |

---

## 2 · Program IDs

After `pnpm run devnet:deploy` writes `config/program-ids.devnet.json`,
copy the four IDs below and link each to its Solscan page so reviewers
can verify on chain. Devnet Solscan URL pattern:
`https://solscan.io/account/<PROGRAM_ID>?cluster=devnet`

| Program                | Program ID  | Solscan                                                     |
| ---------------------- | ----------- | ----------------------------------------------------------- |
| `roundfi-core`         | `_FILL_ME_` | [view](https://solscan.io/account/_FILL_ME_?cluster=devnet) |
| `roundfi-reputation`   | `_FILL_ME_` | [view](https://solscan.io/account/_FILL_ME_?cluster=devnet) |
| `roundfi-yield-mock`   | `_FILL_ME_` | [view](https://solscan.io/account/_FILL_ME_?cluster=devnet) |
| `roundfi-yield-kamino` | `_FILL_ME_` | [view](https://solscan.io/account/_FILL_ME_?cluster=devnet) |

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

| Step                                | Tx Signature | Solscan                                                |
| ----------------------------------- | ------------ | ------------------------------------------------------ |
| Deploy `core`                       | `_FILL_ME_`  | [view](https://solscan.io/tx/_FILL_ME_?cluster=devnet) |
| Deploy `reputation`                 | `_FILL_ME_`  | [view](https://solscan.io/tx/_FILL_ME_?cluster=devnet) |
| Deploy `yield-mock`                 | `_FILL_ME_`  | [view](https://solscan.io/tx/_FILL_ME_?cluster=devnet) |
| Deploy `yield-kamino`               | `_FILL_ME_`  | [view](https://solscan.io/tx/_FILL_ME_?cluster=devnet) |
| `initialize_protocol`               | `_FILL_ME_`  | [view](https://solscan.io/tx/_FILL_ME_?cluster=devnet) |
| `initialize_reputation`             | `_FILL_ME_`  | [view](https://solscan.io/tx/_FILL_ME_?cluster=devnet) |
| Seed demo pool (`pnpm devnet:seed`) | `_FILL_ME_`  | [view](https://solscan.io/tx/_FILL_ME_?cluster=devnet) |

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

| Date         | Build commit | Deployer    | Reason                                                                  | Notes                                                                                                            |
| ------------ | ------------ | ----------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| _yyyy-mm-dd_ | `_FILL_ME_`  | `_FILL_ME_` | Initial v1.1 deploy (TransferDelegate plugin + PDF-canonical waterfall) | First deployment after the audit hardening cluster (#122-#127) and the listings/buys session integration (#156). |

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
