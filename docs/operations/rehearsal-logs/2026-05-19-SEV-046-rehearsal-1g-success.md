# SEV-046 Rehearsal 1g — First Green CD Devnet Deploy

> **Closes the empirical half of [#272](https://github.com/alrimarleskovar/roundfinancial/issues/272) (CD pipeline rehearsal).** First successful end-to-end devnet deploy via the GitHub Actions `deploy · devnet` workflow after the 5-PR bug chain (#389 → #393, catalogued in [`2026-05-18-SEV-046-rehearsal-saga.md`](./2026-05-18-SEV-046-rehearsal-saga.md)). This is rehearsal **1 of 3** required by `cd-pipeline.md` §"Rehearsal protocol" to fully close §3.3 of the canary plan.

## Result

✓ **Workflow ran green.** All 4 RoundFi programs deployed to devnet via clean ubuntu-latest runner with pinned Agave 3.0.0 + Anchor 0.30.1 toolchain. Artifact captured. Keypair scrubbed. No operator-workstation touchpoints.

## Run metadata

| Field       | Value                                                                      |
| ----------- | -------------------------------------------------------------------------- |
| Tag         | `devnet-deploy-v20260519-rehearsal-1g`                                     |
| Run URL     | https://github.com/alrimarleskovar/RoundFinancial/actions/runs/26086314957 |
| Workflow    | `.github/workflows/devnet-deploy.yml`                                      |
| Cluster     | devnet                                                                     |
| Deployed at | 2026-05-19T08:54:32.874Z                                                   |
| Runner      | `ubuntu-latest` (GitHub-hosted)                                            |
| Toolchain   | Agave 3.0.0 + Anchor 0.30.1 (pinned, matches `anchor · build` lane)        |
| Artifact    | `program-ids-devnet-26086314957` (90-day retention)                        |

## Program IDs (devnet)

```json
{
  "cluster": "devnet",
  "deployedAt": "2026-05-19T08:54:32.874Z",
  "programs": {
    "roundfi_core": "7hRHyNsPfAZ7H56mzZ8z4CJuvbhDKHzKiodj7L4KZeNk",
    "roundfi_reputation": "GCg8MBsVbt8mJSYYTwj6jw5hPzYXS7HdrsrVXccoz6Jw",
    "roundfi_yield_mock": "3yX43NNSpW36mz7SGpnkzg4q9DvCAKCNbUoqnbkxUcJL",
    "roundfi_yield_kamino": "7DFsqrA8VdMRXu2EGD7iSA1jZNSSwwypGVPT3ESkf1Th"
  }
}
```

Solscan links (devnet):

- `roundfi_core` → https://solscan.io/account/7hRHyNsPfAZ7H56mzZ8z4CJuvbhDKHzKiodj7L4KZeNk?cluster=devnet
- `roundfi_reputation` → https://solscan.io/account/GCg8MBsVbt8mJSYYTwj6jw5hPzYXS7HdrsrVXccoz6Jw?cluster=devnet
- `roundfi_yield_mock` → https://solscan.io/account/3yX43NNSpW36mz7SGpnkzg4q9DvCAKCNbUoqnbkxUcJL?cluster=devnet
- `roundfi_yield_kamino` → https://solscan.io/account/7DFsqrA8VdMRXu2EGD7iSA1jZNSSwwypGVPT3ESkf1Th?cluster=devnet

## Cost

Empirical SOL consumed matches the floor-bump reasoning baked into PR #393:

| Program              | Bytecode size | Rent-exempt (~2×) |
| -------------------- | ------------- | ----------------- |
| roundfi_core         | ~880 KB       | ~6.14 SOL         |
| roundfi_reputation   | ~370 KB       | ~2.6 SOL          |
| roundfi_yield_kamino | ~294 KB       | ~2.0 SOL          |
| roundfi_yield_mock   | ~254 KB       | ~1.8 SOL          |
| **Total**            | —             | **~12.5 SOL**     |

Buffer above the 20 SOL floor: ~7.5 SOL, well within the 1.6× margin documented in the workflow.

## Deviations from cd-pipeline.md

None. The workflow ran exactly as specified after PRs #389–#393 landed. Compared to the saga doc, this run is the "happy path" continuation — no new failure modes surfaced.

## Verification checklist

- [x] Workflow run green (all steps ✓ on the Actions UI)
- [x] Artifact `program-ids-devnet-26086314957` uploaded
- [x] `config/program-ids.devnet.json` captured in step "Capture deploy summary"
- [x] Keypair cleanup step ran (`if: always()`)
- [ ] Solscan spot-check on each program ID — _operator follow-up_
- [ ] `pnpm test:bankrun:no-mpl-core` against the deployed `.so` artifacts — _operator follow-up if blocking next rehearsal_

## §3.3 progress

`docs/operations/mainnet-canary-plan.md` §3.3 item: **"CD pipeline approved + tested — staging deploy via #272 rehearsed at least once"**.

- **Status**: ✓ "at least once" satisfied. **Strict reading** of the canary plan accepts a single green run as the unblock criterion.
- **Stretch goal**: `cd-pipeline.md` §"Rehearsal protocol" calls for **3× clean in a row** to claim full reproducibility. Counter: **1 / 3**.

## Next rehearsals

To satisfy the 3× stretch goal:

1. **Rehearsal 2** — tag `devnet-deploy-v20260519-rehearsal-2`. Same operator, same secret, no code changes. Expectation: green, ~same SOL cost, different program IDs (fresh keypairs each `anchor build` cycle). **Status (2026-05-19): aborted pre-deploy** by the 20 SOL balance gate (deployer pubkey `5ZpFtJePb2hGKhG9RJ6Fdwmo5y8wuwKXZZcKttoN1Jgo` had 12.38030804 SOL post-1g — the rehearsal-1g `anchor deploy` consumed the ~12.5 SOL that PR #393's empirical breakdown predicted, leaving ~12.4 SOL which is correctly < the 20 SOL floor). **This is the feature working as designed** — the floor refuses to start the workflow when there isn't enough SOL to complete the deploy + safety margin. See [`2026-05-18-SEV-046-rehearsal-saga.md`](./2026-05-18-SEV-046-rehearsal-saga.md) continuation table row 2-aborted for the full evidence.
2. **Rehearsal 3** — tag `devnet-deploy-v20260520-rehearsal-3` (or same-day with a `-b` suffix). Same expectation. If green, file a single combined log addendum and mark §3.3 fully closed.

**Operator unblock path for rehearsals 2 + 3:** top up the deployer wallet to ≥20 SOL via faucet.solana.com (rate-limited 5 SOL / 8h per wallet) OR `solana airdrop` CLI (separate budget) OR alternative devnet faucets (Helius, Triton One). Two faucet hits ~8h apart + CLI airdrop should clear the floor for the next rehearsal.

**§3.3 status note:** the strict "rehearsed at least once" criterion is satisfied by 1g; the 3× stretch goal is reproducibility-confidence-only and deferred pending operator SOL top-up. **NOT a mainnet blocker.**

If either rehearsal fails with a new bug pattern, log it under `2026-05-NN-SEV-046-rehearsal-saga.md` continuation table and ship a fix PR before the next attempt — same single-file/single-concern discipline as PRs #389–#393.

## References

- Saga (PRs #389–#393 + 5 bugs): [`2026-05-18-SEV-046-rehearsal-saga.md`](./2026-05-18-SEV-046-rehearsal-saga.md)
- Architecture: [`docs/operations/cd-pipeline.md`](../cd-pipeline.md)
- Canary plan §3.3: [`docs/operations/mainnet-canary-plan.md`](../mainnet-canary-plan.md)
- SEV-046 tracker row: [`docs/security/internal-audit-findings.md`](../../security/internal-audit-findings.md)
