# RoundFi — Devnet Deployment Record

**Cluster:** Solana **Devnet** · **Status:** ✅ Full M3 protocol surface exercised on-chain (2026-05-07) **including the Escape Valve secondary market, `settle_default` with a Triple Shield seizure on real funds, AND TWO browser-signed write txs (`contribute()` + `claim_payout()`) closing the M3 wiring loop end-to-end**. **Pool 1** (`5APoECXz…c8ooa`) ran the full 3-cycle ROSCA end-to-end (9 contribs LATE → 3 claim_payouts → `Pool.status = Completed` → `release_escrow` reverts with `EscrowLocked` durable failed-tx evidence). **Pool 2** (`8XZxRSqU…twbujm`, cycle_duration=3600s) added: ON-TIME contribs, **`deposit_idle_to_yield` + `harvest_yield` driving the full PDF-canonical waterfall** (realized 0.5 USDC, fee 0.10 → treasury, GF/LP/participants earmarks), **positive-path `release_escrow`** (member 0 received 5 USDC of vested stake), and **`escape_valve_list` + `escape_valve_buy`** — member 1 listed their position for $14, a fresh buyer wallet picked it up, atomic re-anchor closed the old Member PDA and minted a new one at the buyer's key with all bookkeeping carried over. **Pool 3** (`D9PS7Q…pDE5`, cycle_duration=60s) closed the protocol surface with **`settle_default`**: a fresh wallet set joined, slots 0+1 paid cycle 0 LATE while slot 2 fell behind ($5 USDC < $10 installment), `claim_payout(0)` advanced the cycle, and `settle_default(1)` fired the **Triple Shield waterfall** — drained $0.20 from the solidarity vault (the full balance contributed by the two paying members), left escrow + stake intact thanks to the D/C invariant, set `member.defaulted=true`, and wrote a `SCHEMA_DEFAULT` (id=3) attestation. **mpl-core owner-managed plugin bug discovered and fixed in flight**: `TransferV1` resets `FreezeDelegate` and `TransferDelegate` authorities to the new owner; the immediate re-freeze reverted with `0x1a`. Fix shipped (#176): re-approve both plugins back to `position_authority` post-transfer. Combined evidence: 4 programs deployed, 3 ROSCA pools driven across 18 distinct ix paths (including `close_pool` finalizing Pool 1 with a balanced summary log: total_contributed=$90, total_paid_out=$90, AND `settle_default` enforcing the Triple Shield), 14 reputation attestations on-chain (13 + the new SCHEMA_DEFAULT), **3 Triple Shield guards captured firing on real funds** (`WaterfallUnderflow`, `EscrowLocked`, **shield-1-only seizure**), **10 Solana 3.x Box<> workarounds applied** (now including SettleDefault), 1 protocol bug surfaced + fixed end-to-end.

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
| `roundfi_core` upgrade (escape_valve scripts + Box on List/Buy + first deploy of #176)                         | `2eE6Sm2PtMBJFt7aUAhwcg79UqXHwZUJZiH7P44wsrawaR745XatGmxSnRa7ndHssgWM2H2Wwwv84WdirW175Bg4` | [view](https://solscan.io/tx/2eE6Sm2PtMBJFt7aUAhwcg79UqXHwZUJZiH7P44wsrawaR745XatGmxSnRa7ndHssgWM2H2Wwwv84WdirW175Bg4?cluster=devnet) |
| `escape_valve_list` (member 1, slot 1, $14 USDC)                                                               | `4aFv9zbCB6ut82TaMEsXL9pt1ASkRTywGgfgiNGvSQUo4RJ9d1qtAJsPBmnV4upNqWfWM3Sr5sbmNT2mJG3jtzDu` | [view](https://solscan.io/tx/4aFv9zbCB6ut82TaMEsXL9pt1ASkRTywGgfgiNGvSQUo4RJ9d1qtAJsPBmnV4upNqWfWM3Sr5sbmNT2mJG3jtzDu?cluster=devnet) |
| `roundfi_core` upgrade (re-delegate plugins post-transfer fix)                                                 | `2RSZQLtqd8eepfz4kHGcDcupWCv7fbVvxKH4PTQWPST7B2QXN6zhCbQoSWrtSnZwVuAML8BEhZgVaE6uMeTX36tQ` | [view](https://solscan.io/tx/2RSZQLtqd8eepfz4kHGcDcupWCv7fbVvxKH4PTQWPST7B2QXN6zhCbQoSWrtSnZwVuAML8BEhZgVaE6uMeTX36tQ?cluster=devnet) |
| **`escape_valve_buy` POSITIVE — buyer pays $14, receives slot 1 NFT + Member PDA, atomic re-anchor**           | `3cdG3bWRmgMShw5vCQREY6tJ9HQh3VzW42GN55vdR7ZLPuBgrZhow3wGkPv97A9CTmP2VkVifVgnPTeHebGcgCpr` | [view](https://solscan.io/tx/3cdG3bWRmgMShw5vCQREY6tJ9HQh3VzW42GN55vdR7ZLPuBgrZhow3wGkPv97A9CTmP2VkVifVgnPTeHebGcgCpr?cluster=devnet) |
| `roundfi_core` upgrade (Box ClosePool, #178)                                                                   | `2QHc28Mpd4eZKwLsy9HejTazUqbefh7gYmxp8ZaPZUW5H39qwPUaaZgrb5AQMCsjaBsppP5k564zKQAA5XUm279P` | [view](https://solscan.io/tx/2QHc28Mpd4eZKwLsy9HejTazUqbefh7gYmxp8ZaPZUW5H39qwPUaaZgrb5AQMCsjaBsppP5k564zKQAA5XUm279P?cluster=devnet) |
| **`close_pool` Pool 1 — total_contributed=$90, total_paid_out=$90, balanced summary**                          | `ct6MiMvL6cYVpPpKraXfJhdameAwUtxGyJnAFCBqHYb8h4fbcirEZHWkUwkHQphfd7uDKnXLYYMvBiRBuE7b639`  | [view](https://solscan.io/tx/ct6MiMvL6cYVpPpKraXfJhdameAwUtxGyJnAFCBqHYb8h4fbcirEZHWkUwkHQphfd7uDKnXLYYMvBiRBuE7b639?cluster=devnet)  |

> Pool 2's claim_payout flow is intentionally NOT exercised: each
> member's wallet already received a `SCHEMA_CYCLE_COMPLETE` attestation
> during pool 1's three claims, and the reputation program enforces a
> 6-day per-subject cooldown (`MIN_CYCLE_COOLDOWN_SECS = 518_400`). That
> guard is anti-gaming protection for the production score (prevents
> spinning up fake pools to spam attestations); it works as designed.
> Pool 1 already covers the claim_payout positive path three times
> (#171), so pool 2's value is the missing pieces — yield + positive
> release + Escape Valve secondary market.

> **Found-and-fixed bug**: The first attempt at `escape_valve_buy`
> reverted with mpl-core custom error `0x1a` "Neither the asset or any
> plugins have approved this operation" because `TransferV1` resets
> owner-managed plugin authorities (FreezeDelegate / TransferDelegate)
> to the new owner — the position_authority PDA is no longer recognized
> as the plugin delegate post-transfer. The bankrun harness never
> exercised the positive path (only defense-in-depth `AssetNotRefrozen`
> guards that mpl-core's atomicity makes unreachable in practice), so
> the resetting behavior wasn't caught earlier. Fix (#176): insert two
> `ApprovePluginAuthorityV1` CPIs between Step 2 (transfer) and Step 3
> (re-freeze), each signed by `buyer_wallet` (the new asset owner) to
> re-delegate FreezeDelegate AND TransferDelegate back to
> `position_authority`. The post-fix tx (above) confirms the full flow:
> SPL transfer + close-old / init-new Member PDA + thaw / transfer /
> re-delegate / re-freeze NFT + close listing, all atomic.

### Pool 3 (`D9PS7Q…pDE5`, cycle_duration = 60s, GRACE_PERIOD = 60s) — settle_default + Triple Shield seizure

Pool 3 was provisioned with a **fresh wallet set** (`member-3` / `member-4` / `member-5`, picked via `MEMBER_INDEX_OFFSET=3`) so neither pool 1 nor pool 2's existing `SCHEMA_CYCLE_COMPLETE` attestations interfered with the default flow's `SCHEMA_DEFAULT` (id=3) write. `cycle_duration=60s` on pool creation + the devnet-only `GRACE_PERIOD_SECS=60` patch in `core/src/constants.rs` (was 7d in production) made the grace-elapsed precondition reachable in a single test run instead of needing a week.

| Step                                                                                                                                                                                                          | Tx Signature                                                                               | Solscan                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `roundfi_core` upgrade (Box `SettleDefault` + `GRACE_PERIOD_SECS=60` devnet patch + `MEMBER_INDEX_OFFSET` script refactor) — code-only, see 340432a                                                           | _(rebuilt locally before the devnet upgrade tx; see commit 340432a)_                       | —                                                                                                                                     |
| `create_pool` (`POOL_SEED_ID=3`, `cycle_duration=60s`)                                                                                                                                                        | _(earlier in same session — see Pool 3 PDA's tx history on Solscan)_                       | [pool tx history](https://solscan.io/account/D9PS7QDGUsAwHa4T6Gibw6HV9Lx2sbB5aZM5GsNzpDE5?cluster=devnet)                             |
| `init_pool_vaults` (4 vault ATAs)                                                                                                                                                                             | _(same)_                                                                                   | (same)                                                                                                                                |
| `join_pool` member-3 (slot 0)                                                                                                                                                                                 | _(same)_                                                                                   | (same)                                                                                                                                |
| `join_pool` member-4 (slot 1)                                                                                                                                                                                 | _(same)_                                                                                   | (same)                                                                                                                                |
| `join_pool` member-5 (slot 2)                                                                                                                                                                                 | _(same)_                                                                                   | (same)                                                                                                                                |
| `contribute` cycle 0 / member-3 (slot 0, `SCHEMA_LATE` — `now > pool.next_cycle_at + 60s`)                                                                                                                    | `HWeuu9J8uK2HgVeMCD4bEBiYCGdGfUTvapuFEXEDp8iGbqhVDeLDDdeF6hXDYRnZej14guUg8Hqv3Nw6gj61WEy`  | [view](https://solscan.io/tx/HWeuu9J8uK2HgVeMCD4bEBiYCGdGfUTvapuFEXEDp8iGbqhVDeLDDdeF6hXDYRnZej14guUg8Hqv3Nw6gj61WEy?cluster=devnet)  |
| `contribute` cycle 0 / member-4 (slot 1, `SCHEMA_LATE`)                                                                                                                                                       | `5YhGNfHY4FDsjq9tbSLe2pLtSvSysQV78XZALPbNXuY9xZSurdHviWnjs3MBRau4SKpsX1cjafD4UyHKFFeg3auz` | [view](https://solscan.io/tx/5YhGNfHY4FDsjq9tbSLe2pLtSvSysQV78XZALPbNXuY9xZSurdHviWnjs3MBRau4SKpsX1cjafD4UyHKFFeg3auz?cluster=devnet) |
| `contribute` cycle 0 / member-5 (slot 2) — **SKIPPED** by `seed-cycle.ts` pre-flight ATA balance check (`5 USDC < 10 USDC installment`)                                                                       | _(no tx — caught client-side; member-5 stays behind on purpose)_                           | —                                                                                                                                     |
| Pool float top-up (`deployer → pool USDC`, $15.20) — covers slot-0 claim despite slot-2's missing contribution                                                                                                | `532qSPCEBwgYLgjbmraZ4PotYM2H9N3qo6w9KW8yG6d2WBfZZjH6Vudpj4x7oRaVSH88qevSffWG2VxMrnBxAMsD` | [view](https://solscan.io/tx/532qSPCEBwgYLgjbmraZ4PotYM2H9N3qo6w9KW8yG6d2WBfZZjH6Vudpj4x7oRaVSH88qevSffWG2VxMrnBxAMsD?cluster=devnet) |
| `claim_payout` cycle 0 / slot 0 (member-3 receives $30; advances `pool.current_cycle` 0 → 1)                                                                                                                  | `4DEb5AQob2h7t2VjKS8bzdqTT5aQjbr7EoAePs9arDW66yfwKyth4JEiWwDUTiTvrjYs38D21bwuQSyHQnere7GD` | [view](https://solscan.io/tx/4DEb5AQob2h7t2VjKS8bzdqTT5aQjbr7EoAePs9arDW66yfwKyth4JEiWwDUTiTvrjYs38D21bwuQSyHQnere7GD?cluster=devnet) |
| **`settle_default` cycle 1 / slot 2 — Triple Shield fired, $0.20 seized from solidarity vault, `member.defaulted=true`**                                                                                      | `34UyAtEPH5iWXrzhMGLRJVYzt2Z314f4S9DbwmfXA8bfS3SKahgEYkTgFz6KGuX441ktPVVnEvLk19fuVAkNeJeG` | [view](https://solscan.io/tx/34UyAtEPH5iWXrzhMGLRJVYzt2Z314f4S9DbwmfXA8bfS3SKahgEYkTgFz6KGuX441ktPVVnEvLk19fuVAkNeJeG?cluster=devnet) |
| **`contribute` cycle 1 / member-3 (slot 0) — FIRST FRONT-END WRITE: signed by Phantom in the browser via `app/src/lib/contribute.ts` IDL-free encoder; member-3's USDC ATA: 45 → 35**                         | `37FZUtg7SrNuf2AfkiXAJsLTDambYfGowqdtgcAk1tWrjFKJ4X5NDEkRGwKAgkBzBXR9gn7vLBXqwCP7WvA8wg6f` | [view](https://solscan.io/tx/37FZUtg7SrNuf2AfkiXAJsLTDambYfGowqdtgcAk1tWrjFKJ4X5NDEkRGwKAgkBzBXR9gn7vLBXqwCP7WvA8wg6f?cluster=devnet) |
| Pool float top-up #2 (`deployer → pool USDC`, $22.90) — `seed-topup.ts` companion script; covers the gap so member-4 can claim cycle 1 from the browser                                                       | `3iFuuEwPnBzYpkqdEzGCvRMu1FTyhfS7bcajmrTsyS2bysX3drP8dLGeV7ZLPwUt6MpyqssA6CuribfdB84as9VQ` | [view](https://solscan.io/tx/3iFuuEwPnBzYpkqdEzGCvRMu1FTyhfS7bcajmrTsyS2bysX3drP8dLGeV7ZLPwUt6MpyqssA6CuribfdB84as9VQ?cluster=devnet) |
| **`claim_payout` cycle 1 / slot 1 (member-4) — SECOND FRONT-END WRITE: signed by Phantom in the browser via `app/src/lib/claim-payout.ts` IDL-free encoder; member-4 receives $30; pool.current_cycle 1 → 2** | `LKickMQ1fUJ38zawrYUT9UdtsQpy8kVyUF3Q4onPtBqZFmm1EL4EEF5BNrGsfNRkM9vf6doRTG8W2rNmaSEv7Ym`  | [view](https://solscan.io/tx/LKickMQ1fUJ38zawrYUT9UdtsQpy8kVyUF3Q4onPtBqZFmm1EL4EEF5BNrGsfNRkM9vf6doRTG8W2rNmaSEv7Ym?cluster=devnet)  |

> **Triple Shield seizure log** (member-5 wallet `4sLSCzCJ…HvKq`, slot 2 of pool 3) — captured verbatim from the on-chain `msg!` in `settle_default.rs`:
>
> ```
> roundfi-core: settle_default cycle=1 member=4sLSCzCJnZFMtaLD6vQsgZ4ywAwYa6joExK9dcM2HvKq
>   seized_total = 200_000   (= $0.20 USDC)
>   solidarity   = 200_000   (= $0.20)   ← drained
>   escrow       = 0                       ← intact
>   stake        = 0                       ← intact
>   d_rem        = 30_000_000  (= $30 = pool.credit_amount)
>   c_init       = 30_000_000  (= stake $15 + escrow $15 deposited at join)
>   c_after      = 30_000_000  (= still $15 + $15 — collateral untouched)
> ```
>
> The waterfall stopped at shield 1 because the D/C invariant
> (`c_after >= d_rem`, i.e. $30 ≥ $30) already held with just the
> solidarity vault drained — the program correctly chose **not** to
> seize escrow or stake. The $0.20 lines up with the configured
> `solidarity_bps` of 1% × installment ($10) × 2 paying members =
> exactly $0.20 sitting in the vault when settle_default fired.
> `member.defaulted=true` is permanent; the slot's `SCHEMA_DEFAULT` (id=3)
> attestation lands on the delinquent's reputation profile, locking
> them out of future Lv2/Lv3 promotions until manual review. Slot-2's
> $30 of collateral remains posted on-chain — **the protocol does not
> double-collect**: cycle-1's $10 shortfall was already covered by the
> deployer's $15.20 float top-up so slot-0 could claim, and the
> remaining ~$5.20 sits as positive float in `pool_usdc_vault` (will
> be netted out by future top-ups or burned at `close_pool`).

> **First front-end write path validated** (tx `37FZUtg7…wg6f` above). Member-3 was imported into Phantom (devnet), connected on `/home`, FeaturedGroup detected the matching member record + flipped to "ON-CHAIN · DEVNET", `PayInstallmentModal` showed the green ON-CHAIN banner with `slot 0 · cycle 1 · SCHEMA_LATE`, Phantom prompted, user signed. The `app/src/lib/contribute.ts` IDL-free encoder builds the 18-account `contribute(cycle=1)` instruction; `wallet-adapter-react.sendTransaction` dispatched and confirmed. Modal's success card linked the explorer URL; Phantom Activity tab on devnet is currently broken for token transfers (known issue, not RoundFi-specific) so verification is via `solana transaction-history` or Solscan. After this tx the on-chain dial advanced 0→2 contributions for member-3, USDC ATA dropped 45 → 35, and the live `usePool` poll picks up the new state on its next 30s refresh.
>
> **Second front-end write path validated — claim_payout** (tx `LKickMQ1…SEv7Ym` above). Member-4 was imported into Phantom (using the new `pnpm devnet:export-pk` helper), connected on `/home`, FeaturedGroup detected `member.slot_index == pool.current_cycle == 1` and surfaced the new purple-teal **"Receber R$ 165"** CTA next to "Pagar parcela". Click → `ClaimPayoutModal` showed the ON-CHAIN banner with `claim_payout(cycle=1)` + the four-bullet state-transition preview (vault → ATA, current_cycle++, paid_out=true, SCHEMA_CYCLE_COMPLETE attestation). Phantom prompted, user signed. The first attempt reverted with `WaterfallUnderflow` because the pool float was at $7.60 (cycle-1 contribution from member-3 only); the protocol's solvency guard refused to pay $30 from a $7.60 vault. **The guard working as designed is part of the demo evidence**, not a bug. The new `pnpm devnet:seed-topup` companion script computed the gap (`credit − spendable + 0.5 cushion = 22.90 USDC`) and deposited from the deployer (tx `3iFuuEwP…s9VQ` above), the front-end auto-refreshed via `usePool`, the user re-clicked Receber, signed again, and the second attempt landed cleanly. Member-4 ATA: 35 → 65 USDC, `pool.current_cycle` advanced 1 → 2, `member.paid_out=true`, `SCHEMA_CYCLE_COMPLETE` attestation written for member-4.
>
> **Closes the M3 wiring loop end-to-end on real funds**: read paths (3 pool views + member roster live polling), pay path (browser-signed contribute), and receive path (browser-signed claim_payout). Both write paths captured the same byte-for-byte IDL-free encoder methodology, so the remaining `escape_valve_buy` encoder (also shipped in this PR) inherits the same confidence even before its own end-to-end run.
>
> **Why no escrow / stake seizure?** Pool 3 is exactly the size where
> the D/C invariant (`c_after / c_init ≥ d_rem / d_init`) is
> already satisfied by the cumulative escrow + stake the member posted
> at join. In a longer-running pool where the same member had paid 5
> of 12 cycles before defaulting, `d_rem` would be smaller (5
> installments worth less than `credit_amount`) and the waterfall
> might still stop at shield 1; in a pool where the same member had
> paid 11 of 12 cycles, `d_rem` could be tiny and shield 1 alone
> would over-cover. The opposite extreme — a member defaulting on
> cycle 1 of a pool where `installment > stake_initial + escrow_so_far` —
> would force shield 2 + 3 to fire and cap each shield by the D/C
> guard so collateral never goes negative. Bankrun's
> `tests/security_default.spec.ts` covers all four quadrants; this is
> the first capture of the **shield-1-only** quadrant on real funds.

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

| Account                                                                   | Address                                        | Type                        | Solscan                                                                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| `ProtocolConfig` PDA                                                      | `3c9MmoM8ZGQGCrKMFGvJcCtvD78jEPa2JZtLwTvJoTMV` | Anchor account (core)       | [view](https://solscan.io/account/3c9MmoM8ZGQGCrKMFGvJcCtvD78jEPa2JZtLwTvJoTMV?cluster=devnet) |
| `ReputationConfig` PDA                                                    | `7RDWsSDcYYjn31E2dL2hbU3YQFFTvh2Wg8nxDsAXaXo4` | Anchor account (reputation) | [view](https://solscan.io/account/7RDWsSDcYYjn31E2dL2hbU3YQFFTvh2Wg8nxDsAXaXo4?cluster=devnet) |
| Treasury USDC ATA                                                         | `5ggMVBCqCfjwzKegvwMs3dpJqYDYNxmgnpubb55CVQX5` | SPL token account           | [view](https://solscan.io/account/5ggMVBCqCfjwzKegvwMs3dpJqYDYNxmgnpubb55CVQX5?cluster=devnet) |
| **`Pool` PDA** (demo, 3-member, $30 carta)                                | `5APoECXzJwr6j6xXGsqkT6GRSWNVDm4NSQB3KLhc8ooa` | Anchor account (core)       | [view](https://solscan.io/account/5APoECXzJwr6j6xXGsqkT6GRSWNVDm4NSQB3KLhc8ooa?cluster=devnet) |
| Member 0 PDA (slot 0, Lv1, $15 stake)                                     | `4r2Pd9qvL5iDyh7689rTsXVrAYoocoSsoR4bLZJhADc5` | Anchor account (core)       | [view](https://solscan.io/account/4r2Pd9qvL5iDyh7689rTsXVrAYoocoSsoR4bLZJhADc5?cluster=devnet) |
| Member 1 PDA (slot 1, Lv1, $15 stake)                                     | `3Sr4M88HDY3f1hnWJR7dznSvjCoRB4bTwGMDvAVNeEnm` | Anchor account (core)       | [view](https://solscan.io/account/3Sr4M88HDY3f1hnWJR7dznSvjCoRB4bTwGMDvAVNeEnm?cluster=devnet) |
| Member 2 PDA (slot 2, Lv1, $15 stake)                                     | `6ymEiWiAU6oJT4i5MisJDCZTSqtuvbfBKccVfdocYiaa` | Anchor account (core)       | [view](https://solscan.io/account/6ymEiWiAU6oJT4i5MisJDCZTSqtuvbfBKccVfdocYiaa?cluster=devnet) |
| **`Pool 2` PDA** (POOL_SEED_ID=2, cycle_duration=3600s)                   | `8XZxRSqUDEvhVENxxnhNKM8htZTmVuyQgYbZXmtwbujm` | Anchor account (core)       | [view](https://solscan.io/account/8XZxRSqUDEvhVENxxnhNKM8htZTmVuyQgYbZXmtwbujm?cluster=devnet) |
| Pool 2 Member 0 PDA (slot 0, Lv1)                                         | `FnkSyswpsLG3oUcaiJAHuqHo1bLNdoRAZBbwoJyvkbXt` | Anchor account (core)       | [view](https://solscan.io/account/FnkSyswpsLG3oUcaiJAHuqHo1bLNdoRAZBbwoJyvkbXt?cluster=devnet) |
| Pool 2 Member 1 PDA (slot 1, Lv1)                                         | `AM3XJoW28v2yLWLSRJ6nHsES6zPdFCA97XfjoFE8AD9g` | Anchor account (core)       | [view](https://solscan.io/account/AM3XJoW28v2yLWLSRJ6nHsES6zPdFCA97XfjoFE8AD9g?cluster=devnet) |
| Pool 2 Member 2 PDA (slot 2, Lv1)                                         | `BosuNXisQNN1mSRrKZs8J8oaqp7E2R8wQoEnjv5D591F` | Anchor account (core)       | [view](https://solscan.io/account/BosuNXisQNN1mSRrKZs8J8oaqp7E2R8wQoEnjv5D591F?cluster=devnet) |
| Pool 2 yield_mock state PDA                                               | `6h1mj5HU3eJKFEwridjZ4kCz1QdSddUKRqCncdpMVExd` | Anchor account (yield_mock) | [view](https://solscan.io/account/6h1mj5HU3eJKFEwridjZ4kCz1QdSddUKRqCncdpMVExd?cluster=devnet) |
| Pool 2 yield vault ATA (state-PDA-owned)                                  | `2Attqh7w2FjsuP4VN98PHFnC67cNgFhfwPoJtenCpxqE` | SPL token account           | [view](https://solscan.io/account/2Attqh7w2FjsuP4VN98PHFnC67cNgFhfwPoJtenCpxqE?cluster=devnet) |
| Pool 2 / slot 1 listing PDA (filled, closed post-buy)                     | `5sQBMvMYU1iqHMz7rvNSjEdvtqohLZqmTmDxyEHoMB5A` | Anchor account (core)       | [view](https://solscan.io/account/5sQBMvMYU1iqHMz7rvNSjEdvtqohLZqmTmDxyEHoMB5A?cluster=devnet) |
| Pool 2 / slot 1 NEW Member PDA (buyer post-Escape Valve)                  | `Am3iA2sddUE7sWyYuzuTkV8Da9ZjZj9NhxR5w3PKoxQF` | Anchor account (core)       | [view](https://solscan.io/account/Am3iA2sddUE7sWyYuzuTkV8Da9ZjZj9NhxR5w3PKoxQF?cluster=devnet) |
| Pool 2 / slot 1 NFT asset (post-buy: owner = buyer + frozen)              | `3DcyQDWE3pKdMv4iZe7pV5dfqqqmPLcbakieZfaVnDsu` | Metaplex Core asset         | [view](https://solscan.io/account/3DcyQDWE3pKdMv4iZe7pV5dfqqqmPLcbakieZfaVnDsu?cluster=devnet) |
| **`Pool 3` PDA** (`POOL_SEED_ID=3`, cycle_duration=60s, GRACE_PERIOD=60s) | `D9PS7QDGUsAwHa4T6Gibw6HV9Lx2sbB5aZM5GsNzpDE5` | Anchor account (core)       | [view](https://solscan.io/account/D9PS7QDGUsAwHa4T6Gibw6HV9Lx2sbB5aZM5GsNzpDE5?cluster=devnet) |
| Pool 3 Member 2 PDA (slot 2, **defaulted=true** post-`settle_default`)    | `GqzmPkW73QaoSZAmg481btfPkgY7jgncPekf2aUSqfHQ` | Anchor account (core)       | [view](https://solscan.io/account/GqzmPkW73QaoSZAmg481btfPkgY7jgncPekf2aUSqfHQ?cluster=devnet) |

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

| Date       | Build commit | Deployer                                       | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-07 | `340432a`    | `64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm` | Full M3 protocol surface across **three pools** + Escape Valve + **Pool 1 finalized via close_pool** + **Pool 3 settle_default with Triple Shield seizure**. Pool 1: 3-cycle ROSCA closed end-to-end → release_escrow reverts with EscrowLocked → close_pool emitted balanced summary log. Pool 2 (cycle_duration=3600s): ON-TIME contribs + yield Cascade + positive release_escrow + escape_valve_list + escape_valve_buy. Pool 3 (cycle_duration=60s, GRACE_PERIOD_SECS=60): fresh wallet set, two members paid LATE, slot 2 fell behind, `claim_payout(0)` advanced the cycle, `settle_default(1)` drained the solidarity vault ($0.20) and stopped at shield 1 because the D/C invariant already held — `member.defaulted=true`, SCHEMA_DEFAULT attestation written, escrow + stake left intact. Found-and-fixed mpl-core protocol bug in pool 2's Escape Valve. 14 reputation `Attestation` PDAs (13 cycle-attestations + 1 SCHEMA_DEFAULT), **3 Triple Shield guards captured firing on real funds**, 10 Solana 3.x Box workarounds applied (now including SettleDefault), 1 protocol bug surfaced + fixed end-to-end. | Thirteen sessions on the same day, culminating in 340432a + the live settle_default run. (1)–(11) per the previous cumulative entry: protocol deploy → init → Pool 1 lifecycle → Pool 2 + Yield Cascade + Escape Valve + plugin re-delegate fix (#160-#176). (12) **close_pool driver (#178)**: Pool 1 finalized with balanced summary log. (13) **settle_default driver (340432a)**: Box on `SettleDefault` (10th workaround), `GRACE_PERIOD_SECS=60` devnet patch, `MEMBER_INDEX_OFFSET` env var across all seed scripts so a fresh wallet set could opt into Pool 3 without colliding with Pool 1/2 reputation cooldowns. `seed-default.ts` validates pool/member state + grace deadline pre-flight, then dispatches the 18-account ix with a 600k-CU budget and surfaces the on-chain `settle_default` summary log + post-state member read. Next M3 step: app↔chain wiring (front-end modals firing real txs against the deployed pools — foundation already shipped on `claude/m3-app-wiring-foundation` with usePool/usePoolMembers hooks + on-chain badge in /grupos + an IDL-free contribute encoder wired into PayInstallmentModal). |

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
