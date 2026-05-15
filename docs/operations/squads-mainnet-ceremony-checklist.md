# Squads Mainnet Ceremony — Day-of Checklist

> **Use:** print this page (A4, both sides). Take to the ceremony room. Tick boxes with a pen as each line completes. Record tx signatures + PDAs in the blank lines. **Do NOT improvise** — every step has a defined kill-switch in §K.
>
> **Reference (do not read during ceremony — read 24h before):** [`squads-multisig-procedure.md`](./squads-multisig-procedure.md) — full prose runbook with rationale + rollback paths. **Companion:** [`emergency-response.md`](./emergency-response.md) for what to do if §K fires.
>
> **Ceremony splits across two sessions** because of the 7-day on-chain timelock on protocol-authority rotation:
>
> - **Session 1 (Day 0):** create multisig, rotate upgrade authority × 4, propose protocol authority
> - **Session 2 (Day 7+):** commit protocol authority, verification matrix
> - **Optional Session 3 (Day 7+):** treasury rotation (separate 7-day timelock; can stack with Session 2 if started Day 0)

---

## Metadata (fill in pen, before starting)

| Field                        | Value                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Ceremony date (UTC, Day 0)   | `____-__-__T__:__Z`                                                                                                                         |
| Operator (executes commands) | `____`                                                                                                                                      |
| Witness 1                    | `____`                                                                                                                                      |
| Witness 2                    | `____`                                                                                                                                      |
| Out-of-band comms channel    | `____` (Signal/1Password, NOT public)                                                                                                       |
| Devnet rehearsal log         | `docs/operations/rehearsal-logs/______.md`                                                                                                  |
| Squads program ID re-pin     | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` ☐ verified against [deploys page](https://github.com/Squads-Protocol/v4/blob/main/deploys.md) |
| Git commit at ceremony       | `____` (paste `git rev-parse HEAD`)                                                                                                         |

---

## §T-24h. Pre-flight gate

**Cannot proceed to Session 1 unless EVERY box below is ticked.**

- ☐ Devnet rehearsal completed end-to-end with filled log
- ☐ All 5 member hardware wallets charged + firmware up-to-date
- ☐ All 5 member pubkeys verified in writing (cross-channel, not just chat) — paste below:
  - ☐ Member 0: `____`
  - ☐ Member 1: `____`
  - ☐ Member 2: `____`
  - ☐ Member 3: `____`
  - ☐ Member 4: `____`
- ☐ Threshold agreed: **3-of-5** (do not change without team meeting)
- ☐ Deployer keypair at known offline location (`____`); ≥ 0.5 SOL on mainnet for ceremony fees
- ☐ Backup deployer keypair tested (can sign a test mainnet tx of 0.001 SOL transfer)
- ☐ Solana CLI version pinned: output of `solana --version` = `____` (≥ 1.18, ≤ the version anchor build used)
- ☐ Mainnet RPC endpoint chosen + tested (Helius / Triton / QuickNode — NOT public RPC for the ceremony)
- ☐ Squads UI bookmarked (https://app.squads.so), tested with one member's wallet
- ☐ All 4 program IDs paste-buffer ready:
  - ☐ roundfi-core: `8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw`
  - ☐ roundfi-reputation: `Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2`
  - ☐ roundfi-yield-kamino: `74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb`
  - ☐ roundfi-yield-mock: `GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ` _(if also deploying mock to mainnet — usually skipped)_

---

## §S1. Session 1 — Bootstrap (Day 0, T+0)

### 1.1 Create the multisig (Squads UI)

- ☐ Connect Member 0's hardware wallet to Squads UI (pays creation rent ~0.05 SOL)
- ☐ Click "Create Multisig" → "Custom"
  - ☐ Threshold: `3`
  - ☐ Members: paste all 5 pubkeys
  - ☐ Time lock: `0 hours` (on-chain ix has its own 7d)
- ☐ Sign + send. Tx sig: `____`
- ☐ Squads UI shows Multisig PDA: `____`
- ☐ Squads UI shows Vault PDA (index 0): **`____`** ← CRITICAL, copy 5+ chars carefully

### 1.2 Cross-check Vault PDA via derivation script

- ☐ Run script:
  ```bash
  pnpm tsx scripts/devnet/squads-derive-pda.ts \
    --member <m0> --member <m1> --member <m2> --member <m3> --member <m4> \
    --threshold 3 --create-key <create-key-from-UI>
  ```
- ☐ Script Vault PDA (5+ chars): `____`
- ☐ **Match against UI Vault PDA?** → ☐ YES proceed / ☐ NO → §K1

### 1.3 Rotate upgrade authority × 4 programs

For each program (substitute `<PROGRAM_ID>` + `<VAULT_PDA>`):

```bash
solana program set-upgrade-authority \
  --url <mainnet-rpc> \
  --keypair ~/.config/solana/mainnet-deployer.json \
  <PROGRAM_ID> \
  --new-upgrade-authority <VAULT_PDA> \
  --skip-new-upgrade-authority-signer-check
```

| #   | Program              | Tx sig | `solana program show` → Upgrade Authority matches Vault PDA? |
| --- | -------------------- | ------ | ------------------------------------------------------------ |
| a   | roundfi-core         | `____` | ☐                                                            |
| b   | roundfi-reputation   | `____` | ☐                                                            |
| c   | roundfi-yield-kamino | `____` | ☐                                                            |
| d   | roundfi-yield-mock   | `____` | ☐ _(skip if mock not deployed to mainnet)_                   |

**Any row's verification fails** → §K2

### 1.4 Propose protocol authority rotation

- ☐ Verify pre-state — `pnpm tsx scripts/devnet/squads-rehearsal-verify.ts` (or mainnet equivalent script — verify-only, never use rehearsal scripts directly on mainnet) shows:
  - Live authority = deployer pubkey
  - Pending authority = `11111111111111111111111111111111`
  - Pending eta = 0
- ☐ Submit `propose_new_authority(new_authority: <VAULT_PDA>)` via deployer-signed tx (raw CLI or SDK helper, **NOT** through Squads — Squads is the _target_, not yet the signer)
- ☐ Tx sig: `____`
- ☐ Verify post-propose state:
  - Live authority = deployer (unchanged ✓)
  - Pending authority = `____` (should equal Vault PDA)
  - Pending eta = `____` (should be now + 604_800)

### 1.5 Optional: also propose treasury rotation (parallel 7-day window)

If treasury also moves to a vault-owned ATA at this ceremony:

- ☐ Compute new treasury ATA = `getAssociatedTokenAddressSync(USDC_MINT, <VAULT_PDA>, true)`: `____`
- ☐ Deployer signs `propose_new_treasury(new_treasury: <new-ata>)`. Tx sig: `____`
- ☐ Pending treasury verified: `____`, eta `____`

### 1.6 Session 1 sign-off

- ☐ Operator: `____` confirms all rows above completed
- ☐ Witness 1: `____` ack
- ☐ Witness 2: `____` ack
- ☐ Public announcement posted (Twitter / Discord / blog): "RoundFi protocol authority rotation proposed. Vault PDA: `____`. Commit fires after 7 days. Verify via decoded ProtocolConfig at any time."

**🛑 STOP HERE. Session 2 is 7+ days away. Do not commit early.**

---

## §S2. Session 2 — Authority Commit (Day 7+, after eta elapses)

### 2.1 Pre-flight

- ☐ Verify eta has elapsed: current UNIX ts ≥ `pending_authority_eta` from §1.4
- ☐ No emergency disclosed during 7-day window (check Twitter / Discord / SECURITY.md inbox)
- ☐ Re-confirm with witnesses: rotation is still wanted

### 2.2 Commit

- ☐ Anyone (deployer / cranker / a member) calls `commit_new_authority()` — permissionless. Tx sig: `____`
- ☐ Verify post-commit state:
  - **Live authority = `____` (must equal Vault PDA from §1.1) ← THE GATE**
  - Pending authority = `11111111111111111111111111111111`
  - Pending eta = 0
- ☐ Deployer key has ZERO authority over the protocol now (deployer can verify by attempting any authority-gated ix → expect `Unauthorized`)

### 2.3 (If applicable) Commit treasury rotation

If §1.5 was exercised AND the treasury eta has also elapsed:

- ☐ Anyone calls `commit_new_treasury()`. Tx sig: `____`
- ☐ Verify `config.treasury` = new ATA

---

## §V. Final Verification Matrix

Run after Session 2 (and Session 3 if applicable). Every box must tick before declaring ceremony complete.

| #   | Surface                               | Command                                                                                     | Expected                      | Actual | ☐   |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------- | ------ | --- |
| 1   | core upgrade auth                     | `solana program show 8LVrgxKw... -u mainnet-beta`                                           | `<VAULT_PDA>`                 | `____` | ☐   |
| 2   | reputation upgrade auth               | `solana program show Hpo174C6... -u mainnet-beta`                                           | `<VAULT_PDA>`                 | `____` | ☐   |
| 3   | yield-kamino upgrade auth             | `solana program show 74izMa4W... -u mainnet-beta`                                           | `<VAULT_PDA>`                 | `____` | ☐   |
| 4   | `config.authority`                    | decode ProtocolConfig PDA, offset 8                                                         | `<VAULT_PDA>`                 | `____` | ☐   |
| 5   | `config.pending_authority`            | decode ProtocolConfig PDA, offset 311                                                       | `Pubkey::default()`           | `____` | ☐   |
| 6   | `config.pending_authority_eta`        | decode ProtocolConfig PDA, offset 343 (i64 LE)                                              | `0`                           | `____` | ☐   |
| 7   | `config.treasury` (if §1.5 exercised) | decode ProtocolConfig PDA, offset 40                                                        | `<new-ata>`                   | `____` | ☐   |
| 8   | `solana-verify` attestations still OK | `solana-verify -u mainnet-beta get-program-pda --program-id <pid> --signer <orig-deployer>` | original attestation returned | `____` | ☐   |

**Any row fails** → §K3

---

## §F. Post-ceremony actions

- ☐ Update `docs/devnet-deployment.md` (or mainnet equivalent) with Multisig PDA + Vault PDA — **treat as program-ID-level constants, never change**
- ☐ Update `MAINNET_READINESS.md` § 3.6 + § 3.7 → flip to ✅ with ceremony date + tx sigs
- ☐ Update `AUDIT_SCOPE.md` mainnet timeline
- ☐ Write incident postmortem if §K fired at any point (template: [`incident-template.md`](./incident-template.md))
- ☐ Archive this filled checklist to `docs/operations/rehearsal-logs/YYYY-MM-DD-mainnet-squads-ceremony.md`
- ☐ Public announcement: "Protocol authority + upgrade authority now under 3-of-5 Squads multisig. Verification commands at `docs/operations/squads-multisig-procedure.md` §5."
- ☐ Schedule first ongoing Squads governance call (cadence: monthly initial, quarterly post-stabilization)

---

## §K. Kill switches — when to ABORT

| Trigger                                                                                  | Stop point in flow  | Action                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **§K1** Vault PDA from script ≠ Vault PDA from UI                                        | §1.2                | **STOP.** Do NOT click §1.3 commands. The Squads v4 program ID may have rotated or the script offsets drifted. Re-derive on a clean machine; if still mismatch, contact Squads team before proceeding. Multisig PDA setup is recoverable (rent reclaim), but a wrong-PDA upgrade auth transfer is NOT.                                                                                   |
| **§K2** `solana program show` after set-upgrade-authority does NOT show Vault PDA        | §1.3                | **STOP next 3 programs.** Investigate the failing program: signer was wrong (re-run with correct keypair) or PDA target was wrong (catastrophic — program may be locked under unknown key). If catastrophic: emergency-response.md §"Lost upgrade authority" — recoverability only if you control the wrong PDA.                                                                         |
| **§K3** Verification matrix row fails post-commit                                        | §V                  | **STOP. Do not announce ceremony complete.** Investigate: was the right signer used? Did a malicious tx land during the 7-day window? Check signature history of ProtocolConfig PDA on Solscan. Likely action: rotate again (propose immediately with same Vault PDA, wait 7d, commit). If decoded fields show truly unexpected state: emergency-response.md §"Hostile authority".       |
| **§K4** Emergency disclosure during 7-day window (compromised key, leaked seed, exploit) | Between §S1 and §S2 | If the disclosure affects the **incoming** authority (the Squads members): cancel via deployer-signed `cancel_new_authority()`, re-propose with fresh members after the disclosure is contained. If it affects the **outgoing** authority (deployer key): commit ASAP (don't wait the remaining timelock — anyone can crank once eta elapses; if eta hasn't yet, sadly we have to wait). |
| **§K5** Squads UI shows a different threshold / member set than agreed                   | §1.1                | **STOP.** Do NOT click "Sign + send" on the multisig creation. The UI may have lost state or someone clicked wrong button. Reload, reconfigure, verify again before signing.                                                                                                                                                                                                             |
| **§K6** Member hardware wallet refuses to sign / shows wrong data                        | Any                 | **STOP that member.** Other members proceed if threshold still reachable. The non-signing member's session needs a re-test (firmware update, cable, USB hub) before they can resume.                                                                                                                                                                                                     |

---

## §Z. Ceremony sign-off (filled at the very end)

| Role      | Name     | Confirms ceremony complete with all §V rows ticked + no §K triggered | Signature (text-OK) |
| --------- | -------- | -------------------------------------------------------------------- | ------------------- |
| Operator  | \_\_\_\_ | ☐                                                                    | \_\_\_\_            |
| Witness 1 | \_\_\_\_ | ☐                                                                    | \_\_\_\_            |
| Witness 2 | \_\_\_\_ | ☐                                                                    | \_\_\_\_            |

**Ceremony complete at:** `____-__-__T__:__Z` UTC.

---

_Checklist version 1.0. Update whenever the on-chain authority/upgrade surface or the Squads procedure changes._
