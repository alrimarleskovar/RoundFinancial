# Kamino Lend Devnet Exercise — Evidence Record

> **Why this doc exists:** the Adevar Labs W3 re-audit (point #9)
> flagged that even with the SEV-001 fix (ATA constraint on
> `c_token_account` in `roundfi-yield-kamino::Deposit`), there's no
> operational evidence file demonstrating the full Kamino integration
> round-trip on devnet. This doc is the **template + procedure** for
> producing that evidence. The "Evidence" sections below are placeholders
> to be filled when the exercise is executed on devnet against the
> canonical Kamino USDC reserve.

## Goal

Demonstrate that `roundfi-yield-kamino` correctly:

1. **Deposits** USDC into a Kamino USDC reserve
2. **Receives** c-tokens (reserve collateral) into the protocol-owned ATA
3. **Harvests** yield without principal loss
4. **Redeems** c-tokens back to USDC at full principal
5. **Re-deposits** without losing track of accrued yield
6. **Rejects** the malicious-redirect scenario that SEV-001 closed

Each step records the tx signature, the before/after balances, and the
relevant on-chain account state. The result is a tamper-evident receipt
that the integration works end-to-end with the SEV-001 fix in place.

## Pre-flight

```bash
# 1. Confirm the SEV-001 fix is deployed
solana program show <ROUNDFI_YIELD_KAMINO_PROGRAM_ID> --url devnet
# Verify the program hash matches the post-#326 build.

# 2. Confirm Kamino canonical USDC reserve is live on devnet
solana account <KAMINO_USDC_RESERVE_PDA> --url devnet
# Reserve account must exist and be initialized.

# 3. Confirm the protocol-owned ATA path is set up
pnpm tsx scripts/devnet/squads-derive-pda.ts --kind=yield-vault --pool=<TEST_POOL_PDA>
```

## Exercise sequence

### Step 1 — Deposit

**Action:** `deposit_idle_to_yield` with a known USDC amount (suggest 100 USDC = 100_000_000 base units against a freshly-created devnet test pool).

**Evidence to record:**

| Field                                     | Pre   | Post        | Δ            |
| ----------------------------------------- | ----- | ----------- | ------------ |
| Pool USDC vault balance                   | _TBD_ | _TBD_       | −100_000_000 |
| Kamino reserve liquidity vault            | _TBD_ | _TBD_       | +100_000_000 |
| Protocol c-token ATA balance              | _TBD_ | _TBD_       | +X c-tokens  |
| `Pool.yield_position.principal_deposited` | 0     | 100_000_000 | +100_000_000 |
| Tx signature                              | _TBD_ |             |              |
| Explorer link                             | _TBD_ |             |              |

**Expected log markers:**

```
roundfi-yield-kamino: deposit principal=100000000 ctoken_received=...
```

### Step 2 — Harvest (no realized yield path)

**Action:** call `harvest_yield` immediately after deposit (no time has passed so realized yield should be 0 or trivially small).

**Evidence to record:**

| Field                      | Pre   | Post  | Δ           |
| -------------------------- | ----- | ----- | ----------- |
| `Pool.yield_accrued`       | 0     | _TBD_ | +0 or +tiny |
| `realized_usdc` in tx logs | —     | _TBD_ | —           |
| Tx signature               | _TBD_ |       |             |

**Expected:** the slippage-protected harvest path (SEV-003 fix —
`min_realized_usdc` enforced by config) prevents negative-yield harvest
and returns immediately with 0 realized when no time has passed.

### Step 3 — Wait + Harvest (with realized yield)

**Action:** wait 24h (or longer) then call `harvest_yield` again.

**Evidence to record:**

| Field                 | Pre   | Post  | Δ             |
| --------------------- | ----- | ----- | ------------- |
| `Pool.yield_accrued`  | _TBD_ | _TBD_ | +Y_realized   |
| Treasury USDC balance | _TBD_ | _TBD_ | +protocol_fee |
| Realized yield (log)  | —     | _TBD_ | —             |
| Tx signature          | _TBD_ |       |               |

**Expected:** waterfall distribution per the SEV-003 fix —
caller-provided `lp_share_bps` no longer changes the split; reads from
`ProtocolConfig.lp_share_bps`.

### Step 4 — Redeem

**Action:** `withdraw_from_yield` to remove all principal.

**Evidence to record:**

| Field                                     | Pre         | Post  | Δ                      |
| ----------------------------------------- | ----------- | ----- | ---------------------- |
| Pool USDC vault balance                   | _TBD_       | _TBD_ | +100_000_000 + yield   |
| Kamino reserve liquidity vault            | _TBD_       | _TBD_ | −(100_000_000 + yield) |
| Protocol c-token ATA balance              | _TBD_       | 0     | −X c-tokens            |
| `Pool.yield_position.principal_deposited` | 100_000_000 | 0     | −100_000_000           |
| Tx signature                              | _TBD_       |       |                        |

**Critical assertion:** post-redeem pool USDC balance must equal
`pre-deposit balance + accrued yield to treasury fee schedule`. No
principal loss.

### Step 5 — Re-deposit

**Action:** `deposit_idle_to_yield` again with a different amount (e.g. 250 USDC).

**Evidence to record:** same fields as Step 1, with the new amount.

**Critical assertion:** the yield-position bookkeeping reset cleanly
between Step 4 and Step 5. No stale c-token balance, no double-counting.

### Step 6 — Negative case: SEV-001 attempted exploit

**Action:** craft a tx that calls `deposit_idle_to_yield` but passes an
**attacker-controlled** `c_token_account` (not the protocol-owned ATA).

**Expected:** tx fails with the Anchor associated-token-constraint
error. The SEV-001 fix added `associated_token::mint = c_token_mint,
associated_token::authority = c_token_account_authority` to the
`Deposit` account struct, so the pre-tx validator rejects this attempt
before any state changes.

**Evidence to record:**

| Field                    | Value                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Attempted attacker ATA   | _TBD_ (any wallet under attacker control)                                                    |
| Tx error code            | `AnchorError::AccountNotAssociatedTokenAccount` (or equivalent — record exact discriminator) |
| Tx signature             | _TBD_                                                                                        |
| Tx logs (relevant lines) | _TBD_                                                                                        |

**Critical assertion:** the attacker tx never reaches the program
handler — Anchor's account constraint validator rejects upstream of any
state mutation.

## Acceptance criteria

The exercise is **complete and accepted** when:

- [ ] All 6 steps have recorded tx signatures + balance evidence
- [ ] Step 4 demonstrates zero principal loss
- [ ] Step 6 demonstrates the SEV-001 fix rejecting the redirect attempt
- [ ] All txs link to explorer (Solana Beach or solscan.io) and the
      explorer state matches the recorded evidence
- [ ] The evidence is committed to this doc as an immutable record
      (this PR or a follow-up PR)

## What this exercise does NOT cover

- **PrincipalLoss protection on real economic-loss events.** Kamino's
  reserve can in principle suffer a liquidation cascade; on devnet
  there's no realistic way to simulate that. Production deploys
  monitor reserve health via Kamino's published health metrics
  (`docs/operations/emergency-response.md` documents the response
  playbook).
- **Multi-pool / multi-reserve scenarios.** The exercise is single-pool,
  single-reserve. Concurrent pool behavior is a separate scope.
- **Mainnet readiness signoff.** This is devnet evidence; mainnet adds
  the Squads ceremony + canary cap rampup documented in
  [`mainnet-canary-plan.md`](./mainnet-canary-plan.md).

## Bookkeeping invariants the exercise validates

| Invariant                                                                         | Validated by step      |
| --------------------------------------------------------------------------------- | ---------------------- |
| `pool.yield_position.principal_deposited` equals net deposit minus net withdrawal | Steps 1, 4, 5          |
| c-token ATA owner is the protocol PDA (not user/attacker)                         | Step 6 (negative case) |
| Yield waterfall split matches `ProtocolConfig.lp_share_bps`                       | Step 3                 |
| Redeem returns full principal under no-loss conditions                            | Step 4                 |
| Reserve→c-token exchange rate is read at redeem time, not pinned at deposit       | Steps 4, 5             |

## See also

- [`programs/roundfi-yield-kamino/src/lib.rs`](../../programs/roundfi-yield-kamino/src/lib.rs) — `Deposit` and `Withdraw` account structs with the SEV-001 fix
- [`docs/security/internal-audit-findings.md`](../security/internal-audit-findings.md) — SEV-001 (the c-token redirect vector this exercise certifies as closed)
- [`docs/operations/mainnet-canary-plan.md`](./mainnet-canary-plan.md) — production canary procedure that depends on this exercise being green
- [`docs/operations/emergency-response.md`](./emergency-response.md) — Kamino reserve incident playbook
