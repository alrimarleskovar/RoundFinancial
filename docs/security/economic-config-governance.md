# Economic Config Governance

> **Why this doc exists:** the Adevar Labs W3 re-audit (point #6 +
> Risk #4) flagged that several economic-policy levers in `ProtocolConfig`
> still allow instantaneous mutation by the authority (no timelock, no
> public window). The SEV-024 commit comment already acknowledged
> `MAX_FEE_BPS_YIELD = 3_000` as bounding the immediate-blast-radius of
> an authority compromise, but a **timelock on fee changes** was filed
> as deeper follow-up. This doc inventories every economic-relevant
> config field, classifies the governance gate each one carries today,
> and proposes the canonical tiering for which gates should escalate
> before mainnet.

## Governance tiers

| Tier              | Mechanism                                                                       | Use for                                                                             |
| ----------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Hotfix**        | Authority signs one tx, takes effect immediately.                               | Operational toggles that must respond in seconds (pause).                           |
| **Timelock-1d**   | Authority signs propose tx, anyone signs commit tx after 24h.                   | Reversible economic changes (LP share, escrow release).                             |
| **Timelock-7d**   | Same as 1d but 7-day window.                                                    | High-impact economic / structural changes (treasury, authority rotation, fee caps). |
| **Locked**        | One-way kill switch — once locked, the field becomes immutable forever.         | Post-canary commitments (`lock_treasury`, `lock_approved_yield_adapter`).           |
| **Multisig-only** | Authority _is_ a Squads multisig PDA; tier overlays whichever timelock applies. | All of the above on mainnet.                                                        |

## Current state — `ProtocolConfig` fields

| Field                                         | Tier today                                 | Tier target (mainnet)                             | Status      | Audit reference                                           |
| --------------------------------------------- | ------------------------------------------ | ------------------------------------------------- | ----------- | --------------------------------------------------------- |
| `authority`                                   | Timelock-7d (propose/cancel/commit)        | Same + multisig-only                              | 🟢 Closed   | SEV-021 (reputation), Squads ceremony for core            |
| `treasury`                                    | Timelock-7d + Lockable                     | Same + multisig                                   | 🟢 Closed   | SEV-006 (ATA validation), original treasury rotation      |
| `treasury_locked`                             | One-way kill switch                        | Same                                              | 🟢 Closed   | original `lock_treasury()`                                |
| `approved_yield_adapter`                      | Hotfix today + Lockable                    | **Timelock-1d** + Lockable                        | 🟡 **Open** | SEV-020 (lock switch); Risk #6 (timelock)                 |
| `approved_yield_adapter_locked`               | One-way kill switch                        | Same                                              | 🟢 Closed   | SEV-020                                                   |
| `fee_bps_yield`                               | Hotfix (capped at MAX_FEE_BPS_YIELD = 30%) | **Timelock-1d**                                   | 🟡 **Open** | SEV-024 (cap); SEV-024 commit notes timelock as follow-up |
| `fee_bps_cycle_l1/l2/l3`                      | Hotfix                                     | **Timelock-1d**                                   | 🟡 **Open** | Risk #6 — economic-config governance                      |
| `guarantee_fund_bps`                          | Hotfix                                     | **Timelock-1d**                                   | 🟡 **Open** | Risk #6                                                   |
| `lp_share_bps`                                | Hotfix                                     | **Timelock-1d**                                   | 🟡 **Open** | Risk #6 (was caller-controlled pre-SEV-003)               |
| `paused` (selective)                          | Hotfix (intentional)                       | Same                                              | 🟢 Closed   | SEV-022 (decoupled core/reputation pause)                 |
| `passport_attestation_authority`              | Timelock-7d (inherited from `authority`)   | Same + multisig                                   | 🟢 Closed   | SEV-021                                                   |
| `passport_network`                            | Hotfix                                     | **Timelock-1d**                                   | 🟡 **Open** | provider-migration risk                                   |
| `max_pool_tvl_usdc` / `max_protocol_tvl_usdc` | Hotfix                                     | Hotfix (canary safety rail — should respond fast) | 🟢 Closed   | canary plan                                               |
| `commit_reveal_required`                      | Hotfix                                     | Hotfix (MEV mitigation toggle)                    | 🟢 Closed   | #232                                                      |

**Summary:** 6 fields shifted into the "Open" Tier 2 category — they
need a timelock before mainnet because a compromised or hostile
authority can change protocol economics in a single tx. The pattern is
the same as the SEV-006 / SEV-021 fixes already shipped — propose /
cancel / commit, with a public 24h window.

## Why 1-day for fees but 7-day for authority?

| Question                  | Fee changes                                                    | Authority change                                                      |
| ------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| Reversible?               | Yes — change is on a single bps field, can be re-changed       | Effectively no — wrong authority can do anything                      |
| Blast radius if wrong     | Yield routing skews for a cycle                                | Total protocol takeover                                               |
| Detect time vs react time | Off-chain monitor sees instantly; user reads via SDK           | Same                                                                  |
| Public-window value       | 1 day is enough for users to notice + opt out via escape valve | 7 days needed for institutional users to plan a coordinated migration |

The whitepaper bound (`MAX_FEE_BPS_YIELD = 30%`) already caps the
worst case — a compromised authority can route at most 30% of yield to
treasury, not 100%. The 1-day timelock adds **detect + react time** on
top of that bound; it doesn't replace the bound.

## Implementation pattern

Each timelock-1d field uses the same shape already shipped for treasury
and authority rotation:

```rust
// ProtocolConfig state additions per field:
pub pending_<field>: <FieldType>,
pub pending_<field>_eta: i64,

// Two instructions per field:
//   propose_new_<field>(new_value: <FieldType>) — admin signs, writes pending + eta
//   commit_new_<field>() — permissionless after eta, applies pending → field
//   cancel_new_<field>() — admin signs, clears pending
```

The 6 Open fields collectively need ~24 bytes of state padding per
field × 6 = 144 bytes. `ProtocolConfig` padding budget is ~200 bytes
today; we have room. If we exceed it, the migration path is the same as
`reputation-config-migration.md` documents.

## Pause is hotfix on purpose

`paused: bool` deliberately stays hotfix-tier. The reason: pause exists
to halt funds in an emergency, and a timelock on pause defeats the
purpose. The SEV-022 fix decoupled core and reputation pause so an
operator can pause one without dragging the other through the back
door. The same logic argues against any timelock on pause-shape fields
(per-instruction circuit breakers, if added later, would be the same
tier).

## Lock-flags are one-way

`treasury_locked` and `approved_yield_adapter_locked` are post-canary
commitments — once locked, the field becomes immutable forever. This is
the strongest possible governance gate (a "we committed to this value
and removed the ability to change it"). It's the **target end state**
for fields where reversibility is no longer needed; the timelock is the
**bridge** between hotfix and locked.

## Pre-mainnet checklist

| Item                                                                                                                                                  | Owner |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Add `pending_fee_bps_yield` + `pending_fee_bps_yield_eta` to `ProtocolConfig` + the propose/cancel/commit ixs                                         | Eng   |
| Same for `fee_bps_cycle_l1/l2/l3` (3 fields → 1 batched propose/cancel/commit triple is fine)                                                         | Eng   |
| Same for `guarantee_fund_bps`, `lp_share_bps`, `passport_network`, `approved_yield_adapter`                                                           | Eng   |
| Update the public SEV tracker (`docs/security/internal-audit-findings.md`) to reference this doc under the W3 audit "Risk #4 / point #6" tracking row | Eng   |
| Mainnet canary plan: document the post-canary `lock_approved_yield_adapter()` ceremony (already exists; cross-link here)                              | Ops   |
| Off-chain monitor: subscribe to `propose_*` logs and alert on every fee/governance proposal so the public 1-day window is actually visible            | Ops   |

## What this doc does NOT cover

- **Pool-level config** (`Pool.escrow_release_bps`, etc.) — these are
  set at pool creation and immutable per pool. Governance is implicit
  in the SEV-031 viability check (custom pool args are gated by the
  math invariant).
- **Reputation-side config** (`ReputationConfig.*`) — SEV-021 already
  pinned the authority rotation; the rest of the fields are either
  hotfix-acceptable (`paused`) or constants.
- **Operational secrets** (`HELIUS_WEBHOOK_SECRET`, etc.) — covered by
  env-var management, not protocol governance. See SEV-009 / SEV-033
  in the indexer threat model.

## See also

- [`programs/roundfi-core/src/state/config.rs`](../../programs/roundfi-core/src/state/config.rs) — `ProtocolConfig` field layout
- [`programs/roundfi-core/src/instructions/propose_new_treasury.rs`](../../programs/roundfi-core/src/instructions/propose_new_treasury.rs) — canonical timelock-7d shape to mirror
- [`docs/security/internal-audit-findings.md`](./internal-audit-findings.md) — SEV-021, SEV-022, SEV-024, SEV-033 entries that motivate this doc
- [`docs/operations/squads-multisig-procedure.md`](../operations/squads-multisig-procedure.md) — multisig overlay on every timelock
- [`docs/operations/mainnet-canary-plan.md`](../operations/mainnet-canary-plan.md) — when each timelock gate must be in place
