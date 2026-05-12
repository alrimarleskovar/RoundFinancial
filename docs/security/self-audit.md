# RoundFi — Self-Audit & Threat Model

**Status:** Internal audit (M3, hackathon submission). External audit deferred to mainnet migration phase.
**Scope:** `programs/roundfi-core` (20 instructions) + `programs/roundfi-reputation` (attestation CPI surface) + `services/indexer/` schema.
**Methodology:** Invariant-driven review. Each protocol guarantee is mapped to (a) the file/line where it's enforced and (b) the test that proves it holds. 162 test cases across 18 spec files (53 of which are security-specific across 5 spec files) + the 4 Triple Shield guards captured firing on real funds during devnet exercising.

---

## 1. Assets at risk

| Asset                                             | Where it lives                                           | Custody model                                                                      |
| ------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **User stake** (collateral, locked at join)       | `Escrow USDC vault PDA` per pool                         | Released in vesting tranches (`release_escrow`); seizable on default (Shield 3)    |
| **Pool float** (collected installments)           | `Pool USDC vault PDA`                                    | Pays out winner per cycle; idle balance routed to yield adapter                    |
| **Solidarity reserve** (1% of every contribution) | `Solidarity USDC vault PDA` per pool                     | First line of defense on default; consumed before escrow seizure                   |
| **Realized yield**                                | `Yield USDC vault PDA` per pool                          | Split via waterfall: protocol fee → Guarantee Fund → LPs → participants            |
| **Guarantee Fund (GF)**                           | `Protocol-level GF balance` (config)                     | Pool-level shock absorber; capped at `gf_target_bps` of TVL                        |
| **Position NFT** (proof of slot ownership)        | mpl-core asset, frozen plugin                            | Transferable only via `escape_valve_buy` (atomic re-anchor)                        |
| **Reputation attestations**                       | PDAs derived from `(pool, subject, schema, cycle, slot)` | Append-only; written via cross-program CPI from roundfi-core to roundfi-reputation |

## 2. Trust assumptions

- **Protocol authority** — singleton, configured at `initialize_protocol`. Can update fee schedule + propose treasury rotations behind a 7-day timelock. Cannot drain pools (no rug-pull instruction).
- **Pool authority** — typically the protocol authority. Creates pools, closes completed pools.
- **Members** — sign their own `join_pool`, `contribute`, `claim_payout`, `release_escrow`, `escape_valve_list/buy` actions. Cannot impersonate other members (PDA seeds bind member PDA to wallet).
- **Anyone** — can crank `settle_default` (after grace period elapses), `harvest_yield`, `deposit_idle_to_yield`, `commit_new_treasury` (after timelock elapses). Permissionless cranks are economically self-aligned (no fee, just gas).
- **Solana runtime** — assumed correct (BPF execution, account ownership, signer verification, rent collection).
- **Token program** — SPL-Token (USDC mint trusted at config time, frozen as immutable thereafter).
- **mpl-core** — NFT standard with owner-managed `FreezeDelegate` + `TransferDelegate` plugins. **One real production-relevant bug discovered during M3 testing**: `TransferV1` resets owner-managed plugin authorities. Fix shipped (re-approve plugins post-transfer) — see Section 6.
- **Helius webhook** (off-chain indexer) — best-effort delivery; reconciler joins event rows back to canonical pool/member rows during backfill. **Never on the trust path** for fund movement.

## 3. Invariants & enforcement

### 3.1 Economic invariants (Triple Shield)

All three shields were captured **firing on real funds on devnet** during M3 testing — see `docs/devnet-deployment.md`.

#### Shield 1 — Seed Draw Invariant (cycle 0 only)

- **Where:** `programs/roundfi-core/src/instructions/claim_payout.rs:109-117`
- **Function:** `retained_meets_seed_draw()`
- **Requirement:** `pool_vault + escrow_balance >= members_target × installment × 91.6%` (`SEED_DRAW_BPS = 9_160`)
- **Error:** `SeedDrawShortfall`
- **Why:** A first-cycle payout is the most fragile moment of a ROSCA — if the pool can't retain 91.6% of theoretical max month-1 collections, paying out any winner leaves remaining members exposed.

#### Shield 2 — Guarantee Fund Solvency Guard

- **Where:** `programs/roundfi-core/src/instructions/claim_payout.rs:123-131`
- **Requirement:** `spendable (vault − GF_balance) >= credit_amount`
- **Error:** `WaterfallUnderflow`
- **Why:** The GF is earmarked capital that must remain available as a shock absorber; payouts cannot dip below it.
- **Captured firing:** Pool 3 settle_default sequence on devnet — `WaterfallUnderflow` ×2.

#### Shield 3 — Debt/Collateral Invariant (settle_default)

- **Where:** `programs/roundfi-core/src/instructions/settle_default.rs:174-282` + `programs/roundfi-core/src/math/dc.rs:28-86`
- **Functions:** `max_seizure_respecting_dc()`, `dc_invariant_holds()`
- **Invariant:** `D_remaining × C_initial <= C_remaining × D_initial` (cross-multiplied, u128 to avoid overflow)
- **Why:** A defaulting member cannot be over-seized; their collateral fraction must always be at least as large as their debt fraction. The seizure waterfall (solidarity → escrow → stake) caps at each phase.
- **Captured firing:** Pool 3 `settle_default(1)` drained the solidarity vault ($0.20) and **stopped at shield 1 because the D/C invariant already held** — `member.defaulted=true`, `SCHEMA_DEFAULT` attestation written, escrow + stake left intact.

#### Shield 4 (implicit) — Escrow Lock

- **Where:** `programs/roundfi-core/src/instructions/release_escrow.rs`
- **Error:** `EscrowLocked` — `release_escrow` rejected when `checkpoint > current_cycle + 1`, or `checkpoint == 0`, or `checkpoint > cycles_total`.
- **Captured firing:** Pool 1 negative test on devnet.

### 3.2 PDA tampering resistance

All PDAs use deterministic seeds bound to the actor (wallet, pool, slot). Any account passed in that fails `seeds = [...]` constraints is rejected at the Anchor layer before the instruction body runs.

| PDA                          | Seeds                                                                                       | File:line                         |
| ---------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| `Config`                     | `[b"config"]`                                                                               | `constants.rs:8`                  |
| `Pool`                       | `[b"pool", authority, seed_id_le]`                                                          | `constants.rs:9`                  |
| `Member`                     | `[b"member", pool, wallet]`                                                                 | `constants.rs:10`                 |
| `Escrow Vault Authority`     | `[b"escrow", pool]`                                                                         | `constants.rs:11`                 |
| `Solidarity Vault Authority` | `[b"solidarity", pool]`                                                                     | `constants.rs:12`                 |
| `Yield Vault Authority`      | `[b"yield", pool]`                                                                          | `constants.rs:13`                 |
| `Position (NFT Authority)`   | `[b"position", pool, slot_index]`                                                           | `constants.rs:14`                 |
| `Listing`                    | `[b"listing", pool, slot_index]`                                                            | `constants.rs:15`                 |
| `ReputationProfile`          | `[b"profile", wallet]`                                                                      | `roundfi-reputation/constants.rs` |
| `Attestation`                | `[b"attestation", pool, subject, schema_id_le, nonce_le]` (nonce = `(cycle << 32) \| slot`) | `roundfi-reputation/constants.rs` |

### 3.3 Per-instruction privilege model

| Instruction                        | Signer         | Pre-state requirement                                           |
| ---------------------------------- | -------------- | --------------------------------------------------------------- |
| `initialize_protocol`              | Authority      | Config PDA uninitialized                                        |
| `create_pool` / `init_pool_vaults` | Pool authority | (none)                                                          |
| `join_pool`                        | Member wallet  | Pool status = Forming, slot available                           |
| `contribute`                       | Member wallet  | Pool status = Active, member not defaulted, current cycle       |
| `claim_payout`                     | Slot owner     | Pool status = Active, slot matches cycle, not already paid      |
| `release_escrow`                   | Member wallet  | checkpoint validation (Shield 4)                                |
| `settle_default`                   | **Anyone**     | Member missed contribution + 7-day grace period elapsed         |
| `escape_valve_list`                | Member wallet  | Member non-defaulted, on-time contributions, pool Active        |
| `escape_valve_buy`                 | Buyer wallet   | Listing Active, exact price match                               |
| `harvest_yield`                    | **Anyone**     | Yield vault has pending realized yield + slippage tolerance met |
| `deposit_idle_to_yield`            | **Anyone**     | Pool spendable (vault − GF) > 0                                 |
| `close_pool`                       | Pool authority | Pool status = Completed, no outstanding defaults                |
| `update_protocol_config`           | Authority      | Frozen fields (mint, adapters, authority) untouched             |
| `propose_new_treasury`             | Authority      | No pending proposal, treasury not locked                        |
| `cancel_new_treasury`              | Authority      | Pending proposal exists                                         |
| `commit_new_treasury`              | **Anyone**     | Timelock elapsed (7 days)                                       |
| `lock_treasury`                    | Authority      | Idempotent (one-way kill switch)                                |
| `pause`                            | Authority      | Gates all user-facing fund movement except `settle_default`     |
| `ping`                             | Anyone         | Dev-only smoke test (Step 10 deprecation)                       |

## 4. Test coverage by invariant

162 test cases across 18 spec files. The 53 security-specific tests below are the audit-layer evidence; the remaining 109 cover lifecycle, edge cases, parity, reputation, and yield integration.

### 4.1 Security specs (53 tests)

#### `tests/security_economic.spec.ts` (11 tests · count verified)

- Wrong-slot, wrong-cycle, double-claim, underfunded-pool: `claim_payout` ordering invariants
- `deposit_idle_to_yield` zero/overflow/exact-tracking
- Harvest waterfall conservation + idempotency on zero realized yield
- u64::MAX overflow protection

#### `tests/security_inputs.spec.ts` (14 tests · count verified)

- Foreign Pool/Member/vault-authority PDAs → seeds constraint rejection
- Wrong USDC mint, attacker-owned vault, wrong-mint ATA, cross-pool ATA → mint constraint rejection
- SystemProgram-owned, uninitialized, attacker-owned member ATAs → ownership constraint rejection
- **Post-attack state immutability:** no attestation PDAs leaked, pool accepts legitimate `contribute` after rejected attacks (no state poisoning)

#### `tests/security_lifecycle.spec.ts` (14 tests · count verified)

- `contribute` on Forming pool → `PoolNotActive`
- `join_pool` on full pool → `PoolNotForming`
- `release_escrow` (3 negative paths): cp=0, cp>cycles_total, cp>current+1 → `EscrowLocked`
- `release_escrow` happy + repeat → `EscrowNothingToRelease`
- Non-member signs `release_escrow` → seeds mismatch
- `close_pool` on Active pool → `PoolNotCompleted`
- `close_pool` by unauthorized signer → `Unauthorized`
- `escape_valve_list/buy` price/seller mismatch → `InvalidListingPrice`, `EscapeValvePriceMismatch`, `Unauthorized`
- `escape_valve_buy` happy → atomic re-anchor

#### `tests/security_cpi.spec.ts` (10 tests · count verified)

- Wrong yield adapter program → `YieldAdapterMismatch`
- Harvest on empty vault → idempotent no-op
- Attacker-owned ATA as yield_vault → `VaultMismatch`
- Foreign mock-state PDA → seeds guard
- `claim_payout` with wrong reputation_program → `Unauthorized`
- Attestation PDA with rogue issuer / wrong schema → seeds mismatch
- `contribute` cycle skew → `WrongCycle`

#### `tests/security_audit_paths.spec.ts` (4 tests)

- `MetadataUriInvalidScheme` — `join_pool` rejects `ftp://`
- `ReputationLevelMismatch` — asserting level=2 against empty profile fails
- `HarvestSlippageExceeded` — slippage guard fires on zero-yield
- `TreasuryLocked` — `propose_new_treasury` after `lock_treasury` rejects

### 4.2 Reputation guards (12 tests across `reputation_guards.spec.ts` + `reputation_cpi.spec.ts`)

- `contribute` with wrong reputation_program → `Unauthorized`, profile unchanged
- Replay same `(cycle, slot)` after good contribute → rejects, profile unchanged
- Admin attest with unknown schema (99) → `InvalidSchema`, profile unchanged
- Admin attest signed by random keypair → `InvalidIssuer`, profile unchanged
- Same `(subject, cycle, slot)` in two pools → distinct attestation PDAs (no collision)
- Replay in pool X does not affect pool Y's attestation or score
- Score snapshots strictly monotonically non-decreasing
- Attestation PDA count == events fired (no duplicates, no losses)

### 4.3 L1↔L2 economic parity (`economic_parity.spec.ts` + `parity.spec.ts`)

- Every Rust seed byte-equals its TS SDK counterpart (8 seeds: config, pool, member, escrow, solidarity, yield, position, listing)
- Fee schedule (yield bps, cycle L1/L2/L3, GF cap) matches Rust ↔ TS
- Stake bps by level matches the 50-30-10 rule (level 1→50%, 2→30%, 3→10%)
- Pool defaults (members, installments, credit, cycles, cycle duration) match
- Attestation schema IDs match
- L1 stress-lab presets (Healthy, Pre-default, Post-default, Cascade, Triple Veteran Default) produce N deterministic frames; outputs match closed-form expectations

## 5. Automated tooling in CI

Every PR runs:

- **`anchor build`** — compiles all Anchor programs + IDL generation
- **`cargo audit`** — RustSec advisory database scan against `Cargo.lock` (advisory-only; doesn't block merge)
- **`pnpm typecheck`** + **lint** — TypeScript surface (front-end, SDK, indexer)
- **`pnpm test:parity`** — L1 stress-lab parity tests
- **`pnpm test:l1`** — full L1 reference suite

CI status is enforced by branch protection on `main` (3 required checks).

## 6. Bugs surfaced during M3 testing

### 6.1 mpl-core `TransferV1` plugin authority reset

**Surfaced during:** Pool 3 `escape_valve_buy` exercise on devnet.
**Symptom:** After `TransferV1` moved a position NFT from seller → buyer, owner-managed `FreezeDelegate` and `TransferDelegate` plugin authorities were reset to default — meaning the new owner couldn't be re-frozen by the program.
**Fix:** Re-approve plugins post-transfer. The `escape_valve_buy` instruction now: unfreeze → transfer → re-approve plugins (FreezeDelegate + TransferDelegate to position PDA) → re-freeze.
**Impact:** This is a **real production-relevant issue** that bankrun didn't catch — only surfaced under live mpl-core program execution on devnet. Documented in `docs/devnet-deployment.md` and tested via the Pool 3 escape-valve exercise.

### 6.2 Solana 3.x Box workarounds (10 instances)

The Solana 3.x toolchain regressed several Anchor account-size inference paths. Worked around by explicit `Box<>` annotations on accounts approaching stack limits. Tracked in PR #_filled at PR_ . Not a security bug — a compiler ergonomics issue.

## 7. Out of scope (future work)

The following are explicitly **out of scope** for this internal audit. They are tracked for the post-hackathon mainnet migration phase:

- **External third-party audit** — Halborn, Ottersec, Sec3, or equivalent. Recommended budget: 2-3 weeks engagement, ~$50-100k.
- **Formal verification of D/C invariant** — current proof is in-test (`security_economic.spec.ts` + `dc.rs` math module). Worth a model-checked proof (Coq/Lean) before mainnet given the asymmetric loss function.
- **Indexer reconciler hardening** — current scaffold trusts Helius webhook ordering. Reconciler that joins event rows ↔ canonical pool/member rows under reorg + replay scenarios is post-hackathon.
- **Bug bounty program** — recommended at mainnet launch. Suggested platform: Immunefi. Suggested initial pool: $50k.
- **Economic stress-tests under adversarial conditions** — current parity tests cover happy and named-failure paths (5 canonical presets, 34 invariants — see [`docs/stress-lab.md`](../stress-lab.md)). Adversarial scenarios deliberately deferred:
  - **Strategic-behavior simulation** — members coordinating tx ordering, partial defaults, gaming the cycle rotation, etc.
  - **Sybil attacks** — same human spinning N wallets to game reputation (mitigated long-term by the PoP provider — see [§4.4](../architecture.md#44-identity-layer-added-v02--2026-04-22--provider-transition-v04--2026-05); not enforced today since identity layer is optional)
  - **Malicious pool leaders / Community Pool spam** — when Community Pool variant ships post-mainnet, leader-side attack surface (refusing to settle defaults, withholding payouts) needs separate threat modeling
  - **Reputation farming** — minimum-cost-to-mint-attestation arbitrage; today bounded by stake floor + USDC installments but a $1 ROSCA variant would change the calculus
  - **Fuzzer over full state space** — proptest / quickcheck-style harness against the on-chain handlers, not just the L1 simulator

  These are tracked under issue [#228](https://github.com/alrimarleskovar/RoundFinancial/issues/228) (codify additional regression tests) for the codifiable subset, and as pre-mainnet research items for the open-ended adversarial-creativity subset.

- **Front-end attack surface** — wallet adapter, RPC trust, phishing-resistant flows. Currently relies on Phantom + Solana wallet adapter defaults.
- **MEV / front-running** — `claim_payout` and `escape_valve_buy` could be front-run. Mitigation strategies (commit-reveal, jito bundles) deferred to mainnet.

## 8. Recommendations before mainnet

In rough priority order:

1. **External audit** by an established Solana firm (Halborn / Ottersec / Sec3).
2. **Bug bounty** via Immunefi or HackenProof.
3. **Reconciler under reorg fuzzing** — verify event-store consistency under hostile RPC.
4. **Formal proof of D/C invariant** — Coq/Lean model.
5. **Pause-rehearsal drill** — operational test: real authority pauses + unpauses production pool, observers verify all fund-movement instructions blocked.
6. **MEV review** — claim_payout and escape_valve_buy ordering analysis.

## 9. Disclosure

For responsible disclosure of vulnerabilities, see [SECURITY.md](../../SECURITY.md) at the repository root.

## 10. External auditor self-attestation matrix

Pre-flight cross-reference for external review. Each concern that an auditor might raise on a first-pass scan is mapped to (a) the source-line that enforces it and (b) the test that proves the enforcement holds. Drawn from the auditor-feedback round during M3, supersedes the per-section coverage scattered above with a single contiguous table.

| Auditor concern                                                            | Source enforcement                                                                                                                                                                                                                                                                                                                                                                                                              | Test coverage                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All instructions have strong signer / owner / seeds / mint constraints** | Every `#[derive(Accounts)]` struct in `programs/roundfi-core/src/instructions/*.rs` uses `seeds = [...]`, `bump`, `owner = <program-id>`, `mint = <expected>`, `constraint = signer.key() == <expected>` patterns (Anchor-level enforcement, reverts before handler body runs)                                                                                                                                                  | `tests/security_inputs.spec.ts` (14 tests) — foreign Pool/Member/vault-authority PDAs rejected, wrong USDC mint rejected, attacker-owned vault rejected, SystemProgram-owned/uninitialized/attacker-owned member ATAs rejected, post-attack state immutability                                                                                                      |
| **Anyone-can-crank instructions do not enable griefing**                   | `settle_default` requires grace-period elapsed at `settle_default.rs:163-170` (`clock.unix_timestamp >= pool.next_cycle_at + GRACE_PERIOD_SECS`); `harvest_yield` short-circuits on zero realized (`harvest_yield.rs` — `realized == 0` returns Ok no-op); `commit_new_treasury` requires `now >= pending_eta` (7d timelock from PR #122); `deposit_idle_to_yield` requires pool float >= threshold                             | `tests/security_economic.spec.ts` (11 tests) — harvest empty vault idempotent, conservation invariants under stress; `tests/security_audit_paths.spec.ts` — `TreasuryLocked` test fires                                                                                                                                                                             |
| **`settle_default` cannot be triggered early**                             | `settle_default.rs:163-170` — `pool.next_cycle_at.checked_add(GRACE_PERIOD_SECS)` + comparison vs `clock.unix_timestamp`. Constants: `GRACE_PERIOD_SECS = 7 days`. Both arithmetic overflow-checked via `checked_add`                                                                                                                                                                                                           | `tests/security_lifecycle.spec.ts` + `tests/edge_grace_default.spec.ts` + `tests/edge_grace_default_shield1_only.spec.ts`                                                                                                                                                                                                                                           |
| **`claim_payout` rejects slot / cycle mismatch**                           | `claim_payout.rs:93-95` — `require!(args.cycle == pool.current_cycle, WrongCycle)`, `require!(member.slot_index == args.cycle, NotYourPayoutSlot)`, `require!(args.cycle < pool.cycles_total, PoolClosed)`. Anchor `member` account constraint binds wallet → slot via PDA seeds                                                                                                                                                | `tests/security_economic.spec.ts` (11 tests) — wrong-slot, wrong-cycle, double-claim, underfunded-pool ordering invariants                                                                                                                                                                                                                                          |
| **`escape_valve_buy` listing integrity**                                   | `escape_valve_buy.rs` — listing PDA seeds bind `(pool, slot_index)`; buyer ATA validated; **post-CPI invariant block (PR #123)** asserts `asset.owner == buyer` + `FreezeDelegate.frozen == true` — defends against mpl-core silently no-op'ing the `TransferV1` (real bug found, see §6.1)                                                                                                                                     | `tests/security_lifecycle.spec.ts` (escape_valve_buy happy + atomic re-anchor); `tests/security_cpi.spec.ts` (foreign program-id rejected, ATA ownership)                                                                                                                                                                                                           |
| **D/C invariant — no overflow / rounding bug**                             | `programs/roundfi-core/src/math/dc.rs:40-50` — `dc_invariant_holds(d_init, d_rem, c_init, c_rem)` casts to `u128` before multiplication, uses `saturating_mul`. Largest practical product = `u64::MAX × u64::MAX` fits in `u128` exactly. `max_seizure_respecting_dc()` uses ceiling division to never under-cap                                                                                                                | `tests/economic_parity.spec.ts` — 5 D/C tests across the 5 canonical presets. **Across all 5 presets × all cycles tested → invariant never flips.** Captured firing live on Pool 3 default cycle (see §3.1 Shield 3)                                                                                                                                                |
| **`pause` blocks all the right things**                                    | 9 user-facing instructions carry `constraint = !config.paused @ ProtocolPaused`: `create_pool.rs:52`, `join_pool.rs:48`, `contribute.rs`, `claim_payout.rs:26`, `release_escrow.rs`, `deposit_idle_to_yield.rs:39`, `harvest_yield.rs:73`, `escape_valve_list.rs`, `escape_valve_buy.rs`. **`settle_default` deliberately exempted** (carve-out per pause.rs:8-12 docstring — paused protocol must not lock funds indefinitely) | `tests/security_audit_paths.spec.ts` — `TreasuryLocked` fires + auth-table coverage in §3.2. **Live drill 2026-05-12** — pause + on-chain verification + `create_pool` rejected with error 6024 / 0x1788 + unpause + verification. See [`docs/operations/rehearsal-logs/2026-05-12-pause-rehearsal.md`](../operations/rehearsal-logs/2026-05-12-pause-rehearsal.md) |
| **Treasury rotation / timelock secure**                                    | 7-day timelock + permissionless `commit_new_treasury` crank (so authority can't stall) + one-way `lock_treasury` kill switch. PR #122 — 4-instruction rotation cluster: `propose_new_treasury` / `cancel_new_treasury` / `commit_new_treasury` / `lock_treasury`                                                                                                                                                                | `tests/security_audit_paths.spec.ts` — `TreasuryLocked` test (lock_treasury then propose_new_treasury → error fires before pending-proposal check)                                                                                                                                                                                                                  |
| **Upgrade authority controlled**                                           | Solana program-loader `ProgramData.upgrade_authority` set to deployer pubkey `64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm` on all 4 deployed programs. Mainnet plan: rotate to Squads multisig before mainnet smoke (see [`docs/operations/key-rotation.md`](../operations/key-rotation.md))                                                                                                                                   | Runtime verification: `solana program show <pid> --url devnet` → "Upgrade Authority" field. Same pubkey across all 4 program IDs                                                                                                                                                                                                                                    |
| **Reproducible build = source matches deployed bytecode**                  | Source pinned to commit `5f1673b` (later refreshed to `c98cab3`). Builds run inside `solanafoundation/solana-verifiable-build:1.18.26` Docker image. Cargo.lock v3 + borsh 1.5.7 pinned for image compatibility (see [`docs/verified-build.md`](../verified-build.md))                                                                                                                                                          | OtterSec verify-build attestation PDA on devnet for all 4 program IDs, signer = deployer. Verifiable via `solana-verify get-program-pda --program-id <pid> --signer 64XM177V...` (returns `git_url` + `commit` + `executable_hash`)                                                                                                                                 |

The 53 security-specific tests across `tests/security_*.spec.ts` + `tests/reputation_*.spec.ts` + `tests/edge_*.spec.ts` collectively cover the matrix above. The 4 Triple Shield invariants are independently captured firing on real funds on devnet — see §3.1 + `docs/devnet-deployment.md`.

External auditors: this table is the **2-minute first-pass scan**. The deeper invariant detail lives in §3 above; the test-by-test breakdown lives in §4.
