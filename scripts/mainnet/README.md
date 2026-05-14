# `scripts/mainnet/`

Operational scripts that run **against mainnet-beta** as part of the canary launch sequence. Companion to [`docs/operations/mainnet-canary-plan.md`](../../docs/operations/mainnet-canary-plan.md).

## ⚠️ Read before touching

These scripts move real value on mainnet. They are **NOT** for dev iteration. The dev iteration scripts live in [`scripts/devnet/`](../devnet/).

Every script in this directory:

1. **Refuses to run on any cluster other than `mainnet-beta`.** The cluster check uses `getGenesisHash()` against the well-known mainnet genesis (`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`), not an env string — you can't fool it with `SOLANA_CLUSTER=mainnet-beta` pointed at a localnet RPC.
2. **Requires an explicit `CANARY_AUTHORIZED=yes` env var.** This is a second safety belt: even on a properly configured mainnet env, the script aborts unless the operator has gone through the pre-flight checklist + explicitly set the authorization env var.
3. **Logs every transaction hash + tx state** to stdout for auditability.
4. **Is idempotent + resumable.** Each step checks on-chain state before re-running.
5. **Refuses to silently rotate authorities.** If the on-chain state implies someone else (or some other keypair) controls the protocol, the script aborts. Drift must be resolved manually.

## Scripts

| Script           | What                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canary-flow.ts` | The 7- or 9-step canary sequence (pre-flight + initialize → close_pool). Foundation under #292.                                                                       |
| _(future)_       | `wave-1-deploy.ts` — open Wave 1 retail pools post-soak (caps enforced)                                                                                               |
| _(future)_       | `multi-sig-rotate.ts` — rotate upgrade + treasury authorities to Squads PDA (companion to [`docs/operations/key-rotation.md`](../../docs/operations/key-rotation.md)) |

## Run order (canary launch)

1. **Complete pre-flight** per [`mainnet-canary-plan.md` §3](../../docs/operations/mainnet-canary-plan.md#3-pre-flight-checklist). All 20+ items must be ✅.
2. **Configure env:**
   ```bash
   export SOLANA_CLUSTER=mainnet-beta
   export SOLANA_RPC_URL=<helius-or-equivalent-mainnet-rpc>
   export CANARY_DEPLOYER_KEYPAIR=$HOME/.config/solana/canary.json   # deployer keypair (NOT squads signers)
   export CANARY_AUTHORIZED=yes
   ```
3. **Run the canary:**
   ```bash
   pnpm tsx scripts/mainnet/canary-flow.ts
   ```
4. **Squads handoff.** For `create_pool` + `close_pool` steps, the script generates the tx and prints the base64-encoded payload. Operator hands the payload to the Squads UI for the 3-of-5 approval flow. Script polls + continues once executed.
5. **Capture the post-run report** in `docs/operations/mainnet-canary-report.md` (copy from `mainnet-canary-report-template.md`).

## Current state

`canary-flow.ts` ships in this PR as a **scaffold + pre-flight gate**. The per-step transaction handlers are intentionally unimplemented (they throw `not implemented`). Implementation lands when pre-flight blockers clear:

- #266 — Squads multi-sig migration (required for `create_pool` + `close_pool` signing path)
- #267 — External audit clear (required for mainnet write authorization)
- #230 — Agave 2.x toolchain migration (canary uses post-migration bytecode)
- #233 — Kamino harvest path (optional yield branch in canary)
- #268 — Legal counsel BR + US opinions (off-chain blocker)

This keeps the script honest: a partial mainnet write before the blockers clear would be worse than not running at all.

## Safety guards in code

| Guard                                                                 | Where                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| Refuse non-mainnet cluster (genesis-hash check)                       | `refuseIfNotMainnet()` in `canary-flow.ts`                |
| Refuse unless `CANARY_AUTHORIZED=yes`                                 | `refuseUnlessExplicitAuthorization()` in `canary-flow.ts` |
| Pre-flight read-only checks (7 gates, all must pass)                  | `runPreflight()` in `canary-flow.ts`                      |
| Authority-mismatch abort on `initialize_protocol`                     | `PreflightCheck` "Protocol is NOT paused" gate            |
| Idempotency: skip steps where on-chain state already reflects success | Per-step state checks (TODO when handlers wire)           |

## References

- [`mainnet-canary-plan.md`](../../docs/operations/mainnet-canary-plan.md) — the plan this script implements
- [`mainnet-canary-report-template.md`](../../docs/operations/mainnet-canary-report-template.md) — post-run report template
- [`emergency-response.md`](../../docs/operations/emergency-response.md) — pause + escalation procedure
- [`config/clusters.ts`](../../config/clusters.ts) — cluster + program-ID resolution (mainnet-beta already supported)
- Issue [#292](https://github.com/alrimarleskovar/RoundFinancial/issues/292) — canary tracking issue
