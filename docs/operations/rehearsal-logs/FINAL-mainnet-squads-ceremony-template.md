# Final Mainnet Squads Multisig Ceremony — Report Template

> **Pre-flight reading:**
>
> - [`squads-multisig-procedure.md`](../squads-multisig-procedure.md) — full procedure
> - [`squads-mainnet-ceremony-checklist.md`](../squads-mainnet-ceremony-checklist.md) — readiness checklist
> - [`squads-rehearsal-quickstart.md`](../squads-rehearsal-quickstart.md) — devnet rehearsal evidence (2026-05-16)
>
> **This document is the WORKSHEET filled DURING the mainnet ceremony, not before.** Pre-filled fields are inputs the ceremony coordinator confirms beforehand; blank fields are evidence captured live. Save the completed file to this directory with name `YYYY-MM-DD-mainnet-squads-ceremony.md` after sign-off.

## Ceremony metadata

| Field                          | Value                               |
| ------------------------------ | ----------------------------------- |
| **Date (UTC)**                 | _YYYY-MM-DDTHH:MM:SSZ_              |
| **Cluster**                    | mainnet-beta                        |
| **Coordinator**                | _name_                              |
| **Witness / second pair eyes** | _name_                              |
| **Squads UI version**          | v4 _build-hash_                     |
| **Solana CLI version**         | _output of `solana --version`_      |
| **RPC endpoint used**          | _e.g. Helius mainnet, Triton, etc._ |

## Squads multisig configuration

| Field                                   | Value                                                  |
| --------------------------------------- | ------------------------------------------------------ |
| **Multisig PDA**                        | _<base58>_                                             |
| **Quorum**                              | 3 of 5                                                 |
| **Member 1 (founder)**                  | _<base58>_ · Ledger Nano S+ · derivation `44'/501'/0'` |
| **Member 2 (technical lead)**           | _<base58>_ · _device_ · _derivation_                   |
| **Member 3 (security advisor)**         | _<base58>_ · _device_ · _derivation_                   |
| **Member 4 (board / backup)**           | _<base58>_ · _device_ · _derivation_                   |
| **Member 5 (board / backup)**           | _<base58>_ · _device_ · _derivation_                   |
| **Vault PDA (treasury USDC ATA owner)** | _<base58>_                                             |

## Pre-ceremony attestations

Each member confirms before any tx is signed:

- [ ] Hardware wallet firmware updated within last 30 days
- [ ] Solana app version matches the rest of the quorum
- [ ] Member pubkey shown on hardware screen matches the value above
- [ ] Member has read [`squads-multisig-procedure.md`](../squads-multisig-procedure.md) Steps 1–6
- [ ] Member understands the irreversibility of each step
- [ ] Recovery procedure ([`key-rotation.md`](../key-rotation.md)) is on file

Coordinator + witness pre-flight:

- [ ] `pnpm test:mainnet-hardening` exited 0 with current `ProtocolConfig` state (paste output as Appendix A)
- [ ] Verified the build at `claude/mainnet-deploy` matches the OtterSec verify-build PDA on the 4 mainnet programs (paste tx sigs as Appendix B)
- [ ] Treasury USDC ATA is created and owned by the Squads vault PDA (paste `spl-token display` output as Appendix C)
- [ ] No active `propose_new_authority` or `propose_new_treasury` pending on the protocol (`solana account <config_pda>` → confirm pending_authority_eta == 0 and pending_treasury_eta == 0)

## Phase 1 — Rotate `roundfi-core` upgrade authority to Squads PDA

**Command (run from coordinator's deployer machine):**

```bash
solana program set-upgrade-authority \
  8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw \
  --new-upgrade-authority <SQUADS_VAULT_PDA> \
  --url mainnet-beta \
  --keypair <CURRENT_AUTHORITY_KEYPAIR>
```

| Field           | Value                         |
| --------------- | ----------------------------- |
| Tx signature    | _<base58>_                    |
| Solscan link    | https://solscan.io/tx/_<sig>_ |
| Time (UTC)      | _HH:MM:SSZ_                   |
| Coordinator sig | ✅ / 🔴 _initials_            |
| Witness sig     | ✅ / 🔴 _initials_            |

## Phase 2 — Rotate `roundfi-reputation` upgrade authority

| Field           | Value                                          |
| --------------- | ---------------------------------------------- |
| Program ID      | `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2` |
| Tx signature    | _<base58>_                                     |
| Solscan link    | https://solscan.io/tx/_<sig>_                  |
| Time (UTC)      | _HH:MM:SSZ_                                    |
| Coordinator sig | ✅ / 🔴 _initials_                             |
| Witness sig     | ✅ / 🔴 _initials_                             |

## Phase 3 — Rotate `roundfi-yield-kamino` upgrade authority

| Field           | Value                                          |
| --------------- | ---------------------------------------------- |
| Program ID      | `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb` |
| Tx signature    | _<base58>_                                     |
| Solscan link    | https://solscan.io/tx/_<sig>_                  |
| Time (UTC)      | _HH:MM:SSZ_                                    |
| Coordinator sig | ✅ / 🔴 _initials_                             |
| Witness sig     | ✅ / 🔴 _initials_                             |

## Phase 4 — Rotate `roundfi-yield-mock` upgrade authority

(Mock adapter stays deployed for emergency fallback — same rotation discipline.)

| Field           | Value                                          |
| --------------- | ---------------------------------------------- |
| Program ID      | `GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ` |
| Tx signature    | _<base58>_                                     |
| Solscan link    | https://solscan.io/tx/_<sig>_                  |
| Time (UTC)      | _HH:MM:SSZ_                                    |
| Coordinator sig | ✅ / 🔴 _initials_                             |
| Witness sig     | ✅ / 🔴 _initials_                             |

## Phase 5 — Propose `config.authority` rotation via Squads UI

(7-day timelock window opens here. Squads ceremony for the proposal only — the commit happens after the timelock matures.)

**Squads UI sequence:**

1. Coordinator opens https://app.squads.so/ with cluster=mainnet, connects multisig PDA
2. New Transaction → Solana → Custom Instruction
3. Program ID: `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw` (roundfi-core)
4. Instruction data: encoded `propose_new_authority(<SQUADS_VAULT_PDA>)`
5. Accounts: ProtocolConfig PDA (`{derive}`), current `config.authority`, system_program
6. Each member signs with their hardware wallet (M1 + M2 + M3 = 3 of 5 quorum)
7. Coordinator hits "Execute Transaction" once quorum is reached

| Field                        | Value                         |
| ---------------------------- | ----------------------------- |
| Squads tx index              | _#nnn_                        |
| Squads tx pubkey             | _<base58>_                    |
| Members who signed (3+ of 5) | M*, M*, M\_                   |
| On-chain tx signature        | _<base58>_                    |
| Solscan link                 | https://solscan.io/tx/_<sig>_ |
| Time (UTC)                   | _HH:MM:SSZ_                   |
| `pending_authority_eta` set  | _Unix ts_ (= now + 7 days)    |

## Phase 6 — Propose `config.treasury` rotation via Squads UI

Same shape as Phase 5, but target is the Squads-controlled USDC ATA.

| Field                        | Value                         |
| ---------------------------- | ----------------------------- |
| Squads tx index              | _#nnn_                        |
| Squads tx pubkey             | _<base58>_                    |
| Target treasury ATA          | _<base58>_                    |
| Members who signed (3+ of 5) | M*, M*, M\_                   |
| On-chain tx signature        | _<base58>_                    |
| Solscan link                 | https://solscan.io/tx/_<sig>_ |
| `pending_treasury_eta` set   | _Unix ts_ (= now + 7 days)    |

## Post-ceremony immediate verification

Coordinator runs and pastes output:

```bash
# 1. Confirm all 4 program upgrade authorities flipped
for PID in \
  8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw \
  Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2 \
  74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb \
  GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ; do
  echo "=== $PID ==="
  solana program show "$PID" --url mainnet-beta | grep "Authority"
done

# 2. Confirm ProtocolConfig has pending proposals registered
pnpm test:mainnet-hardening \
  EXPECTED_AUTHORITY=<original_authority> \
  EXPECTED_TREASURY=<original_treasury>
```

Expected:

- All 4 programs show `Authority: <SQUADS_VAULT_PDA>` (no longer single-keypair)
- `mainnet-hardening` still passes (authority/treasury haven't COMMITTED yet — pending only)

## T+7 days — Commit phase (separate ceremony)

After the 7-day timelock matures, ANYONE can call:

```bash
solana program invoke ... commit_new_authority ...
solana program invoke ... commit_new_treasury ...
```

Track separately as `YYYY-MM-DD-mainnet-squads-commit.md`.

## Roll-back

If something goes catastrophically wrong between propose and commit:

| Mistake                                | Recovery                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong Squads PDA proposed              | Call `cancel_new_authority` / `cancel_new_treasury` via current authority before the 7-day ETA. Restart with correct PDA.                                                                                                                                                                          |
| Member key lost mid-ceremony           | If quorum still reachable without that member (e.g. 3 of remaining 4), continue. Otherwise abort and re-plan with backup signers.                                                                                                                                                                  |
| Hardware wallet bricked                | Same as above — quorum-dependent.                                                                                                                                                                                                                                                                  |
| Upgrade authority rotated to wrong PDA | **NOT RECOVERABLE FROM CURRENT KEYPAIR** — wrong PDA now has full control. If that PDA is the Squads PDA (off-by-account), same Squads quorum can `set-upgrade-authority` back. If it's a true random pubkey, the program is permanently locked at current version (no further upgrades possible). |

## Sign-off

**Ceremony coordinator:**

```
Name:
Date:
Signature: ________________________
```

**Witness:**

```
Name:
Date:
Signature: ________________________
```

**Member acknowledgments (each member):**

```
Member 1: ________________________
Member 2: ________________________
Member 3: ________________________
Member 4: ________________________
Member 5: ________________________
```

## Appendices

### Appendix A — `pnpm test:mainnet-hardening` pre-flight output

```
<paste full output here>
```

### Appendix B — OtterSec verify-build attestation PDAs

```
<paste 4 program verification confirmations>
```

### Appendix C — Treasury USDC ATA `spl-token display`

```
<paste output>
```

### Appendix D — On-chain log of each Phase tx (full Solscan dump)

```
<paste expanded log for each of the 6 phase txs>
```

## Notes / deviations from procedure

_(Anything that didn't match the documented procedure goes here. Auditor-readable.)_

---

_Template version: 1.0_
_Last updated: 2026-05-17_
_Authored under PR #381 as part of the mainnet-prep deliverables sprint._
