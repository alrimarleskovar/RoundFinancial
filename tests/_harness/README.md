# tests/\_harness — RoundFi test scaffolding

Step 5a — the foundational layer. Everything under this folder is
**infrastructure** (types, fixtures, reusable builders). No business
assertions live here — those belong in `tests/*.spec.ts`.

Execution environment: Linux / WSL / GitHub Actions. Not expected to
run on the author's Windows dev box. `anchor test` from repo root
runs `anchor build` first, then starts a local `solana-test-validator`
and runs every `tests/**/*.spec.ts` under `ts-mocha`. In CI the suite splits
by mpl_core dependency: the no-mpl-core subset runs via `bankrun.ts`
(`bankrun · no-mpl-core` lane), while the mpl_core-dependent specs (join-NFT
mint, escape-valve NFT transfer) run via `litesvm.ts` (`litesvm · mpl-core
path` lane), which loads the SBFv2 `mpl_core.so` that bankrun panics on.

## Modules

| File            | Purpose                                                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env.ts`        | Workspace provider + typed `Program<T>` handles for all four on-chain programs. Single import point for spec files.                                                                                                        |
| `pda.ts`        | Re-exports `@roundfi/sdk` PDA helpers; adds anchor-specific conveniences (bump extraction, arrays of position PDAs, etc.).                                                                                                 |
| `keypairs.ts`   | Deterministic keypair generation from a seed string — reproducible fixtures across CI runs.                                                                                                                                |
| `airdrop.ts`    | Batched SOL funding for test wallets (respects faucet caps on real devnet, unthrottled on localnet).                                                                                                                       |
| `mint.ts`       | Creates a fresh 6-decimal USDC-like mint per test, mints to ATAs, ensures ATAs exist.                                                                                                                                      |
| `time.ts`       | Localnet clock warping + `sleep`. For cycle-boundary and grace-window tests.                                                                                                                                               |
| `yield.ts`      | Resolves the mock yield adapter program ID from the workspace and exposes its state PDA helper.                                                                                                                            |
| `protocol.ts`   | Wrapper around `initialize_protocol` — idempotent per test (skips if already init'd for the same `authority`).                                                                                                             |
| `reputation.ts` | Wrappers around `initialize_reputation`, `init_profile`; event-log parser for attestation events.                                                                                                                          |
| `pool.ts`       | **Reusable pool initializer**: create pool → mass-join N members at configurable tiers → optionally advance to an active cycle.                                                                                            |
| `events.ts`     | Anchor event parser (decodes `ProfileSnapshot`, attestation events, etc. from tx logs).                                                                                                                                    |
| `index.ts`      | Barrel export. Spec files do `import { ... } from "../_harness"`.                                                                                                                                                          |
| `bankrun.ts`    | Bankrun-backed `Env` (`setupBankrunEnv`) — the ADR 0007 shim wrapping bankrun's `BankrunConnectionProxy` with the full `Connection` surface. Runs the `bankrun · no-mpl-core` CI lane.                                     |
| `litesvm.ts`    | litesvm-backed `Env` — custom anchor `Provider` + one-point v1→v2 tx bridge; loads the SBFv2 `mpl_core.so` that bankrun's `solana-program-test 1.18` panics on. Runs the `litesvm · mpl-core path` CI lane on **Node 24**. |

## Usage pattern

```ts
import { setupEnv, initializeProtocol, createPool, joinPool, fundUsdc } from "../_harness";

describe("contribute happy path", () => {
  it("advances member state correctly", async () => {
    const env = await setupEnv();
    await initializeProtocol(env);
    const pool = await createPool(env);
    const alice = await joinPool(env, pool, { slotIndex: 0, reputationLevel: 1 });
    await fundUsdc(env, alice.wallet, pool.installmentAmount);
    // ... drive contribute, assert state ...
  });
});
```

## Conventions

- Only `*.spec.ts` files are test entrypoints (see Anchor.toml `[scripts].test`).
- Helpers never start with `*.spec.ts`; they are plain `*.ts`.
- Every helper accepts an `Env` handle (from `env.ts`) so tests stay independent.
- Helpers return typed records (`PoolHandle`, `MemberHandle`) rather than raw pubkeys —
  keeps spec files readable and lets us evolve internals without touching every test.
- Pure math lives in Rust unit tests (`cargo test -p roundfi-core`), not here.
