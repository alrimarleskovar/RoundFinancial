# Kamino Bankrun-Clone Spike — Runbook

> **Why this doc exists:** the planned devnet exercise for `roundfi-yield-kamino` (`docs/operations/kamino-devnet-exercise.md`) hit operational friction — Kamino doesn't publish a canonical devnet USDC reserve, and init'ing one requires Scope oracle infra that's also second-class on devnet. **Estimated cost: 1-2 weeks of integration plumbing.**
>
> Bankrun with a cloned Kamino program offers a cheaper validation path for the **CPI mechanics layer**: discriminator + account ordering + signer-seeds correctness. It does NOT validate economic behavior (no real exchange-rate movement), but it closes the highest-probability bug class for a fraction of the cost.
>
> **Discovery payoff already realized:** the discovery phase of this spike (cross-checking what address to clone) caught SEV-040 — a typo in the pinned `KAMINO_LEND_PROGRAM_ID` constant that would have made the entire Kamino integration fail at canary-mainnet. Fixed in PR #377 before the spike itself ran.

## Phases

### Phase 1 — Program loading (in this PR)

**Goal:** prove bankrun can host Kamino's program bytecode without rejection. Same shape as the mpl_core loader pattern (`tests/_harness/bankrun.ts::maybeLoadMplCore`), now mirrored for klend.

**What's validated:**

- klend.so loads into bankrun without "Unsupported program id"
- Program account is retrievable at `KAMINO_LEND_PROGRAM_ID`
- Executable bit is set (not a data account)
- Harness-side and on-chain-side pin agree on the canonical program ID

**Pre-flight (one-time):** download Kamino's mainnet program bytecode:

```bash
solana program dump -u mainnet-beta \
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD \
  target/deploy/klend.so
```

The dump is ~600KB. NOT committed to the repo (same convention as mpl_core.so).

**Run:**

```bash
pnpm exec mocha -t 60000 tests/security_kamino_cpi.spec.ts
```

If klend.so is missing, the spec skips with a clear pointer to the dump command. If bankrun rejects the bytecode, the loader assertion fails with the error message — that's the SEV-012 / mpl_core upstream-compat failure mode and a hard signal that the spike-clone path is dead and we must escalate to devnet.

### Phase 2 — CPI mechanics (separate PR)

**Goal:** invoke `deposit` and `harvest` through `roundfi-yield-kamino` against the cloned Kamino program. Surface any discriminator or account-ordering mismatches.

**Accounts to cascade-clone from mainnet:**

| Account                               | How to find                                                                      | Why                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| USDC reserve PDA (Kamino main market) | Query Kamino SDK `KaminoMarket.load(connection, MAIN_MARKET).getReserve("USDC")` | The reserve account our adapter points at                                     |
| Reserve collateral mint               | `Reserve.collateral.mint_pubkey`                                                 | c-token mint, anchor-derived ATA target                                       |
| Reserve liquidity supply ATA          | `Reserve.liquidity.supply_pubkey`                                                | Kamino's USDC vault — sink/source for our CPI                                 |
| Reserve fee receiver                  | `Reserve.config.fees.receiver`                                                   | Kamino's fee skim ATA                                                         |
| Lending market PDA (parent)           | `Reserve.lending_market`                                                         | Kamino's market context                                                       |
| Lending market authority PDA          | Derived from market via `seeds = [lending_market.key().as_ref()]`                | Signer for the reserve's internal CPIs                                        |
| Scope oracle prices PDA               | `Reserve.config.token_info.oracle.scope`                                         | Pyth/Switchboard price feed aggregator — required for Kamino's pre-CPI checks |

**Snapshot procedure:**

```bash
# Dump each account state as base64 to a JSON file
for ACC in <reserve_pda> <c_token_mint> <liquidity_supply> <fee_receiver> <market> <oracle>; do
  solana account "$ACC" --url mainnet-beta --output json > "tests/fixtures/kamino/${ACC}.json"
done
```

Phase 2 spec then writes these via `context.setAccount` in `before()` to seed the bankrun env, mirroring the pattern in `tests/_harness/bankrun.ts::writeAnchorAccount` / `writeTokenAccount`.

**Known risks for Phase 2 (may force fallback to devnet exercise):**

1. **Stale oracle timestamps.** Kamino's pre-CPI check `last_update <= current_slot` may panic if bankrun's clock is way past the snapshot moment. Mitigation: call `setBankrunUnixTs` to align clock with snapshot moment, OR clone the oracle account fresh each test.

2. **Cluster ID assertions.** If Kamino's bytecode has `cluster == MainnetBeta` checks anywhere, the clone in bankrun fails. No evidence of this in the public docs but worth verifying empirically.

3. **Cascade depth.** A reserve may reference accounts (e.g. Switchboard aggregator) which reference further accounts (e.g. job definitions). Each step needs cloning. Worst case: 8+ accounts to seed before deposit works.

4. **Mutable state divergence.** Kamino's deposit ix updates `Reserve.liquidity.available_amount` etc. After the first deposit, the bankrun state diverges from mainnet — fine, but means each test re-bootstrap is needed (no test reuse).

**Phase 2 is gated on Phase 1 succeeding.** If bankrun rejects klend.so loading entirely (Phase 1 failure), Phase 2 won't help — escalate to either devnet self-init (Scope-heavy) or accept canary-mainnet as the first validation point.

### Phase 3 — Economic validation (NOT covered by bankrun)

End-to-end yield accrual requires real exchange rate movement. Bankrun's frozen state can't simulate this. **This is the canary-mainnet event**, not a bankrun event. Phases 1-2 reduce the bug surface canary needs to find, but don't replace canary.

## What this spike does NOT replace

- `MAINNET_READINESS.md` §4.5 "Harvest path lands" stays 🟡 until canary mainnet, regardless of spike outcome.
- The `kamino-devnet-exercise.md` template stays as the documented operational path for full economic + mechanics validation.
- Phase 3 B2B oracle validation remains gated on the Phase 2 spec + canary success.

## Methodology lesson — already cashed

The discovery-phase payoff (SEV-040 caught before the spike even ran) confirms a meta-pattern: **preparing operational validation is itself a form of validation.** The act of cross-referencing what to clone against what's pinned in code surfaced a critical typo that pure code review missed.

Recommended follow-up: every external-program CPI in our codebase should have at minimum:

1. A pinning unit test for the pinned program ID (string equality vs canonical)
2. A bankrun-clone spike spec that proves the program is loadable
3. A documented cascade-clone inventory for full mechanics validation

`roundfi-yield-kamino` is the first to apply this checklist. The same checklist applies to any future yield-adapter additions (Solend, MarginFi, etc).

## See also

- [`programs/roundfi-yield-kamino/src/lib.rs`](../../programs/roundfi-yield-kamino/src/lib.rs) — pinned program ID + discriminators + account contexts
- [`tests/_harness/bankrun.ts`](../../tests/_harness/bankrun.ts) — `maybeLoadKaminoLend()` loader + `KAMINO_LEND_PROGRAM_ID` export
- [`tests/security_kamino_cpi.spec.ts`](../../tests/security_kamino_cpi.spec.ts) — Phase 1 spec (this PR)
- [`docs/operations/kamino-devnet-exercise.md`](./kamino-devnet-exercise.md) — devnet path (parked due to Scope-oracle friction)
- [`docs/security/internal-audit-findings.md`](../security/internal-audit-findings.md) — SEV-040 row (typo caught by this spike's discovery phase)
