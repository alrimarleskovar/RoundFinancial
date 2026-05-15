# Squads Multisig Procedure — RoundFi mainnet

> **Scope:** the one-time bootstrap that rotates RoundFi's **upgrade authority** (Solana program-loader) and **protocol authority** (`ProtocolConfig.authority`) from a single deployer keypair to a Squads v4 multisig. Closes items 3.6 + 3.7 of [`MAINNET_READINESS.md`](../../MAINNET_READINESS.md).
>
> **Companion:**
>
> - [`key-rotation.md`](./key-rotation.md) — generic rotation runbook covering all three key surfaces (protocol authority, treasury, upgrade authority). This doc is the **Squads-specific** drill-down for the upgrade + protocol authority surfaces.
> - [`emergency-response.md`](./emergency-response.md) — what to do if a key (multisig or otherwise) is suspected compromised mid-flight.
> - [`scripts/devnet/squads-derive-pda.ts`](../../scripts/devnet/squads-derive-pda.ts) — utility for previewing the multisig PDA from candidate member keys before the real ceremony.
> - [`scripts/devnet/squads-rehearsal-*.ts`](../../scripts/devnet/) — `verify` / `propose-authority` / `cancel-authority` / `commit-authority` wrappers around the on-chain authority-rotation ix trio. Used end-to-end during the devnet rehearsal; refuse to run against mainnet.
> - [`docs/operations/rehearsal-logs/TEMPLATE-squads-rotation.md`](./rehearsal-logs/TEMPLATE-squads-rotation.md) — fill-in-the-blank rehearsal log capturing every tx signature, PDA, and verification check from the dry-run.
> - [`squads-mainnet-ceremony-checklist.md`](./squads-mainnet-ceremony-checklist.md) — **the day-of operational artifact**. Printable A4 with checkbox-per-line, blank lines for tx sigs/PDAs, explicit kill-switches in §K, sign-off block. Use this checklist at the ceremony; use this procedure doc for context + rationale 24h before.

---

## Why multisig

A single deployer keypair on mainnet is a **point of total compromise** for the protocol: leak the key (HSM failure, social engineering, host compromise) and an attacker can:

- Ship a malicious program upgrade that drains every pool's vaults
- Call `update_protocol_config` to redirect fees or unpause the protocol after an emergency stop
- Race the legitimate authority to rotate the on-chain authority into hostile territory (see compromised-key path in [`key-rotation.md`](./key-rotation.md))

A 3-of-5 Squads multisig collapses every one of those single-key failure modes into a 3-key correlated compromise — exponentially harder. It's the **default expectation** of every external auditor we've talked to.

---

## What Squads gives us

[Squads Protocol v4](https://github.com/Squads-Protocol/v4) is the standard Solana multisig program. The v4 mainnet deployment lives at:

```
Mainnet program ID: SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
Devnet program ID:  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf  (same — Squads ships the same binary)
```

For each multisig you create, Squads derives:

| PDA      | Seed                                        | Purpose                                                                                                                      |
| -------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Multisig | `["multisig", create_key]`                  | Stores the member list + threshold + bump                                                                                    |
| Vault    | `["multisig", multisig, "vault", index_le]` | One PDA per vault index. **This is the address that should hold protocol authority + receive upgrade-authority delegation.** |

The vault PDA is what counts on-chain — it's the address that signs transactions on behalf of the multisig once the threshold of members approve a proposed instruction.

> **Always re-verify the Squads program ID against the published deploy** before running the procedure below. Squads v4 has been stable since 2024 but a re-pin pre-mainnet costs nothing.

---

## Procedure (one-time, mainnet ceremony)

### Step 0 — Pre-flight

1. **Hardware wallets for every member**. Ledger Nano X or equivalent. No software-keystore members for mainnet.
2. **Member list locked down** — the 5 members signed off, public keys recorded, threshold = 3 chosen.
3. **Out-of-band comms channel established** — 1Password/Signal/etc., NOT the same channel as the project's public Discord/Twitter.
4. **Pre-rehearsal on devnet** — at least one full dry-run via the Squads UI on devnet using throwaway members; see [§ Devnet rehearsal](#devnet-rehearsal) below.
5. **Squads program verified** against the canonical program ID above (compare against [Squads' deploys page](https://github.com/Squads-Protocol/v4/blob/main/deploys.md)).

### Step 1 — Create the multisig

Via the [Squads web app](https://app.squads.so):

1. Connect a member's hardware wallet (any member — the connecting wallet pays creation rent, ~0.05 SOL).
2. "Create Multisig" → "Custom" → set:
   - **Threshold:** 3
   - **Members:** add all 5 member pubkeys
   - **Time lock:** 0 hours (RoundFi treasury rotation already has its own 7-day on-chain timelock — adding another at the Squads layer is duplicative friction)
3. Sign + send. Squads creates the multisig PDA + a vault PDA at index 0.
4. **Record both PDA addresses** in `docs/devnet-deployment.md` (or the mainnet equivalent) as the canonical "protocol multisig" addresses. Treat these as if they were program IDs — never change after recording.

### Step 2 — Rotate the upgrade authority

> **Critical:** this rotation is **one-way at the Solana runtime level**. If you set the wrong address (wrong PDA, typo, etc.), the program is locked under a wrong key with no recovery. Triple-check the target pubkey.

For each of the 4 RoundFi programs (`roundfi-core`, `roundfi-reputation`, `roundfi-yield-kamino`, `roundfi-yield-mock`):

```bash
# Substitute <VAULT_PDA> with the Squads vault PDA from Step 1.
# Substitute <PROGRAM_ID> with each program ID in turn.
solana program set-upgrade-authority \
  --url https://api.mainnet-beta.solana.com \
  --keypair ~/.config/solana/mainnet-deployer.json \
  <PROGRAM_ID> \
  --new-upgrade-authority <VAULT_PDA> \
  --skip-new-upgrade-authority-signer-check
```

The `--skip-new-upgrade-authority-signer-check` flag is **required** when transferring authority to a PDA (the PDA cannot sign at rotation time; it signs future upgrades through Squads' invoke).

After each call:

```bash
# Verify the rotation landed
solana program show <PROGRAM_ID> --url https://api.mainnet-beta.solana.com
# → "Upgrade Authority: <VAULT_PDA>"  ← must match the address from Step 1
```

Repeat for all 4 programs. Once all 4 are rotated, the deployer key has **zero on-chain authority** over upgrades — every future upgrade must flow through a Squads proposal.

### Step 3 — Rotate the protocol authority

This is the `ProtocolConfig.authority` field — different surface from the upgrade authority (see [`key-rotation.md` §(a)](./key-rotation.md#a-protocol-authority-rotation)).

Authority rotation flows through a dedicated 3-step timelock pattern that mirrors the treasury rotation (PR #122). All three instructions live in `programs/roundfi-core/src/instructions/`:

1. **Propose** — deployer signs `propose_new_authority(new_authority: <VAULT_PDA>)`. Stages the vault PDA on `config.pending_authority` and sets `config.pending_authority_eta = now + 7d`. Live `config.authority` is **not touched yet** — this is the public-window stage where any user/auditor/multisig member can detect a malicious authority rotation and react.

2. **Wait 7 days** (`TREASURY_TIMELOCK_SECS = 604_800`). Reuses the same constant the treasury rotation does — authority is at least as sensitive a surface, so the window matches.

3. **Commit** — anyone calls `commit_new_authority()` after the eta elapses (permissionless crank, identical pattern to `commit_new_treasury`). Atomically: `config.authority = config.pending_authority`, clears the pending fields. The Squads vault PDA is now the authority.

If the proposal is wrong (typo, malicious, etc.) before commit, the deployer can call `cancel_new_authority()` to abort and re-propose.

> **Bootstrap quirk:** at `initialize_protocol` the deployer's wallet is the initial `authority`, and `pending_authority = Pubkey::default()`. The deployer signs ONE `propose_new_authority` ix with the vault PDA, waits 7 days, then anyone (including the deployer or a third-party cranker) calls `commit_new_authority`. After commit, all authority-gated ix (including future `propose_new_authority` calls for Squads-A → Squads-B rotations) require a Squads threshold signature CPI'd through the vault PDA.

> **Why 7 days for the bootstrap?** The deployer can't be malicious to themselves, so the window is operational friction for THIS rotation. But the public-window assurance is what gives auditors confidence that NO surprise authority changes can happen on this protocol — the gate is uniform across deployer-bootstrap and Squads-A → Squads-B cases. One-time annoyance, durable trust property.

### Step 4 — Rotate the treasury (if applicable)

If the treasury also needs to move to a Squads-controlled ATA:

1. Create a USDC ATA under the vault PDA: `getAssociatedTokenAddressSync(USDC_MINT, <VAULT_PDA>, true /* allowOwnerOffCurve */)`
2. From the **current authority** (which is now the Squads multisig after Step 3), propose `propose_new_treasury(new_treasury: <new_ata>)`. Members approve, Squads executes.
3. Wait **7 days** (the on-chain timelock on treasury rotation — see [`key-rotation.md` §(b)](./key-rotation.md#b-treasury-address-rotation)).
4. **Anyone** can then call `commit_new_treasury()` (permissionless ix — no Squads needed for this step). Future `harvest_yield` calls route protocol fees to the new ATA.

This is the only step in the whole sequence that involves an on-chain timelock; Squads doesn't add anything on top.

### Step 5 — Verification matrix

After all rotations, run all four checks:

| Surface                                  | Verification command                                                                            | Expected                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `roundfi-core` upgrade authority         | `solana program show 8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw -u mainnet-beta`              | "Upgrade Authority" = `<VAULT_PDA>`                                    |
| `roundfi-reputation` upgrade authority   | `solana program show Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2 -u mainnet-beta`              | Same                                                                   |
| `roundfi-yield-kamino` upgrade authority | `solana program show 74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb -u mainnet-beta`              | Same                                                                   |
| Protocol authority                       | `solana account <ProtocolConfig-PDA> --output json` then decode `authority` field               | `<VAULT_PDA>`                                                          |
| Reproducible-build attestation           | `solana-verify -u mainnet-beta get-program-pda --program-id <PID> --signer <ORIGINAL_DEPLOYER>` | Still returns the original attestation (signer-bound, doesn't refresh) |

If any verification fails, **DO NOT PROCEED** with the mainnet smoke (item 4.1 of `MAINNET_READINESS.md`). The protocol cannot run safely with a half-rotated authority surface.

---

## Devnet rehearsal

Before the mainnet ceremony, run the rotation end-to-end on devnet to catch any procedural surprises. The recommended sequence:

1. **Copy the rehearsal log template** to a dated file:

   ```bash
   cp docs/operations/rehearsal-logs/TEMPLATE-squads-rotation.md \
      docs/operations/rehearsal-logs/$(date -u +%Y-%m-%d)-squads-rotation-rehearsal.md
   ```

2. **Deploy a fresh devnet protocol instance** if you haven't already (see [`docs/devnet-setup.md`](../devnet-setup.md)).
3. **Create a real Squads multisig on devnet** via [app.squads.so](https://app.squads.so) → switch to devnet → "Create Multisig". Use throwaway member keypairs. Threshold = 2-of-3 to keep the rehearsal fast.
4. **Cross-check the derived Vault PDA** against the address shown in the Squads UI using [`scripts/devnet/squads-derive-pda.ts`](../../scripts/devnet/squads-derive-pda.ts) (see below).
5. **Run the rotation procedure** above against the devnet programs + devnet protocol, using the rehearsal scripts:

   | Step                                   | Script                                                                                                               |
   | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
   | Pre/post-state inspection (every step) | [`scripts/devnet/squads-rehearsal-verify.ts`](../../scripts/devnet/squads-rehearsal-verify.ts)                       |
   | Step 3 propose (deployer → vault)      | [`scripts/devnet/squads-rehearsal-propose-authority.ts`](../../scripts/devnet/squads-rehearsal-propose-authority.ts) |
   | Step 3 abort (also worth rehearsing)   | [`scripts/devnet/squads-rehearsal-cancel-authority.ts`](../../scripts/devnet/squads-rehearsal-cancel-authority.ts)   |
   | Step 3 finalize (post-timelock)        | [`scripts/devnet/squads-rehearsal-commit-authority.ts`](../../scripts/devnet/squads-rehearsal-commit-authority.ts)   |

   For Step 2 (upgrade authority) and Step 4 (treasury, if exercised), the existing `solana program set-upgrade-authority` CLI + `propose_new_treasury` / `commit_new_treasury` ix already cover the surface — no new wrappers needed.

6. **Fill in the rehearsal log** as each step lands, capturing every tx signature, derived PDA, and verification output. The template at `TEMPLATE-squads-rotation.md` has slots for everything an auditor would want to see post-hoc.

> **Timelock fast-forward (devnet-only):** the 7-day `TREASURY_TIMELOCK_SECS` makes a same-day rehearsal painful. For devnet rehearsals only, temporarily set `TREASURY_TIMELOCK_SECS = 60` in `programs/roundfi-core/src/constants.rs` on a rehearsal-only branch, redeploy, run the full flow in ~2 minutes. Record the temporary value in the rehearsal log §5d so the artifact is honest about which timelock was actually exercised. **Never** ship this branch to mainnet.

The `scripts/devnet/squads-derive-pda.ts` utility derives the Squads PDA addresses deterministically from a member-key list — useful for sanity-checking the address you're about to set as the new upgrade authority. Run it:

```bash
pnpm tsx scripts/devnet/squads-derive-pda.ts \
  --member <pubkey-1> \
  --member <pubkey-2> \
  --member <pubkey-3> \
  --threshold 2 \
  --create-key <unique-create-key-pubkey>
```

Output:

```
Squads v4 program ID: SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
Members: 3
Threshold: 2-of-3
Multisig PDA: <derived-multisig-pda>
Vault PDA (index 0): <derived-vault-pda>
```

Compare the printed `Vault PDA` against the one shown in the Squads UI after multisig creation. If they don't match, **STOP** — the procedure has drifted from the published Squads v4 derivation and you'd be transferring authority to a wrong/unknown address.

---

## What can go wrong (and rollback)

### Upgrade authority transfer fails

Most common cause: missing `--skip-new-upgrade-authority-signer-check` flag when targeting a PDA. The CLI will print a signer-check error and reject the tx. Re-run with the flag.

### Upgrade authority transferred to wrong address

**This is irrecoverable** if the wrong address is unknown / unsigned-by-multisig. Mitigations BEFORE the rotation:

1. Use `squads-derive-pda.ts` to compute the expected PDA offline and visually compare 5+ characters with the Squads UI's displayed address.
2. Run on devnet first against the same member set.
3. Have a second team member independently derive + verify the target PDA.

After the rotation, if the address is wrong but you control the destination (e.g. you derived for the wrong multisig but it's still a Squads PDA you can control through the UI), you can chain another `set-upgrade-authority` from inside that Squads to the correct one. But this only works if you can sign with the wrongly-targeted multisig — otherwise the program is permanently locked.

### Protocol authority transferred to wrong address

If `update_protocol_config { new_authority: <wrong-pda> }` ships and is wrong, the only way back is the wrong authority signing another `update_protocol_config { new_authority: <correct-pda> }`. If you don't control the wrong PDA, the protocol is functionally captured — see [`key-rotation.md` § Compromised-key path](./key-rotation.md#compromised-key-path).

### Squads multisig is itself compromised

3-of-5 threshold + hardware wallets + out-of-band comms make this extremely unlikely without a coordinated 3-member attack. If it does happen:

1. The compromised multisig signs `update_protocol_config { new_authority: <attacker-pda> }` first.
2. We have no recovery — the protocol is captured.
3. Best mitigation: **threshold > 50% of members** (3-of-5 satisfies this) + **dispersed key custody** (no two members share a physical location / device manufacturer / cloud provider).
4. See [`emergency-response.md`](./emergency-response.md) for the public-disclosure procedure if this happens.

---

## Cost summary

| Step                                        | Approx cost (SOL) | Notes                                                      |
| ------------------------------------------- | ----------------- | ---------------------------------------------------------- |
| Squads multisig creation                    | ~0.05             | Includes multisig account + vault PDA rent                 |
| Upgrade authority rotation × 4              | ~0.001            | Tx fees only; the program data account size doesn't change |
| Protocol authority rotation                 | ~0.001            | Single `update_protocol_config` tx                         |
| Treasury rotation (optional)                | ~0.002            | `propose` + `commit` txs (7-day gap between them)          |
| **Total** (excluding cold-storage hardware) | **~0.06 SOL**     | Plus the rehearsal-on-devnet equivalent                    |

---

## References

- [Squads v4 GitHub](https://github.com/Squads-Protocol/v4) — protocol source, IDL, audit reports
- [Squads v4 documentation](https://docs.squads.so/main/) — UI flows + SDK reference
- [`key-rotation.md`](./key-rotation.md) — generic rotation runbook (this doc is the Squads-specific drill-down)
- [`emergency-response.md`](./emergency-response.md) — incident response for key compromise
- [`MAINNET_READINESS.md` § 3.6 + 3.7](../../MAINNET_READINESS.md) — readiness checklist this procedure closes
- [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md) — context on which authorities are in audit scope
