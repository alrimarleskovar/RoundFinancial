# @roundfi/indexer

> Helius-webhook + RPC backfill service that hydrates Postgres from
> the on-chain RoundFi state. Phase 3's B2B oracle reads from this
> DB; the front-end reads on-chain directly today.

**Status:** scaffold landed in this PR. Wired against the same SDK
helpers the front-end uses (`@roundfi/sdk` IDL-free decoders).
NOT running on a real cluster yet — see the "Run locally" section
below for the path that proves it.

---

## What it does

```
        ┌─ Helius webhook ────────────┐
        │  POST /webhook/helius       │
on-chain│  (Anchor logs → events)     │
event   ├─────────────────────────────┤
        │  parse logs (decoder.ts)    │
        │      ↓                      │
        │  upsert events (webhook.ts) │
        │      ↓                      │
        │  Postgres (Prisma)          │
        └─────────────────────────────┘
                      ↑
        ┌─ getProgramAccounts ───────┐
        │  pnpm backfill              │
        │  decode pool/member raw     │
        │  upsert canonical rows      │
        └─────────────────────────────┘
                      ↓
        ┌─ Phase-3 B2B oracle ───────┐
        │  GET /b2b/score             │
        │  (separate service, future) │
        └─────────────────────────────┘
```

The webhook handler is fast-path: parse logs → insert event row.
The backfiller is slow-path: paginated `getProgramAccounts` over the
core program → decode every Pool + Member account → upsert.

A separate **reconciler** (TODO; not in this scaffold) joins the
`txSignature`-keyed event rows to canonical Pool/Member rows. The
event tables intentionally accept dangling FK targets so the webhook
can run at full RPC throughput without an inline lookup per event.

## Schema highlights

- **`pools`** — one row per `roundfi-core::Pool` PDA. Holds both the
  immutable config (installment, cycles, bps splits) and the mutable
  state (currentCycle, balances, defaultedMembers). Updated by both
  the webhook (event-driven) and the backfiller (full sweep).
- **`members`** — one row per `roundfi-core::Member` PDA. Tracks the
  Triple Shield invariants: `stakeDepositedInitial`,
  `totalEscrowDeposited` (the "_initial_" anchors that never mutate),
  plus the live `stakeDeposited`, `escrowBalance`, `defaulted`.
- **`attestations`** — one row per `roundfi-reputation::Attestation`
  PDA. The B2B score API joins on `(subject, schemaId)` to compute
  the wallet's reputation tier.
- **`contribute_events` / `claim_events` / `default_events`** —
  immutable append-only log, one row per landed tx. Event tables
  carry the same fields the on-chain `msg!` summary emits.

See `prisma/schema.prisma` for the full DDL.

## Run locally

You need:

- Postgres 15+ (`docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15`)
- Node 20 + pnpm 9

```bash
# Install
pnpm install

# Set the DB URL
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/roundfi_indexer"

# First-time schema migrate (creates the DB + tables)
pnpm --filter @roundfi/indexer prisma:migrate

# Backfill from devnet — uses the deployed core program
ROUNDFI_CORE_PROGRAM_ID=8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw \
SOLANA_RPC_URL=https://api.devnet.solana.com \
pnpm --filter @roundfi/indexer backfill

# Start the webhook listener
pnpm --filter @roundfi/indexer dev
# → indexer listening on http://0.0.0.0:8787
```

Test the webhook with a synthetic Helius payload:

```bash
curl -X POST http://localhost:8787/webhook/helius \
  -H 'Content-Type: application/json' \
  -d '[{
    "signature": "test-sig-1",
    "slot": 123456,
    "timestamp": 1778195000,
    "meta": {
      "logMessages": [
        "Program log: roundfi-core: contribute cycle=1 member=DC5Dcf7j365ca4ZCeSqqpiqxhaQVdgagRivQQpU4xgah installment=10000000 solidarity=100000 escrow=2500000 pool_float=7400000 on_time=false"
      ]
    }
  }]'
```

Health check + lag metric:

```bash
curl http://localhost:8787/healthz
curl http://localhost:8787/metrics
```

## Production wiring (Phase 3)

In production this service runs behind a reverse proxy with the
Helius webhook URL configured in their dashboard to point at
`https://indexer.roundfi.example/webhook/helius`. The
[`scripts/devnet/init-protocol.ts`](../../scripts/devnet/init-protocol.ts)
deployer would also register the webhook automatically once
mainnet ships.

Required env vars:

- `DATABASE_URL` — Postgres connection string
- `ROUNDFI_CORE_PROGRAM_ID` — pinned per cluster (devnet vs mainnet)
- `SOLANA_RPC_URL` — Helius / Triton / public devnet
- `INDEXER_PORT` (default 8787)
- `INDEXER_HOST` (default 0.0.0.0)
- `LOG_LEVEL` (default info)

## What's NOT here yet

This scaffold is intentionally minimal — the goal is to prove the
architecture works end-to-end, not to ship a production service.
Follow-ups (in priority order):

1. **Reconciler job** — periodic worker that resolves
   `_unresolved` FK targets in event tables to canonical Pool/Member
   rows. Runs every 30s.
2. **`getSignaturesForAddress` backfill** — for each Pool PDA, fetch
   every signature, replay events. Closes the gap between deploy
   time and first webhook delivery.
3. **Websocket fallback** — `connection.onLogs(programId, ...)` for
   when Helius is down (or in self-hosted setups). Same
   `parseLogMessages` pipeline; different ingress.
4. **Decoder unit tests** — `decoder.test.ts` against the actual log
   strings captured from the on-chain run. Gated on bankrun harness
   migration so we can fixture.
5. **Prometheus metrics** — `/metrics` returns JSON today; should
   emit OpenMetrics format (`prom-client` lib).
6. **The B2B oracle itself** (`packages/api/`) — Fastify HTTP API
   with API-key gating that exposes `GET /b2b/score`. Subscribes to
   this DB; lives in a separate service for blast-radius isolation.
