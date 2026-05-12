# Deploy / Redeploy Runbook

> **Scope:** devnet today, mainnet at GA. Procedure is identical modulo the cluster flag — differences flagged inline. Last exercised end-to-end during the [#207 reproducible-build redeploy](https://github.com/alrimarleskovar/RoundFinancial/pull/207) cycle.

## Pre-flight checklist

- [ ] **Deployer keypair available** at the path declared in `~/.config/solana/cli/config.yml` (or via `--keypair <path>`). Public key must match the **upgrade authority** of all 4 deployed programs (verifiable via `solana program show <pid> --url <cluster>` → "Upgrade Authority" field).
- [ ] **Balance ≥ ~8 SOL** on the deployer wallet. Each program redeploy consumes ~0.5–2 SOL. Devnet: `solana airdrop 5 --url devnet` (rate-limited; fall back to https://faucet.solana.com). Mainnet: real SOL.
- [ ] **`solana` CLI on PATH**, version matches the deployment target. Today: pinned to Solana Agave 3.0.0 toolchain (see [`docs/verified-build.md`](../verified-build.md) and `.github/workflows/ci.yml` anchor lane). Mainnet will move to Agave 2.x stable per issue #230.
- [ ] **`solana-verify` on PATH** for the attestation step. `cargo install solana-verify --locked` if missing.
- [ ] **Reproducible build artifacts** already produced via `pnpm devnet:verify-build` in the current working tree. Confirms: `target/deploy/roundfi_core.so` + 3 others exist and were produced by the `solanafoundation/solana-verifiable-build:1.18.26` Docker image (NOT a local `anchor build`).
- [ ] **Git working tree clean**, on the commit you intend to attest. `git rev-parse HEAD` matches the commit you want bound to the deployed bytecode.

## Procedure

### 1. Sanity check on-chain authority

For each program ID, confirm the deployer wallet is the upgrade authority:

```bash
for pid in 8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw \
           Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2 \
           GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ \
           74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb; do
  echo "▶ $pid"
  solana program show "$pid" --url devnet | grep "Upgrade Authority"
done
```

Must report the deployer pubkey for every program. If any program shows a different authority → **STOP**. Authority drift means another keypair is holder of record; resolve before redeploy.

### 2. Compare local hashes to on-chain

```bash
pnpm devnet:verify-check
```

If all 4 already match (`✓ MATCH` on every line) → redeploy is not needed; skip to Step 4 only if you need to refresh the attestation PDA against a new commit hash.

If any mismatch (`✗ MISMATCH`) → continue.

### 3. Redeploy

```bash
pnpm devnet:verify-redeploy
```

Script handles all 4 in sequence. Each program prints a Solscan-linkable tx Signature on success.

Common failure modes:

- **`Program's authority Some(X) does not match authority provided Y`** → pre-flight step 1 should have caught this; review wallet config
- **`insufficient funds`** → airdrop more SOL (devnet) or transfer SOL (mainnet)
- **RPC timeout mid-deploy** → re-run for the failed program(s) individually (`pnpm devnet:verify-redeploy roundfi_core`). Solana skips already-deployed bytecode, so partial retries are safe

### 4. Verify hashes match

```bash
pnpm devnet:verify-check
```

Must exit 0 with all `✓ MATCH`. If not, debug the failed program before continuing — the attestation step will fail otherwise.

### 5. Refresh on-chain attestation PDA

```bash
pnpm devnet:verify-onchain
```

Pinned to the current `git rev-parse HEAD`. ~3-5 min total across the 4 programs. Each `verify-from-repo` call:

1. Clones the repo from GitHub at the pinned commit (~10s)
2. Rebuilds inside Docker (~3-5 min/program — Docker layer cache helps subsequent runs)
3. Verifies hash matches on-chain bytecode
4. Writes the OtterSec verify-build attestation PDA

### 6. Verify attestations on-chain

```bash
DEPLOYER=$(solana-keygen pubkey ~/.config/solana/keypairs/deployer.json)
for pid in 8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw \
           Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2 \
           GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ \
           74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb; do
  echo "▶ $pid"
  solana-verify -u devnet get-program-pda \
    --program-id "$pid" --signer "$DEPLOYER"
done
```

Each must print a `git_url`, `commit`, `executable_hash` block matching the redeployed state.

### 7. Update docs ledger

- Append the redeploy timestamp + commit hash + 4 tx signatures to `docs/devnet-deployment.md` (or `docs/mainnet-deployment.md` post-GA)
- Update `AUDIT_SCOPE.md` if any structural change (e.g. new program added) affects the in-scope row
- Add a CHANGELOG entry under `[Unreleased]` if user-visible behavior changed

## Mainnet-only additions (when applicable)

1. **Pre-deploy comms** — announce the maintenance window in #announcements 24h ahead
2. **TVL snapshot** — capture `pool_usdc_vault` balances per active pool pre-deploy for post-deploy reconciliation
3. **Multisig signing** — the redeploy tx is co-signed by the Squads multisig per the protocol-authority key custody model
4. **Bug-bounty pause** — temporarily disable Immunefi submissions during the window so researchers don't waste cycles on a known-pending deploy state
5. **Post-deploy sanity** — pause + unpause cycle (one tx each) to confirm the auth flow works against the new bytecode before re-opening submissions

## Rollback

Solana programs are append-only — there is no "undo" once a deploy lands. If a redeploy ships a regression:

1. **Pause immediately** — `lock_treasury` is NOT the right tool (one-way kill switch); use the standard `pause` instruction (see [`emergency-response.md`](./emergency-response.md))
2. **Diagnose** — confirm the regression is in the deployed bytecode, not transient RPC
3. **Hot-patch** — fix the bug on `main`, run the full deploy procedure above against the same program IDs (Solana program-update semantics overwrite the bytecode)
4. **Unpause** + announce

The verified-build attestation PDA will need a separate `verify-from-repo` refresh against the new commit hash.

## Verification gates summary

| Step | Verification                                      | Failure mode                                                               |
| ---- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| 1    | On-chain `Upgrade Authority` matches deployer     | Wrong keypair / wallet drift                                               |
| 2    | `verify-check` exit code                          | Hash drift between local + on-chain (this is the "redeploy needed" signal) |
| 4    | `verify-check` exits 0                            | Deploy didn't apply (RPC issue, partial deploy)                            |
| 5    | `verify-onchain` 4× success                       | Rebuild + attestation write all landed                                     |
| 6    | `get-program-pda` returns git_url + commit + hash | Attestation actually persisted on-chain                                    |
| 7    | Docs ledger updated                               | History reconstruction works after the fact                                |

If any gate is red, **stop and resolve before continuing**. Don't push state forward against a known-failing intermediate step.
