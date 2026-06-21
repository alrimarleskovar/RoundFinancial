# `ReputationConfig` Migration — automated realloc procedure

> **Why this doc exists:** [PR #337](https://github.com/alrimarleskovar/roundfinancial/pull/337)
> (SEV-021 fix — reputation authority rotation timelock) grew the
> `ReputationConfig` account from **168 → 178 bytes** (discriminator-inclusive;
> +40 for `pending_authority: Pubkey` + `pending_authority_eta: i64`, −30
> reclaimed from the reserved padding ⇒ +10 net) by adding those two fields.
>
> Anchor allocates the account at `init` time using the **then-current**
> `LEN` constant. Existing devnet `ReputationConfig` accounts that were
> allocated under the old 168-byte layout fail to deserialize once the
> program is upgraded to the 178-byte version — the discriminator matches
> but the trailing field offsets are off by 10 (`AccountDidNotDeserialize`,
> custom program error `0xbbb`).
>
> The auditor's W3 re-audit (Risk #5) flagged the absence of an automated
> migration path. **That gap is now closed in code:** the authority-gated
> `migrate_reputation_config` instruction ([PR #408](https://github.com/alrimarleskovar/RoundFinancial/pull/408))
> reallocs the account up to the current `LEN` in place (zero-initializing
> the grown region — `pending_authority`/`eta` read back as
> `default`/`0`, the canonical "no rotation pending" state). This doc now
> documents the **automated** procedure. **No production accounts exist
> yet** (mainnet has not launched), so the action surface is devnet only.

## Scope

| Cluster      | Action                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **localnet** | None — `anchor test` runs a fresh validator per test, no migration needed.                                                     |
| **devnet**   | Run `pnpm devnet:migrate-reputation-config` if a `ReputationConfig` PDA exists from before PR #337 (2026-05).                  |
| **mainnet**  | Not yet deployed; new `ReputationConfig` will be allocated at the correct 178-byte size on first `initialize_reputation` call. |

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

- Account size **178 bytes**: ✅ already migrated. No action.
- Account size **168 bytes** (or any size below 178): 🔴 needs migration.
- Account does not exist: ✅ first `initialize_reputation` call will allocate at 178. No action.

## Migration procedure (devnet)

Because `ReputationConfig` is a PDA seeded by a constant `[b"rep-config"]`,
the same PDA address is recovered on every derivation — we cannot
re-allocate by changing the seed, and there is no need to: the
`migrate_reputation_config` instruction reallocs the existing account in
place. The procedure is:

1. **Upgrade the reputation program** to the build that contains
   `migrate_reputation_config` (any build from PR #408 onward):

   ```bash
   anchor build --no-idl
   solana program deploy target/deploy/roundfi_reputation.so \
     --program-id target/deploy/roundfi_reputation-keypair.json \
     --upgrade-authority "$ANCHOR_WALLET" --keypair "$ANCHOR_WALLET" \
     --url https://api.devnet.solana.com
   ```

2. **Run the migration.** Idempotent — the script reads the on-chain
   size first and no-ops if the account is already at the current `LEN`:

   ```bash
   pnpm devnet:migrate-reputation-config
   ```

   `migrate_reputation_config` (authority-gated) reallocs the account to
   the current `LEN` and lets the runtime zero-init the grown region. The
   first 138 bytes (discriminator + 4 Pubkeys + `paused` + `bump`) are
   byte-identical across the layouts and preserved untouched; the appended
   `pending_authority`/`pending_authority_eta` read back as `default`/`0`.

3. **Verify** the new account is 178 bytes (the script prints
   `new size: 178 bytes` on success) and `pending_authority` is
   `Pubkey::default()`.

4. **Downstream pools are unaffected.** Pools created against the old
   reputation config still point at the same PDA (the address didn't
   change), so the migration is transparent to them.

> **Implementation note:** the migration takes the config as an
> `UncheckedAccount` and validates owner + PDA + the stored authority by
> raw bytes — it **cannot** use `Account<ReputationConfig>` because the
> too-short legacy account would fail Anchor's deserialize during account
> validation, before the handler runs. See
> [`programs/roundfi-reputation/src/instructions/migrate_reputation_config.rs`](../../programs/roundfi-reputation/src/instructions/migrate_reputation_config.rs).

## What about future field additions?

The padding budget in `ReputationConfig` was **fully consumed** by the
SEV-021 additions, so any future field will again grow `LEN`. That is now
a **handled** case rather than an operational hazard: bump the struct +
`LEN`, ship the upgrade, and re-run `migrate_reputation_config` — the same
realloc path grows the account to whatever the new `LEN` is and zero-inits
the new tail. (Defaults that are NOT zero would need the migration handler
extended to write them, but every field added so far defaults to
zero/`Pubkey::default()`.)

Tracked as **SEV-032** in
[`docs/security/internal-audit-findings.md`](../security/internal-audit-findings.md):
the padding-exhaustion is a deliberate layout choice, and
`migrate_reputation_config` (#408) is the in-place escape hatch that
removes the "no automated migration path" consequence the auditor flagged.

## See also

- [`docs/security/internal-audit-findings.md`](../security/internal-audit-findings.md) — SEV-021 status + SEV-032 design constraint.
- [`programs/roundfi-reputation/src/instructions/migrate_reputation_config.rs`](../../programs/roundfi-reputation/src/instructions/migrate_reputation_config.rs) — the in-place realloc migration instruction (#408).
- [`scripts/devnet/migrate-reputation-config.ts`](../../scripts/devnet/migrate-reputation-config.ts) — `pnpm devnet:migrate-reputation-config` runner.
- [`programs/roundfi-reputation/src/state/config.rs`](../../programs/roundfi-reputation/src/state/config.rs) — current `ReputationConfig` layout (178 bytes, 0 padding).
- [`scripts/devnet/init-protocol.ts`](../../scripts/devnet/init-protocol.ts) — bootstrap script that allocates fresh `ReputationConfig`.
