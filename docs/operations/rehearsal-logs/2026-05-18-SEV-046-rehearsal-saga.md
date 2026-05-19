# SEV-046 Rehearsal Saga — CD Pipeline Devnet Bring-Up

> **Why this doc exists.** The SEV-046 CD pipeline scaffolding (PR #388) shipped clean code and clean docs but missed five empirical bugs that only surface when the workflow runs against real GitHub-hosted runner conditions. Each rehearsal attempt found exactly one bug, fixed it, then surfaced the next. This file catalogs the chain so the next operator (mainnet ceremony, or anyone bringing up the equivalent flow in a fork) skips the 5 round trips we needed.
>
> Companion to [`docs/operations/cd-pipeline.md`](../cd-pipeline.md) (architecture spec). This file is the empirical lessons-learned counterpart.

## Headline

**5 PRs (#389 → #393) all closed before the workflow could complete a single deploy.** Each was a one-line YAML or one-line script issue. None would have been caught by `actionlint`, `prettier`, or any of the existing CI lanes. **Lesson burned in: workflow code is untestable except by running it.** The Hofstadter's Law speaks for itself.

**Update 2026-05-19:** rehearsal 1g (post-#393) ran green end-to-end. 4 programs live on devnet via clean ubuntu-latest runner. See [`2026-05-19-SEV-046-rehearsal-1g-success.md`](./2026-05-19-SEV-046-rehearsal-1g-success.md) for the full run record. **1 / 3** clean rehearsals against the §"Rehearsal protocol" stretch goal in `cd-pipeline.md`.

**Update 2026-05-19 (later):** rehearsal 2 aborted pre-deploy — the 20 SOL balance gate from PR #393 fired correctly when the deployer wallet was at 12.38 SOL post-1g (1g consumed the ~12.5 SOL the floor was sized against). **This is the floor working as designed, not a bug.** The operator unblock path is faucet top-up; deferred until the wallet clears 20 SOL again. Captured in the chronology table as row "2-aborted" to keep the saga honest about what the operator actually saw. §3.3 strict criterion ("at least once") remains satisfied by 1g; the 3× stretch goal is reproducibility-confidence-only and **NOT a mainnet blocker**.

**Update 2026-05-19 (later still):** operator topped up to 22.38 SOL via faucet; rehearsal **2b** ran green end-to-end with 12.62 SOL consumed (1% over the 12.5 SOL prediction — within rounding). Same workflow, fresh keypairs, all 4 programs deployed cleanly. **3× stretch goal now at 2/3.** See [`2026-05-19-SEV-046-rehearsal-2b-success.md`](./2026-05-19-SEV-046-rehearsal-2b-success.md) for the full run record + the 1g-vs-2b reproducibility comparison table. **Reproducibility empirically demonstrated** — the 5-PR bug chain in 1b–1f has no siblings; the remaining gap is operator-side (SOL availability for a third top-up cycle).

## Per-rehearsal chronology

| #         | Tag                                    | Bug surfaced                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Fix PR                                                             | Fix shape                                                                                                                                                                                                                                                                                                                                                     |
| --------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a        | `devnet-deploy-v20260518-rehearsal-1`  | `DEVNET_DEPLOYER_KEYPAIR` secret empty (operator hadn't set it yet)                                                                                                                                                                                                                                                                                                                                                                                          | — (expected)                                                       | Operator setup, not a code bug                                                                                                                                                                                                                                                                                                                                |
| 1b        | `devnet-deploy-v20260518-rehearsal-1b` | `solana balance --output json \| jq -r '.balance'` returns the literal string `null` — `jq` exits 0 so the `\|\|` fallback never fires                                                                                                                                                                                                                                                                                                                       | [#389](https://github.com/alrimarleskovar/roundfinancial/pull/389) | Drop the JSON parse; use plain-text `solana balance \| grep -oE '^[0-9.]+'` (same form mainnet workflow already used)                                                                                                                                                                                                                                         |
| 1c        | `devnet-deploy-v20260518-rehearsal-1c` | `scripts/devnet/deploy.ts` called `anchor build` (no `--no-idl`), tripping `proc_macro2::Span::source_file()` removal in `anchor-syn 0.30.1`                                                                                                                                                                                                                                                                                                                 | [#390](https://github.com/alrimarleskovar/roundfinancial/pull/390) | Add `--no-idl` to all anchor build calls in `deploy.ts` (devnet AND mainnet). IDLs are regenerated separately via `scripts/dev/rebuild-idls.sh` (local) or future OtterSec flow                                                                                                                                                                               |
| 1d        | `devnet-deploy-v20260518-rehearsal-1d` | `anchor deploy` errored `No default signer found, run "solana-keygen new -o /home/runner/.config/solana/id.json"` — `solana config set --keypair` is for the `solana` CLI only, anchor CLI ignores it                                                                                                                                                                                                                                                        | [#391](https://github.com/alrimarleskovar/roundfinancial/pull/391) | Tried `ANCHOR_WALLET` env var — **didn't actually work** (anchor CLI doesn't read it). See 1e for the real fix. This PR's change is inert but harmless                                                                                                                                                                                                        |
| 1e        | `devnet-deploy-v20260518-rehearsal-1e` | Same error as 1d — `Upgrade authority: /home/runner/.config/solana/id.json`. `anchor deploy` reads wallet exclusively from `Anchor.toml`'s `[provider] wallet = "~/.config/solana/id.json"`                                                                                                                                                                                                                                                                  | [#392](https://github.com/alrimarleskovar/roundfinancial/pull/392) | `cp target/devnet-deployer.json $HOME/.config/solana/id.json` — meet `Anchor.toml` at the canonical path. Removed the inert `ANCHOR_WALLET` env from PR #391. Cleanup step updated to remove both paths                                                                                                                                                       |
| 1f        | `devnet-deploy-v20260518-rehearsal-1f` | Reached `anchor deploy`, failed mid-upload: `Account 5ZpFt... has insufficient funds for spend (6.137 SOL) + fee (0.004 SOL)`. The 5 SOL floor passed but the real cost is ~12.5 SOL for 4 programs                                                                                                                                                                                                                                                          | [#393](https://github.com/alrimarleskovar/roundfinancial/pull/393) | Bump floor 5 → 20 SOL. Docstring breaks down per-program empirical cost (core ~6.14, reputation ~2.6, yield_kamino ~2.0, yield_mock ~1.8)                                                                                                                                                                                                                     |
| 1g        | `devnet-deploy-v20260519-rehearsal-1g` | ✓ **Green.** First successful end-to-end deploy. 4 programs live on devnet, artifact captured. See [`2026-05-19-SEV-046-rehearsal-1g-success.md`](./2026-05-19-SEV-046-rehearsal-1g-success.md)                                                                                                                                                                                                                                                              | —                                                                  | Workflow ran exactly as spec'd post-#393. No new failure modes surfaced                                                                                                                                                                                                                                                                                       |
| 2-aborted | `devnet-deploy-v20260519-rehearsal-2`  | **Balance gate fired pre-deploy (feature working as designed).** Deployer pubkey `5ZpFtJePb2hGKhG9RJ6Fdwmo5y8wuwKXZZcKttoN1Jgo` had 12.38030804 SOL post-1g — the 1g `anchor deploy` consumed the ~12.5 SOL that PR #393 predicted, leaving balance < 20 SOL floor. Step "Check deployer balance ≥ 20 SOL" exit 1 with `Top up via faucet (https://faucet.solana.com) before retrying.`                                                                      | — (no fix needed)                                                  | This is exactly what PR #393's floor was meant to catch: refusing to start the workflow when there isn't enough SOL to complete the deploy + safety margin. Operator unblock path: top up via faucet (5 SOL/8h) + CLI airdrop (separate budget) + alternative faucets (Helius, Triton One). **Not a code bug — defer until operator top-up clears the floor** |
| 2b        | `devnet-deploy-v20260519-rehearsal-2b` | ✓ **Green.** Second successful end-to-end deploy (post-faucet-topup). 4 programs re-deployed with fresh keypairs (different from 1g IDs, as expected — `anchor keys sync` regenerates each run). 12.62 SOL consumed (within 1% of PR #393's 12.5 SOL prediction). See [`2026-05-19-SEV-046-rehearsal-2b-success.md`](./2026-05-19-SEV-046-rehearsal-2b-success.md) for the run record + 1g-vs-2b reproducibility comparison. **3× stretch goal now at 2/3.** | —                                                                  | Workflow ran exactly as spec'd. No new failure modes. Reproducibility empirically demonstrated — the 5-bug chain in 1b–1f has no siblings; remaining gap is operator-side SOL availability for rehearsal-3                                                                                                                                                    |

## Per-bug root cause analysis

### 1b — JSON parse trap

```bash
# Broken
BAL_RAW=$(solana balance --url devnet --output json | jq -r '.balance' || \
          solana balance --url devnet | awk '{print $1}')
```

Two compounding bugs:

1. `solana balance --output json` doesn't return an object — it returns the lamports as a bare number. `jq -r '.balance'` on a bare number returns `null` (jq's "no such field" behavior).
2. `jq` exits 0 on `null`, so the `|| awk` fallback never executes. `$BAL_RAW = "null"`, downstream regex bails.

**Fix:** parse plain-text output. `solana balance` without `--output json` returns `"X.YZ SOL"` reliably.

**Generalized lesson:** when both branches of a `||` chain depend on exit codes, verify the LHS actually fails on the unhappy path. `jq` is famously polite about missing fields.

### 1c — anchor-syn `source_file()` removal

```rust
// anchor-syn-0.30.1/src/idl/defined.rs:499
let source_path = proc_macro2::Span::call_site().source_file().path();
//                                              ^^^^^^^^^^^ removed in stable rustc
```

Anchor's CI lane (`anchor · build`) uses `anchor build --no-idl` precisely to skip this code path. The deploy scripts I wrote didn't.

**Fix:** add `--no-idl` to every anchor invocation in `scripts/{devnet,mainnet}/deploy.ts`. IDLs aren't needed for the on-chain deploy; client SDKs regen via `bash scripts/dev/rebuild-idls.sh` locally.

**Generalized lesson:** when in doubt, mirror the existing working CI lane's invocation verbatim.

### 1d–1e — anchor wallet resolution

Each of `anchor deploy`'s three wallet-resolution paths I tried:

1. `solana config set --keypair X` — solana CLI only, anchor CLI ignores
2. `ANCHOR_WALLET=X` env var — JS SDK `Provider.env()` reads it, anchor CLI doesn't
3. `--provider.wallet X` flag — anchor CLI respects this, but requires touching the script
4. **`Anchor.toml [provider] wallet = "X"`** — anchor CLI reads this exclusively when invoked without `--provider.wallet`

I burned 1d on (2) before realizing (4) is the only one that matters. The Anchor.toml pin is `wallet = "~/.config/solana/id.json"`, so the only place the keypair must live is `$HOME/.config/solana/id.json`.

**Fix:** `cp target/devnet-deployer.json $HOME/.config/solana/id.json` after restoring the keypair from secret.

**Generalized lesson:** when a tool has multiple config sources, read its source code to find which one wins. Documentation lies; tests don't (but only when they run).

### 1f — empirical SOL cost > docstring estimate

The docstring claimed "~3-4 SOL for 4 programs." Empirical reality:

| Program                | Bytecode   | 2× rent-exempt          |
| ---------------------- | ---------- | ----------------------- |
| `roundfi_core`         | ~880KB     | ~6.14 SOL               |
| `roundfi_reputation`   | ~370KB     | ~2.6 SOL                |
| `roundfi_yield_kamino` | ~294KB     | ~2.0 SOL                |
| `roundfi_yield_mock`   | ~254KB     | ~1.8 SOL                |
| **TOTAL**              | **~1.8MB** | **~12.5 SOL** + tx fees |

Per-program cost = `2 × bytecode_size × rent_per_byte_per_year` (Solana's rent-exempt minimum formula). The docstring estimate was off by ~3×.

**Fix:** bump devnet + mainnet floor 5 → 20 SOL. Docstring now has the per-program breakdown so future devs don't re-derive.

**Generalized lesson:** never trust a SOL cost estimate that hasn't been empirically verified. Especially for first-deploy where buffer accounts also escrow lamports temporarily.

## What would have prevented this saga

A **localnet smoke-test workflow** that runs the entire `devnet-deploy.yml` body against `solana-test-validator` (or a `surfpool` instance) inside CI on every PR that touches `.github/workflows/{devnet,mainnet}-deploy.yml` or `scripts/{devnet,mainnet}/deploy.ts`. Would have caught all 5 bugs before any operator-side rehearsal.

Implementation sketch (TODO, not in scope of SEV-046):

```yaml
# .github/workflows/cd-smoke-test.yml (proposed)
on:
  pull_request:
    paths:
      - ".github/workflows/devnet-deploy.yml"
      - ".github/workflows/mainnet-deploy.yml"
      - "scripts/devnet/deploy.ts"
      - "scripts/mainnet/deploy.ts"
      - "Anchor.toml"

jobs:
  smoke:
    name: cd · devnet smoke (localnet)
    runs-on: ubuntu-latest
    steps:
      # Same toolchain install as devnet-deploy.yml
      # Generate ephemeral keypair (no secret needed)
      # solana-test-validator background process
      # SOLANA_CLUSTER=localnet run the deploy script verbatim
      # Assert config/program-ids.localnet.json materialized
```

Filed as follow-up for post-canary cleanup. Not blocking — once SEV-046 closes with rehearsal-1g green, the workflows are demonstrably correct against the actual production target.

## Mainnet-deploy mitigation

`mainnet-deploy.yml` already received fixes 1b/1c/1d/1e/1f in parallel because the bugs were either shared with the devnet workflow or in shared script code:

- 1b: mainnet-deploy.yml already had the cleaner parse form (devnet was the odd one)
- 1c: `scripts/mainnet/deploy.ts` same `--no-idl` fix applied in PR #390
- 1d/1e: keypair-restore step copies to `$HOME/.config/solana/id.json` (PR #392)
- 1f: balance floor 5 → 20 in both workflows (PR #393)

**Net: the first mainnet-deploy tag (`mainnet-deploy-v0.4.0-canary` or similar) should not surface a new round of these bugs.** The mainnet workflow has additional gates (`environment: mainnet` approval, signed-tag-only trigger, `mainnet_hardening_check` preflight) but the deploy mechanics themselves are now proven on devnet.

## What still needs operator-side work

| Item                                             | Required for                   | Status                                                  |
| ------------------------------------------------ | ------------------------------ | ------------------------------------------------------- |
| `DEVNET_DEPLOYER_KEYPAIR` repo secret            | rehearsal-1g                   | ✅ set 2026-05-18                                       |
| Deployer wallet ≥ 20 SOL on devnet               | rehearsal-1g                   | ⏳ ~5 SOL; topping via faucet (rate-limited; ETA hours) |
| Run rehearsal-1g                                 | first clean run                | ⏳ pending balance                                      |
| Run rehearsals 1g/2/3 (3× clean for canary §3.3) | check-mark on canary-plan §3.3 | ⏳ pending                                              |
| `mainnet` environment in repo Settings           | mainnet workflow               | ⏳ deferred to Squads ceremony                          |
| 5 mainnet env-scoped secrets                     | mainnet workflow               | ⏳ deferred                                             |
| `MAINNET_DEPLOYER_KEYPAIR` funded ≥ 20 SOL       | first mainnet deploy           | ⏳ deferred (Squads ceremony)                           |

## Cross-references

- Architecture: [`docs/operations/cd-pipeline.md`](../cd-pipeline.md)
- Canary plan: [`docs/operations/mainnet-canary-plan.md`](../mainnet-canary-plan.md) §3.3
- SEV-046 tracker entry: [`docs/security/internal-audit-findings.md`](../../security/internal-audit-findings.md)
- Related issues: [#272](https://github.com/alrimarleskovar/roundfinancial/issues/272), [#319](https://github.com/alrimarleskovar/roundfinancial/pull/319)
- Related SEVs: SEV-042 (mainnet_hardening_check used by preflight), SEV-044 (hardening check coverage), SEV-012 (bankrun-no-mpl-core lane, same toolchain pattern)
