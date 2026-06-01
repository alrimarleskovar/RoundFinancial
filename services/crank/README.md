# @roundfi/crank

Daemon that keeps RoundFi pools moving forward on-chain. Long-running
companion to the indexer; never user-facing.

## Why this service exists

The Canary launch needs **48h cycles + 24h grace** — well beyond any
human-driven run loop. `services/orchestrator` is the demo runner
(single-shot `runCycle`), not a daemon. The on-chain program will not
advance a pool past a defaulted member without `settle_default` being
explicitly called; without continuous cranking, every other member's
score gets held hostage to one missing tx.

Closes the 6 gaps from the canary readiness audit (May 2026):

| Gap | Symptom if unfixed                                     | Where                 |
| --- | ------------------------------------------------------ | --------------------- |
| 1   | Defaulted members stall the pool indefinitely          | `settleDefaults.ts`   |
| 2   | Cycles only advance when a human runs a script         | `pollingLoop.ts`      |
| 3   | No way for UptimeRobot / Railway to see degradation    | `healthServer.ts`     |
| 4   | Flaky RPC → silent "no pools" → /health stays ok       | `rpcHealth.ts`        |
| 5   | Hardcoded `memcmp` offset desyncs after struct edits   | `fetchActivePools.ts` |
| 6   | INFRA blip indistinguishable from on-chain LOGIC error | `classifyError.ts`    |

## Env vars

| Name                            | Required    | Default | Notes                                                                                                                          |
| ------------------------------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SOLANA_RPC_URL`                | yes         | —       | Devnet/mainnet RPC. Single endpoint; multi-RPC quorum is the indexer's job, not the crank's.                                   |
| `ROUNDFI_CORE_PROGRAM_ID`       | yes         | —       | Pinned per cluster — devnet ≠ mainnet.                                                                                         |
| `ROUNDFI_REPUTATION_PROGRAM_ID` | yes         | —       | Pinned per cluster.                                                                                                            |
| `CRANK_KEYPAIR`                 | yes         | —       | Base58 secret key (devnet/local) OR JSON byte array (Solana CLI export). Pays gas on `settle_default`. **Must hold SOL.**      |
| `POLL_INTERVAL_MS`              | no          | `60000` | 60s catches grace-deadline crossings within a minute without melting RPC quota.                                                |
| `HEALTH_PORT`                   | no          | `3000`  | UptimeRobot hits `/health` on this port.                                                                                       |
| `CRANK_LEASE_ENABLED`           | no          | `false` | Set `true` when running ≥2 replicas (Railway autoscale, blue-green). Single-instance dev leaves it off.                        |
| `DATABASE_URL`                  | conditional | —       | Required iff `CRANK_LEASE_ENABLED=true`. Reuses the indexer's Postgres (Prisma `reconciler_lease` table; ROW id `crank-main`). |

## Local run

```sh
pnpm --filter @roundfi/crank install
pnpm --filter @roundfi/crank dev   # tsx watch
```

For a one-shot tick (no loop):

```sh
SOLANA_RPC_URL=https://api.devnet.solana.com \
ROUNDFI_CORE_PROGRAM_ID=<devnet core pk> \
ROUNDFI_REPUTATION_PROGRAM_ID=<devnet rep pk> \
CRANK_KEYPAIR=<base58> \
pnpm --filter @roundfi/crank start
```

## /health contract

UptimeRobot keys off HTTP status (not JSON body), so the mapping is
load-bearing:

| Body status | HTTP | When                                                 |
| ----------- | ---- | ---------------------------------------------------- |
| `starting`  | 200  | First 5 min of process life (Railway redeploy grace) |
| `ok`        | 200  | Last successful tick was < 5 min ago                 |
| `degraded`  | 503  | Past boot grace AND no successful tick in 5 min      |

A "successful tick" is: lease held (or no-op lease) → RPC reachable →
`fetchActivePools` returned → per-pool catch finished. A LOGIC failure
in one pool does NOT downgrade the tick; the pool's own log line is the
escalation path.

## INFRA_FAILURE vs PAYMENT_MISSED

The on-chain `settle_default` instruction has no `reason` arg (would
require a core PR + new audit). The crank emits the classification in
the structured log so the indexer + admin score-contestation UI can
flip the verdict off-chain:

- `INFRA_FAILURE`: the crank's RPC was down at or before this member's
  grace deadline. The missed contribution isn't necessarily theirs to
  own — eligible for off-chain score reversal.
- `PAYMENT_MISSED`: RPC was healthy across the deadline. Member simply
  didn't pay.

## Multi-replica (Postgres lease)

Mirrors the indexer's reconciler lease pattern (Wave 9.2, PR #431):
single Postgres row `reconciler_lease.id = 'crank-main'`, TTL 90s
(1.5× the default poll interval). The lease holder advances its own
`acquiredAt`; followers' `tryAcquire` matches the WHERE-clause cutoff
and skips the tick with an `event_type: tick.no_lease` log.

Leaving `CRANK_LEASE_ENABLED=false` avoids the Postgres coupling in
dev / single-replica deployments.

## Deployment notes

- **Railway**: 1 worker by default. If you scale to ≥2, set
  `CRANK_LEASE_ENABLED=true` + `DATABASE_URL` and the lease will gate
  the active worker.
- **UptimeRobot**: HTTP keyword monitor on `/health`, alert on `5xx`.
  Don't key off the JSON body — the 503/200 split is the contract.
- **Cranker keypair funding**: ~0.01 SOL per `settle_default` is the
  rough upper bound observed on devnet (one CPI to reputation, one
  burn, ATA writes). Top up before each cycle's grace window opens.

## Tests

```sh
pnpm --filter @roundfi/crank test
```

Covers the four pure surfaces:

- `classifyError.spec.ts` — INFRA/LOGIC/UNKNOWN bucket boundaries.
- `healthServer.spec.ts` — starting/ok/degraded transitions, 503 mapping.
- `settleDefaults.spec.ts` — eligibility + INFRA_FAILURE classification.
- `pollingLoop.spec.ts` — lease gating, RPC skip, per-pool isolation.

The actual `settle_default` CPI is integration-level — covered in the
bankrun / litesvm lanes, not here.
