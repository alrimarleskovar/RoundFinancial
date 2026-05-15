# `ReputationConfig` Migration — devnet re-init procedure

> **Why this doc exists:** [PR #337](https://github.com/alrimarleskovar/roundfinancial/pull/337)
> (SEV-021 fix — reputation authority rotation timelock) grew the
> `ReputationConfig` account from **160 → 170 bytes** by adding
> `pending_authority: Pubkey` and `pending_authority_eta: i64`.
>
> Anchor allocates the account at `init` time using the **then-current**
> `LEN` constant. Existing devnet `ReputationConfig` accounts that were
> allocated under the old 160-byte layout will fail to deserialize once
> the program is upgraded to the 170-byte version — the discriminator
> matches but the trailing field offsets are off-by-10.
>
> The auditor's W3 re-audit (Risk #5) flagged the absence of an
> automated migration path. This doc closes the operational gap by
> documenting the manual re-init procedure. **No production accounts
> exist yet** (mainnet has not launched), so the action surface is
> devnet only.

## Scope

| Cluster      | Action                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **localnet** | None — `anchor test` runs a fresh validator per test, no migration needed.                                                     |
| **devnet**   | Required if a `ReputationConfig` PDA exists from before PR #337 (2026-05).                                                     |
| **mainnet**  | Not yet deployed; new `ReputationConfig` will be allocated at the correct 170-byte size on first `initialize_reputation` call. |

## Pre-flight check

Confirm a devnet re-init is actually needed:

```bash
# 1. Derive the ReputationConfig PDA
pnpm tsx scripts/devnet/squads-derive-pda.ts --kind=rep-config

# 2. Fetch the account and inspect its size
solana account <REP_CONFIG_PDA> --url devnet --output json | jq '.data[1] | length / 4 * 3'
# (base64-decoded length; rough check)

# 3. Confirm via Anchor IDL
pnpm tsx -e '
  import { AnchorProvider, Program } from "@coral-xyz/anchor";
  // ... fetch and print account size
'
```

**Decision tree:**

- Account size **170 bytes**: ✅ already migrated. No action.
- Account size **160 bytes**: 🔴 needs re-init.
- Account does not exist: ✅ first `initialize_reputation` call will allocate at 170. No action.

## Re-init procedure (devnet)

Because `ReputationConfig` is a PDA seeded by a constant `[b"rep-config"]`,
the same PDA address is recovered on every derivation — we cannot
re-allocate by changing the seed. The procedure is:

1. **Close the existing account** (refunds rent to the close-authority
   wallet). Currently the program does **not** expose a
   `close_reputation_config` instruction (deliberate — closing protocol
   state should be a multi-step ceremony, not a one-shot ix), so on
   devnet the operator must redeploy the reputation program with a
   one-time `close_reputation_config` admin instruction included, run
   it, then redeploy without the close instruction.

2. **Re-run `initialize_reputation`** with the same authority signer
   that owned the prior config:

   ```bash
   pnpm tsx scripts/devnet/init-protocol.ts --reputation-only
   ```

   The script's existing "skip if PDA exists" check (`init-protocol.ts:173-177`)
   will now allocate the new 170-byte shape because the PDA was closed
   in step 1.

3. **Verify** the new account is 170 bytes and `pending_authority` is
   `Pubkey::default()`:

   ```bash
   pnpm tsx -e '
     // ... fetch ReputationConfig, assert pending_authority == 11111...111
   '
   ```

4. **Re-link any downstream pools.** Pools created against the old
   reputation config still point at the same PDA (the address didn't
   change), so this is transparent.

## What about future field additions?

The 30-byte padding budget in `ReputationConfig` was **fully consumed**
by the SEV-021 additions. Future additions will require:

- A protocol upgrade with **explicit `realloc`** in a one-shot ix
  (Anchor supports this via `#[account(mut, realloc = NEW_LEN, ...)]`), OR
- A close-and-reinit cycle as above.

Tracked as **SEV-032** in
[`docs/security/internal-audit-findings.md`](../security/internal-audit-findings.md).
The auditor accepts the design constraint; the cost is operational
discipline for the next state-shape change.

## Why not automate it?

The migration is a **one-time** operation per cluster. Building a
production-grade migration framework (versioned schemas, rolling
upgrades, snapshot-and-restore) is a non-trivial project that does not
clear a mainnet-blocker bar today. The runbook above is sufficient for
the only environment where the migration applies (devnet) and any
future field addition is rare enough to justify a fresh decision then.

## See also

- [`docs/security/internal-audit-findings.md`](../security/internal-audit-findings.md) — SEV-021 status + SEV-032 design constraint.
- [`programs/roundfi-reputation/src/state/config.rs`](../../programs/roundfi-reputation/src/state/config.rs) — current `ReputationConfig` layout (170 bytes, 0 padding).
- [`scripts/devnet/init-protocol.ts`](../../scripts/devnet/init-protocol.ts) — bootstrap script that allocates fresh `ReputationConfig`.
