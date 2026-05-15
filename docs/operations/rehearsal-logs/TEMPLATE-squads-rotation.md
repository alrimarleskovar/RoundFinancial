# Squads multisig rotation — rehearsal log TEMPLATE

> **Use:** copy this file to `YYYY-MM-DD-squads-rotation-rehearsal.md` in
> this same folder before starting the devnet rehearsal. Fill in every
> blank as the rehearsal progresses. The artifact is what an auditor
> (and a future you, 6 months later) needs to see to trust that the
> mainnet ceremony was practiced end-to-end on devnet first.
>
> **Companion:**
>
> - [`docs/operations/squads-multisig-procedure.md`](../squads-multisig-procedure.md) — the canonical procedure this rehearsal exercises
> - [`docs/operations/key-rotation.md`](../key-rotation.md) — generic rotation runbook

---

## 0. Metadata

| Field                | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| Rehearsal date (UTC) | `____-__-__T__:__:__Z`                                          |
| Operator             | `____`                                                          |
| Witnesses (≥1)       | `____`                                                          |
| Cluster              | `devnet`                                                        |
| Core program ID      | `____` _(should match `cluster.programs.core` for devnet)_      |
| ProtocolConfig PDA   | `____` _(derive: `[b"config"]` under core program)_             |
| Solana CLI version   | `____` _(output of `solana --version`)_                         |
| Branch + commit      | `____` _(output of `git rev-parse --abbrev-ref HEAD` + `HEAD`)_ |

---

## 1. Member set (throwaway keypairs for devnet)

> Generate fresh keypairs with `solana-keygen new --no-bip39-passphrase -o member-N.json`.
> These are **throwaway** — do NOT reuse on mainnet.

| Slot | Pubkey | Source path       |
| ---- | ------ | ----------------- |
| 0    | `____` | `member-0.json`   |
| 1    | `____` | `member-1.json`   |
| 2    | `____` | `member-2.json`   |
| (3)  | `____` | `member-3.json`   |
| (4)  | `____` | `member-4.json`   |
| key  | `____` | `create-key.json` |

Threshold chosen for rehearsal: `__-of-__` _(suggested: 2-of-3 for speed; mainnet will be 3-of-5)_

---

## 2. Squads PDA derivation (cross-check)

Run:

```bash
pnpm tsx scripts/devnet/squads-derive-pda.ts \
  --member <member-0-pubkey> \
  --member <member-1-pubkey> \
  --member <member-2-pubkey> \
  --threshold 2 \
  --create-key <create-key-pubkey>
```

| Field                | Computed value | UI-shown value | Match? |
| -------------------- | -------------- | -------------- | ------ |
| Squads v4 program ID | `____`         | `____`         | ☐      |
| Multisig PDA         | `____`         | `____`         | ☐      |
| Vault PDA (index 0)  | `____`         | `____`         | ☐      |

> **If the Vault PDA does NOT match** the address shown in the Squads
> UI after multisig creation, **STOP**. The PDA derivation has drifted
> from canonical Squads v4 and proceeding would transfer authority to
> a wrong/unknown address.

---

## 3. Step 1 — Create the multisig (Squads web UI)

| Field                      | Value                                         |
| -------------------------- | --------------------------------------------- |
| Squads UI URL              | https://app.squads.so (switch to devnet)      |
| Connecting wallet (payer)  | `____`                                        |
| Multisig creation tx sig   | `____`                                        |
| Vault PDA shown in UI      | `____` _(should match the cross-check above)_ |
| Squads "Account" page link | `____`                                        |

---

## 4. Step 2 — Rotate upgrade authority (4 RoundFi programs)

For each program, run:

```bash
solana program set-upgrade-authority \
  --url <devnet-rpc> \
  --keypair ~/.config/solana/devnet-deployer.json \
  <PROGRAM_ID> \
  --new-upgrade-authority <VAULT_PDA> \
  --skip-new-upgrade-authority-signer-check
```

| Program              | Program ID | Rotation tx sig | `solana program show` verifies new auth? |
| -------------------- | ---------- | --------------- | ---------------------------------------- |
| roundfi-core         | `____`     | `____`          | ☐                                        |
| roundfi-reputation   | `____`     | `____`          | ☐                                        |
| roundfi-yield-kamino | `____`     | `____`          | ☐                                        |
| roundfi-yield-mock   | `____`     | `____`          | ☐                                        |

---

## 5. Step 3 — Rotate protocol authority (propose → 7d → commit)

### 5a. Pre-propose state

Run `pnpm tsx scripts/devnet/squads-rehearsal-verify.ts` and paste the
"Authority rotation surface" block here:

```
  Live authority       : ____
  Pending authority    : ____  (expected: 11111111111111111111111111111111)
  Pending authority eta: ____  (expected: 0 (no proposal))

  ✓ Idle — no authority rotation in flight
```

### 5b. Submit `propose_new_authority`

```bash
pnpm tsx scripts/devnet/squads-rehearsal-propose-authority.ts \
  --new-authority <VAULT_PDA>
```

| Field                          | Value  |
| ------------------------------ | ------ |
| `propose_new_authority` tx sig | `____` |
| Vault PDA proposed             | `____` |
| Eta (printed by script)        | `____` |

### 5c. Post-propose state

Re-run verify:

```
  Live authority       : ____  (still the deployer)
  Pending authority    : ____  (now the vault PDA)
  Pending authority eta: ____  (now + ~7d in seconds)

  ⏳ Pending — proposal staged, timelock active
```

### 5d. Wait window (or fast-forward on devnet)

| Tactic                                     | Notes                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Real 7-day wait (production-faithful)      | Most rigorous; longest. Run cancel + re-propose in parallel to also exercise the abort path.                                                |
| Lower `TREASURY_TIMELOCK_SECS` on a branch | For a same-day rehearsal: temporarily set `TREASURY_TIMELOCK_SECS = 60` in `constants.rs`, redeploy, re-run. Record the temporary constant. |

Approach used for this rehearsal: `____`

If a cancel path is also being rehearsed (recommended at least once):

| `cancel_new_authority` tx sig | `____` |
| Post-cancel verify state | `____` |
| Fresh re-propose tx sig | `____` |

### 5e. Commit

```bash
pnpm tsx scripts/devnet/squads-rehearsal-commit-authority.ts
```

| Field                         | Value                                     |
| ----------------------------- | ----------------------------------------- |
| `commit_new_authority` tx sig | `____`                                    |
| New `config.authority`        | `____` _(should match Vault PDA from §2)_ |

### 5f. Post-commit state

```
  Live authority       : ____  (NOW the vault PDA)
  Pending authority    : ____  (back to 11111111111111111111111111111111)
  Pending authority eta: ____  (back to 0)

  ✓ Idle — no authority rotation in flight
```

---

## 6. Step 4 — Rotate treasury (optional rehearsal)

> Only fill in if the rehearsal also exercises treasury rotation. Otherwise mark "Not exercised this run."

Status: `____`

If exercised:

| Field                         | Value  |
| ----------------------------- | ------ |
| New treasury ATA              | `____` |
| `propose_new_treasury` tx sig | `____` |
| 7-day wait approach           | `____` |
| `commit_new_treasury` tx sig  | `____` |
| Post-commit `config.treasury` | `____` |

---

## 7. Step 5 — Verification matrix

Run all four checks and paste outputs:

```bash
# Upgrade authority × 4 programs
solana program show <core-id> --url devnet
solana program show <reputation-id> --url devnet
solana program show <kamino-id> --url devnet
solana program show <mock-id> --url devnet

# Protocol authority
pnpm tsx scripts/devnet/squads-rehearsal-verify.ts
```

| Surface                           | Expected            | Actual | Match? |
| --------------------------------- | ------------------- | ------ | ------ |
| roundfi-core upgrade auth         | `<VAULT_PDA>`       | `____` | ☐      |
| roundfi-reputation upgrade auth   | `<VAULT_PDA>`       | `____` | ☐      |
| roundfi-yield-kamino upgrade auth | `<VAULT_PDA>`       | `____` | ☐      |
| roundfi-yield-mock upgrade auth   | `<VAULT_PDA>`       | `____` | ☐      |
| `config.authority`                | `<VAULT_PDA>`       | `____` | ☐      |
| `config.pending_authority`        | `Pubkey::default()` | `____` | ☐      |
| `config.pending_authority_eta`    | `0`                 | `____` | ☐      |

If ANY row fails, **DO NOT mark the rehearsal complete**. Open an issue
referencing this log + the failing row.

---

## 8. Surprises + lessons learned

> Free-form. Anything unexpected during the rehearsal — UI weirdness,
> tx ordering issues, missing CLI flags, RPC quirks, hardware-wallet
> firmware issues if testing with real hardware. This section is what
> a future operator (you, the auditor, a new team member) reads to
> avoid the same trip-wires at mainnet.

```
____
```

---

## 9. Sign-off

| Role             | Name     | Signature (text-OK, "Approved on YYYY-MM-DD HH:MM UTC") |
| ---------------- | -------- | ------------------------------------------------------- |
| Operator         | \_\_\_\_ | \_\_\_\_                                                |
| Witness 1        | \_\_\_\_ | \_\_\_\_                                                |
| (Witness 2 opt.) | \_\_\_\_ | \_\_\_\_                                                |

---

_Template version 1.0. Update when the on-chain authority-rotation surface or the procedure doc changes._
