# Key Rotation Runbook

> **Scope:** the 3 distinct key surfaces of the deployed protocol: **(a) protocol authority** (signs `update_protocol_config` + treasury rotation), **(b) treasury address** (receives protocol fees from `harvest_yield` waterfall), **(c) deployer / upgrade authority** (signs program upgrades).
>
> All three rotations are **timelocked or one-way on-chain** by design — no surprise key swaps. Procedures below cover the happy path + the compromised-key path.
>
> **For the mainnet ceremony specifically** — rotating from a single deployer keypair to a Squads multisig — see the dedicated drill-down at [`squads-multisig-procedure.md`](./squads-multisig-procedure.md). It expands the abstract steps below into concrete CLI invocations + verification matrix + rollback paths.

---

## (a) Protocol authority rotation

The `authority` field on `ProtocolConfig` controls:

- `update_protocol_config` (fee bps, GF target, paused flag)
- `propose_new_treasury` / `cancel_new_treasury` / `lock_treasury`
- `pause` (immediate, no timelock — see [`emergency-response.md`](./emergency-response.md))

**Authority rotation is NOT timelocked in the current implementation** — the rotation is direct via `update_protocol_config { new_authority }`. This is by design for devnet but should harden before mainnet.

### Happy path (planned rotation)

1. **Generate the new authority keypair** offline. Multisig (Squads) recommended for mainnet.
2. **Pre-announce in #announcements** with the new public key 7+ days ahead. Reviewers and integrators verify off-chain.
3. **Sign + send `update_protocol_config`** with the current authority and `new_authority` set:
   ```bash
   # (Example — actual CLI may differ; today's path is via the SDK)
   solana-keygen pubkey new-authority.json
   # → <new-authority-pubkey>
   # … invoke update_protocol_config with new_authority = <new-pubkey>
   ```
4. **Verify on-chain** via `getAccountInfo` decoded against `ProtocolConfig` layout (see `packages/sdk/src/onchain-raw.ts`):
   ```bash
   # The authority field should now equal the new pubkey
   ```
5. **Update internal docs**: `AUDIT_SCOPE.md` mainnet timeline + `SECURITY.md` contact (if comms email also changes) + CHANGELOG entry.

### Compromised-key path

If the **current** authority key is suspected compromised:

1. **Immediate `pause`** with the compromised key (last legitimate action before rotation; freezes all fund movements except `settle_default`). See [`emergency-response.md`](./emergency-response.md).
2. **Race the attacker to the rotation** — they can also call `update_protocol_config`, so first-write-wins. Likelihood low if you're checking on a high-tip RPC + the attacker is exploiting via a different vector.
3. **If you lose the race** and the authority is now hostile, the on-chain protocol is functionally captured. There is **no on-chain recovery** without the original key. Mitigation: multisig before mainnet so the attacker needs ≥ N keys; HSM custody so the keys aren't directly compromise-able.
4. **Public disclosure** via SECURITY.md and a post on the project's official channel. Mark the affected program IDs as compromised in `docs/devnet-deployment.md` / mainnet ledger.

---

## (b) Treasury address rotation

The `treasury` field on `ProtocolConfig` receives the protocol-fee bps of every `harvest_yield` call. Rotation is **7-day timelocked** by design (see [PR #122](https://github.com/alrimarleskovar/RoundFinancial/pull/122)).

### Happy path

1. **Propose the new treasury** with the protocol authority:
   ```rust
   propose_new_treasury({ new_treasury: <new-ata-pubkey> })
   // → writes pending_treasury + pending_treasury_eta = now + 7d
   ```
2. **Wait 7 days.** During this window, any harvest tx continues to route fees to the OLD treasury — predictable behavior. Anyone (not just authority) can watch the pending state via decoded `ProtocolConfig`.
3. **Commit the rotation** — **permissionless** instruction:
   ```rust
   commit_new_treasury()
   // → fires only if now ≥ pending_treasury_eta
   // → caller can be anyone (deployer, partner, monitoring crank); typically the authority itself
   ```
4. **Post-commit sanity** — next `harvest_yield` routes to the new treasury. Verify by inspecting the resulting Solscan tx's account-changes block.

### Cancel a pending rotation

If you realize during the 7-day window that the proposal was wrong (typo on the address, partnership fell through, etc.):

```rust
cancel_new_treasury()
// → only callable by current authority; resets pending state to zeros
```

No race condition risk — even if a permissionless `commit_new_treasury` is sent in the same block as your cancel, the require-pending check on `commit` rejects after the cancel writes.

### Lock the treasury (one-way)

For maximum-security mode where the team commits to a fixed treasury forever:

```rust
lock_treasury()
// → sets ProtocolConfig.treasury_locked = true
// → blocks all future propose_new_treasury calls (require treasury_locked == false)
// → IDEMPOTENT (calling twice is a no-op, not an error)
```

After `lock_treasury`, the only way to ever change the treasury is to **redeploy the program with a different layout** — i.e. a hard fork. Use only when the treasury address is finalized (post-mainnet, multisig-owned, audited).

---

## (c) Deployer / upgrade authority rotation

The Solana program-loader stores the **upgrade authority** as a separate field on the `ProgramData` account (NOT inside `ProtocolConfig`). Rotation uses standard Solana CLI:

```bash
solana program set-upgrade-authority \
  --url <cluster> \
  --keypair <current-deployer.json> \
  <program-id> \
  --new-upgrade-authority <new-pubkey>
```

Repeat for all 4 program IDs. Each call is one tx, no timelock at the Solana runtime level.

### When to rotate the upgrade authority

- **Multisig adoption** — moving from a single deployer keypair to a Squads multisig PDA
- **Team member departure** — if any member who had access to the current deployer keypair leaves
- **HSM migration** — moving from a software-stored keypair to hardware-backed key custody
- **Suspected compromise** — immediately, BEFORE the attacker can ship a malicious program update

### Finalizing — make program immutable

`solana program set-upgrade-authority --upgrade-authority null` makes the program **permanently immutable** (no future upgrades possible). This is the strongest on-chain commitment but eliminates the ability to patch bugs. **Use only after external audit + mainnet smoke + bug-bounty findings have stabilized.**

---

## Verification matrix

After any rotation, run these checks:

| Surface                | Verification command                                                                 | Expected                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Protocol authority     | `solana account <ProtocolConfig-PDA> --output json` → decode `authority` field       | Matches new authority pubkey                                                |
| Treasury (post-commit) | Same decode → `treasury` field; or inspect next harvest tx's Solscan account-changes | Matches new treasury ATA                                                    |
| Upgrade authority      | `solana program show <pid> --url <cluster>`                                          | "Upgrade Authority" line shows new pubkey                                   |
| Reproducible build     | `solana-verify -u <cluster> get-program-pda --program-id <pid> --signer <DEPLOYER>`  | Still returns valid attestation; no need to refresh unless deployer rotated |

If `deployer` is rotated, the **OtterSec attestation PDA** is signer-bound to the OLD deployer. To preserve attestation continuity, the NEW deployer should call `verify-from-repo` again after the rotation — same procedure as `pnpm devnet:verify-onchain`.

## Pre-mainnet hardening

These hardening moves are tracked. Status reflects what's in the repo today vs what executes at the mainnet ceremony:

- [x] **Squads multisig procedure documented** — see [`squads-multisig-procedure.md`](./squads-multisig-procedure.md). PDA-derivation utility at [`scripts/devnet/squads-derive-pda.ts`](../../scripts/devnet/squads-derive-pda.ts). Execution itself happens at the mainnet ceremony.
- [ ] **HSM key custody** for the deployer keypair (mainnet)
- [ ] **Authority rotation timelock** added on-chain — currently treasury has 7d timelock but authority swap is direct; consider symmetric timelock pre-mainnet
- [ ] **Comms template** for planned rotations — single Twitter/Discord post template with required fields

See [`AUDIT_SCOPE.md`](../../AUDIT_SCOPE.md#mainnet-timeline) for the timeline these hardening steps slot into.
