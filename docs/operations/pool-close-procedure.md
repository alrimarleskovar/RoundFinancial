# Pool Close Procedure — Multi-Step Operational Sequence

> **Status:** runbook draft for post-canary mainnet operations. The
> on-chain `close_pool` instruction (single ix) flips
> `pool.status → Closed` and emits the summary log, but it does NOT
> close any PDAs or ATAs — rent stays locked, sub-min-rent dust in
> vaults becomes inaccessible. This document is the multi-step
> ceremony that does the actual close.
>
> Tracked as **SEV-039 (Informational, Acknowledged)** in
> [`docs/security/internal-audit-findings.md`](../security/internal-audit-findings.md).
> Not a fund-loss vector (dust was never claimable beyond rounding),
> but real operational debt: per-pool rent waste is ~0.0035 SOL on the
> Pool PDA + 4 vault ATAs + N Member PDAs. Cumulative across protocol
> lifetime, real but bounded.

## When to run this

| Trigger                                                              | Run procedure?                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Pool reaches final cycle, `claim_payout` flips status to `Completed` | ✅ Yes, after a grace window (suggest 30 days for stragglers to call `release_escrow` for vested stake portions still in escrow) |
| Pool liquidated (mass defaults, protocol pause)                      | ✅ Yes — recover what rent remains                                                                                               |
| Pool in `Forming` indefinitely (never reached members_target)        | ✅ Yes via `close_pool` after authority decides to abandon                                                                       |
| Pool in `Active` with defaults                                       | ❌ No — must first resolve defaults via `settle_default`; `close_pool` rejects with `OutstandingDefaults`                        |

## Pre-flight (read-only verification)

```bash
# 1. Confirm pool is in a closeable terminal state
solana account <POOL_PDA> --url <CLUSTER> --output json | jq '.data[1] | length, .lamports'

# 2. Decode pool status (byte offset 96 of Pool PDA = u8 status)
# Expected: 2 (Completed) OR 3 (Liquidated)

# 3. List Member PDAs for this pool
# PDA seed: [b"member", pool, wallet]
# For each member, fetch + verify member.escrow_balance == 0
# (otherwise the member has unclaimed vested stake — surface to them
# before closing, or accept rent loss on their unclaimed share)

# 4. Confirm vaults are empty
for VAULT in escrow_usdc_vault pool_usdc_vault solidarity_usdc_vault yield_usdc_vault; do
  solana balance <VAULT_ATA> --url <CLUSTER>
done
# Any non-zero balance must be drained to treasury before close
```

## Step 1 — Run `close_pool` (on-chain)

Authority signs the single `close_pool` ix. Flips `pool.status → Closed` and logs the summary. Pool PDA + Member PDAs + ATAs all remain allocated (rent still locked).

```bash
pnpm tsx scripts/devnet/seed-close.ts --pool <POOL_PDA> --authority <AUTHORITY_KEYPAIR>
```

Verify: `solana account <POOL_PDA>` shows `status == 4` (Closed).

## Step 2 — Drain vault dust to treasury (optional, per policy)

If any of the 4 vault ATAs has a non-zero balance (typically rounding dust after final `claim_payout`), drain to the protocol treasury:

```bash
# Per vault, signed by the appropriate Vault Authority PDA
spl-token transfer <SOURCE_VAULT> <DRAIN_AMOUNT> <TREASURY_ATA> \
  --owner <VAULT_AUTHORITY_PDA> \
  --fund-recipient \
  --allow-unfunded-recipient
```

**Notes:**

- The 4 vault authorities are PDAs (`SEED_ESCROW`, `SEED_SOLIDARITY`, `SEED_YIELD`, plus the pool itself for `pool_usdc_vault`). Signing requires the program (via a new admin ix) — not user-callable today. **This step requires program-side support that doesn't yet exist** — currently the dust is acceptable.
- Tracked: an `admin_sweep_pool_dust(pool, vault_kind)` ix that takes the Vault Authority PDA bump + transfers all to treasury. Would be a one-shot per pool, post-close.

## Step 3 — Close Member PDAs (rent return)

For each member of the pool, close their `Member` PDA. Anchor `close = <recipient>` constraint returns the rent.

**Currently requires program-side support:** there is no `close_member()` ix today. The Anchor pattern would be:

```rust
#[derive(Accounts)]
pub struct CloseMember<'info> {
    #[account(mut, address = pool.authority @ Unauthorized)]
    pub authority: Signer<'info>,
    #[account(seeds = [...], bump = pool.bump,
              constraint = pool.status == PoolStatus::Closed as u8)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [...], bump = member.bump,
              constraint = member.escrow_balance == 0,
              close = rent_recipient)]
    pub member: Account<'info, Member>,
    /// CHECK: rent recipient. Conventionally `pool.authority`.
    #[account(mut)]
    pub rent_recipient: UncheckedAccount<'info>,
}
```

Per-Member rent: ~0.0022 SOL. For a 24-member pool, total recoverable: ~0.05 SOL.

## Step 4 — Close vault ATAs (rent return)

After all member PDAs are closed and dust is drained, the 4 vault ATAs can be closed via `spl-token close-account`:

```bash
for VAULT_AUTHORITY in <ESCROW> <SOLIDARITY> <YIELD> <POOL>; do
  # close ATA owned by this authority, return rent to treasury
  spl-token close-account <VAULT_ATA> <TREASURY> --owner <VAULT_AUTHORITY_PDA>
done
```

Same caveat as Step 2: signing under a PDA requires a program-side helper (`admin_close_vault_ata(pool, vault_kind)`).

## Step 5 — Close Pool PDA (rent return)

Final step. Closes the Pool PDA itself.

**Currently requires program-side support:** `close_pool_pda(pool)` ix with:

```rust
#[derive(Accounts)]
pub struct ClosePoolPda<'info> {
    #[account(mut, address = pool.authority)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [...], bump = pool.bump,
              constraint = pool.status == PoolStatus::Closed as u8,
              constraint = pool.defaulted_members == 0,
              close = rent_recipient)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub rent_recipient: UncheckedAccount<'info>,
}
```

Pool PDA rent: ~0.0035 SOL.

## Total recoverable rent (per pool)

| Account    | Rent (SOL) | Count    | Subtotal                |
| ---------- | ---------- | -------- | ----------------------- |
| Pool PDA   | ~0.0035    | 1        | 0.0035                  |
| Member PDA | ~0.0022    | up to 24 | ~0.053                  |
| Vault ATAs | ~0.002     | 4        | ~0.008                  |
| **Total**  |            |          | **~0.065 SOL per pool** |

At 1000 pools over protocol lifetime, ~65 SOL recoverable. Real but bounded.

## Current implementation status

| Step                 | Today                | Pending                 |
| -------------------- | -------------------- | ----------------------- |
| 1. `close_pool` ix   | ✅ Implemented       | —                       |
| 2. Drain vault dust  | ❌ No admin ix       | `admin_sweep_pool_dust` |
| 3. Close Member PDAs | ❌ No admin ix       | `close_member`          |
| 4. Close vault ATAs  | ❌ Requires #2 first | `admin_close_vault_ata` |
| 5. Close Pool PDA    | ❌ No admin ix       | `close_pool_pda`        |

Steps 2-5 are **non-blocking for mainnet GA** — the rent retention is documented operational debt, not a vulnerability. They land in a future sprint as a cohesive "pool teardown" feature.

## Why not implement this now

The auditor (W5 #4) recommended documenting the procedure ahead of mainnet GA so operators have a runbook, even if the multi-step ix's aren't built. This doc fulfills that requirement.

When the team decides to implement the teardown ixs:

1. They cluster naturally as one PR (4 new admin ixs + their negative-path tests)
2. Padding budget on `Pool` and `Member` is fine — no state-shape changes needed
3. The bankrun harness can exercise the full close cycle once SEV-012 (mpl-core borsh upstream) unblocks

## See also

- [`programs/roundfi-core/src/instructions/close_pool.rs`](../../programs/roundfi-core/src/instructions/close_pool.rs) — current single-ix implementation + SEV-039 module comment
- [`docs/security/internal-audit-findings.md`](../security/internal-audit-findings.md) — SEV-039 entry
- [`docs/operations/mainnet-canary-plan.md`](./mainnet-canary-plan.md) — broader canary procedure (close happens at the END of canary, not before)
