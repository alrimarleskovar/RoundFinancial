# Constants Audit — Mainnet Validation Sweep (2026-05-15)

> **Pattern:** Adevar Labs SEV-002 (`GRACE_PERIOD_SECS = 60`) and SEV-023
> (`MIN_CYCLE_DURATION = 60`) were both shaped the same way: a devnet
> shortcut value was pinned with a "MUST revert before mainnet" TODO, the
> TODO never closed, a pinning test happily asserted the shortcut as
> production-correct, and the value leaked to main. This audit is a
> deliberate sweep for any **other** instance of the same pattern across
> every `pub const` in `programs/` and every cross-program literal —
> performed before mainnet canary opens.

## Scope

| Surface                              | Files audited                                                       |
| ------------------------------------ | ------------------------------------------------------------------- |
| Rust constants modules               | `programs/roundfi-core/src/constants.rs`, `programs/roundfi-reputation/src/constants.rs` |
| Time-arithmetic literals (`*_SECS`)  | All instruction files in `programs/` (grep sweep)                  |
| Inline `unix_timestamp` math         | All instructions doing `.checked_add()` / `.saturating_add()`      |
| Rust ↔ TS constant parity            | `programs/**/constants.rs` vs `sdk/src/constants.ts`               |
| Default-permissive `ProtocolConfig`  | `initialize_protocol.rs` field-by-field                            |
| Devnet / DEMO / TODO markers         | `grep -E "(devnet\|DEMO\|MUST revert\|TODO.*mainnet)"` in `*.rs`   |

## Methodology

Sweep keywords: `_DURATION`, `_PERIOD`, `_INTERVAL`, `_TIMEOUT`, `_GRACE`,
`_COOLDOWN`, `_DELAY`, `_TIMELOCK`, plus the canonical-time literals
`60 / 3600 / 86400 / 86_400 / 604800 / 604_800 / 2592000 / 2_592_000`.

Cross-checked every grep hit against three questions:

1. Is this value a real production value, or a devnet shortcut leaked to main?
2. Is there a pinning test that asserts the production value (not a devnet value)?
3. Does the comment match the value, or has either drifted?

## Findings

### 1. Hardcoded time literals — **CLEAN**

Zero hardcoded time literals (`60`, `3600`, `86400`, etc.) appear in
executable instruction code outside the named-constant definitions.
Every `checked_add` / `saturating_add` / `>=` against `unix_timestamp`
references a named constant:

| Site                                                     | Constant used                          | Value (sec) |
| -------------------------------------------------------- | -------------------------------------- | ----------- |
| `settle_default.rs:167`                                  | `GRACE_PERIOD_SECS`                    | 604_800     |
| `propose_new_treasury.rs:88`                             | `TREASURY_TIMELOCK_SECS`               | 604_800     |
| `propose_new_authority.rs:63`                            | `TREASURY_TIMELOCK_SECS`               | 604_800     |
| `escape_valve_list_reveal.rs:105`                        | `REVEAL_COOLDOWN_SECS`                 | 30          |
| `propose_new_reputation_authority.rs:59`                 | `REPUTATION_AUTHORITY_TIMELOCK_SECS`   | 604_800     |
| `attest.rs` (admin-cooldown branch)                      | `MIN_ADMIN_ATTEST_COOLDOWN_SECS`       | 60          |
| `attest.rs` (CycleComplete branch)                       | `MIN_CYCLE_COOLDOWN_SECS`              | 518_400     |
| `create_pool.rs:99` (`>= MIN_CYCLE_DURATION`)            | `MIN_CYCLE_DURATION`                   | 86_400      |

**Verdict:** the SEV-002 / SEV-023 fixes closed every instance of the
pattern they exemplified. No new occurrences surfaced.

### 2. `MIN_CYCLE_COOLDOWN_SECS` — comment-vs-default drift

The constant value `518_400` (6 days) was chosen as "60% of a 10-day
cycle" per its docstring (`programs/roundfi-reputation/src/constants.rs:22`).
The current protocol default `DEFAULT_CYCLE_DURATION = 2_592_000` (30 days)
means the cooldown is **20% of a default cycle**, not 60%.

**Risk assessment:** the security property the constant is meant to defend
(anti-sybil rate-limit on `SCHEMA_CYCLE_COMPLETE` attestations) is still
enforced — an admin or pool-PDA cannot issue >1 `CycleComplete` per
subject per 6 days regardless of `cycle_duration`. The value is correct as
an **absolute rate-limit floor**; the docstring's "60% of cycle" framing
is what drifted, not the security guarantee.

**Recommendation:** update the docstring to reframe `518_400` as an
absolute anti-sybil floor (decoupled from cycle duration) — no value
change. Filed as low-severity doc-correction in this PR.

### 3. `MIN_ADMIN_ATTEST_COOLDOWN_SECS = 60` — bounded by threat model

The SEV-027 fix added a 60-second cooldown between admin-issued
`SCHEMA_PAYMENT` attestations for the same subject. 60s defeats trivial
tight-loop score-pumping (the documented threat). A patient malicious
admin slow-walking attestations at 1/min could theoretically pump a
subject 0 → L3 (2000 score) in ~3.3 hours.

This is intentional: the admin threat model assumes the protocol
authority is the trusted multisig (post-Squads handoff). If admin is
compromised, score-pumping is a low-order concern vs. the broader
authority-rotation attack surface — which is mitigated by the 7-day
timelock on `propose_new_authority` (`TREASURY_TIMELOCK_SECS`). The
60s value is the documented anti-spam floor and matches the comment.
**No action.**

### 4. Default-permissive `ProtocolConfig` flags — DEVNET SHORTCUT PATTERN risk class

`initialize_protocol.rs` ships 4 ops gates in the **permissive default**
state, with comments saying "mainnet authority flips via
`update_protocol_config`". These are not bugs — they're intentional
mainnet-canary safety rails defaulted off — but they sit in the same
risk family as SEV-002: if the mainnet runbook is not followed, the
protocol launches with rails down and nothing on-chain enforces the
flip.

| Flag                                  | Default              | What it enforces when ON                                  | Where ops flips                  |
| ------------------------------------- | -------------------- | --------------------------------------------------------- | -------------------------------- |
| `commit_reveal_required`              | `false`              | Blocks legacy `escape_valve_list` → forces commit-reveal flow (#232 MEV mitigation) | `update_protocol_config`         |
| `max_pool_tvl_usdc`                   | `0` (disabled)       | Per-pool TVL cap (mainnet canary safety rail)            | `update_protocol_config`         |
| `max_protocol_tvl_usdc`               | `0` (disabled)       | Protocol-wide TVL cap                                    | `update_protocol_config`         |
| `approved_yield_adapter`              | `Pubkey::default()`  | Allowlist — pools may only point at this adapter         | `update_protocol_config`         |
| `approved_yield_adapter_locked`       | `false`              | One-way kill switch on the allowlist                     | `lock_approved_yield_adapter()`  |
| `treasury_locked`                     | `false`              | One-way kill switch on treasury rotation                 | `lock_treasury()`                |

**Risk:** human-process error during mainnet bootstrap leaves any of
these off. None is a direct fund-loss vector on its own — they're
defense-in-depth — but together they form the canary safety envelope.

**Recommendation (encoded as TODO, deferred to a follow-up):** add a
`mainnet_hardening_check()` step to `scripts/mainnet/canary-flow.ts` that
reads `ProtocolConfig` and refuses to run the canary unless all 6 flags
are in the production-correct state. This converts a runbook-checklist
gate into an on-chain-state assertion. Filed under the canary pre-flight
TODOs in `scripts/mainnet/canary-flow.ts:64-135` (which already has
`TODO(#292 W2)` markers in the same shape).

### 5. Rust ↔ TS constant parity — **CLEAN**

Every numeric constant exported by `sdk/src/constants.ts` matches its
Rust counterpart. Verified by direct comparison:

| Domain          | Rust                                                        | TS                            | Match |
| --------------- | ----------------------------------------------------------- | ----------------------------- | ----- |
| Pool defaults   | `DEFAULT_MEMBERS_TARGET = 24`                               | `membersTarget: 24`           | ✅    |
| Pool defaults   | `DEFAULT_INSTALLMENT_AMOUNT = 600_000_000`                  | `installmentAmount: 600_000_000n` | ✅ |
| Pool defaults   | `DEFAULT_CREDIT_AMOUNT = 10_000_000_000`                    | `creditAmount: 10_000_000_000n` | ✅  |
| Pool defaults   | `DEFAULT_CYCLES_TOTAL = 24`                                 | `cyclesTotal: 24`             | ✅    |
| Pool defaults   | `DEFAULT_CYCLE_DURATION = 2_592_000`                        | `cycleDurationSec: 2_592_000` | ✅    |
| Fees            | `DEFAULT_FEE_BPS_YIELD = 2_000`                             | `yieldFeeBps: 2_000`          | ✅    |
| Fees            | `DEFAULT_FEE_BPS_CYCLE_L1/L2/L3 = 200/100/0`                | `cycleFeeL1Bps/L2Bps/L3Bps`   | ✅    |
| Fees            | `DEFAULT_GUARANTEE_FUND_BPS = 15_000`                       | `guaranteeFundBps: 15_000`    | ✅    |
| Fees            | `SOLIDARITY_BPS = 100`                                      | `solidarityBps: 100`          | ✅    |
| Fees            | `SEED_DRAW_BPS = 9_160`                                     | `seedDrawBps: 9_160`          | ✅    |
| Fees            | `DEFAULT_ESCROW_RELEASE_BPS = 2_500`                        | `escrowReleaseBps: 2_500`     | ✅    |
| Stake bps       | `STAKE_BPS_LEVEL_{1,2,3} = 5000/3000/1000`                  | `STAKE_BPS_BY_LEVEL{1,2,3}`   | ✅    |
| Schemas         | `SCHEMA_PAYMENT/LATE/DEFAULT/CYCLE_COMPLETE/LEVEL_UP = 1..5`| `ATTESTATION_SCHEMA.*`        | ✅    |
| Grace           | `GRACE_PERIOD_SECS = 604_800`                               | `CRANK_DEFAULTS.defaultGraceSec: 604_800` | ✅ |

## Summary

| Category                                       | Findings                | Action                          |
| ---------------------------------------------- | ----------------------- | ------------------------------- |
| Hardcoded devnet time literals                 | 0                       | none — sweep clean              |
| Time-constant pinning tests                    | All assert prod values  | none — verified                 |
| Rust ↔ TS parity drift                         | 0                       | none — sweep clean              |
| `MIN_CYCLE_COOLDOWN_SECS` comment drift        | 1 (doc-only)            | docstring update in this PR     |
| Default-permissive `ProtocolConfig` flags      | 6 (intentional)         | canary pre-flight check (TODO)  |
| `MIN_ADMIN_ATTEST_COOLDOWN_SECS` threat-model  | 1 (bounded, no-op)      | documented + no action          |

**Verdict:** the SEV-002 / SEV-023 family is **closed**. The remaining
mainnet-bootstrap risk surface is process-shaped, not code-shaped, and
is addressable by a single follow-up adding pre-flight state assertions
to the canary script.

## Methodology reproducibility

```bash
# 1. List every pub const + check categorization
grep -rn --include="*.rs" -E "^\s*pub const" programs/

# 2. Time-shortcut keywords
grep -rn --include="*.rs" -E "(_DURATION|_PERIOD|_INTERVAL|_TIMEOUT|_GRACE|_COOLDOWN|_DELAY|_TIMELOCK)" programs/

# 3. Hardcoded time literals
grep -rn --include="*.rs" -E "\b(60|3600|86400|86_400|604800|604_800|2592000|2_592_000)\b" programs/

# 4. Devnet markers in code paths
grep -rn --include="*.rs" -E "(devnet|DEMO|MUST revert|TODO.*mainnet|FIXME)" programs/

# 5. Cross-program timestamp arithmetic
grep -rn --include="*.rs" -E "(saturating_add|checked_add).*unix" programs/

# 6. Rust ↔ TS parity (manual line-by-line vs sdk/src/constants.ts)
```

Re-running these 6 commands after any constants change should produce
the same shape of output. The audit is reproducible by any reviewer.
