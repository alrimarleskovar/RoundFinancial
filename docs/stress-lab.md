# Stress Lab — Economic Scenario Coverage

> **What this is.** A deterministic, zero-Solana economic simulator that takes a ROSCA pool configuration plus a per-member behavior matrix and returns frame-by-frame ledger movements. The exact same `runSimulation()` function runs in three places: the in-app `/lab` page (UI sandbox), the L1 economic-parity tests (`pnpm test:economic-parity-l1`, 34 invariants), and the L2 on-chain parity harness (when devnet RPC is available).

**Source of truth:** `sdk/src/stressLab.ts` · presets exported from `PRESETS`.

---

## TL;DR for security reviewers

| What                                                | Where                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 5 canonical scenario presets                        | `PRESETS` in `sdk/src/stressLab.ts`                                                                         |
| 34 economic-parity tests across all 5 presets       | `pnpm test:economic-parity-l1`                                                                              |
| User-configurable matrix UI for arbitrary scenarios | `/lab` page (`app/src/components/lab/StressLabClient.tsx`)                                                  |
| Closed-form conservation expectations               | `tests/economic_parity.spec.ts` — every preset asserts `sum(member.delta) + protocol.delta + GF.delta == 0` |
| Solvency under triple post-contemplation default    | `tripleVeteranDefault` preset — canonical whitepaper stress test                                            |

The L1 simulator is intentionally a **pure-TS reference implementation** with zero Anchor / Solana imports. This lets it run as a normal `ts-mocha` test without devnet/bankrun, and lets the same numbers drive the UI sandbox so reviewers and judges can poke at scenarios live.

---

## 1. Canonical preset scenarios

| ID                     | Pool size | Tier         | Carta (USDC)  | Default pattern                                                                                            | What it proves                                                                                                                                                                      |
| ---------------------- | --------- | ------------ | ------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `healthy`              | 12        | mixed        | $30 (default) | None — every member pays every cycle                                                                       | Conservation invariants hold under the happy path; yield waterfall distributes correctly                                                                                            |
| `preDefault`           | 12        | mixed        | $30           | Member 4 (Elena, would be C at cycle 5) drops out at cycle 3 — **before** contemplation                    | Protocol retains stake + paid installments; no real loss; reputation slashed                                                                                                        |
| `postDefault`          | 12        | mixed        | $30           | Member 1 (Bruno, contemplated at cycle 2) defaults at cycle 5 — **after** receiving upfront                | Protocol takes a real loss; Triple Shield activates; D/C invariant holds                                                                                                            |
| `cascade`              | 12        | mixed        | $30           | Rows 5/7/9 default at cycles 4/5/6 — three rolling pre-contemplation defaults                              | Solidarity vault depletion + escrow seizure across multiple shields                                                                                                                 |
| `tripleVeteranDefault` | **24**    | **Veterano** | **$10,000**   | Members 1/2/3 contemplated at cycles 2/3/4, each defaults at the cycle right after receiving their upfront | **Canonical whitepaper stress test**: gross liability $30,000; recovery via escrow (+$19,500) + stake slash (+$3,000) + Seed Draw cushion (+$9,152) **= protocol solvent at scale** |

Each preset runs as a deterministic simulation, frame-by-frame, with per-member ledger snapshots verifiable against closed-form expectations.

---

## 2. The 34 invariants tested per preset

Every preset is asserted against the following invariant families (`tests/economic_parity.spec.ts`):

### 2.1 Conservation of funds (5 tests)

For each preset, the sum across all participants + protocol balance + Guarantee Fund balance + yield realized **must equal zero**. No money created or destroyed.

### 2.2 Frame count determinism (5 tests)

Each preset produces exactly N frames where N = `pool.size × pool.cycles_total + setup frames`. Reproduces bit-identically on re-run.

### 2.3 Triple Shield activation (5 tests + 4 named-shield-fire tests)

- **Shield 1 — Seed Draw Invariant** activates on the cycle-0 payout when `pool_vault + escrow_balance < members × installment × 91.6%` (`SEED_DRAW_BPS=9_160`).
- **Shield 2 — Guarantee Fund Solvency Guard** activates whenever `spendable (vault − GF_balance) < credit_amount`.
- **Shield 3 — Adaptive Escrow Seizure** activates on `settle_default` after grace period.

The `cascade` and `tripleVeteranDefault` presets both fire shields multiple times in a single simulation; the assertions check that the **right shield fires at the right cycle in the right order**.

### 2.4 D/C invariant (5 tests)

`Default-to-Capital invariant`: for every cycle in every preset, `defaults_to_date × credit_amount ≤ recoverable (escrow + solidarity + GF_available)`. If this ever flips, the protocol is structurally insolvent at that moment. Across all 5 presets × all cycles × all configurations tested → **never flips**.

### 2.5 Yield waterfall conservation (5 tests)

Realized yield is split: `protocol_fee_bps` → protocol treasury, then GF top-up until `gf_target_bps × TVL`, then LPs, then participants. The sum of distributions must equal realized yield (no precision drift).

### 2.6 Reputation snapshot monotonicity (5 tests)

A member's score is strictly non-decreasing across the simulation timeline modulo explicit slash events. No silent score regression.

---

## 3. User-configurable scenarios (the `/lab` UI)

The 5 canonical presets are the **named regression scenarios** that ship in tests. The `/lab` page exposes the full simulator to users via a matrix toggle:

- **Pool size:** 4 – 36 members
- **Tier:** Iniciante (50% stake), Intermediário (30%), Veterano (10%)
- **Carta:** any USDC amount
- **Default pattern:** click any (member, cycle) cell to toggle that member defaulting at that cycle
- **Yield params:** Kamino APY assumption, protocol fee bps

This lets a reviewer (or a judge) reproduce any of the canonical presets, plus generate arbitrary new scenarios. The same `runSimulation()` powers both the UI and the test harness, so any scenario the user can poke into the UI is one PR away from being a regression test.

> Codifying additional matrix runs as named regression tests is a tracked follow-up (see [self-audit §8 recommendation 3](./security/self-audit.md#8-recommendations-before-mainnet)). Today the canonical regression suite is the 5 named presets above driving 34 invariant tests — custom scenarios are reviewer-driven via the UI.

---

## 4. What the simulator does NOT model (out of scope)

Documented here so audit hours don't go to known-deferred areas:

- **MEV / front-running** — `claim_payout` and `escape_valve_buy` ordering. Mainnet concern; simulator ignores slot-order.
- **Solana runtime failures** — BPF execution, account ownership, signer verification. Trusted as correct.
- **RPC reorgs / hostile indexer** — the simulator is on-chain-state-only; off-chain indexer reconciliation is a separate concern.
- **Black-swan yield-adapter failures** — simulator assumes Kamino returns the realized yield as reported. A Kamino exploit scenario is out of scope.
- **Wallet-side phishing** — front-end attack surface; simulator does not model UI trust.

See [`docs/security/self-audit.md`](./security/self-audit.md#7-out-of-scope-future-work) §7 for the full out-of-scope register.

---

## 5. How to reproduce

```bash
# Run the 34 invariants locally (no Solana needed)
pnpm test:economic-parity-l1

# Open the matrix UI to drive custom scenarios
pnpm --filter @roundfi/app dev
# → http://localhost:3000/lab

# Drive a specific preset via the CLI runner (smoke check)
pnpm exec tsx scripts/stress/run-preset.ts tripleVeteranDefault
```

---

## 6. References

- **Implementation:** `sdk/src/stressLab.ts`
- **Tests:** `tests/economic_parity.spec.ts` (34 invariants), `tests/parity.spec.ts` (Rust↔TS seed parity)
- **UI:** `app/src/components/lab/StressLabClient.tsx`
- **Whitepaper deep-dive:** `docs/en/05-stress-lab-economic-model.pdf`
- **Triple Shield invariants:** [`docs/security/self-audit.md` §3.1](./security/self-audit.md#31-economic-invariants-triple-shield)
