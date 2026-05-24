# SEV-046 Rehearsal 2b — Second Green CD Devnet Deploy

> **2 of 3 against the `cd-pipeline.md` §"Rehearsal protocol" stretch goal.** Second successful end-to-end devnet deploy via the GitHub Actions `deploy · devnet` workflow. Same operator + same secret + no code changes since [rehearsal 1g](./2026-05-19-SEV-046-rehearsal-1g-success.md) — this run validates that 1g wasn't a one-off and that the pipeline is reproducible from a clean ubuntu-latest runner against the same toolchain pin. **Reproducibility now empirically demonstrated** (2 consecutive green runs against the same workflow, different program IDs each time, predictable SOL cost).
>
> Companion to [`2026-05-19-SEV-046-rehearsal-1g-success.md`](./2026-05-19-SEV-046-rehearsal-1g-success.md) (first green) and [`2026-05-18-SEV-046-rehearsal-saga.md`](./2026-05-18-SEV-046-rehearsal-saga.md) (the 5-PR bug chain that preceded the first green run + the 2-aborted balance-gate evidence).

## Result

✓ **Workflow ran green.** All 4 RoundFi programs re-deployed to devnet with fresh keypairs via clean ubuntu-latest runner using the same pinned Agave 3.0.0 + Anchor 0.30.1 toolchain. Artifact captured. Keypair scrubbed. Zero deviations from `cd-pipeline.md`. Pre-flight 2-aborted earlier the same day (operator balance was 12.38 SOL, < 20 SOL floor — captured in [PR #398](https://github.com/alrimarleskovar/RoundFinancial/pull/398) as the floor working as designed); post-faucet-topup attempt as `-2b` cleared the gate at 22.38 SOL.

## Run metadata

| Field       | Value                                                                      |
| ----------- | -------------------------------------------------------------------------- |
| Tag         | `devnet-deploy-v20260519-rehearsal-2b`                                     |
| Run URL     | https://github.com/alrimarleskovar/RoundFinancial/actions/runs/26115425088 |
| Workflow    | `.github/workflows/devnet-deploy.yml`                                      |
| Cluster     | devnet                                                                     |
| Deployed at | 2026-05-19T18:08:52.375Z                                                   |
| Runner      | `ubuntu-latest` (GitHub-hosted)                                            |
| Toolchain   | Agave 3.0.0 + Anchor 0.30.1 (pinned, matches `anchor · build` lane)        |
| Artifact    | `program-ids-devnet-26115425088` (90-day retention)                        |

## Program IDs (devnet)

```json
{
  "cluster": "devnet",
  "deployedAt": "2026-05-19T18:08:52.375Z",
  "programs": {
    "roundfi_core": "7rk61i9dR2U5WSNEbHcw8yPL3SZQtMXvMaL9Sb8Ve6nz",
    "roundfi_reputation": "9V3qwWCGSpeZP4icm92v11TxeUEHF75QvSZcYQzKLpzN",
    "roundfi_yield_mock": "C32JyRiEoPB192hBWTbpzwdyMwfFQNp6btutJ3ttoiDL",
    "roundfi_yield_kamino": "AGs392Yb1uLa8kiC11RNqWGpZmeW5yAgDhkzP9jBY4SC"
  }
}
```

Solscan links (devnet):

- `roundfi_core` → https://solscan.io/account/7rk61i9dR2U5WSNEbHcw8yPL3SZQtMXvMaL9Sb8Ve6nz?cluster=devnet
- `roundfi_reputation` → https://solscan.io/account/9V3qwWCGSpeZP4icm92v11TxeUEHF75QvSZcYQzKLpzN?cluster=devnet
- `roundfi_yield_mock` → https://solscan.io/account/C32JyRiEoPB192hBWTbpzwdyMwfFQNp6btutJ3ttoiDL?cluster=devnet
- `roundfi_yield_kamino` → https://solscan.io/account/AGs392Yb1uLa8kiC11RNqWGpZmeW5yAgDhkzP9jBY4SC?cluster=devnet

## Reproducibility check vs rehearsal 1g

All 4 program IDs are **different** from the 1g run, as expected (`anchor keys sync` generates fresh keypairs each build cycle). What's identical between runs:

| Property               | 1g                                    | 2b              | Same?       |
| ---------------------- | ------------------------------------- | --------------- | ----------- |
| Workflow file SHA      | `.github/workflows/devnet-deploy.yml` | same            | ✓ yes       |
| Agave version          | 3.0.0                                 | 3.0.0           | ✓ yes       |
| Anchor version         | 0.30.1                                | 0.30.1          | ✓ yes       |
| Runner image           | `ubuntu-latest`                       | `ubuntu-latest` | ✓ yes       |
| Program count deployed | 4                                     | 4               | ✓ yes       |
| SOL consumed (approx)  | ~12.5                                 | 12.62           | ✓ within 1% |
| Deployer pubkey        | `5ZpFt...`                            | `5ZpFt...`      | ✓ yes       |
| Failure modes surfaced | 0                                     | 0               | ✓ yes       |

The 12.62 SOL consumed in 2b matches the 12.5 SOL prediction baked into PR #393's empirical breakdown (core ~6.14 + reputation ~2.6 + yield_kamino ~2.0 + yield_mock ~1.8 = ~12.5). The 1% delta is per-program rent-exempt rounding + 4 × ~0.001 SOL tx fees — no surprise.

**Conclusion:** the CD pipeline is now reproducible across consecutive runs by an external observer (the runner) against a fresh wallet topology. The Hofstadter's-Law-class bugs that consumed PRs #389–#393 do not appear to have any siblings; what's left is operator-side (SOL availability).

## Cost

Empirical SOL consumed: **12.62 SOL** (22.38 → 9.76 = 12.62 delta). Matches PR #393's per-program breakdown:

| Program              | Bytecode size | Rent-exempt (~2×) |
| -------------------- | ------------- | ----------------- |
| roundfi_core         | ~880 KB       | ~6.14 SOL         |
| roundfi_reputation   | ~370 KB       | ~2.6 SOL          |
| roundfi_yield_kamino | ~294 KB       | ~2.0 SOL          |
| roundfi_yield_mock   | ~254 KB       | ~1.8 SOL          |
| **Sum**              | —             | **~12.5 SOL**     |
| **Observed**         |               | **12.62 SOL**     |

Post-run balance: **9.76 SOL** — below the 20 SOL floor, so rehearsal-3 will need another faucet top-up cycle.

## Deviations from cd-pipeline.md

None. The workflow ran exactly as specified, with the same shape as 1g.

## Verification checklist

- [x] Workflow run green (all steps ✓ on the Actions UI)
- [x] Artifact `program-ids-devnet-26115425088` uploaded
- [x] `config/program-ids.devnet.json` captured in step "Capture deploy summary"
- [x] Keypair cleanup step ran (`if: always()`)
- [x] SOL consumption matches PR #393 prediction within 1%
- [x] Pre-flight 2-aborted by balance gate confirms PR #393 floor working as designed (separate PR [#398](https://github.com/alrimarleskovar/RoundFinancial/pull/398))
- [ ] Solscan spot-check on each program ID — _operator follow-up_

## §3.3 progress

`docs/operations/mainnet-canary-plan.md` §3.3 item: **"CD pipeline approved + tested — staging deploy via #272 rehearsed at least once"**.

- **Strict criterion**: ✓ satisfied since 1g.
- **Stretch goal (`cd-pipeline.md` §"Rehearsal protocol"):** **2 / 3** clean rehearsals. One more green run closes the 3× reproducibility claim.

## Next rehearsal

1. **Rehearsal 3** — tag `devnet-deploy-v20260520-rehearsal-3` (or same-day with a `-3b` suffix). Same operator, same secret, no code changes. Operator unblock path: top up the deployer wallet from 9.76 SOL back to ≥20 SOL via faucet (5 SOL/8h on faucet.solana.com + `solana airdrop` separate budget + Helius/Triton alt faucets). Two faucet hits + 1 CLI airdrop should clear the floor.

If rehearsal 3 lands green, mark `cd-pipeline.md §"Rehearsal protocol"` as **3/3 ✓** and the §3.3 stretch goal as fully closed.

## References

- First green: [`2026-05-19-SEV-046-rehearsal-1g-success.md`](./2026-05-19-SEV-046-rehearsal-1g-success.md)
- 5-bug saga + 2-aborted record: [`2026-05-18-SEV-046-rehearsal-saga.md`](./2026-05-18-SEV-046-rehearsal-saga.md)
- Architecture: [`docs/operations/cd-pipeline.md`](../cd-pipeline.md)
- Canary plan §3.3: [`docs/operations/mainnet-canary-plan.md`](../mainnet-canary-plan.md)
- PR #398 (2-aborted balance-gate log): https://github.com/alrimarleskovar/RoundFinancial/pull/398
- SEV-046 tracker row: [`docs/security/internal-audit-findings.md`](../../security/internal-audit-findings.md)
