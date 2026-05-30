# Kamino Program-ID Pin Verification (Audit Wave 7)

> **Status:** Operator gate + CI drift detector.
> **Closes:** LEAD-3 residual ("verificação operacional do program-id") from the Adevar bug bounty report + the long-pending operator check called out in the `roundfi-yield-kamino` module header.

## Why this exists

The `roundfi-yield-kamino` adapter hardcodes the Kamino Lend program ID:

```rust
// programs/roundfi-yield-kamino/src/lib.rs
pub const KAMINO_LEND_PROGRAM_ID: Pubkey =
    anchor_lang::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
```

If this address drifts (typo, copy-paste mistake, Kamino governance rotates the program), **every yield CPI from our adapter routes to the wrong target** — silently, until the first harvest reverts (or worse, succeeds against a malicious look-alike). The adapter's own module header has flagged this as a pre-mainnet operator check that has stayed pending.

## What ships in Wave 7

| Piece                                           | Where                                                        | Runs                                       |
| ----------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| Pure extractor + verifier (`verifyKaminoPin`)   | `scripts/mainnet/kamino-pin.ts`                              | reused by both the CI spec + the CLI       |
| **CI drift gate** (no RPC)                      | `tests/kamino_pin_verify.spec.ts` → `test:kamino-pin`        | every PR, `js` lane                        |
| **Operator pre-deploy CLI** (with RPC liveness) | `scripts/mainnet/verify-kamino-pin.ts` → `verify:kamino-pin` | manual, before each mainnet adapter deploy |

The canonical expected value lives in **one place** (`scripts/mainnet/kamino-pin.ts::EXPECTED_KAMINO_LEND_PROGRAM_ID`). If Kamino ever rotates the program, the same PR must update **both** that constant **and** the adapter `const` — the spec fails otherwise.

## What the CI gate catches automatically

Every PR run executes `verifyKaminoPin` against the on-disk adapter source. The `js` lane will fail if:

1. **The pinned const drifts** from `EXPECTED_KAMINO_LEND_PROGRAM_ID`.
2. **Someone reshapes the const** (renames it, switches to a runtime value, removes it) so the regex no longer matches — surfaces as `extraction_failed`, which is just as critical (the next harvest CPI would use whatever the new shape resolved to, untested).

## What the CI gate does NOT catch

- That the program is actually **deployed** at that address on mainnet (it could be the right pin against a decommissioned address).
- That the program's **bytecode** is the canonical `klend` build (a malicious upgrade by the deploy authority would be invisible here).
- That the per-pool `kamino_reserve` / `kamino_market` pair pinned at `init_vault` time is the canonical USDC reserve — that is a per-pool init-time check, not a global pre-deploy gate.

## Operator pre-deploy ritual

Before deploying / redeploying the adapter to mainnet:

```bash
# 1. Source drift gate (same as CI — verifies the pin against canonical).
pnpm verify:kamino-pin

# 2. Source drift gate + RPC liveness (proves the program is deployed
#    + executable at the pinned address on mainnet right now).
pnpm verify:kamino-pin --verify-rpc

# 3. With a custom RPC (private endpoint, fork, etc.):
pnpm verify:kamino-pin --verify-rpc --rpc https://my-rpc.example.com
```

Exit code is non-zero on any failure; the message names the exact divergence (source pin vs canonical, missing account on-chain, etc.).

## What to do when Kamino rotates the program

(Hopefully rare, but documented for completeness.)

1. Obtain Kamino's published deploy announcement (Squads multisig commit, official announcement) for the new program address.
2. In a SINGLE PR, update **both**:
   - `programs/roundfi-yield-kamino/src/lib.rs`: the `KAMINO_LEND_PROGRAM_ID` const.
   - `scripts/mainnet/kamino-pin.ts`: the `EXPECTED_KAMINO_LEND_PROGRAM_ID` const.
3. The PR description cites the Kamino announcement URL.
4. CI's drift gate then becomes a guard against accidental re-introduction of the old value.
5. Re-run `pnpm verify:kamino-pin --verify-rpc` before the next adapter deploy.

## Companion checks

- `pnpm test:mainnet-hardening` already covers `approved_yield_adapter` (our adapter program ID, downstream of this one). The two together form the chain: _our core CPI's the right adapter, AND our adapter CPI's the right Kamino_.
- The per-pool reserve verification follow-up is tracked as Wave 7.1 (operator paste-in of canonical reserve at init-time).
