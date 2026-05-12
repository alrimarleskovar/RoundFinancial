# Pause-rehearsal Procedure

> **What this is.** A scripted operational drill that exercises the `pause`/`unpause` instructions live on devnet, confirms the 9 user-facing instructions all gate correctly with `ProtocolPaused`, and confirms `settle_default` remains permissionless (deliberate carve-out per [`programs/roundfi-core/src/instructions/pause.rs`](../../programs/roundfi-core/src/instructions/pause.rs)).
>
> **Why we run it.** [Self-audit §8 rec 5](../security/self-audit.md#8-recommendations-before-mainnet) flags pause-rehearsal as pre-mainnet operational hygiene. The mechanism is tested in negative-path unit tests but had never been exercised live until this drill. Real-world surfaces (concurrent in-flight tx, RPC propagation, indexer visibility) only show under live conditions.

## Quick reference

```bash
pnpm devnet:pause-rehearsal
```

Orchestrator script: [`scripts/devnet/pause-rehearsal.ts`](../../scripts/devnet/pause-rehearsal.ts). Closes #231 partially (the runbook + the orchestrator land here; the actual log of a completed drill lands in `docs/operations/rehearsal-logs/` after the operator runs it).

## Prerequisites

- [ ] **Authority keypair available** at `~/.config/solana/id.json` (or `SOLANA_WALLET=/path/to/authority.json` env override). Public key must match `ProtocolConfig.authority` — the orchestrator reads this PDA and refuses to proceed if the authority signer mismatch surfaces at tx-build time.
- [ ] **Balance ≥ 0.01 SOL** on the authority wallet (one pause + one unpause tx).
- [ ] **Devnet currently not paused** (otherwise the drill is meaningless — if you see "Protocol is ALREADY paused", the orchestrator aborts cleanly).
- [ ] **No active in-flight user txs you care about** — running the rehearsal will block any user-facing fund movement for the duration. Plan for a window where this is fine (off-hours, demo pool only, etc.).
- [ ] **Side channel for testing the gates** — you'll need to attempt each gated instruction during the paused window. Options:
  - The dApp (`https://roundfinancial.vercel.app`) for the wired-up instructions (`contribute`, `claim_payout`)
  - SDK seed scripts (`pnpm devnet:seed-pool`, `seed-members`, `seed-cycle`, etc.) for the rest
  - Direct SDK invocations from a Node script for the permissionless cranks

## What the script does

```
1. Read ProtocolConfig.paused → must be false (else abort)
2. Wait for operator Enter
3. Sign + send pause(true) with authority keypair
4. Re-read ProtocolConfig.paused → must be true
5. Print manual-verification checklist (9 gated ix + 1 ungated)
6. Wait for operator Enter (operator runs the manual checks)
7. Sign + send pause(false)
8. Re-read ProtocolConfig.paused → must be false
9. Write rehearsal log to docs/operations/rehearsal-logs/YYYY-MM-DD-pause-rehearsal.md
```

The script is **interactive** — pauses for operator confirmation at each state-change step. Ctrl-C aborts between confirmations safely (will leave protocol in whatever state the last completed tx set).

## Verification checklist (run during step 6)

For each instruction, attempt one tx against the deployed `roundfi-core` program. The script's manual-verification block enumerates them, but for reference:

### Must fail with `ProtocolPaused`

| Instruction             | Easiest reproduction path                                        | Trigger reason                                       |
| ----------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `create_pool`           | `pnpm devnet:seed-pool` (creates a fresh demo pool)              | Should fail at the constraint on `create_pool.rs:52` |
| `join_pool`             | `pnpm devnet:seed-members` (joins members into an existing pool) | Constraint on `join_pool.rs:48`                      |
| `contribute`            | dApp Pay-Installment modal OR `pnpm devnet:seed-cycle`           | Constraint on `contribute.rs` (similar pattern)      |
| `claim_payout`          | dApp Receber CTA OR `pnpm devnet:seed-claim`                     | Constraint on `claim_payout.rs:26`                   |
| `release_escrow`        | `pnpm devnet:seed-release`                                       | Constraint on `release_escrow.rs`                    |
| `deposit_idle_to_yield` | `pnpm devnet:seed-yield-deposit`                                 | Constraint on `deposit_idle_to_yield.rs:39`          |
| `harvest_yield`         | `pnpm devnet:seed-yield-harvest`                                 | Constraint on `harvest_yield.rs:73`                  |
| `escape_valve_list`     | `pnpm devnet:seed-evlist`                                        | Constraint on `escape_valve_list.rs`                 |
| `escape_valve_buy`      | `pnpm devnet:seed-evbuy`                                         | Constraint on `escape_valve_buy.rs`                  |

### Must NOT fail with `ProtocolPaused`

| Instruction      | Reproduction                                                      | Why exempt                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settle_default` | `pnpm devnet:seed-default` (against an existing defaulted member) | Deliberate carve-out per pause.rs docstring: "A paused protocol must never create a path where funds can be locked indefinitely — defaults must still be settleable" |

`settle_default` may fail for OTHER reasons (no eligible defaulter, grace period not elapsed, member already settled, etc.) — those are fine. The test is specifically: it does NOT fail with `ProtocolPaused`.

## After the drill — file the log

The orchestrator writes a stub log to `docs/operations/rehearsal-logs/YYYY-MM-DD-pause-rehearsal.md` with the two tx Signatures already filled in. **The operator fills the verification table** before committing:

```markdown
| Instruction   | Expected       | Observed |
| ------------- | -------------- | -------- |
| `create_pool` | ProtocolPaused | ✓        |
| `join_pool`   | ProtocolPaused | ✓        |

| ...
```

Commit the log to the repo. This becomes the **proof of operational maturity** that auditors, partners, and integrators can see when they read `docs/operations/`.

## Outcome interpretation

| Result                                                     | Meaning                                                                                  | Action                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| All 9 gated rows = ✓ AND `settle_default` row = ✓          | **Mechanism works as designed** — pause is reachable in ~1s; gates fire; carve-out works | Mark #231 closed; rehearsal complete                                                                |
| Any gated row ≠ ✓                                          | **Real bug** — a gated ix did NOT block                                                  | File a `mainnet-blocker` issue immediately; investigate before next deploy                          |
| `settle_default` row ≠ ✓ (i.e. it DID fire ProtocolPaused) | **Carve-out broken** — a member could be locked under default                            | Same — `mainnet-blocker` issue, investigate                                                         |
| Pause fires but unpause fails                              | **Protocol stuck paused**                                                                | Use [emergency-response.md](./emergency-response.md) procedure; consider authority-key sanity check |

## Cadence recommendation

- **Pre-mainnet:** run once now (closes #231) + once after Anza Agave 2.x migration (#230, since bytecode changes) + once before mainnet smoke deploy
- **Post-mainnet:** quarterly + after every protocol upgrade (because new instructions might forget the `!config.paused` constraint — the rehearsal catches that regression)

## Related runbooks

- [`emergency-response.md`](./emergency-response.md) — for an actual incident (not a planned rehearsal)
- [`key-rotation.md`](./key-rotation.md) — if the rehearsal surfaces an authority-key issue
- [`deploy-runbook.md`](./deploy-runbook.md) — the runbook that placed the deployed bytecode this drill exercises

## Related issues

- #231 — Pause-rehearsal operational drill (this runbook + orchestrator closes the procedural side; the log of an actual run closes it fully)
