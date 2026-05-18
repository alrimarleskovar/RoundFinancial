# CD Pipeline — Program Deploys

Closes [issue #272](https://github.com/alrimarleskovar/roundfinancial/issues/272). Implementation of the canary-plan §3.3 item: **CD pipeline approved + tested — staging deploy rehearsed at least once**.

## Why

Until SEV-046 landed, every Anchor program deploy went through `pnpm run devnet:deploy` on an operator's workstation. That setup carried three risks:

1. **Reproducibility drift.** The Rust toolchain, Solana CLI version, and platform-tools cache on a WSL/macOS box are not bit-identical to OtterSec's verify-build runner. PR #319 (Agave 2.x migration) burned ~1 day chasing version mismatches between the deploy runner and the verify-build expectation.
2. **Audit trail.** Tx signatures lived in operator's terminal scroll buffer. The canary-plan worksheet has a per-step capture, but no enforcement.
3. **Mainnet parity.** The mainnet ceremony (Squads + hardware wallets) was scoped from scratch each time, with no rehearsed CI path to fall back on.

The CD pipeline addresses all three: a clean ubuntu-latest runner with pinned toolchain, every run logged with retention, and the devnet workflow rehearses the exact shape of the mainnet workflow.

## Topology

```
┌────────────────────────────┐                ┌────────────────────────────┐
│  Tag: devnet-deploy-v*     │                │  Tag: mainnet-deploy-v*    │
│  Trigger: tag push OR      │                │  Trigger: tag push ONLY    │
│           workflow_dispatch│                │           (signed tag)     │
└────────────┬───────────────┘                └────────────┬───────────────┘
             │                                              │
             ▼                                              ▼
┌────────────────────────────┐                ┌────────────────────────────┐
│  devnet-deploy.yml         │                │  mainnet-deploy.yml        │
│  - Pinned Agave 3.0.0      │                │  - 2 jobs: preflight + deploy
│  - Pinned Anchor 0.30.1    │                │  - preflight runs mainnet- │
│  - DEVNET_DEPLOYER_KEYPAIR │                │    hardening-check vs      │
│  - Balance ≥ 5 SOL gate    │                │    mainnet RPC (read-only) │
│  - anchor keys sync OK     │                │  - deploy needs:           │
│  - scripts/devnet/deploy.ts│                │     • GH env approver gate │
│  - Artifact:               │                │     • anchor keys verify   │
│    program-ids-devnet      │                │       (NO auto-sync — IDs  │
│                            │                │       must already match)  │
│                            │                │     • scripts/mainnet/     │
│                            │                │       deploy.ts            │
│                            │                │  - Artifact:               │
│                            │                │    program-ids-mainnet     │
└────────────────────────────┘                └────────────────────────────┘
```

## Workflows

### `devnet-deploy.yml` — rehearsal lane

**Trigger:** tag `devnet-deploy-v*` OR `workflow_dispatch` with a `reason` input (free-text, captured in audit log).

**Toolchain:** mirrors the working `anchor · build` CI lane (Agave 3.0.0 from `anza-xyz/agave` GitHub releases + Anchor 0.30.1 via `cargo install --git --tag v0.30.1`). Same shape used by SEV-012 / PR #385 bankrun-no-mpl-core lane — proven path.

**Deployer:** `DEVNET_DEPLOYER_KEYPAIR` repo secret (base64-encoded JSON). Workflow restores to disk, sets `solana config`, refuses to start if balance < 5 SOL.

**Steps:**

1. `anchor build --no-idl`
2. `anchor keys sync` — auto-resyncs `declare_id!()` to match keypair files. **This is fine on devnet** (program IDs are disposable); on mainnet the same step is a verify-only check (see below).
3. `anchor build --no-idl` again — post-sync rebuild.
4. `pnpm exec tsx scripts/devnet/deploy.ts` — wrapper that calls `anchor deploy --provider.cluster devnet` and writes `config/program-ids.devnet.json`.
5. Upload `config/program-ids.devnet.json` as an artifact (90-day retention).
6. Cleanup deployer keypair from runner (defense-in-depth — runners are ephemeral but explicit `rm -f` survives a debugging-fork misconfig).

**Use cases:**

- **Routine devnet refresh** — push `devnet-deploy-v$(date +%Y%m%d)` to trigger.
- **Mainnet rehearsal** — every code path that the mainnet workflow exercises is exercised here first against devnet. If devnet-deploy fails, mainnet would have failed too.

### `mainnet-deploy.yml` — production lane

**Trigger:** tag `mainnet-deploy-v*` ONLY. **No `workflow_dispatch` fallback** — every mainnet run must be traceable to a signed git tag. Tag the desired commit with a signed tag (`git tag -s mainnet-deploy-v0.4.0-canary -m "..."`) so the audit chain is `signed tag → tagger identity → commit → CI run → tx signature`.

**Two-job structure:**

#### Job 1 — `preflight`

Runs without approval gate. Read-only against mainnet RPC. Catches show-stoppers before any human is paged for approval:

- `anchor build --no-idl` clean
- `anchor keys sync` **as a verifier** (not a syncer): if any `declare_id!()` would change, the workflow fails. **Mainnet program IDs are permanent** — auto-sync at this point would silently rewrite them, which is catastrophic. Fix in a separate PR, re-tag.
- `mainnet_hardening_check` against the live cluster. If `ROUNDFI_CORE_PROGRAM_ID` secret is empty (first-deploy case), the step exits 0 with a "skipping" notice. If it's set, every BLOCKER (paused = false, treasury_locked = false, TVL caps, approved_yield_adapter, usdc_mint, metaplex_core — see SEV-042, SEV-044) must pass.

#### Job 2 — `deploy`

`needs: preflight`. **`environment: mainnet`** triggers the GitHub environment protection rules:

- Required reviewers — listed approvers must click "Approve and deploy" in the Actions UI before the job's steps start.
- The `MAINNET_DEPLOYER_KEYPAIR`, `EXPECTED_AUTHORITY`, `EXPECTED_TREASURY`, `EXPECTED_APPROVED_ADAPTER`, `MAINNET_CORE_PROGRAM_ID` secrets are scoped to this environment (not visible to PR jobs).

Once approved:

1. Same toolchain install as preflight + devnet workflow.
2. Restore keypair, set `solana config`, balance check ≥ 5 SOL.
3. `anchor build --no-idl` (sealed — no keys sync this time).
4. `pnpm exec tsx scripts/mainnet/deploy.ts` — wrapper that:
   - Enforces `SOLANA_CLUSTER=mainnet-beta` AND `MAINNET_DEPLOY_CONFIRM=I-UNDERSTAND-THIS-IS-MAINNET` AND `MAINNET_DEPLOYER_KEYPAIR` path AND the three `EXPECTED_*` env vars.
   - Prints canary-plan reminders + sleeps 10s (last-chance Ctrl-C window — applies when run manually; in CI the sleep just adds 10s to the run).
   - Re-runs `mainnet_hardening_check` if `ROUNDFI_CORE_PROGRAM_ID` is set (defense-in-depth — preflight already did this, but config could theoretically have moved between preflight and deploy if a parallel operation flipped a flag).
   - `anchor build` + `anchor keys sync` + `anchor build` + `anchor deploy --provider.cluster mainnet`. **`anchor keys sync` here is the second invocation in this PR's flow** — it should be a no-op since preflight already verified, but if it does report drift the deploy fails loud rather than overwriting.
   - Writes `config/program-ids.mainnet-beta.json`.
5. Upload artifact (365-day retention).
6. Print post-deploy mandatory steps reminders.
7. Cleanup keypair.

## One-time setup

### Devnet

1. Generate a deployer keypair on a clean machine:
   ```bash
   solana-keygen new --no-bip39-passphrase -o /tmp/devnet-deployer.json
   ```
2. Airdrop or transfer ≥ 5 SOL to the new pubkey.
3. Base64-encode the JSON and store as `DEVNET_DEPLOYER_KEYPAIR` repo secret:
   ```bash
   base64 -w0 /tmp/devnet-deployer.json
   # Paste output into: Settings → Secrets and variables → Actions → New repository secret
   # Name: DEVNET_DEPLOYER_KEYPAIR
   ```
4. Shred the local copy: `shred -u /tmp/devnet-deployer.json`.

### Mainnet

1. Generate the deployer keypair via the **Squads ceremony** (see `docs/operations/squads-mainnet-ceremony-checklist.md`). Hardware wallets preferred; if software keys, they must NEVER be reused across clusters.
2. Fund with ≥ 5 SOL on mainnet (typical deploy cost: 3-4 SOL across 4 programs).
3. Create the `mainnet` environment in repo Settings → Environments → New environment. Configure:
   - **Required reviewers:** at minimum the protocol authority signers (3-of-5 Squads).
   - **Deployment branches:** restrict to `main` only.
4. Add environment-scoped secrets:
   - `MAINNET_DEPLOYER_KEYPAIR` (base64 JSON, same shape as devnet)
   - `EXPECTED_AUTHORITY` (Squads multisig PDA, base58)
   - `EXPECTED_TREASURY` (Squads-controlled USDC ATA, base58)
   - `EXPECTED_APPROVED_ADAPTER` (`roundfi-yield-kamino` program ID, base58)
   - `MAINNET_CORE_PROGRAM_ID` (set AFTER first deploy; leave empty initially)

## First deploy vs upgrade

| Phase                             | `MAINNET_CORE_PROGRAM_ID` secret    | `mainnet_hardening_check` step              |
| --------------------------------- | ----------------------------------- | ------------------------------------------- |
| First mainnet deploy              | empty                               | skipped with `::notice::`                   |
| First protocol-init tx            | (set the secret after this commits) | n/a (run manually next time)                |
| Every subsequent deploy (upgrade) | populated                           | runs both in preflight + inside `deploy.ts` |

## Rehearsal protocol

The canary-plan §3.3 item is "**staging deploy rehearsed at least once**." Definition of rehearsed:

1. Push tag `devnet-deploy-v$(date +%Y%m%d)-rehearsal-1`.
2. Wait for CD workflow to complete green.
3. Verify on Solscan devnet — each of the 4 programs has the expected pubkey from the artifact.
4. Run `pnpm test:bankrun:no-mpl-core` against `target/deploy/*.so` from the run (download via `actions/download-artifact`).
5. File a rehearsal-log entry under `docs/operations/rehearsal-logs/` with: tag name, run URL, program IDs, SOL spent, any deviations from this doc.
6. Rinse and repeat — until the dry-run is fully reproducible against a clean runner three times in a row, mainnet is not yet rehearsed enough.

## Open follow-ups (not in this PR)

- **OtterSec verify-build automation** — currently a manual post-deploy step. When the formal OtterSec engagement starts, add a `verify-build` job to `mainnet-deploy.yml` that calls their API/CLI and attaches the attestation to the run.
- **Tx signature capture** — the `anchor deploy` output has the tx signatures; this PR captures the deployer balance delta as proxy. A future improvement: parse the signatures from anchor's stdout and emit a structured summary file as artifact.
- **Squads multisig integration** — currently the deploy uses a single keypair. The Squads ceremony rotates upgrade authority POST-deploy. A future iteration could pre-stage the rotation tx via the same workflow.

## References

- Workflow files: `.github/workflows/{devnet,mainnet}-deploy.yml`
- Scripts: `scripts/devnet/deploy.ts` (rehearsal), `scripts/mainnet/deploy.ts` (production)
- Canary plan: `docs/operations/mainnet-canary-plan.md`
- Hardening pre-flight: `scripts/mainnet/mainnet-hardening-check.ts` (SEV-042, SEV-044)
- Squads ceremony: `docs/operations/squads-mainnet-ceremony-checklist.md`
- OtterSec attestation: `docs/security/audit-readiness.md` §verify-build
