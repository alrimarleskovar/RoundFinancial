# RoundFi — Devnet Deployment Record

**Cluster:** Solana **Devnet** · **Status:** ✅ Full M3 protocol surface exercised on-chain (2026-05-07). **Pool 1** (`5APoECXz…c8ooa`) ran the full 3-cycle ROSCA end-to-end (9 contribs LATE → 3 claim_payouts → `Pool.status = Completed` → `release_escrow` reverts with `EscrowLocked` because `on_time_count = 0`, durable failed-tx evidence). **Pool 2** (`8XZxRSqU…twbujm`, cycle_duration=3600s) added the missing pieces: ON-TIME contribs (so `on_time_count = 1`), **`deposit_idle_to_yield` + `harvest_yield` driving the full PDF-canonical waterfall** with realized=0.5 USDC (protocol fee 0.10 transferred to treasury, GF/LP/participants earmarks accrued), and **positive-path `release_escrow`** — member 0 received their first checkpoint's vested portion (5 USDC of stake). Combined evidence: 4 programs deployed, 2 ROSCA pools driven across 14 distinct ix paths, 13 reputation attestations on-chain, 2 Triple Shield guards captured firing (`WaterfallUnderflow` via top-up flow + `EscrowLocked` via failed release), 7 Solana 3.x stack workarounds applied (`create_pool` split + Box<> on `JoinPool` / `Contribute` / `ClaimPayout` / `ReleaseEscrow` / `DepositIdleToYield` / `HarvestYield`).

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

| Step                                                                                                        | Tx Signature                                                                               | Solscan                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy `reputation`                                                                                         | `TkT3pk6W7pED5BWGKYDMQGjwkg6M9xf8USpUkS5w4yweoyamdY1a4LzCAyWkbVi39KYCFs6evsMa6RZ9ctFScpM`  | [view](https://solscan.io/tx/TkT3pk6W7pED5BWGKYDMQGjwkg6M9xf8USpUkS5w4yweoyamdY1a4LzCAyWkbVi39KYCFs6evsMa6RZ9ctFScpM?cluster=devnet)  |
| Deploy `core`                                                                                               | `3jbdE3u2bdmdzHKiWPa9j3wdo7QP1hJdeEUDzdX4ENWkXPkAYk5gcpBHuvn668XAY8WbwNxhPfhV6tkaKKN8ehRV` | [view](https://solscan.io/tx/3jbdE3u2bdmdzHKiWPa9j3wdo7QP1hJdeEUDzdX4ENWkXPkAYk5gcpBHuvn668XAY8WbwNxhPfhV6tkaKKN8ehRV?cluster=devnet) |
| Deploy `yield-kamino`                                                                                       | `21RmNi2PgZqs9TVaL8uxiqcZBQGkHCKUGS9EQDauEhWu6JWLmiHeR8JaW6KFnSCAKSqUpQagrGYW6iyy5TjWzyS3` | [view](https://solscan.io/tx/21RmNi2PgZqs9TVaL8uxiqcZBQGkHCKUGS9EQDauEhWu6JWLmiHeR8JaW6KFnSCAKSqUpQagrGYW6iyy5TjWzyS3?cluster=devnet) |
| Deploy `yield-mock`                                                                                         | `3U4C4JVqxhrd2d343DQqgRGgqb1a8VdQXMBkFtqy148UnEBwrH8ia76PdG776qvxGNnMVqX62FVQGG6QVZ61RTGY` | [view](https://solscan.io/tx/3U4C4JVqxhrd2d343DQqgRGgqb1a8VdQXMBkFtqy148UnEBwrH8ia76PdG776qvxGNnMVqX62FVQGG6QVZ61RTGY?cluster=devnet) |
| Create treasury ATA                                                                                         | `4s5ESCkvapynecLDGpd9iSvBWEirtVuND9rxLsMa8kHNxowHZQAXwCQssb4SDdSH12eYtuGTQLvRUBabrTm8Hbfq` | [view](https://solscan.io/tx/4s5ESCkvapynecLDGpd9iSvBWEirtVuND9rxLsMa8kHNxowHZQAXwCQssb4SDdSH12eYtuGTQLvRUBabrTm8Hbfq?cluster=devnet) |
| `initialize_protocol`                                                                                       | `3gCY7MpttUhiHejEgxA67FvkzEjrdRYZ99chcFDpbSKBrJAizZqkcuCVCgaC6ZHRCUrcvezGkhe3LN8uWUfrXNUz` | [view](https://solscan.io/tx/3gCY7MpttUhiHejEgxA67FvkzEjrdRYZ99chcFDpbSKBrJAizZqkcuCVCgaC6ZHRCUrcvezGkhe3LN8uWUfrXNUz?cluster=devnet) |
| `initialize_reputation`                                                                                     | `59Sgz1G59g2Q3usdk2qVxGVFcQSDU5RhAPSNypY5QJ8oqRRNBqq1VJbgBWh3ymVaBRLm1yJJE2bYYH3wP1PALCn1` | [view](https://solscan.io/tx/59Sgz1G59g2Q3usdk2qVxGVFcQSDU5RhAPSNypY5QJ8oqRRNBqq1VJbgBWh3ymVaBRLm1yJJE2bYYH3wP1PALCn1?cluster=devnet) |
| `roundfi_core` upgrade (split fix)                                                                          | `56Fia9v3nYzhRTmYjwuwvdvcFmZYsCdXr8Nh4QicTE6pYyhCPMerYabuAtbrFYk9RVfv8moXkANFYYTE15KWSiwH` | [view](https://solscan.io/tx/56Fia9v3nYzhRTmYjwuwvdvcFmZYsCdXr8Nh4QicTE6pYyhCPMerYabuAtbrFYk9RVfv8moXkANFYYTE15KWSiwH?cluster=devnet) |
| `create_pool`                                                                                               | `2Emh1snRJgSRsypcwSgZUe21Duw6pKrQk4e16NJQh3CLi9ehaQGQPnj1RJvEAyPu3icjmThM4ehnk55sn8GE8urS` | [view](https://solscan.io/tx/2Emh1snRJgSRsypcwSgZUe21Duw6pKrQk4e16NJQh3CLi9ehaQGQPnj1RJvEAyPu3icjmThM4ehnk55sn8GE8urS?cluster=devnet) |
| `init_pool_vaults` (4 vault ATAs)                                                                           | `zmnoexdEA8VVwLDNQJPVh8eVPdiLK5EThEAh7rbWiVJNrjQCzyCExXpmDtQL73DdUKm1vpmNd5pNWqeVo3iumnx`  | [view](https://solscan.io/tx/zmnoexdEA8VVwLDNQJPVh8eVPdiLK5EThEAh7rbWiVJNrjQCzyCExXpmDtQL73DdUKm1vpmNd5pNWqeVo3iumnx?cluster=devnet)  |
| `roundfi_core` upgrade (JoinPool box)                                                                       | `Df8EQFNsT3EuN1xSUifdexe7BtDnTaq7ytAQbzZqB6PnKBfgtbVgAW9MKtotq73TzvuMuUKNXHnhAJFBsk6Cxg9`  | [view](https://solscan.io/tx/Df8EQFNsT3EuN1xSUifdexe7BtDnTaq7ytAQbzZqB6PnKBfgtbVgAW9MKtotq73TzvuMuUKNXHnhAJFBsk6Cxg9?cluster=devnet)  |
| `join_pool` member 0                                                                                        | `2UrRDG9f6Dq8rZE3h1t5decBPrSV5gLacHBNhbKUvEBCyjQDuC5htJNbkVxuHwD5srPu7xT6F7AGB3bJpAoddnLD` | [view](https://solscan.io/tx/2UrRDG9f6Dq8rZE3h1t5decBPrSV5gLacHBNhbKUvEBCyjQDuC5htJNbkVxuHwD5srPu7xT6F7AGB3bJpAoddnLD?cluster=devnet) |
| `join_pool` member 1                                                                                        | `3GJUTibE3LEn9zaJT7BdqpHKnKy8ZnPzysbYUEo6b3uxV8bbypmvAgcKtTNsGbhjfhfPzWejiaTGhkoAEvPSwU8k` | [view](https://solscan.io/tx/3GJUTibE3LEn9zaJT7BdqpHKnKy8ZnPzysbYUEo6b3uxV8bbypmvAgcKtTNsGbhjfhfPzWejiaTGhkoAEvPSwU8k?cluster=devnet) |
| `join_pool` member 2                                                                                        | `3L7dtnuaR4arvAjMuAFSofJpuSLunxz8ajWWRDbUw3d9wdgzgBPEA5x1a1yvZh6cikPVHieUkbvkNaooDqhceYSJ` | [view](https://solscan.io/tx/3L7dtnuaR4arvAjMuAFSofJpuSLunxz8ajWWRDbUw3d9wdgzgBPEA5x1a1yvZh6cikPVHieUkbvkNaooDqhceYSJ?cluster=devnet) |
| `roundfi_core` upgrade (Contribute box)                                                                     | `5RdnRcov49bkjUMnddVDLRuaGfxDEd5dhAvr3jH6uMCw9vznwALUPAMooibSGtDwYZRUnCanGB6s89dJjDDBsqBG` | [view](https://solscan.io/tx/5RdnRcov49bkjUMnddVDLRuaGfxDEd5dhAvr3jH6uMCw9vznwALUPAMooibSGtDwYZRUnCanGB6s89dJjDDBsqBG?cluster=devnet) |
| `contribute` cycle 0 / member 0                                                                             | `ysSSQJhk8Frn87ng4dPGvePaNeLGeU45GHkNY75XPw7ACMymmFDUvHLEeyaRFkkWbogHHqXqAYasNVhp22o6HHW`  | [view](https://solscan.io/tx/ysSSQJhk8Frn87ng4dPGvePaNeLGeU45GHkNY75XPw7ACMymmFDUvHLEeyaRFkkWbogHHqXqAYasNVhp22o6HHW?cluster=devnet)  |
| `contribute` cycle 0 / member 1                                                                             | `3MwScoes8KrzqWy3QUUeEhqmejKfN44kTXzkY41rYZqfoLFiEKK9yT2m3cQjh27FjJrCbDeHd8AoTSy4JAGicMYJ` | [view](https://solscan.io/tx/3MwScoes8KrzqWy3QUUeEhqmejKfN44kTXzkY41rYZqfoLFiEKK9yT2m3cQjh27FjJrCbDeHd8AoTSy4JAGicMYJ?cluster=devnet) |
| `contribute` cycle 0 / member 2                                                                             | `yTVakGwDwvWUEXYpzCBuvW2t9D2XWsyLwr1eJN8weWgPGqcuhqHRyN7Vx871f3xHXVgVc6z41EW899bYT9x1iDT`  | [view](https://solscan.io/tx/yTVakGwDwvWUEXYpzCBuvW2t9D2XWsyLwr1eJN8weWgPGqcuhqHRyN7Vx871f3xHXVgVc6z41EW899bYT9x1iDT?cluster=devnet)  |
| `roundfi_core` upgrade (ClaimPayout box)                                                                    | `4LrahHnk2dE9uGnUph751ojobkzhKk8sMSun6ZdG3rzYgo9bRpni2rx83PQ4wyqVzbCeTUz47zc7pLo74vGKtc9P` | [view](https://solscan.io/tx/4LrahHnk2dE9uGnUph751ojobkzhKk8sMSun6ZdG3rzYgo9bRpni2rx83PQ4wyqVzbCeTUz47zc7pLo74vGKtc9P?cluster=devnet) |
| Pool float top-up (deployer → pool USDC, $7.80)                                                             | `4dEaTvFrHnztJoK9GwM2E7rqnDFtxUSEgtc8iq4xoU1LGCNEGc97kUkAJQSuxJzXWFkwoye7Bq93YrjC2H7pKpe8` | [view](https://solscan.io/tx/4dEaTvFrHnztJoK9GwM2E7rqnDFtxUSEgtc8iq4xoU1LGCNEGc97kUkAJQSuxJzXWFkwoye7Bq93YrjC2H7pKpe8?cluster=devnet) |
| `claim_payout` cycle 0 / slot 0 (member 0 receives $30)                                                     | `5fx4VLEtgbVuXDrXs9rCcAmJarJx6UWWYoeVonQXLQ7JqC5HnMYTNqKNSzjKiroL8s6ZH1UpxpQBmETFKZxpqpab` | [view](https://solscan.io/tx/5fx4VLEtgbVuXDrXs9rCcAmJarJx6UWWYoeVonQXLQ7JqC5HnMYTNqKNSzjKiroL8s6ZH1UpxpQBmETFKZxpqpab?cluster=devnet) |
| `contribute` cycle 1 / member 0                                                                             | `3hqMZGBH4eosuuJ38PewMs1WMu8maUTuW6PP1a1qP1pE6aJzxHHJgPPtMorJtsYnzJ7WA83LsWoQjTHu7gBJGBdB` | [view](https://solscan.io/tx/3hqMZGBH4eosuuJ38PewMs1WMu8maUTuW6PP1a1qP1pE6aJzxHHJgPPtMorJtsYnzJ7WA83LsWoQjTHu7gBJGBdB?cluster=devnet) |
| `contribute` cycle 1 / member 1                                                                             | `CFt7rHWnHY5AqMWCLPs9Rg3dgyjs8BYwUM4dRKm5yaUyPZARcygucnsa2f2EmdRvbgQ9xF49v5b52tfRgJBeY9G`  | [view](https://solscan.io/tx/CFt7rHWnHY5AqMWCLPs9Rg3dgyjs8BYwUM4dRKm5yaUyPZARcygucnsa2f2EmdRvbgQ9xF49v5b52tfRgJBeY9G?cluster=devnet)  |
| `contribute` cycle 1 / member 2                                                                             | `P3iaunviiq5QXMiuochuorRApukMsk1TK3RUaCeftQ2TVkDN452phWxVkR4wmhtwuXWZXQEKqSsnkKu8WpsGRmM`  | [view](https://solscan.io/tx/P3iaunviiq5QXMiuochuorRApukMsk1TK3RUaCeftQ2TVkDN452phWxVkR4wmhtwuXWZXQEKqSsnkKu8WpsGRmM?cluster=devnet)  |
| Pool float top-up (cycle 1, $7.80)                                                                          | `HwC3ZGd18Ss2HehP5STSaXZD8GDtS86tK4DyYiYQUUVAom8kWpYXNKHNfMFWhoJVignuEXHFeVeSf2goYC7gWgD`  | [view](https://solscan.io/tx/HwC3ZGd18Ss2HehP5STSaXZD8GDtS86tK4DyYiYQUUVAom8kWpYXNKHNfMFWhoJVignuEXHFeVeSf2goYC7gWgD?cluster=devnet)  |
| `claim_payout` cycle 1 / slot 1 (member 1 receives $30)                                                     | `4KEmjibkqrTRxkcPQzP36qALiaRZqJXsr7EHMZqxnWyWQBWKTsBauivRxAUswBqboXyQc1v1kcorQeVZfBCyye1o` | [view](https://solscan.io/tx/4KEmjibkqrTRxkcPQzP36qALiaRZqJXsr7EHMZqxnWyWQBWKTsBauivRxAUswBqboXyQc1v1kcorQeVZfBCyye1o?cluster=devnet) |
| `contribute` cycle 2 / member 0                                                                             | `4T1W7cBwJ8xV77dUK99qhgqB4fuadkaJa8yLcFUcavKchgHpwexvpseRgmygn6PtEFxd1tJfDPT1ERni5uz61mJ8` | [view](https://solscan.io/tx/4T1W7cBwJ8xV77dUK99qhgqB4fuadkaJa8yLcFUcavKchgHpwexvpseRgmygn6PtEFxd1tJfDPT1ERni5uz61mJ8?cluster=devnet) |
| `contribute` cycle 2 / member 1                                                                             | `5PHr9Qn8daHWHXqW97YnrfP3J7Z123TdcxL8nGQU9g2V1dDN2t79FJnJHwp5n95mDUkTTz4F6gDy7kbhG2sxsfsQ` | [view](https://solscan.io/tx/5PHr9Qn8daHWHXqW97YnrfP3J7Z123TdcxL8nGQU9g2V1dDN2t79FJnJHwp5n95mDUkTTz4F6gDy7kbhG2sxsfsQ?cluster=devnet) |
| `contribute` cycle 2 / member 2                                                                             | `3AQ3jxvUA8Mf6JGDdU71NuMqQuZdsAyikpoGzwjfdHwcJANhzo2Au3oxtgdSRDCBNDuhahWi8hg7WQXXKPq6VvQj` | [view](https://solscan.io/tx/3AQ3jxvUA8Mf6JGDdU71NuMqQuZdsAyikpoGzwjfdHwcJANhzo2Au3oxtgdSRDCBNDuhahWi8hg7WQXXKPq6VvQj?cluster=devnet) |
| Pool float top-up (cycle 2, $7.80)                                                                          | `4MgZk1C1ToenQ9pgDtURnh8iefGvzr2bZ6ACXayPCdjZjZbEzzzQqAbpJkE13xNDtPxNu9fupEJgQdjkUwjkZJHH` | [view](https://solscan.io/tx/4MgZk1C1ToenQ9pgDtURnh8iefGvzr2bZ6ACXayPCdjZjZbEzzzQqAbpJkE13xNDtPxNu9fupEJgQdjkUwjkZJHH?cluster=devnet) |
| `claim_payout` cycle 2 / slot 2 (member 2 receives $30, pool ⇒ Completed)                                   | `4bjda3tX5p1tqQkRFKDnX2NbEGKqUqAadRiEE8LdTGStNmJCsnwHbxDop1Z5cJzpyT1XuhAtjV6ytXZm9gmMKfwc` | [view](https://solscan.io/tx/4bjda3tX5p1tqQkRFKDnX2NbEGKqUqAadRiEE8LdTGStNmJCsnwHbxDop1Z5cJzpyT1XuhAtjV6ytXZm9gmMKfwc?cluster=devnet) |
| `roundfi_core` upgrade (ReleaseEscrow box)                                                                  | `2ZdLfQ9tRLED1oWqg3FRbBX9SLdts3yjHKn4cqsZKCWfT3kSXVKkJr4aLMdTjjkcXhzNiB8xFigqa2CQvZBoMmvF` | [view](https://solscan.io/tx/2ZdLfQ9tRLED1oWqg3FRbBX9SLdts3yjHKn4cqsZKCWfT3kSXVKkJr4aLMdTjjkcXhzNiB8xFigqa2CQvZBoMmvF?cluster=devnet) |
| `release_escrow` negative test (member 0, checkpoint 1) — **failed on-chain with `EscrowLocked` code 6011** | `4wB8RqiP57qQMNi6Vs6yLckkurm1pzqv2zoGev4duyaPWvCJoMdZEynfHTCjfitrGXenbUbsPRjdZG1xTZY8f5Mn` | [view](https://solscan.io/tx/4wB8RqiP57qQMNi6Vs6yLckkurm1pzqv2zoGev4duyaPWvCJoMdZEynfHTCjfitrGXenbUbsPRjdZG1xTZY8f5Mn?cluster=devnet) |

### Pool 2 (`8XZxRSqU…twbujm`, cycle_duration = 3600s) — yield + positive release

| Step                                                                                                           | Tx Signature                                                                               | Solscan                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `roundfi_core` upgrade (Box DepositIdleToYield + HarvestYield + Pool 2 enablement #174)                        | `5ZMPG5pYePYbnckpSPzLGzh5hdgojasXGAWtphywTkHn8LdhSGfuVPruyUfKgb7bEdvFG3sjLE4c5YHN5PQ9upz1` | [view](https://solscan.io/tx/5ZMPG5pYePYbnckpSPzLGzh5hdgojasXGAWtphywTkHn8LdhSGfuVPruyUfKgb7bEdvFG3sjLE4c5YHN5PQ9upz1?cluster=devnet) |
| `create_pool` (POOL_SEED_ID=2)                                                                                 | `2yKtPE72B7vTuwj78aQ7KiXJJuC6sqdPdVJLjvG5cbNzmjdxfYWgQiEM4X7LGaG586SizpGVr52AdiTZc48q9eTB` | [view](https://solscan.io/tx/2yKtPE72B7vTuwj78aQ7KiXJJuC6sqdPdVJLjvG5cbNzmjdxfYWgQiEM4X7LGaG586SizpGVr52AdiTZc48q9eTB?cluster=devnet) |
| `init_pool_vaults` (4 vault ATAs)                                                                              | `38KhhJxfT2bwr72takotc1f9x8BpstFY2C3PYDEc5reYNhFXtgijdiciVZx4gkiStG7wFEaBcjCU6rvDsfgXgNrZ` | [view](https://solscan.io/tx/38KhhJxfT2bwr72takotc1f9x8BpstFY2C3PYDEc5reYNhFXtgijdiciVZx4gkiStG7wFEaBcjCU6rvDsfgXgNrZ?cluster=devnet) |
| `roundfi_yield_mock.init_vault` (state PDA + yield vault)                                                      | `64oGarnSZWDSoDcHCn9bcLFYW4zU7TKXLGJSSktd1zw8eT1yhx2q9NJ7Uxq83cmNtjJqaYHJ9cTProvFhbdXDTGs` | [view](https://solscan.io/tx/64oGarnSZWDSoDcHCn9bcLFYW4zU7TKXLGJSSktd1zw8eT1yhx2q9NJ7Uxq83cmNtjJqaYHJ9cTProvFhbdXDTGs?cluster=devnet) |
| `join_pool` member 0                                                                                           | `Hy3YwtMa2Czb1rMARABoZEt87QfFJMetLustW8cioHyY1V2eL8bUd8LMLS7yboBKtoMNQ5xqGck6D27FJbFGm5v`  | [view](https://solscan.io/tx/Hy3YwtMa2Czb1rMARABoZEt87QfFJMetLustW8cioHyY1V2eL8bUd8LMLS7yboBKtoMNQ5xqGck6D27FJbFGm5v?cluster=devnet)  |
| `join_pool` member 1                                                                                           | `5DRSxQdawSWqwDaBco638G6pvM7DHLocG4ZUaKLc3Nk7Bk9615CryWkBtdDqPSEcXZCzKH32arXtAkX9otCqsypH` | [view](https://solscan.io/tx/5DRSxQdawSWqwDaBco638G6pvM7DHLocG4ZUaKLc3Nk7Bk9615CryWkBtdDqPSEcXZCzKH32arXtAkX9otCqsypH?cluster=devnet) |
| `join_pool` member 2                                                                                           | `4K3hi3SUWri14t7z5xQ4aMoQBCBH2S8RiYbTGDV1JbjDZfk91AAkx9PKKkAFQY5PupnG59MLMBZuwrHCnP1HtRtc` | [view](https://solscan.io/tx/4K3hi3SUWri14t7z5xQ4aMoQBCBH2S8RiYbTGDV1JbjDZfk91AAkx9PKKkAFQY5PupnG59MLMBZuwrHCnP1HtRtc?cluster=devnet) |
| `roundfi_core` upgrade (treasury check uses key()) — fix                                                       | `5cFrATuQorEB7t9UCXdq2cuZDWztTv8fd6PjY7Jxjp4x1nsUoVXQDoAGGP5E9fTdvwuHf1Drk1jUhKwDomoeKQXX` | [view](https://solscan.io/tx/5cFrATuQorEB7t9UCXdq2cuZDWztTv8fd6PjY7Jxjp4x1nsUoVXQDoAGGP5E9fTdvwuHf1Drk1jUhKwDomoeKQXX?cluster=devnet) |
| `deposit_idle_to_yield` (10 USDC across 2 calls + 0.5 pre-fund)                                                | `3gAbmM48vEQRRwk39oTeRET4mGD2jFrx8xRiDnAfQNxr7zn5TZbExgCM1BFPnEmEr78p7xCZy74brWRstKnyU3kp` | [view](https://solscan.io/tx/3gAbmM48vEQRRwk39oTeRET4mGD2jFrx8xRiDnAfQNxr7zn5TZbExgCM1BFPnEmEr78p7xCZy74brWRstKnyU3kp?cluster=devnet) |
| Yield vault pre-fund (deployer → vault, 0.5 USDC, simulates accrued APY)                                       | `26DN91xosAcKJKWafQY91rSEqCCjvKRc4zF1sP3iGCnRmPCZGbGTSHaNkq7AhvwesGuQqHxYmb5QZoKfoHvy3gf2` | [view](https://solscan.io/tx/26DN91xosAcKJKWafQY91rSEqCCjvKRc4zF1sP3iGCnRmPCZGbGTSHaNkq7AhvwesGuQqHxYmb5QZoKfoHvy3gf2?cluster=devnet) |
| **`harvest_yield` — realized 0.5 USDC, waterfall split (fee → treasury, GF/LP/participants earmarks accrued)** | `U1vK5GXMMWRhiuSEQ3ByfKDeHuBNrk6EVciC3CYRZaX4YPWTYFzBipsjBZbV4CVARjyPte47V1AcpgE33u1sdmq`  | [view](https://solscan.io/tx/U1vK5GXMMWRhiuSEQ3ByfKDeHuBNrk6EVciC3CYRZaX4YPWTYFzBipsjBZbV4CVARjyPte47V1AcpgE33u1sdmq?cluster=devnet)  |
| **`release_escrow` POSITIVE — member 0 receives 5 USDC of vested stake (1/3 × $15)**                           | `5BvLSatc9gbmaRJLjJnP9YLhHEHcCFN2thfZ5wZAL9kGjL4mkUSAL89jcszbwKLgd7rFFg5dZnpycTZVWxFcHVQm` | [view](https://solscan.io/tx/5BvLSatc9gbmaRJLjJnP9YLhHEHcCFN2thfZ5wZAL9kGjL4mkUSAL89jcszbwKLgd7rFFg5dZnpycTZVWxFcHVQm?cluster=devnet) |

> Pool 2's claim_payout flow is intentionally NOT exercised: each
> member's wallet already received a `SCHEMA_CYCLE_COMPLETE` attestation
> during pool 1's three claims, and the reputation program enforces a
> 6-day per-subject cooldown (`MIN_CYCLE_COOLDOWN_SECS = 518_400`). That
> guard is anti-gaming protection for the production score (prevents
> spinning up fake pools to spam attestations); it works as designed.
> Pool 1 already covers the claim_payout positive path three times
> (#171), so pool 2's value is the missing pieces — yield + positive
> release.

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

| Account                                                 | Address                                        | Type                        | Solscan                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| `ProtocolConfig` PDA                                    | `3c9MmoM8ZGQGCrKMFGvJcCtvD78jEPa2JZtLwTvJoTMV` | Anchor account (core)       | [view](https://solscan.io/account/3c9MmoM8ZGQGCrKMFGvJcCtvD78jEPa2JZtLwTvJoTMV?cluster=devnet) |
| `ReputationConfig` PDA                                  | `7RDWsSDcYYjn31E2dL2hbU3YQFFTvh2Wg8nxDsAXaXo4` | Anchor account (reputation) | [view](https://solscan.io/account/7RDWsSDcYYjn31E2dL2hbU3YQFFTvh2Wg8nxDsAXaXo4?cluster=devnet) |
| Treasury USDC ATA                                       | `5ggMVBCqCfjwzKegvwMs3dpJqYDYNxmgnpubb55CVQX5` | SPL token account           | [view](https://solscan.io/account/5ggMVBCqCfjwzKegvwMs3dpJqYDYNxmgnpubb55CVQX5?cluster=devnet) |
| **`Pool` PDA** (demo, 3-member, $30 carta)              | `5APoECXzJwr6j6xXGsqkT6GRSWNVDm4NSQB3KLhc8ooa` | Anchor account (core)       | [view](https://solscan.io/account/5APoECXzJwr6j6xXGsqkT6GRSWNVDm4NSQB3KLhc8ooa?cluster=devnet) |
| Member 0 PDA (slot 0, Lv1, $15 stake)                   | `4r2Pd9qvL5iDyh7689rTsXVrAYoocoSsoR4bLZJhADc5` | Anchor account (core)       | [view](https://solscan.io/account/4r2Pd9qvL5iDyh7689rTsXVrAYoocoSsoR4bLZJhADc5?cluster=devnet) |
| Member 1 PDA (slot 1, Lv1, $15 stake)                   | `3Sr4M88HDY3f1hnWJR7dznSvjCoRB4bTwGMDvAVNeEnm` | Anchor account (core)       | [view](https://solscan.io/account/3Sr4M88HDY3f1hnWJR7dznSvjCoRB4bTwGMDvAVNeEnm?cluster=devnet) |
| Member 2 PDA (slot 2, Lv1, $15 stake)                   | `6ymEiWiAU6oJT4i5MisJDCZTSqtuvbfBKccVfdocYiaa` | Anchor account (core)       | [view](https://solscan.io/account/6ymEiWiAU6oJT4i5MisJDCZTSqtuvbfBKccVfdocYiaa?cluster=devnet) |
| **`Pool 2` PDA** (POOL_SEED_ID=2, cycle_duration=3600s) | `8XZxRSqUDEvhVENxxnhNKM8htZTmVuyQgYbZXmtwbujm` | Anchor account (core)       | [view](https://solscan.io/account/8XZxRSqUDEvhVENxxnhNKM8htZTmVuyQgYbZXmtwbujm?cluster=devnet) |
| Pool 2 Member 0 PDA (slot 0, Lv1)                       | `FnkSyswpsLG3oUcaiJAHuqHo1bLNdoRAZBbwoJyvkbXt` | Anchor account (core)       | [view](https://solscan.io/account/FnkSyswpsLG3oUcaiJAHuqHo1bLNdoRAZBbwoJyvkbXt?cluster=devnet) |
| Pool 2 Member 1 PDA (slot 1, Lv1)                       | `AM3XJoW28v2yLWLSRJ6nHsES6zPdFCA97XfjoFE8AD9g` | Anchor account (core)       | [view](https://solscan.io/account/AM3XJoW28v2yLWLSRJ6nHsES6zPdFCA97XfjoFE8AD9g?cluster=devnet) |
| Pool 2 Member 2 PDA (slot 2, Lv1)                       | `BosuNXisQNN1mSRrKZs8J8oaqp7E2R8wQoEnjv5D591F` | Anchor account (core)       | [view](https://solscan.io/account/BosuNXisQNN1mSRrKZs8J8oaqp7E2R8wQoEnjv5D591F?cluster=devnet) |
| Pool 2 yield_mock state PDA                             | `6h1mj5HU3eJKFEwridjZ4kCz1QdSddUKRqCncdpMVExd` | Anchor account (yield_mock) | [view](https://solscan.io/account/6h1mj5HU3eJKFEwridjZ4kCz1QdSddUKRqCncdpMVExd?cluster=devnet) |
| Pool 2 yield vault ATA (state-PDA-owned)                | `2Attqh7w2FjsuP4VN98PHFnC67cNgFhfwPoJtenCpxqE` | SPL token account           | [view](https://solscan.io/account/2Attqh7w2FjsuP4VN98PHFnC67cNgFhfwPoJtenCpxqE?cluster=devnet) |

The pool's four USDC vault ATAs land in the same `init_pool_vaults` tx — they're derivable as `getAssociatedTokenAddress(USDC_MINT, <authority_pda>)` where the four authorities are PDAs from `[SEED_X, pool.key()]`:

| Vault              | Authority seed prefix | Purpose                                                               |
| ------------------ | --------------------- | --------------------------------------------------------------------- |
| `pool_usdc_vault`  | `b"pool"` (Pool PDA)  | Active settlement pot — installments land here                        |
| `escrow_vault`     | `b"escrow"`           | Member stake escrow — locked Lv2 stake (~$9 each at 30% × $30 credit) |
| `solidarity_vault` | `b"solidarity"`       | Cofre Solidário — 1% of every installment (Triple Shield 1st cushion) |
| `yield_vault`      | `b"yield"`            | Parked-USDC source for the Kamino-bound yield adapter                 |

PDAs are deterministic — re-running `pnpm devnet:init` and `pnpm devnet:seed` against the same cluster + program IDs is idempotent (both scripts detect existing PDAs/ATAs and print "skipping").

After `pnpm devnet:seed-cycle`, three additional `Attestation` PDAs (one per member, owned by `roundfi_reputation`) record cycle 0 contributions. Each is derived as `[b"attestation", pool, member_wallet, schema_id_le, nonce_le]` where `schema_id = 2` (`SCHEMA_LATE` — payments landed ~21 minutes after the 60-second cycle window) and `nonce = (cycle as u64) << 32 | (slot_index as u64)`. The driver script picks the right schema based on cluster `blockTime` vs `pool.next_cycle_at` so the off-chain PDA derivation always matches the address the on-chain handler will write to.

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

| Date       | Build commit | Deployer                                       | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-07 | `9cefb5a`    | `64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm` | Full M3 protocol surface exercised on devnet across **two pools**. **Pool 1**: 3-cycle ROSCA closed end-to-end (9 contribs LATE → 3 claim_payouts → Completed → release_escrow reverts with EscrowLocked because on_time_count=0). **Pool 2** (cycle_duration=3600s): ON-TIME contribs + `deposit_idle_to_yield` + `harvest_yield` running the full PDF-canonical waterfall (realized 0.5 USDC, 20% protocol fee transferred to treasury, GF/LP/participants logical earmarks accrued) + **positive-path `release_escrow`** (member 0 received 5 USDC of vested stake). 13 reputation `Attestation` PDAs, 2 Triple Shield guards captured firing, 7 Solana 3.x Box workarounds applied. | Ten sessions on the same day, culminating in #174. (1) Three programs deploy. (2) `roundfi-yield-mock` deploy after 8h faucet cooldown. (3) `initialize_protocol` + `initialize_reputation` (#162). (4) `create_pool` + `init_pool_vaults` for Pool 1 (#164) — split required to dodge Solana 3.x stack overflow. (5) `seed-members` (#166) — Box on `JoinPool`. (6) `seed-cycle` (#168) — Box on `Contribute`, schema selection. (7) `seed-claim` (#169) — Box on `ClaimPayout`, top-up flow proxies the Yield Cascade. (8) Cycles 1 + 2 (#171) — `Pool 1.status = Completed`. (9) `seed-release` negative test (#172) — Box on `ReleaseEscrow`, `EscrowLocked` durable failed-tx evidence. (10) **Pool 2 + yield drivers (#174)**: refactor of all scripts to accept `POOL_SEED_ID` + `CYCLE_DURATION_SEC` env vars; Box on `DepositIdleToYield` + `HarvestYield`; `roundfi_yield_mock.init_vault` driver; `deposit_idle_to_yield` + pre-fund driver (simulates accrued APY); `harvest_yield` driver that runs the full PDF waterfall; treasury constraint fix (`key()` not `owner()`); positive-path `release_escrow` (`on_time_count >= checkpoint`). Combined evidence is the full M3 protocol surface — every M3 instruction now has an on-chain receipt. Next M3 step: app↔chain wiring (front-end modals firing real txs against the deployed pools). |

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
