# Squads rotation rehearsal — quickstart execution helper

> **What this is:** the copy-paste runbook for actually executing the
> Squads multisig devnet rehearsal in ~30 minutes. Not a substitute for
> [`squads-multisig-procedure.md`](./squads-multisig-procedure.md) (the
> canonical 268-line procedure with context + rationale) — this is the
> "I know why I'm doing it, just tell me what to type" condensation.
>
> **Output:** a filled-in rehearsal log at
> `docs/operations/rehearsal-logs/YYYY-MM-DD-squads-rotation-rehearsal.md`
> with every tx signature, PDA, and verification check. That artifact
> is what an auditor (and a future you, 6 months later) needs to trust
> the mainnet ceremony was practiced end-to-end.
>
> **Pair with:**
>
> - [`squads-multisig-procedure.md`](./squads-multisig-procedure.md) — read 24h before for context
> - [`squads-mainnet-ceremony-checklist.md`](./squads-mainnet-ceremony-checklist.md) — printable A4 used at the real mainnet ceremony
> - [`rehearsal-logs/TEMPLATE-squads-rotation.md`](./rehearsal-logs/TEMPLATE-squads-rotation.md) — fill-in-the-blank log template
> - [`rehearsal-logs/2026-05-12-pause-rehearsal.md`](./rehearsal-logs/2026-05-12-pause-rehearsal.md) — companion pause-rehearsal log shape (already executed; this Squads rehearsal mirrors the pattern)

## Pre-flight (5 min)

```sh
cd ~/RoundFinancial    # or your clone path

# 1. Confirm cluster + wallet
solana config get
#   RPC URL:    https://api.devnet.solana.com
#   Keypair:    /home/<you>/.config/solana/id.json
solana balance                              # ≥ 0.5 SOL (rehearsal txs are cheap, ~3 of them)
#   If <0.5: solana airdrop 2

# 2. Confirm git state — rehearsal runs against main HEAD
git status                                  # working tree clean
git log --oneline -1                        # remember this SHA for the log

# 3. Snapshot pre-state of authority surface
pnpm devnet:squads-rehearsal-verify
#   Expected output:
#     authority: <your-deployer-pubkey>
#     pending:   <11111111... default sentinel>
#     eta:       0

# 4. Generate 3 throwaway member keypairs (for Squads create_key derivation)
mkdir -p rehearsal-keypairs && cd rehearsal-keypairs
for n in 0 1 2 create-key; do
  solana-keygen new --no-bip39-passphrase --silent -o member-$n.json
  echo "$n: $(solana-keygen pubkey member-$n.json)"
done
cd ..

# 5. Derive the Squads vault PDA from the create-key (read-only preview)
pnpm devnet:squads-derive-pda \
  --create-key $(solana-keygen pubkey rehearsal-keypairs/member-create-key.json) \
  --threshold 2 \
  --members rehearsal-keypairs/member-0.json,rehearsal-keypairs/member-1.json,rehearsal-keypairs/member-2.json
#   Output: VAULT_PDA=<some-pubkey>  ← copy this; you'll pass it as --new-authority
```

## Start the rehearsal log

```sh
DATE=$(date -u +%Y-%m-%d)
cp docs/operations/rehearsal-logs/TEMPLATE-squads-rotation.md \
   docs/operations/rehearsal-logs/${DATE}-squads-rotation-rehearsal.md
${EDITOR:-vi} docs/operations/rehearsal-logs/${DATE}-squads-rotation-rehearsal.md
# Fill in §0 (metadata) + §1 (member set pubkeys from step 4) + §2 (vault PDA from step 5)
```

## Phase A — Propose (1 tx, ~3s)

Stage the Squads vault PDA on `config.pending_authority` with a 7-day timelock:

```sh
VAULT=<paste-VAULT_PDA-from-pre-flight>
pnpm devnet:squads-rehearsal-propose --new-authority $VAULT
#   Output:
#     tx: <SIG>
#     authority: <deployer> (unchanged)
#     pending:   <VAULT>  (new)
#     eta:       <now + 7d in unix>
```

Log §3 (paste the tx sig + eta) + §4 (paste the post-propose verify output).

Verify on-chain:

```sh
pnpm devnet:squads-rehearsal-verify
#   Expected:
#     authority: <deployer>      (unchanged — timelock not expired)
#     pending:   <VAULT>         (set by propose)
#     eta:       <now+7d-ish>
```

## Phase B — Cancel (negative-path drill, 1 tx, ~3s)

Cancel the proposal to prove the abort path works (this is the kill-switch the ceremony depends on if a wrong key is staged):

```sh
pnpm devnet:squads-rehearsal-cancel
#   Output:
#     tx: <SIG>
#     pending: <11111111... default sentinel>  (cleared)
#     eta:     0                                (cleared)
```

Log §5 (cancel tx sig + verify output).

```sh
pnpm devnet:squads-rehearsal-verify
#   Expected:
#     authority: <deployer>           (still unchanged)
#     pending:   <11111111... default> (cleared by cancel)
#     eta:       0
```

## Phase C — Re-propose + commit (timelock-bound)

Re-propose with the same vault:

```sh
pnpm devnet:squads-rehearsal-propose --new-authority $VAULT
```

The on-chain `commit_new_authority` enforces `TREASURY_TIMELOCK_SECS = 604_800` (**7 days**) unconditionally — there is **no devnet bypass**. This is intentional: the rehearsal must exercise the real timelock surface, otherwise it doesn't prove the mainnet ceremony works. Per [`TEMPLATE-squads-rotation.md`](./rehearsal-logs/TEMPLATE-squads-rotation.md) §5, you have two choices:

**Option 1 — Real 7-day wait (mainnet-faithful, recommended for full rehearsal):**

Mark the rehearsal log as "commit phase scheduled for $(date -u -d '+7 days' +%Y-%m-%d)". Return after 7 days to run:

```sh
pnpm devnet:squads-rehearsal-commit          # only succeeds once now >= eta
pnpm devnet:squads-rehearsal-verify
#   Expected: authority: <VAULT>
```

This is the canonical path. The 7-day wait is the auditor-facing assurance that no surprise rotations happen — exercising it on devnet proves mainnet works.

**Option 2 — Same-day rehearsal with temporarily-shortened timelock:**

For an end-to-end commit demonstration in one sitting, temporarily lower the timelock and redeploy on a throwaway branch:

```sh
git checkout -b temp/squads-rehearsal-shortened-timelock
# Edit programs/roundfi-core/src/constants.rs:
#   pub const TREASURY_TIMELOCK_SECS: i64 = 604_800;
#   ↓
#   pub const TREASURY_TIMELOCK_SECS: i64 = 60;
# NOTE: the floor-guard test at constants.rs FLOOR_SECS will fail.
# Comment it out for the rehearsal branch only.
anchor build --no-idl
anchor deploy --provider.cluster devnet
# Wait 60s, then:
pnpm devnet:squads-rehearsal-commit
pnpm devnet:squads-rehearsal-verify
# After commit succeeds, RESTORE the constant + redeploy:
git checkout main
anchor build --no-idl
anchor deploy --provider.cluster devnet
# Verify constant restored:
grep "TREASURY_TIMELOCK_SECS" programs/roundfi-core/src/constants.rs
```

Document the temporary constant in the rehearsal log §5d (the template has a row for this).

Whichever option you choose, log §6 (re-propose + commit tx sigs + final verify).

## Post-flight

**Rotate back** so the next rehearsal can start from a clean slate (otherwise the deployer keypair has lost authority of the devnet ProtocolConfig). This requires a signer that can act for the vault — either one of the multisig members (via Squads UI) or, if you used Option 2's shortened timelock, repeat the propose+commit cycle from the vault back to the deployer:

```sh
# From the vault (signed via Squads UI multisig or, on the shortened-timelock
# branch, by a vault-controlling key):
pnpm devnet:squads-rehearsal-propose --new-authority $(solana-keygen pubkey ~/.config/solana/id.json)
# Wait timelock (60s on Option 2, 7d on Option 1), then:
pnpm devnet:squads-rehearsal-commit
pnpm devnet:squads-rehearsal-verify
#   Expected: authority back to your deployer pubkey
```

If a rotate-back isn't feasible in your time budget, that's fine for the rehearsal: the log captures the rotation-to-vault as the artifact. Next rehearsal can spin up a fresh devnet deploy.

**Wipe throwaway keypairs** — they were generated for one-shot rehearsal use:

```sh
rm -rf rehearsal-keypairs/
```

**Commit the rehearsal log:**

```sh
git checkout -b chore/squads-rehearsal-log-${DATE}
git add docs/operations/rehearsal-logs/${DATE}-squads-rotation-rehearsal.md
git commit -m "chore(operations): squads rotation rehearsal log — ${DATE}"
git push -u origin chore/squads-rehearsal-log-${DATE}
# Open PR — this is the artifact that closes the 'execution pending' gap
```

## What can go wrong (debugging)

| Symptom                                              | Cause                                                                                                      | Fix                                                                                                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `propose` errors with `Unauthorized`                 | Wallet (`ANCHOR_WALLET` / `~/.config/solana/id.json`) doesn't match `config.authority`                     | `pnpm devnet:squads-rehearsal-verify` to see live authority; switch wallets via `solana config set --keypair <path>`                                                                             |
| `commit` errors with `TimelockNotElapsed`            | Devnet feature gate not active (you're on mainnet or a build that didn't have the devnet cfg flag enabled) | Confirm cluster is devnet via `solana config get`; if so, redeploy with `anchor build --features devnet && anchor deploy --provider.cluster devnet`. Mainnet ceremony observes the real 7d wait. |
| `cancel` errors with `NoPendingProposal`             | The propose tx didn't land (timeout, RPC drop)                                                             | `pnpm devnet:squads-rehearsal-verify` shows pending=default → re-run propose                                                                                                                     |
| `derive-pda` returns a different VAULT than expected | Member order in `--members` matters                                                                        | Pass member keypairs in the same order they'll be registered with Squads                                                                                                                         |
| Out of SOL mid-rehearsal                             | Devnet faucet rate-limited                                                                                 | `solana airdrop 2` (retry until limit clears, ~1h)                                                                                                                                               |

## Total expected time

| Phase                                 | Time        | Tx count |
| ------------------------------------- | ----------- | -------- |
| Pre-flight                            | ~5 min      | 0        |
| Phase A (propose)                     | ~1 min      | 1        |
| Phase B (cancel)                      | ~1 min      | 1        |
| Phase C (re-propose + commit)         | ~2 min      | 2        |
| Post-flight (rotate back, log commit) | ~5 min      | 2        |
| **Total**                             | **~15 min** | **6**    |

The rehearsal log itself is the slowest part — it's the artifact that matters.

## After execution

Update [`MAINNET_READINESS.md`](../../MAINNET_READINESS.md) row 3.6 (Squads multisig rotation rehearsal) to ✅ with a link to the dated rehearsal log. Same pattern row 3.5 (pause rehearsal) already uses, post-2026-05-12 execution.

## Why this doc exists

The 4 rehearsal scripts (`scripts/devnet/squads-rehearsal-*.ts`) + the 268-line procedure doc + the rehearsal log template have been ready for ~5 sprints, but the execution hadn't happened. Probable cause: friction. This doc replaces 3 separate doc reads + 4 script-path memorizations with one copy-paste sequence + pnpm aliases (`devnet:squads-rehearsal-*` instead of `tsx scripts/devnet/squads-rehearsal-*.ts`).

If you read this doc and the rehearsal still hasn't run, the friction isn't in the docs — escalate that.
